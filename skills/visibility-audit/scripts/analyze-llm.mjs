// The LLM half of the audit: 15 criteria are graded by reading the page, and press coverage
// is counted by filtering search results. Four grading prompts + one filter prompt, ported
// VERBATIM from `backend/src/modules/website-audit/prompts/audit-{llm,faq}.prompt.ts` — the wording
// IS the calibration, so changing it changes everyone's score. Re-port, never rewrite.
//
// Bands are discrete (0 / 50 / 100, or "na" where the rule allows it) with a one-sentence
// reason. Discrete bands are why two different models still land on comparable numbers.
//
// Usage:
//   node analyze-llm.mjs --pages pages.json --meta meta.json --offstore offstore.json \
//     --route anthropic --out llm.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pickRoute, runJson } from './llm.mjs'
import {
  buildFaqAnalysis,
  buildFaqPool,
  faqFailedResult,
  faqGateResult,
  hasQuestionSignal,
  sanitizePairs,
} from './faq-analysis.mjs'
import { resolveSubject } from './subject.mjs'
import {
  buildRawHaystack,
  extractMainText,
  htmlToText,
  isMainModule,
  normalizeForMatch,
  parseArgv,
  parseJsonLd,
  textPresentInRaw,
} from './util.mjs'

const CONTENT_CAP = 8000
// Page text is a supporting source, not the main one — keep it from crowding the rest out.
const PAGE_CONTENT_CAP = 6000

export const CONTENT_LLM_KEYS = [
  'specifications',
  'compatibility-sizing',
  'safety-materials',
  'benefits-outcomes',
  'limitations-honest',
  'comparison-alternatives',
  'who-is-it-for',
  'faq-product',
  'troubleshooting-care',
]

// Voice batch: its prompt carries the merchant's copy and nothing else, so structured data
// and machine-extracted page text CANNOT leak into a band that measures the shop's voice —
// telling the model to ignore them was measured and did not hold (backend ADR-0042).
export const VOICE_LLM_KEYS = ['unique-description', 'answer-formatting']

const VOICE_RULES = `You grade ONLY the merchant's own product copy for an e-commerce page. For EACH criterion return band 0, 50, or 100 + a one-sentence reason grounded in the text. The text below is what the merchant wrote themselves; grade nothing else.

- unique-description: ONLY the "own-voice vs copied/boilerplate" axis (NOT richness, NOT length). 0 = empty/placeholder/verbatim manufacturer copy; 50 = generic boilerplate ("high quality, premium materials") or lightly reworded manufacturer text; 100 = distinct shop voice.
- answer-formatting: answer-first, one-idea short chunks. 0 = wall of text; 50 = mixed; 100 = mostly short answer-first chunks.`

export const CREDIBILITY_LLM_KEYS = [
  'about-page',
  'policies-quality',
  'onsite-reviews',
  'shipping-competitive',
]

const CONTENT_RULES = `You grade an e-commerce product page for AI-visibility. For EACH criterion return band 0, 50, or 100 (or "na" where allowed) + a one-sentence reason grounded in the text.

You are given UP TO THREE evidence sections: "## PRODUCT TEXT" (the merchant-written product description), "## FAQ" (Q&A extracted from the page's FAQPage structured data) and "## PAGE CONTENT" (the visible text of the rendered product page, page furniture already stripped — this is where theme sections and app blocks live: spec tables, ingredients, how-to-use, care, and FAQ accordions that emit no structured data). A section is OMITTED ENTIRELY when that source is empty or would only repeat another section — its absence means "this source was not available", it NEVER means "the page lacks that content". A shopper and an AI crawler both read all three, so they are ONE pool of evidence: grade what the page actually offers, wherever in the pool you find it, and never lower a band merely because the evidence sat in a different section than you expected.

"## PAGE CONTENT" is machine-extracted, so it can still carry price/variant labels, review-widget lines and, on some themes, blocks about OTHER products. Use it only for statements clearly about THIS product (see "## PRODUCT" for its title); ignore the rest instead of grading it.

- specifications: concrete spec attributes with number+unit (kg, cm, W, ml...) in discrete/table form. 0 = none/only vague adjectives; 50 = 1-3 specs OR missing units OR buried in prose; 100 = >=4 number+unit attributes in discrete/table form.
- compatibility-sizing: applies ONLY to wearables (needs size chart vs body measurements) or accessories/parts (needs compatibility list). If product is neither -> "na". 0 = none; 50 = partial (only S/M/L, vague compat); 100 = clear size chart or specific compatibility list.
- safety-materials: applies ONLY to ingestible/skin-contact/kids/health products. If not -> "na". 0 = missing certs AND ingredients; 50 = partial; 100 = clear safety certs/claims + ingredient/allergen list.
- benefits-outcomes: 0 = only feature list; 50 = vague benefits; 100 = clear outcome-oriented benefits tied to buyer goals.
- limitations-honest: 0 = all-positive; 50 = vague hedge; 100 = >=1 specific honest limitation/tradeoff.
- comparison-alternatives: 0 = none; 50 = vague "better than"; 100 = specific comparison to >=1 alternative + who-it-fits verdict.
- who-is-it-for: 0 = no audience named; 50 = 1 audience/implied; 100 = >=3 specific audiences/use-cases.
- faq-product: buyer Q&A from ALL sections counts as one pool, wherever it lives (description, structured data, or a theme FAQ accordion in "## PAGE CONTENT"). Grade the QUALITY of the answers, not the presence of a FAQ block. 0 = no Q&A anywhere; 50 = 1-2 Q&A, or answers that are one-liners (<~25 words) needing the page around them to make sense; 100 = >=3 real buyer Q&A each self-contained (~40-60 words) and quotable on its own.
- troubleshooting-care: post-purchase lifecycle content (care/cleaning, troubleshooting, maintenance/lifespan). If product is single-use/consumable -> "na". 0 = none; 50 = thin 1-2 generic lines; 100 = clear guidance in >=1 area.`

const CREDIBILITY_RULES = `You grade a store's on-site credibility pages. For EACH criterion return band 0, 50, or 100 + a one-sentence reason grounded in the text. Judge only from the provided page text.

- about-page: identity substance (who/why/since-when), not placeholder. 0 = no About page OR placeholder/generic ("Welcome to our store!"); 50 = has text but 0 concrete identity anchors; 100 = >=2 anchors {origin story, named team/founder, specific mission} AND >150 words in a real voice.
- policies-quality: return/refund + shipping policy substance (real numbers). 0 = missing main policies OR template placeholders (bracket "[...]"/default boilerplate); 50 = policies exist but vague (no concrete window / who-pays-return-shipping / refund time); 100 = Return + Shipping have concrete numbers AND privacy/terms exist.
- onsite-reviews: ONLY the named-testimonial dimension on the store's own About/landing text (NOT the review widget count). 0 = none or only anonymous praise ("Great! - J."); 50 = >=1 named testimonial without a case study; 100 = a named testimonial AND a case study (before/after or a detailed named customer story).
- shipping-competitive: attractiveness of the store's OWN free-shipping offer from the SHIPPING policy text (do NOT compare to rivals). NEVER "na" — always return 0/50/100. Judge against TARGET COUNTRY and the given TYPICAL ITEM PRICE (proxy for a normal basket). Band 0 ONLY when the store offers NO free shipping at all (every order pays a fee) OR the shipping terms are not visible in the text. CRITICAL: if the text mentions ANY free-shipping offer, the MINIMUM band is 50 — NEVER 0 — no matter how high the threshold is (a 500-order threshold on a 90 item is still 50, not 0). 50 = free shipping EXISTS but its threshold is above the typical item price (buyer must combine several items) OR it covers only part of the target country. 100 = free shipping reachable with ~1 typical item (threshold <= typical item price, or free on all orders) AND it covers the target country. If no typical item price is given, judge threshold reachability qualitatively.`

const PRESS_RULES = `You filter web results to count DISTINCT earned press/authority coverage for a brand. Keep a result ONLY if it is (a) a reputable news/editorial article that genuinely mentions the brand in its body-topic, OR (b) the brand appearing in a reputable third-party "best/top" ranked list. EXCLUDE: social media, the brand's own domain (self-PR), self-serve PR-wire (Issuewire, BusinessWire, EIN, PRNewswire), spam/SEO farms. Dedup by URL. Return {count, kept[]} where count = number of distinct kept URLs and kept = those URLs. Be strict — one reputable source beats fifty junk ones.`

const shape = (keys) =>
  `Return: { ${keys.map((k) => `"${k}": { "band": "0"|"50"|"100"${k === 'shipping-competitive' ? '' : '|"na"'}, "reason": "..." }`).join(', ')} }`

// Empty section = OMITTED, never "(none)": printing the header with a placeholder made the
// model treat that section as the only valid source and ignore the same content sitting in
// another one (measured regression on a store whose FAQ lives in the description).
export function buildContentPrompt(
  product,
  { faqText = '', pageText = '', descriptionText = null } = {},
) {
  const productText = descriptionText ?? htmlToText(product.description, CONTENT_CAP)
  const faqSection = faqText ? `\n\n## FAQ (from page structured data)\n${faqText}` : ''
  const pageSection = pageText
    ? `\n\n## PAGE CONTENT (rendered page, theme sections and app blocks)\n${pageText}`
    : ''
  return `${CONTENT_RULES}

${shape(CONTENT_LLM_KEYS)}

## PRODUCT
- title: ${product.title}
- vendor: ${product.vendor ?? '(unknown)'}
- type: ${product.productType ?? '(unknown)'}

## PRODUCT TEXT
${productText || '(empty)'}${faqSection}${pageSection}`
}

// ≥80% of the questions already sitting in ## PAGE CONTENT makes the ## FAQ section pure
// prompt cost (measured: 10/10 duplicated, 21.5% of the prompt) without adding a fact.
// Dropping it from the PROMPT is not dropping it from evidence — faq-schema still reads it.
export function faqSectionRedundant(faqText, pageText, threshold = 0.8) {
  const page = normalizeForMatch(pageText)
  const questions = faqText
    .split('\n\n')
    .map((pair) => normalizeForMatch(pair.split('\n')[0].replace(/^q:\s*/i, '')))
    .filter(Boolean)
  if (!questions.length || !page) return false
  return questions.filter((q) => page.includes(q)).length / questions.length >= threshold
}

// Q&A from the page's FAQPage JSON-LD — the source a theme accordion emits when the shop
// uses a FAQ app, and one no product description ever carries.
export function extractFaqText(jsonLd, cap = 4000) {
  const faq = (jsonLd?.raw ?? []).find((n) => {
    const t = n?.['@type']
    return Array.isArray(t) ? t.includes('FAQPage') : t === 'FAQPage'
  })
  if (!faq) return ''
  const entity = faq.mainEntity
  const questions = Array.isArray(entity) ? entity : entity != null ? [entity] : []
  const pairs = []
  for (const q of questions) {
    const name = typeof q?.name === 'string' ? q.name.trim() : ''
    const raw = q?.acceptedAnswer?.text
    const answer = typeof raw === 'string' ? htmlToText(raw, cap) : ''
    if (name && answer) pairs.push(`Q: ${name}\nA: ${answer}`)
  }
  return pairs.join('\n\n').slice(0, cap)
}

// The description comes from /products/<handle>.json, an endpoint no AI crawler calls. Keep
// it only when the same words really sit in the pre-JS HTML, else fall to the JSON-LD
// description, else let PAGE CONTENT carry the page on its own.
export function resolveDescriptionText(product, jsonLd, rawHaystack) {
  const fromJson = htmlToText(product?.description, CONTENT_CAP)
  if (textPresentInRaw(fromJson, rawHaystack)) return fromJson
  const ld = typeof jsonLd?.product?.description === 'string' ? jsonLd.product.description : null
  const fromLd = htmlToText(ld, CONTENT_CAP)
  return textPresentInRaw(fromLd, rawHaystack) ? fromLd : ''
}

export function buildVoicePrompt(product, descriptionText = null) {
  return `${VOICE_RULES}

${shape(VOICE_LLM_KEYS)}

## PRODUCT
- title: ${product.title}
- vendor: ${product.vendor ?? '(unknown)'}
- type: ${product.productType ?? '(unknown)'}

## PRODUCT TEXT
${(descriptionText ?? htmlToText(product.description, CONTENT_CAP)) || '(empty)'}`
}

export function buildCredibilityPrompt(input) {
  const price =
    input.productPrice != null
      ? `${input.productPrice}${input.currency ? ` ${input.currency}` : ''}`
      : '(unknown)'
  return `${CREDIBILITY_RULES}

${shape(CREDIBILITY_LLM_KEYS)}

## ABOUT PAGE
${input.aboutText || '(no About page found)'}

## POLICY PAGES
${input.policiesText || '(no policy pages found)'}

## SHIPPING CONTEXT (for shipping-competitive)
- target country: ${input.targetCountry ?? '(unknown)'}
- typical item price: ${price}`
}

export function buildPressPrompt({ brand, results }) {
  const list = results
    .map(
      (r, i) =>
        `${i + 1}. url: ${r.link}\n   source: ${r.source}\n   title: ${r.title}\n   snippet: ${r.snippet}`,
    )
    .join('\n')
  return `${PRESS_RULES}

Return: { "count": <integer>, "kept": ["<url>", ...] }

## BRAND
${brand}

## RESULTS
${list || '(none)'}`
}

// Store pages are full HTML (nav/footer included) → take the main region so the model does not
// grade a cookie banner as the About page.
export function buildCredibilityInput(pages, subject) {
  const policies = pages?.storePages?.policies ?? {}
  const policiesText = [
    ['Return/Refund', policies.refund],
    ['Shipping', policies.shipping],
    ['Privacy', policies.privacy],
    ['Terms', policies.terms],
  ]
    .filter(([, p]) => p)
    .map(([label, p]) => `## ${label}\n${extractMainText(p.html, 3000)}`)
    .join('\n\n')
  return {
    aboutText: extractMainText(pages?.storePages?.about?.html, CONTENT_CAP),
    policiesText,
    productPrice: subject.product.price,
    currency: subject.product.currency,
    targetCountry: subject.location.country,
  }
}

const BANDS = new Set(['0', '50', '100', 'na'])

// Keep only well-formed entries for the keys we asked about; a malformed one is simply absent,
// which the scorer reads as `na` — better than coercing junk into a number.
export function normalizeBands(parsed, keys) {
  const out = {}
  for (const key of keys) {
    const v = parsed?.[key]
    if (!v) continue
    const band = String(v.band ?? v.score ?? '').trim()
    if (!BANDS.has(band)) continue
    out[key] = {
      band: band === 'na' ? 'na' : Number(band),
      reason: typeof v.reason === 'string' ? v.reason : '',
    }
  }
  return out
}

export function normalizePress(parsed) {
  const kept = Array.isArray(parsed?.kept) ? parsed.kept.filter((u) => typeof u === 'string') : []
  const count = Number.isInteger(parsed?.count) ? parsed.count : kept.length
  return { count: Math.max(0, count), kept }
}

// `faq-product` has its OWN prompt: it returns PAIRS with four flags each, not a band.
// Ported verbatim from backend/src/modules/website-audit/prompts/audit-faq.prompt.ts.
export const FAQ_PAIRS_RULES = `You extract and grade the FAQ content of an e-commerce product page.
Judge only from the provided product page text. It may contain navigation,
promos and review widgets; ignore those.

STEP 1 — Extract every question-and-answer pair, no matter who wrote them or
where they sit: product description, FAQ section, accordion, a heading phrased
as a question with its answer right after, or a customer question thread with
staff replies. A pair counts only when an answer sits next to its question. An
empty "ask us a question" form with no pairs is not a pair. Copy both sides
VERBATIM — do not paraphrase, shorten, or fix typos. Empty list if none.

STEP 2 — Judge EACH PAIR ON ITS OWN with 4 booleans. Do NOT summarise across
pairs; a later step aggregates them.
- intentOk: is this what a buyer asks BEFORE buying (shipping, returns, fit,
  how to use, safety, ingredients)? false for self-promotional confirmations
  ("Is it a good brightening cream?").
- phrasingOk: is it written the way a shopper asks an assistant — a natural,
  complete question? false for keyword fragments ("warranty?").
- completeOk: does the answer ADD something the question did not already
  contain? Set it false when the answer merely restates the question in the
  affirmative ("Is it suitable for all skin types?" -> "Yes, it is suitable for
  all skin types"), hedges with no concrete detail, or needs the rest of the
  page to make sense. Saying yes or no is not enough on its own: the answer
  must give the buyer at least one fact they did not already have from the
  question. Pointing to a qualified professional (doctor, vet, electrician,
  installer) is NOT a failure by itself, as long as the answer still states
  the product facts.
- formatOk: does the first sentence answer directly AND carry something
  checkable — a number, measurement, timeframe, material, ingredient, standard,
  certification, compatible model or named part? false if it opens with
  marketing or gives only unquantified claims.

Do NOT judge how long an answer is — length is measured separately.`

export function buildFaqPairsPrompt(product, poolText) {
  return `${FAQ_PAIRS_RULES}

Return JSON: { "pairs": [ { "q": "...", "a": "...", "intentOk": true|false,
  "phrasingOk": true|false, "completeOk": true|false, "formatOk": true|false } ] }

## PRODUCT
- title: ${product.title}
- vendor: ${product.vendor ?? '(unknown)'}
- type: ${product.productType ?? '(unknown)'}

## PAGE TEXT
${poolText}`
}

// The pool is extracted TWICE: the pre-JS pass is graded, the post-JS pass only counts
// reach. With one pass no pair can ever be jsOnly, so a store that hides ten answers
// behind JavaScript is diagnosed exactly like a store that never wrote a FAQ — one needs
// server rendering, the other needs someone to sit down and write.
export async function collectFaq({ product, sources, opts }) {
  const pool = buildFaqPool(sources)
  if (!hasQuestionSignal(pool)) return faqGateResult('no-question-signal', sources)
  try {
    const first = await runJson(buildFaqPairsPrompt(product, pool), opts)
    const scoredPairs = Array.isArray(first?.pairs) ? first.pairs : []
    // Second pass only when the first found almost nothing (3 = the countBand threshold,
    // not a new number) and the rendered page really differs from the source.
    let seenPairs = []
    if (sanitizePairs(scoredPairs, pool).pairs.length < 3 && sources.seenText !== sources.pageText) {
      const second = await runJson(
        buildFaqPairsPrompt(product, `## PAGE CONTENT\n${sources.seenText}`),
        opts,
      )
      seenPairs = Array.isArray(second?.pairs) ? second.pairs : []
    }
    return buildFaqAnalysis({ scoredPairs, seenPairs, sources })
  } catch (e) {
    process.stderr.write(`warning: faq-product batch failed: ${e.message}\n`)
    return faqFailedResult(sources)
  }
}

export async function analyze({ pages, meta, offstore, route, model, timeoutMs }) {
  const subject = resolveSubject(meta, pages)
  const opts = { route, model, timeoutMs }
  // Which of content/voice/credibility/faq/press threw and got caught rather than graded —
  // written into the output (see `main`) so a run where every batch failed is distinguishable
  // from a store that is genuinely thin. Both leave the same criteria `na`, so without this a
  // total-failure run "looks like" a bad page instead of an unmeasured one (audit incident H).
  const failedBatches = []
  const warn = (label) => (e) => {
    process.stderr.write(`warning: ${label} batch failed: ${e.message}\n`)
    failedBatches.push(label)
    return {}
  }

  // Separate batches so one failure costs one cluster, not the whole audit.
  // Grade the PRE-JS HTML: AI crawlers do not execute JS, so the rendered copy would score
  // text three of the four engines never see.
  const rawHtml = pages?.page?.rawSourceHtml || pages?.page?.renderedHtml || ''
  const jsonLd = parseJsonLd(rawHtml)
  const pageText = extractMainText(rawHtml, PAGE_CONTENT_CAP)
  const faqText = extractFaqText(jsonLd)
  const contentSources = {
    descriptionText: resolveDescriptionText(subject.product, jsonLd, buildRawHaystack(rawHtml)),
    faqText: faqSectionRedundant(faqText, pageText) ? '' : faqText,
    pageText,
  }

  const faqSources = {
    productText: contentSources.descriptionText,
    // Full JSON-LD FAQ on purpose, NOT the deduped one the prompt gets: here it decides
    // whether a pair lives in markup or in visible text, it is not being graded.
    faqText,
    pageText,
    seenText: extractMainText(pages?.page?.renderedHtml || rawHtml, PAGE_CONTENT_CAP),
    contentSource: contentSources.descriptionText ? 'live' : 'page',
  }

  const [content, voice, credibility, faq] = await Promise.all([
    runJson(buildContentPrompt(subject.product, contentSources), opts)
      .then((p) => normalizeBands(p, CONTENT_LLM_KEYS))
      .catch(warn('content')),
    runJson(buildVoicePrompt(subject.product, contentSources.descriptionText), opts)
      .then((p) => normalizeBands(p, VOICE_LLM_KEYS))
      .catch(warn('voice')),
    runJson(buildCredibilityPrompt(buildCredibilityInput(pages, subject)), opts)
      .then((p) => normalizeBands(p, CREDIBILITY_LLM_KEYS))
      .catch(warn('credibility')),
    collectFaq({ product: subject.product, sources: faqSources, opts }),
  ])

  let press = null
  const candidates = offstore?.press?.candidates ?? null
  if (candidates) {
    press = await runJson(buildPressPrompt({ brand: subject.shop.name, results: candidates }), opts)
      .then(normalizePress)
      .catch((e) => {
        process.stderr.write(`warning: press filter failed: ${e.message}\n`)
        failedBatches.push('press')
        return null
      })
  }
  // faq-product's own call catches internally (see collectFaq) rather than rejecting, so it
  // never hits `warn` above — read its result status instead.
  if (faq?.status === 'llm-failed') failedBatches.push('faq')

  return {
    generatedAt: new Date().toISOString(),
    route,
    model: model ?? null,
    analysis: { ...content, ...voice, ...credibility },
    faq,
    press,
    failedBatches,
  }
}

// `--meta` / `--offstore` are optional lanes — SKILL.md says omitting either flag never fails
// the run. A path that IS given but does not exist on disk now gets the same treatment:
// incident A found this throwing a bare ENOENT and killing P4b whenever it ran before P4a had
// written `offstore.json` (or off-store never ran at all, e.g. no SerpApi key), even though
// nothing downstream actually needs the file to exist — `analyze()` already treats a `null`
// offstore/meta as "that lane did not run". Any OTHER read failure (malformed JSON,
// permissions) still throws: only "file genuinely absent" degrades. Exported so this can be
// unit-tested without a real LLM call.
export function readOptionalJson(p, label, readFile = readFileSync) {
  if (!p) return null
  try {
    return JSON.parse(readFile(p, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') {
      process.stderr.write(`warning: ${label} not found at ${p} — that lane did not run\n`)
      return null
    }
    throw e
  }
}

export async function main(argv) {
  const a = parseArgv(argv)
  if (!a.pages) throw new Error('--pages pages.json is required')

  const result = await analyze({
    pages: JSON.parse(readFileSync(a.pages, 'utf8')),
    meta: readOptionalJson(a.meta, 'meta'),
    offstore: readOptionalJson(a.offstore, 'offstore'),
    route: a.route ?? pickRoute(),
    model: a.model ?? null,
    timeoutMs: a['timeout-ms'] ? Number(a['timeout-ms']) : 180000,
  })

  if (a.out) {
    mkdirSync(dirname(a.out), { recursive: true })
    writeFileSync(a.out, JSON.stringify(result, null, 2))
  }
  const graded = Object.keys(result.analysis)
  return {
    out: a.out ?? null,
    route: result.route,
    graded: graded.length,
    missing: [...CONTENT_LLM_KEYS, ...VOICE_LLM_KEYS, ...CREDIBILITY_LLM_KEYS].filter(
      (k) => !graded.includes(k),
    ),
    // Which batches threw rather than graded (also written into llm.json itself — see
    // `analyze`) — read this before treating a thin-looking report as a finding.
    failedBatches: result.failedBatches,
    pressCount: result.press?.count ?? null,
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e.message)
      process.exit(1)
    })
}
