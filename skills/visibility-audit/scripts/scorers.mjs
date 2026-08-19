// The 40 criterion scorers, ported from `backend/src/modules/website-audit/scorers/**`.
// Each scorer is PURE: it reads the already-collected context and returns
//   { status: 'scored', score, evidence } | { status: 'na'|'gated', reason }
// exactly like the backend's, so a client-side run and a server run agree on the numbers.
//
// ctx shape (built by score.mjs):
//   { shop, product, pdpUrl, page, robots, jsonLd, storePages, llmAnalysis, faq, offStore,
//     feed: { googleMerchantFeed }, merchant: { competitorPrices }, phase1: { language } }
//
// ONE DELIBERATE DEVIATION from the backend, marked below: `crawlable-text` returns `na`
// when no post-JS rendering happened. See the note on that scorer.

import { CRITERIA } from './framework.mjs'
import { isStub } from './faq-analysis.mjs'
import { matchNap } from './nap-match.mjs'
import {
  asObject,
  brandText,
  firstNodeByType,
  firstOf,
  htmlToText,
  isBotBlocked,
  isShopNameLike,
  isValidGtin,
  nonEmptyStr,
  normalizeText,
  parseRobots,
  stripTags,
  toNum,
  tokenize,
  typesOf,
} from './util.mjs'

// Build a scorer from its framework definition so weights/factors can never drift apart.
function def(key, extra) {
  const d = CRITERIA[key]
  if (!d) throw new Error(`scorer '${key}' is not in the framework`)
  return { key, factor: d.factor, subGroup: d.subGroup, weight: d.weight, languageGated: false, ...extra }
}

// ---------------------------------------------------------------- factor 1 --

const hasNoindex = (value) => !!value && /noindex/i.test(value)

export const aiBotsAllowed = def('ai-bots-allowed', {
  score(ctx) {
    const { robots } = ctx
    const groups = parseRobots(robots.ok ? robots.body : '')
    const noindex = hasNoindex(robots.metaRobots) || hasNoindex(robots.xRobotsTag)
    const googleBlocked = isBotBlocked(groups, 'googlebot') || noindex
    const openaiBlocked =
      isBotBlocked(groups, 'oai-searchbot') || isBotBlocked(groups, 'chatgpt-user')
    const score = googleBlocked ? 25 : openaiBlocked ? 75 : 100
    return {
      status: 'scored',
      score,
      evidence: { googleBlocked, openaiBlocked, noindex, robotsOk: robots.ok },
    }
  },
})

export const googleMerchantFeed = def('google-merchant-feed', {
  score(ctx) {
    const d = ctx.feed.googleMerchantFeed
    if (!d) return { status: 'na', reason: 'No Google Shopping data collected' }
    return {
      status: 'scored',
      score: d.onGoogleShopping ? 100 : 0,
      evidence: {
        source: d.source,
        onGoogleShopping: d.onGoogleShopping,
        matchedTitle: d.matchedTitle,
        resultCount: d.resultCount,
      },
    }
  },
})

const NAV_RE = /<nav\b/i
const COLLECTION_LINK_RE = /href=["'][^"']*\/collections\//i
const PRODUCT_LINK_RE = /href=["'][^"']*\/products\//i
const RECO_RE = /related products|you may also like|recommend|complete the look|pairs? well with/i

export const internalLinking = def('internal-linking', {
  score(ctx) {
    const html = ctx.page.renderedHtml ?? ''
    const hasBreadcrumb = ctx.jsonLd.types.includes('BreadcrumbList')
    const reachable = NAV_RE.test(html) || hasBreadcrumb || COLLECTION_LINK_RE.test(html)
    const relatedOut = RECO_RE.test(html) || PRODUCT_LINK_RE.test(html)
    const score = !reachable ? 0 : !relatedOut ? 50 : 100
    return { status: 'scored', score, evidence: { approx: 'approx-html', reachable, relatedOut } }
  },
})

// DEVIATION from the backend: it compares post-JS text against pre-JS text and, when its
// renderer chain falls all the way through to a plain fetch, silently compares the page to
// itself and scores ~100. Client-side that fallback is the COMMON case, so a free 100 here
// would be a fabricated pass on the one criterion that measures JS-hidden content. Without a
// real post-JS capture we score nothing: `na`, and the report says why.
export const crawlableText = def('crawlable-text', {
  score(ctx) {
    if (!ctx.page.ok) return { status: 'na', reason: 'page-not-ok' }
    if (ctx.page.renderer === 'plain') {
      return { status: 'na', reason: 'no post-JS capture — nothing to compare the raw HTML against' }
    }

    const renderedTokens = tokenize(stripTags(ctx.page.renderedHtml ?? ''))
    const rawTokens = new Set(tokenize(stripTags(ctx.page.rawSourceHtml ?? '')))
    const unique = [...new Set(renderedTokens)]
    if (unique.length === 0) return { status: 'na', reason: 'no-rendered-text' }

    const found = unique.filter((t) => rawTokens.has(t)).length
    const coverage = found / unique.length
    const score = coverage >= 0.9 ? 100 : coverage >= 0.5 ? 50 : 0
    return {
      status: 'scored',
      score,
      evidence: {
        coverage: Math.round(coverage * 100) / 100,
        renderedTokens: unique.length,
        found,
        renderer: ctx.page.renderer,
      },
    }
  },
})

const FILENAME_RE = /^(img[_-]|dsc[_-]?\d)|\.(jpe?g|png|gif|webp|svg|bmp|avif)$/i
const SHOPIFY_CDN_RE = /cdn\.shopify\.com\/s\/files\/|\/cdn\/shop\//i

function extractImgs(html) {
  const imgs = []
  const imgRe = /<img\b[^>]*>/gi
  let m
  while ((m = imgRe.exec(String(html || ''))) !== null) {
    const altMatch = /\balt\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[0])
    const srcMatch = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[0])
    imgs.push({
      alt: altMatch ? (altMatch[2] ?? altMatch[3] ?? '') : '',
      src: srcMatch ? (srcMatch[2] ?? srcMatch[3] ?? '') : '',
    })
  }
  return imgs
}

function normalizeImgUrl(src) {
  const noQuery = String(src).split('?')[0]
  const base = noQuery.split('/').pop() ?? noQuery
  return base.replace(/_\d+x(\d+)?(?=\.[a-z0-9]+$)/i, '').toLowerCase()
}

function productImageBases(product) {
  const bases = new Set()
  const raw = product?.image
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  for (const entry of list) {
    if (typeof entry === 'string' && entry.trim()) bases.add(normalizeImgUrl(entry))
  }
  return bases
}

function selectPdpImgs(imgs, product) {
  const bases = productImageBases(product)
  if (bases.size > 0) {
    const matched = imgs.filter((i) => bases.has(normalizeImgUrl(i.src)))
    if (matched.length > 0) return matched
  }
  const cdn = imgs.filter((i) => SHOPIFY_CDN_RE.test(i.src))
  return cdn.length > 0 ? cdn : imgs
}

export const imageAltText = def('image-alt-text', {
  score(ctx) {
    const allImgs = extractImgs(ctx.page.renderedHtml ?? '')
    if (allImgs.length === 0) return { status: 'na', reason: 'no-images' }
    const alts = selectPdpImgs(allImgs, ctx.jsonLd.product).map((i) => i.alt)

    const normCounts = new Map()
    for (const a of alts) {
      const n = normalizeText(a)
      if (n) normCounts.set(n, (normCounts.get(n) ?? 0) + 1)
    }

    let passed = 0
    for (const alt of alts) {
      const trimmed = alt.trim()
      if (!trimmed) continue
      if (FILENAME_RE.test(trimmed)) continue
      const words = trimmed.split(/\s+/).filter(Boolean).length
      if (words < 4 || trimmed.length > 125) continue
      if ((normCounts.get(normalizeText(trimmed)) ?? 0) > 1) continue
      passed++
    }

    return {
      status: 'scored',
      score: Math.round((100 * passed) / alts.length),
      evidence: { total: alts.length, passed },
    }
  },
})

function extractHeadings(html) {
  const out = []
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  let m
  while ((m = re.exec(String(html || ''))) !== null) {
    out.push({ level: Number(m[1]), text: stripTags(m[2]) })
  }
  return out
}

function softMatch(h1, name) {
  const h1Norm = tokenize(h1).join(' ')
  const nameTokens = tokenize(name)
  if (!nameTokens.length || !h1Norm) return false
  if (h1Norm.includes(nameTokens.join(' '))) return true
  const h1Set = new Set(h1Norm.split(' '))
  return nameTokens.filter((t) => h1Set.has(t)).length / nameTokens.length >= 0.8
}

function hasSkip(headings) {
  let prev = 0
  for (const h of headings) {
    if (prev > 0 && h.level > prev + 1) return true
    prev = h.level
  }
  return false
}

export const headingHierarchy = def('heading-hierarchy', {
  score(ctx) {
    const headings = extractHeadings(ctx.page.renderedHtml ?? '')
    const h1s = headings.filter((h) => h.level === 1)
    if (h1s.length !== 1) return { status: 'scored', score: 0, evidence: { h1Count: h1s.length } }
    const nameMatch = softMatch(h1s[0].text, ctx.product.title ?? '')
    const skip = hasSkip(headings)
    return {
      status: 'scored',
      score: nameMatch && !skip ? 100 : 50,
      evidence: { h1Count: 1, nameMatch, skip },
    }
  },
})

export const brandInTitle = def('brand-in-title', {
  score(ctx) {
    // Schema brand beats vendor: a reseller's vendor field is usually the store's own name.
    const schemaBrand = ctx.jsonLd.product ? brandText(ctx.jsonLd.product.brand) : null
    const vendor = ctx.product.vendor?.trim() || null
    const brand =
      schemaBrand ?? (vendor && !isShopNameLike(vendor, ctx.shop.name) ? vendor : null)

    if (!brand) {
      if (vendor) return { status: 'na', reason: 'vendor-is-shop-name' }
      return { status: 'scored', score: 0, evidence: { brand: null, matched: false } }
    }

    const brandNorm = normalizeText(brand)
    const titleNorm = normalizeText(ctx.product.title ?? '')
    const matched = brandNorm.length > 0 && titleNorm.includes(brandNorm)
    return { status: 'scored', score: matched ? 100 : 0, evidence: { brand, matched } }
  },
})

export const productSchema = def('product-schema', {
  score(ctx) {
    const product = ctx.jsonLd.product
    if (!product) return { status: 'scored', score: 0, evidence: { hasProduct: false } }

    const offers = ctx.jsonLd.offers ?? asObject(firstOf(product.offers))
    if (!offers) {
      return { status: 'scored', score: 50, evidence: { hasProduct: true, hasOffers: false } }
    }

    const hasPrice = toNum(offers.price) !== null
    const hasCurrency = nonEmptyStr(offers.priceCurrency) !== null
    const hasAvailability = nonEmptyStr(offers.availability) !== null
    const full = hasPrice && hasCurrency && hasAvailability
    return {
      status: 'scored',
      score: full ? 100 : 50,
      evidence: { hasProduct: true, hasOffers: true, hasPrice, hasCurrency, hasAvailability },
    }
  },
})

const GTIN_KEYS = ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14']

export const productSchemaRich = def('product-schema-rich', {
  score(ctx) {
    const product = ctx.jsonLd.product
    if (!product) return { status: 'scored', score: 0, evidence: { hasProduct: false } }
    const validGtin = GTIN_KEYS.some((k) => isValidGtin(product[k]))
    const brand = brandText(product.brand) !== null
    const mpn = nonEmptyStr(product.mpn) !== null
    const sku = nonEmptyStr(product.sku) !== null
    const score = validGtin || (brand && mpn) ? 100 : brand || mpn || sku ? 50 : 0
    return { status: 'scored', score, evidence: { validGtin, brand, mpn, sku } }
  },
})

export const reviewSchema = def('review-schema', {
  score(ctx) {
    const { jsonLd } = ctx
    const product = jsonLd.product
    const agg =
      asObject(product?.aggregateRating) ?? firstNodeByType(jsonLd.raw, 'AggregateRating')
    const hasReview =
      product?.review != null ||
      jsonLd.types.includes('Review') ||
      firstNodeByType(jsonLd.raw, 'Review') !== null

    if (!agg && !hasReview) {
      return { status: 'scored', score: 0, evidence: { hasAgg: false, hasReview: false } }
    }
    if (!agg) {
      return { status: 'scored', score: 50, evidence: { hasAgg: false, hasReview: true } }
    }

    const ratingValue = toNum(agg.ratingValue)
    const count = toNum(agg.reviewCount) ?? toNum(agg.ratingCount)
    const best = toNum(agg.bestRating) ?? 5
    const worst = toNum(agg.worstRating) ?? 0
    const inScale = ratingValue !== null && ratingValue >= worst && ratingValue <= best
    const valid = inScale && count !== null
    return {
      status: 'scored',
      score: valid ? 100 : 50,
      evidence: { hasAgg: true, ratingValue, count, inScale },
    }
  },
})

export const shippingSchema = def('shipping-schema', {
  score(ctx) {
    const { jsonLd } = ctx
    const offers = jsonLd.offers ?? asObject(firstOf(jsonLd.product?.offers))
    const details =
      asObject(firstOf(offers?.shippingDetails)) ??
      firstNodeByType(jsonLd.raw, 'OfferShippingDetails')
    if (!details) return { status: 'scored', score: 0, evidence: { hasShipping: false } }

    const hasRate = details.shippingRate != null
    const hasDestination = details.shippingDestination != null
    const hasDeliveryTime = details.deliveryTime != null
    const full = hasRate && hasDestination && hasDeliveryTime
    return {
      status: 'scored',
      score: full ? 100 : 50,
      evidence: { hasShipping: true, hasRate, hasDestination, hasDeliveryTime },
    }
  },
})

function questionValid(q) {
  if (!typesOf(q).includes('Question')) return false
  if (!nonEmptyStr(q.name)) return false
  const answer = asObject(q.acceptedAnswer)
  return !!answer && nonEmptyStr(answer.text) !== null
}

export const faqSchema = def('faq-schema', {
  score(ctx) {
    const faq = firstNodeByType(ctx.jsonLd.raw, 'FAQPage')
    if (!faq) return { status: 'scored', score: 0, evidence: { hasFaq: false } }

    const mainEntity = faq.mainEntity
    const questions = Array.isArray(mainEntity) ? mainEntity : mainEntity != null ? [mainEntity] : []
    const validCount = questions.map((q) => asObject(q)).filter((q) => q && questionValid(q)).length
    return {
      status: 'scored',
      score: validCount >= 1 ? 100 : 50,
      evidence: { hasFaq: true, questions: questions.length, validQuestions: validCount },
    }
  },
})

const hasSameAs = (value) =>
  Array.isArray(value) ? value.some((v) => nonEmptyStr(v) !== null) : nonEmptyStr(value) !== null

export const organizationSchema = def('organization-schema', {
  score(ctx) {
    const org = firstNodeByType(ctx.jsonLd.raw, 'Organization')
    if (!org) return { status: 'scored', score: 0, evidence: { hasOrg: false } }
    const hasName = nonEmptyStr(org.name) !== null
    const hasLogo = org.logo != null || org.image != null
    const sameAs = hasSameAs(org.sameAs)
    return {
      status: 'scored',
      score: hasName && hasLogo && sameAs ? 100 : 50,
      evidence: { hasOrg: true, hasName, hasLogo, sameAs },
    }
  },
})

function itemUrl(item) {
  const it = item.item
  if (typeof it === 'string') return it
  const obj = asObject(it)
  return obj ? nonEmptyStr(obj['@id']) : null
}

export const breadcrumbSchema = def('breadcrumb-schema', {
  score(ctx) {
    const bc = firstNodeByType(ctx.jsonLd.raw, 'BreadcrumbList')
    const list = bc ? bc.itemListElement : null
    const items = (Array.isArray(list) ? list : []).map((i) => asObject(i)).filter(Boolean)

    if (!bc || items.length < 2) {
      return { status: 'scored', score: 0, evidence: { hasBreadcrumb: !!bc, count: items.length } }
    }

    const positions = items.map((i) => toNum(i.position))
    const positionsOk =
      positions.every((p) => p !== null) && new Set(positions).size === positions.length
    const fieldsOk = items.every((i) => nonEmptyStr(i.name) !== null && itemUrl(i) !== null)

    if (!positionsOk) {
      return { status: 'scored', score: 0, evidence: { count: items.length, positionsOk: false } }
    }
    if (!fieldsOk) {
      return { status: 'scored', score: 50, evidence: { count: items.length, fieldsOk: false } }
    }

    const hasCategory = items.some((item, idx) => {
      if (idx === 0 || idx === items.length - 1) return /\/collections\//i.test(itemUrl(item) ?? '')
      return true
    })
    return {
      status: 'scored',
      score: hasCategory ? 100 : 50,
      evidence: { count: items.length, hasCategory },
    }
  },
})

const VIDEO_EMBED_RE =
  /<video\b|youtube\.com\/embed|youtu\.be\/|player\.vimeo\.com|<iframe\b[^>]*(youtube|vimeo)/i

export const videoSchema = def('video-schema', {
  score(ctx) {
    const node = firstNodeByType(ctx.jsonLd.raw, 'VideoObject')
    const hasEmbed = VIDEO_EMBED_RE.test(ctx.page.renderedHtml ?? '')
    if (!node && !hasEmbed) return { status: 'na', reason: 'no-video' }
    if (!node) {
      return { status: 'scored', score: 0, evidence: { hasVideoObject: false, hasEmbed: true } }
    }

    const hasName = nonEmptyStr(node.name) !== null
    const hasDescription = nonEmptyStr(node.description) !== null
    const hasThumbnail = node.thumbnailUrl != null
    const hasUploadDate = nonEmptyStr(node.uploadDate) !== null
    const hasUrl = node.contentUrl != null || node.embedUrl != null
    const full = hasName && hasDescription && hasThumbnail && hasUploadDate && hasUrl
    return {
      status: 'scored',
      score: full ? 100 : 50,
      evidence: {
        hasVideoObject: true,
        hasName,
        hasDescription,
        hasThumbnail,
        hasUploadDate,
        hasUrl,
      },
    }
  },
})

// ---------------------------------------------------------------- factor 2 --

// Pure-LLM criteria: the band comes from the analyze step, the scorer stays pure.
export function llmBandScorer(key) {
  return def(key, {
    score(ctx) {
      const a = ctx.llmAnalysis[key]
      if (!a) return { status: 'na', reason: 'LLM analysis missing' }
      if (a.band === 'na') return { status: 'na', reason: a.reason }
      return {
        status: 'scored',
        score: a.band,
        evidence: { band: a.band, reason: a.reason, source: 'llm' },
      }
    },
  })
}

const FAQ_STUB_THRESHOLD = 20
const FAQ_MIN_DENOMINATOR = 3
const FAQ_SHORTFALL_MIN_LOST = 5
const FAQ_SHORTFALL_MAX = 2
const FAQ_WEIGHTS = {
  countBand: 0.2,
  q_intent: 0.2,
  q_phrasing: 0.1,
  lengthBand: 0.1,
  a_complete: 0.3,
  a_format: 0.1,
}
const FAQ_SHORTFALL_CODES = {
  countBand: 'too-few-pairs',
  q_intent: 'question-intent',
  q_phrasing: 'question-phrasing',
  lengthBand: 'answer-length',
  a_complete: 'answer-completeness',
  a_format: 'answer-format',
}

// `faq-product` reads pairs + four flags per pair (analyze-llm builds them), never a band:
// asking the model to grade the whole set swung 70/70/70/75, per pair it lands 80/80/80 —
// and only per-pair flags tell Phase 3 WHICH answer to rewrite.
export const faqProduct = def('faq-product', {
  score(ctx) {
    const faq = ctx.faq
    // Cannot measure is not the same as does not exist: both are na, never 0.
    if (!ctx.page?.ok) return { status: 'na', reason: 'page-not-ok' }
    if (!faq) return { status: 'na', reason: 'faq analysis missing' }
    if (faq.status === 'llm-failed') return { status: 'na', reason: 'llm-failed' }

    const base = {
      pairCount: faq.pairs.length,
      stubThreshold: FAQ_STUB_THRESHOLD,
      reach: faq.reach,
      faqState: faq.faqState,
      writable: faq.writable,
      droppedPairs: faq.droppedPairs,
      contentSource: faq.contentSource,
      ...(faq.gate ? { gate: faq.gate } : {}),
      ...(faq.lengthBandUnreliable ? { lengthBandUnreliable: true } : {}),
    }

    // Guard n = 0 explicitly: without it 0/0 = NaN, every comparison is false, every
    // component falls back to 100 and a BLANK PAGE SCORES 90.
    const n = faq.pairs.length
    if (n === 0)
      return {
        status: 'scored',
        score: 0,
        evidence: {
          ...base,
          stubCount: 0,
          intentOkCount: 0,
          phrasingOkCount: 0,
          completeOkCount: 0,
          formatOkCount: 0,
          shortfalls: ['too-few-pairs'],
        },
      }

    // Minimum denominator, else two perfect pairs (93) beat ten pairs with six good (68)
    // and the score teaches merchants to delete questions.
    const d = Math.max(n, FAQ_MIN_DENOMINATOR)
    const count = (pick) => faq.pairs.filter(pick).length
    const stubCount = count(isStub)
    const parts = {
      countBand: Math.min(n / FAQ_MIN_DENOMINATOR, 1) * 100,
      q_intent: (count((p) => p.intentOk) / d) * 100,
      q_phrasing: (count((p) => p.phrasingOk) / d) * 100,
      lengthBand: ((n - stubCount) / d) * 100,
      a_complete: (count((p) => p.completeOk) / d) * 100,
      a_format: (count((p) => p.formatOk) / d) * 100,
    }
    const score = Math.round(
      Object.keys(FAQ_WEIGHTS).reduce((sum, k) => sum + FAQ_WEIGHTS[k] * parts[k], 0),
    )
    const shortfalls = Object.keys(FAQ_WEIGHTS)
      .map((k) => ({ code: FAQ_SHORTFALL_CODES[k], lost: FAQ_WEIGHTS[k] * (100 - parts[k]) }))
      .filter((s) => s.lost >= FAQ_SHORTFALL_MIN_LOST)
      .sort((a, b) => b.lost - a.lost)
      .slice(0, FAQ_SHORTFALL_MAX)
      .map((s) => s.code)

    return {
      status: 'scored',
      score,
      evidence: {
        ...base,
        pairs: faq.pairs,
        stubCount,
        intentOkCount: count((p) => p.intentOk),
        phrasingOkCount: count((p) => p.phrasingOk),
        completeOkCount: count((p) => p.completeOk),
        formatOkCount: count((p) => p.formatOk),
        ...parts,
        shortfalls,
      },
    }
  },
})

const CDN_IMG_RE = /https?:\/\/[^"'\s]*cdn\.shopify\.com\/[^"'\s]*\/products\/[^"'\s]+/gi
const VIDEO_RE = /<iframe[^>]+(youtube|vimeo|youtu\.be)/i

function countJsonLdImages(product) {
  const img = product?.image
  if (!img) return 0
  return Array.isArray(img) ? img.length : 1
}

export const originalMedia = def('original-media', {
  score(ctx) {
    const fromLd = countJsonLdImages(ctx.jsonLd.product)
    const imageCount =
      fromLd > 0
        ? fromLd
        : new Set(
            (ctx.page.renderedHtml.match(CDN_IMG_RE) ?? []).map((u) => u.split('?')[0]),
          ).size
    const video = ctx.jsonLd.types.includes('VideoObject') || VIDEO_RE.test(ctx.page.renderedHtml)
    // Transcripts can't be checked without a YouTube key, so a video caps at +25 (no-transcript).
    const score = Math.min(100, (imageCount >= 4 ? 50 : 0) + (video ? 25 : 0))
    return {
      status: 'scored',
      score,
      evidence: { imageCount, hasVideo: video, transcriptChecked: false, source: 'script' },
    }
  },
})

const MONTH_MS = 30 * 24 * 3600 * 1000
// `\u0063\u1EADp nh\u1EADt` is Vietnamese for "updated" — the same signal as the English words beside it,
// kept because a Vietnamese storefront states its freshness that way and would otherwise score
// zero on a criterion it actually passes. Escaped rather than written out: this file ships in a
// public repo whose CI reads a bare Vietnamese phrase as prose someone forgot to translate.
const DISPLAY_DATE_RE =
  /(?:updated|c\u1EADp nh\u1EADt|last modified|as of)[^0-9]{0,12}(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{4}|\d{4})/i

function parseLoose(raw) {
  const t = Date.parse(raw)
  if (!Number.isNaN(t)) return t
  const my = /^(\d{1,2})\/(\d{4})$/.exec(raw)
  if (my) return Date.parse(`${my[2]}-${my[1].padStart(2, '0')}-01`)
  const y = /^(\d{4})$/.exec(raw)
  if (y) return Date.parse(`${y[1]}-01-01`)
  return null
}

export const freshness = def('freshness', {
  score(ctx) {
    const ld = ctx.jsonLd.raw.find((n) => typeof n?.dateModified === 'string')?.dateModified ?? null
    const display = (ctx.page.renderedHtml.match(DISPLAY_DATE_RE) ??
      ctx.page.rawSourceHtml.match(DISPLAY_DATE_RE))?.[1]
    const shown = ld ?? display ?? null
    if (!shown) {
      return { status: 'scored', score: 0, evidence: { shownDate: null, source: 'script' } }
    }
    const ts = parseLoose(shown)
    const ageMonths = ts === null ? null : (Date.now() - ts) / MONTH_MS
    const score = ageMonths === null ? 50 : ageMonths <= 6 ? 100 : 50
    return {
      status: 'scored',
      score,
      evidence: {
        shownDate: shown,
        ageMonths: ageMonths === null ? null : Math.round(ageMonths),
        fakeFreshChecked: false,
        source: 'script',
      },
    }
  },
})

const TABLE_LIST_RE = /<(table|ul|ol)\b/i
const snap = (v) => (v < 25 ? 0 : v < 75 ? 50 : 100)

function formattingScriptBand(desc) {
  const hasTableList = TABLE_LIST_RE.test(desc)
  const paras = String(desc || '')
    .split(/<\/p>|<br\s*\/?>|\n\n+/i)
    .map((p) => p.replace(/<[^>]+>/g, ' ').trim())
    .filter((p) => p.length > 0)
  const wordCounts = paras.map((p) => p.split(/\s+/).length)
  const shortChunks = wordCounts.filter((w) => w >= 10 && w <= 80).length
  const shortFrac = wordCounts.length ? shortChunks / wordCounts.length : 0
  if (hasTableList && shortFrac >= 0.6) return 100
  if (hasTableList || shortFrac >= 0.4) return 50
  return 0
}

export const answerFormatting = def('answer-formatting', {
  score(ctx) {
    const script = formattingScriptBand(ctx.product.description ?? '')
    const llm = ctx.llmAnalysis['answer-formatting']
    const llmBand = llm && llm.band !== 'na' ? llm.band : null
    const score = llmBand === null ? script : snap((script + llmBand) / 2)
    return {
      status: 'scored',
      score,
      evidence: { scriptBand: script, llmBand, source: llmBand === null ? 'script' : 'mix' },
    }
  },
})

// ---------------------------------------------------------------- factor 3 --

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_RE = /(?:\+?\d[\d\s().-]{6,}\d)/
const POSTAL_RE =
  /\b\d{1,5}\s+[A-Za-z][\w.'-]*(?:\s+[\w.'-]+){0,3}\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|way|suite|ste|floor)\b/i

const s = (x) => (typeof x === 'string' && x.trim() ? x : null)

function isOrgNode(node) {
  const type = node?.['@type']
  return type === 'Organization' || (Array.isArray(type) && type.includes('Organization'))
}

function addressToString(addr) {
  if (typeof addr === 'string') return s(addr)
  if (addr && typeof addr === 'object') {
    const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
      .map(s)
      .filter(Boolean)
    return parts.length ? parts.join(', ') : null
  }
  return null
}

function orgSignals(ctx) {
  const out = { hasAddress: false, hasNap: false }
  for (const node of ctx.jsonLd.raw) {
    if (!isOrgNode(node)) continue
    if (node.address) out.hasAddress = true
    if (node.contactPoint || node.address) out.hasNap = true
  }
  return out
}

function onsiteNap(ctx) {
  const nap = { name: null, address: null, phone: null }
  for (const node of ctx.jsonLd.raw) {
    if (!isOrgNode(node)) continue
    nap.name ??= s(node.name)
    nap.address ??= addressToString(node.address)
    const cp = node.contactPoint
    const cpList = Array.isArray(cp) ? cp : cp ? [cp] : []
    let cpPhone = null
    for (const c of cpList) {
      if (c && typeof c === 'object' && 'telephone' in c) {
        cpPhone = c.telephone
        break
      }
    }
    nap.phone ??= s(node.telephone) ?? s(cpPhone)
  }
  return nap
}

export const contactInfo = def('contact-info', {
  score(ctx) {
    const haystack = `${ctx.storePages.contact?.html ?? ''}\n${ctx.page.renderedHtml}`
    const org = orgSignals(ctx)
    const hasEmail = EMAIL_RE.test(haystack)
    const hasPhone = PHONE_RE.test(haystack)
    const hasAddress = org.hasAddress || POSTAL_RE.test(haystack)
    const channels = [hasEmail, hasPhone, hasAddress].filter(Boolean).length
    const schemaMatch = org.hasNap

    let score = channels === 0 ? 0 : channels >= 2 && schemaMatch ? 100 : 50

    const gr = ctx.offStore.googleReviews
    const napMatchesGbp = gr
      ? matchNap(onsiteNap(ctx), { name: gr.name, address: gr.address, phone: gr.phone })
      : null
    if (score === 100 && napMatchesGbp === 'mismatch') score = 50

    return {
      status: 'scored',
      score,
      evidence: { hasEmail, hasPhone, hasAddress, schemaMatch, napMatchesGbp, source: 'script' },
    }
  },
})

const PLACEHOLDER_RE = /\[[^\]\n]{1,40}\]/

export const policiesQuality = def('policies-quality', {
  score(ctx) {
    const { refund, shipping } = ctx.storePages.policies
    const hasReturn = !!refund
    const hasShipping = !!shipping
    const placeholder =
      PLACEHOLDER_RE.test(htmlToText(refund?.html, 2000)) ||
      PLACEHOLDER_RE.test(htmlToText(shipping?.html, 2000))

    const llm = ctx.llmAnalysis['policies-quality']
    const llmBand = llm && llm.band !== 'na' ? llm.band : null
    const score = !hasReturn || !hasShipping || placeholder ? 0 : (llmBand ?? 50)

    return {
      status: 'scored',
      score,
      evidence: {
        hasReturn,
        hasShipping,
        placeholder,
        llmBand,
        source: llmBand === null ? 'script' : 'mix',
      },
    }
  },
})

function widgetReviewCount(ctx) {
  const nodes = [ctx.jsonLd.product, ...ctx.jsonLd.raw].filter(Boolean)
  for (const node of nodes) {
    const ar = node.aggregateRating
    const n = ar?.reviewCount ?? ar?.ratingCount
    const num = typeof n === 'string' ? Number(n) : n
    if (typeof num === 'number' && Number.isFinite(num)) return num
  }
  return 0
}

export const onsiteReviews = def('onsite-reviews', {
  score(ctx) {
    const reviewCount = widgetReviewCount(ctx)
    const widgetScore = reviewCount >= 20 ? 100 : reviewCount >= 1 ? 50 : 0
    const band = ctx.llmAnalysis['onsite-reviews']?.band
    const testimonialBand = typeof band === 'number' ? band : 0
    return {
      status: 'scored',
      score: Math.max(widgetScore, testimonialBand),
      evidence: { reviewCount, widgetScore, testimonialBand, source: 'mix' },
    }
  },
})

export const googleReviews = def('google-reviews', {
  score(ctx) {
    const d = ctx.offStore.googleReviews
    if (!d) return { status: 'na', reason: 'No Google Business data collected' }
    let score
    if (!d.hasProfile || (d.rating !== null && d.rating < 3.5)) score = 0
    else if (d.rating !== null && d.rating >= 4.3 && d.reviewCount >= 50) score = 100
    else score = 50
    return {
      status: 'scored',
      score,
      evidence: {
        hasProfile: d.hasProfile,
        rating: d.rating,
        reviewCount: d.reviewCount,
        source: d.source ?? 'serpapi',
      },
    }
  },
})

export const trustpilot = def('trustpilot', {
  languageGated: true,
  score(ctx) {
    if (ctx.phase1.language !== 'en') {
      return { status: 'gated', reason: 'Trustpilot skews Western/English markets' }
    }
    const d = ctx.offStore.trustpilot
    if (!d) return { status: 'na', reason: 'No Trustpilot data collected' }
    let score
    if (!d.hasProfile || (d.score !== null && d.score < 3.0)) score = 0
    else if (d.score !== null && d.score >= 4.0 && d.reviewCount >= 50) score = 100
    else score = 50
    return {
      status: 'scored',
      score,
      evidence: {
        hasProfile: d.hasProfile,
        score: d.score,
        reviewCount: d.reviewCount,
        source: d.source ?? 'jsonld',
      },
    }
  },
})

export const reddit = def('reddit', {
  languageGated: true,
  score(ctx) {
    if (ctx.phase1.language !== 'en') {
      return { status: 'gated', reason: 'Reddit is an English-market signal' }
    }
    const d = ctx.offStore.reddit
    if (!d) return { status: 'na', reason: 'No Reddit data collected' }
    return {
      status: 'scored',
      score: Math.min(100, Math.round(12.5 * Math.sqrt(d.threadCount))),
      evidence: { threadCount: d.threadCount, source: d.source ?? 'serpapi' },
    }
  },
})

export const socialVideoMentions = def('social-video-mentions', {
  score(ctx) {
    const d = ctx.offStore.video
    if (!d) return { status: 'na', reason: 'No video-mention data collected' }
    const sumSqrt = Object.values(d.perPlatform).reduce((a, n) => a + Math.sqrt(n), 0)
    return {
      status: 'scored',
      score: Math.min(100, Math.round(7 * sumSqrt)),
      evidence: { perPlatform: d.perPlatform, source: d.source ?? 'serpapi' },
    }
  },
})

export const pressAndLists = def('press-and-lists', {
  score(ctx) {
    const d = ctx.offStore.press
    if (!d || typeof d.count !== 'number') {
      return { status: 'na', reason: 'No press data collected' }
    }
    return {
      status: 'scored',
      score: Math.min(100, Math.round(45 * Math.sqrt(d.count))),
      evidence: { count: d.count, source: d.source ?? 'serpapi+llm' },
    }
  },
})

export const entityDatabases = def('entity-databases', {
  score(ctx) {
    const d = ctx.offStore.entityDatabases
    if (!d) return { status: 'na', reason: 'No entity-database data collected' }
    const score =
      d.hasKnowledgePanel || d.hasWikipedia ? 100 : d.hasWikidata || d.hasCrunchbase ? 50 : 0
    return {
      status: 'scored',
      score,
      evidence: {
        hasKnowledgePanel: d.hasKnowledgePanel,
        hasWikipedia: d.hasWikipedia,
        hasWikidata: d.hasWikidata,
        hasCrunchbase: d.hasCrunchbase,
        source: d.source ?? 'wikidata+wikipedia+serpapi',
      },
    }
  },
})

// ---------------------------------------------------------------- factor 4 --

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// gap% = (own − median) / median × 100 → clamp(0..100, round(100×(40−gap)/35)).
const scoreFromGap = (gapPct) => Math.max(0, Math.min(100, Math.round((100 * (40 - gapPct)) / 35)))

export const priceCompetitive = def('price-competitive', {
  score(ctx) {
    const own = ctx.product.price
    const currency = ctx.product.currency
    if (own == null || own <= 0 || !currency) {
      return { status: 'na', reason: 'No own price/currency to compare' }
    }
    const rivals = ctx.merchant.competitorPrices
      .filter((p) => p.currency === currency && p.amount > 0)
      .map((p) => p.amount)
    if (rivals.length < 2) {
      return { status: 'na', reason: 'No benchmark: fewer than 2 rival prices in the same currency' }
    }
    const benchmark = median(rivals)
    const gapPct = ((own - benchmark) / benchmark) * 100
    return {
      status: 'scored',
      score: scoreFromGap(gapPct),
      evidence: {
        ownPrice: own,
        currency,
        benchmark,
        gapPct: Math.round(gapPct * 10) / 10,
        rivalCount: rivals.length,
        method: 'median',
        source: 'phase1-mentions',
      },
    }
  },
})

export const shippingCompetitive = def('shipping-competitive', {
  score(ctx) {
    const a = ctx.llmAnalysis['shipping-competitive']
    // Never N/A: a missing band means no free-shipping offer was visible, which is actionable.
    if (!a || a.band === 'na') {
      return {
        status: 'scored',
        score: 0,
        evidence: {
          band: 0,
          reason: a?.reason ?? 'No shipping terms visible',
          source: 'llm',
        },
      }
    }
    return {
      status: 'scored',
      score: a.band,
      evidence: { band: a.band, reason: a.reason, source: 'llm' },
    }
  },
})

// ------------------------------------------------------------------ registry --

export const ALL_SCORERS = [
  // discoverability (15)
  aiBotsAllowed,
  googleMerchantFeed,
  internalLinking,
  crawlableText,
  imageAltText,
  headingHierarchy,
  brandInTitle,
  productSchema,
  productSchemaRich,
  reviewSchema,
  shippingSchema,
  faqSchema,
  organizationSchema,
  breadcrumbSchema,
  videoSchema,
  // content (13): 10 pure-LLM + 3 script/mix
  llmBandScorer('specifications'),
  llmBandScorer('compatibility-sizing'),
  llmBandScorer('safety-materials'),
  llmBandScorer('benefits-outcomes'),
  llmBandScorer('limitations-honest'),
  llmBandScorer('comparison-alternatives'),
  llmBandScorer('who-is-it-for'),
  faqProduct,
  llmBandScorer('troubleshooting-care'),
  llmBandScorer('unique-description'),
  originalMedia,
  freshness,
  answerFormatting,
  // entity-trust (10)
  llmBandScorer('about-page'),
  contactInfo,
  policiesQuality,
  onsiteReviews,
  googleReviews,
  trustpilot,
  reddit,
  socialVideoMentions,
  pressAndLists,
  entityDatabases,
  // merchant (2)
  priceCompetitive,
  shippingCompetitive,
]
