// Step 1-4 of `faq-product`, ported from
// backend/src/modules/website-audit/utils/faq-analysis.util.ts — keep the two in step
// (ADR-0035): the parity test feeds one context to both scorers and demands one score.
//
// Pure code: the caller does the LLM round trips, this file builds the pool, filters the
// model's output, and works out REACH (can AI read it) and SOURCE (can the app write it).

import { normalizeForMatch } from './util.mjs'

// ؟ (U+061F) is the Arabic question mark — without it every UAE store with an Arabic FAQ
// drops straight to 0, and the UAE is a market we sell into.
const QUESTION_MARKS = /[?？؟՞፧]/
// AI recognises a Q&A pair by STRUCTURE, no question mark required.
//
// The Vietnamese cues are data, not prose — they are the words a Vietnamese storefront opens a
// FAQ line with, and translating them would stop this matching the pages it exists to match.
// Two of them carry letters that only Vietnamese uses, so they are written as escapes and named
// here instead: `\u1EDF \u0111âu` is "where", and `có` / `làm sao` / `bao lâu` / `bao nhiêu` / `khi nào` are
// "is there" / "how" / "how long" / "how many" / "when".
const VI_QUESTION_CUES = ['có', 'làm sao', 'bao lâu', 'bao nhiêu', 'khi nào', '\u1EDF \u0111âu']
const EN_QUESTION_CUES = ['how', 'what', 'can', 'does', 'do', 'is', 'are', 'why', 'when', 'where', 'which']
const QUESTION_CUES = new RegExp(
  `^\\s*(${[...EN_QUESTION_CUES, ...VI_QUESTION_CUES].join('|')})\\b`,
  'im',
)
const NON_SPACED_SCRIPT = /[一-鿿぀-ヿ฀-๿]/

const STUB_THRESHOLD = 20

// Only trustworthy on EXTRACTED text: glowtheory has three "?" and the word "FAQ" in its
// menu, footer and mail banner — grading raw text counts the menu as a FAQ.
export function hasQuestionSignal(text) {
  return QUESTION_MARKS.test(text) || QUESTION_CUES.test(text)
}

// Punctuation-insensitive: the model returns the right words with different quotes/dashes.
function loose(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function countWords(text) {
  const t = String(text ?? '').trim()
  return t ? t.split(/\s+/).length : 0
}

export function needsFix(p) {
  return !(p.intentOk && p.phrasingOk && p.completeOk && p.formatOk)
}

export function isStub(p) {
  return p.words < STUB_THRESHOLD && !p.completeOk
}

// An empty section is DROPPED, never printed as "(none)": a store that writes its FAQ in
// the description lost 100 → 0 because the model read "## FAQ = (none)" as "no FAQ here".
export function buildFaqPool(s) {
  return [
    s.productText && `## PRODUCT TEXT\n${s.productText}`,
    s.faqText && `## FAQ\n${s.faqText}`,
    s.pageText && `## PAGE CONTENT\n${s.pageText}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Verify verbatim → dedupe → missing flag counts as false. The verbatim check is not
// optional: Phase 3 shows `pair.a` back to the merchant as "what your page says today".
export function sanitizePairs(raw, pool) {
  const haystack = loose(pool)
  const kept = new Map()
  let dropped = 0
  for (const p of raw ?? []) {
    const answer = typeof p?.a === 'string' ? p.a : ''
    const question = typeof p?.q === 'string' ? p.q : ''
    const needle = loose(answer)
    if (!needle || !question || !haystack.includes(needle)) {
      dropped++
      continue
    }
    const flags = {
      intentOk: p.intentOk === true,
      phrasingOk: p.phrasingOk === true,
      completeOk: p.completeOk === true,
      formatOk: p.formatOk === true,
    }
    const key = loose(question)
    const prev = kept.get(key)
    if (!prev || answer.length > prev.a.length) kept.set(key, { q: question, a: answer, ...flags })
  }
  return { pairs: [...kept.values()], dropped }
}

function reachOf(answer, visible, markup) {
  const needle = loose(answer)
  if (needle && loose(visible).includes(needle)) return 'raw'
  if (needle && loose(markup).includes(needle)) return 'markupOnly'
  return 'raw'
}

function sourceOf(answer, s, descriptionWritable) {
  const needle = loose(answer)
  if (descriptionWritable && needle && loose(s.productText).includes(needle)) return 'description'
  if (needle && loose(s.faqText).includes(needle)) return 'markup'
  return 'theme'
}

function stateOf(scored, jsOnly) {
  if (scored === 0) return jsOnly > 0 ? 'js-locked' : 'absent'
  return jsOnly > 0 ? 'mixed' : 'reachable'
}

function emptyAnalysis(sources) {
  return {
    status: 'ok',
    gate: null,
    pairs: [],
    reach: { raw: 0, markupOnly: 0, jsOnly: 0 },
    faqState: 'absent',
    writable: true,
    droppedPairs: 0,
    contentSource: sources.contentSource,
    lengthBandUnreliable: false,
  }
}

export function faqGateResult(gate, sources) {
  return { ...emptyAnalysis(sources), gate }
}

export function faqFailedResult(sources) {
  return { ...emptyAnalysis(sources), status: 'llm-failed' }
}

export function buildFaqAnalysis({ scoredPairs, seenPairs, sources }) {
  const pool = buildFaqPool(sources)
  const { pairs: clean, dropped } = sanitizePairs(scoredPairs, pool)

  // Only trust "this pair sits in the description" when the description really IS the
  // description: once the source ladder falls to `page`, ## PRODUCT TEXT is theme text and
  // every pair would look writable.
  const descriptionWritable = sources.contentSource === 'snapshot' || sources.contentSource === 'live'
  const visible = `${sources.productText}\n${sources.pageText}`

  const pairs = clean.map((p) => ({
    ...p,
    words: countWords(p.a),
    reach: reachOf(p.a, visible, sources.faqText),
    source: sourceOf(p.a, sources, descriptionWritable),
  }))

  // A jsOnly pair is NOT graded: it stays out of pairCount and out of both sides of the
  // ratio. It only feeds reach/faqState so the diagnosis names the right disease.
  const seenOnly = sanitizePairs(seenPairs, sources.seenText).pairs.filter(
    (p) => !loose(pool).includes(loose(p.a)),
  )
  const faqState = stateOf(pairs.length, seenOnly.length)

  return {
    status: 'ok',
    gate: pairs.length === 0 && (scoredPairs?.length ?? 0) > 0 ? 'llm-no-pairs' : null,
    pairs,
    reach: {
      raw: pairs.filter((p) => p.reach === 'raw').length,
      markupOnly: pairs.filter((p) => p.reach === 'markupOnly').length,
      jsOnly: seenOnly.length,
    },
    faqState,
    writable:
      faqState === 'absent'
        ? true
        : pairs.filter(needsFix).every((p) => p.source === 'description') &&
          faqState !== 'js-locked',
    droppedPairs: dropped,
    contentSource: sources.contentSource,
    lengthBandUnreliable: NON_SPACED_SCRIPT.test(pool),
  }
}
