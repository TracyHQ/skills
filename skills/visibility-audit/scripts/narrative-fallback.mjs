// Deterministic sentences built from evidence alone, ported from `narrative-fallback.ts`.
// Used whenever the narrative LLM is absent, fails, or its line is rejected by the guards —
// so the report always has grounded copy, never a blank or an unverified claim.

import { CRITERION_TITLES, factorLabel } from './framework.mjs'

function cap(s, max) {
  if (s.length <= max) return s
  const truncated = s.slice(0, max - 1)
  const lastSpace = truncated.lastIndexOf(' ')
  const clean = lastSpace > max * 0.6 ? truncated.slice(0, lastSpace) : truncated
  return `${clean.trimEnd().replace(/[.,;:!?-]+$/, '')}…`
}

const numField = (ev, key) =>
  typeof ev[key] === 'number' && Number.isFinite(ev[key]) ? ev[key] : null
const strField = (ev, key) => (typeof ev[key] === 'string' && ev[key].length > 0 ? ev[key] : null)
const boolField = (ev, key) => (typeof ev[key] === 'boolean' ? ev[key] : null)

const DIAGNOSIS_BUILDERS = {
  'image-alt-text': (_score, ev) => {
    const total = numField(ev, 'total')
    const passed = numField(ev, 'passed')
    if (total === null || passed === null || total === 0) return null
    return `${total - passed} of ${total} images missing quality alt text`
  },
  'crawlable-text': (_score, ev) => {
    const coverage = numField(ev, 'coverage')
    if (coverage === null) return null
    return `${Math.round(coverage * 100)}% of visible content is present in the raw HTML crawlers see`
  },
  'heading-hierarchy': (_score, ev) => {
    const h1Count = numField(ev, 'h1Count')
    if (h1Count === null) return null
    if (h1Count !== 1) return `Page has ${h1Count} H1 headings (expected exactly 1)`
    const nameMatch = boolField(ev, 'nameMatch')
    const skip = boolField(ev, 'skip')
    const parts = ['1 H1 heading found']
    if (nameMatch !== null) parts.push(nameMatch ? 'matches product name' : 'does not match product name')
    if (skip !== null) parts.push(skip ? 'heading levels skip' : 'no heading level skips')
    return parts.join(', ')
  },
  'product-schema': (_score, ev) => {
    const hasProduct = boolField(ev, 'hasProduct')
    if (hasProduct === null) return null
    if (!hasProduct) return 'No Product schema (JSON-LD) detected on the page'
    if (boolField(ev, 'hasOffers') === false) return 'Product schema present but missing Offers data'
    const missing = [
      boolField(ev, 'hasPrice') === false ? 'price' : null,
      boolField(ev, 'hasCurrency') === false ? 'currency' : null,
      boolField(ev, 'hasAvailability') === false ? 'availability' : null,
    ].filter(Boolean)
    if (missing.length === 0) return 'Product schema present with price, currency, and availability'
    return `Product schema missing ${missing.join(', ')}`
  },
  'brand-in-title': (_score, ev) => {
    const matched = boolField(ev, 'matched')
    if (matched === null) return null
    const brand = strField(ev, 'brand')
    if (!brand) return 'No brand name found to check against the page title'
    return `Brand "${brand}" ${matched ? 'appears' : 'does not appear'} in the page title`
  },
  'internal-linking': (_score, ev) => {
    const reachable = boolField(ev, 'reachable')
    if (reachable === null) return null
    if (!reachable) return 'Page has no detected navigation, breadcrumb, or collection links'
    const relatedOut = boolField(ev, 'relatedOut')
    return `Page is reachable via navigation${relatedOut ? ' and links to related products' : ' but has no related-product links'}`
  },
  reddit: (_score, ev) => {
    const threadCount = numField(ev, 'threadCount')
    if (threadCount === null) return null
    return `${threadCount} Reddit thread${threadCount === 1 ? '' : 's'} mention the brand`
  },
  trustpilot: (_score, ev) => {
    const hasProfile = boolField(ev, 'hasProfile')
    if (hasProfile === null) return null
    if (!hasProfile) return 'No Trustpilot profile found'
    const tpScore = numField(ev, 'score')
    const reviewCount = numField(ev, 'reviewCount')
    if (tpScore === null || reviewCount === null) return 'Trustpilot profile found'
    return `Trustpilot ${tpScore}★ from ${reviewCount} reviews`
  },
  'google-reviews': (_score, ev) => {
    const hasProfile = boolField(ev, 'hasProfile')
    if (hasProfile === null) return null
    if (!hasProfile) return 'No Google Business profile found'
    const rating = numField(ev, 'rating')
    const reviewCount = numField(ev, 'reviewCount')
    if (rating === null || reviewCount === null) return 'Google Business profile found'
    return `Google rating ${rating}★ from ${reviewCount} reviews`
  },
  'social-video-mentions': (_score, ev) => {
    const perPlatform = ev.perPlatform
    if (!perPlatform || typeof perPlatform !== 'object') return null
    const counts = Object.values(perPlatform).filter((v) => typeof v === 'number' && Number.isFinite(v))
    if (counts.length === 0) return null
    const total = counts.reduce((a, n) => a + n, 0)
    const platforms = counts.filter((n) => n > 0).length
    return `${total} third-party video mention${total === 1 ? '' : 's'} across ${platforms} platform${platforms === 1 ? '' : 's'}`
  },
  'press-and-lists': (_score, ev) => {
    const count = numField(ev, 'count')
    if (count === null) return null
    return `${count} press or best-of list mention${count === 1 ? '' : 's'} found`
  },
  'google-merchant-feed': (_score, ev) => {
    const on = boolField(ev, 'onGoogleShopping')
    if (on === null) return null
    if (!on) return "Product isn't showing on Google Shopping, not listed or approved in the feed"
    const title = strField(ev, 'matchedTitle')
    return title ? `Live on Google Shopping (matched "${title}")` : 'Live on Google Shopping'
  },
  // The band's own reason already came from an LLM read of this page — reuse it, no new call.
  specifications: (_score, ev) => {
    const reason = strField(ev, 'reason')
    return reason ? `Specifications: ${reason}` : null
  },
  // Ordered branches, first match wins: REACH before QUALITY. All three of absent /
  // js-locked / mixed report pairCount 0, but only 'absent' really has no FAQ — saying
  // "no FAQ" for a js-locked page is both wrong and the wrong remedy.
  'faq-product': (_score, ev) => {
    const state = strField(ev, 'faqState')
    const pairCount = numField(ev, 'pairCount')
    const jsOnly = typeof ev?.reach?.jsOnly === 'number' ? ev.reach.jsOnly : null
    if (state === null || pairCount === null) return null

    if (state === 'absent') return 'No FAQ or Q&A content on the page'
    if (state === 'js-locked')
      return jsOnly === null ? null : `${jsOnly} answers only load after scripts run`
    if (state === 'mixed')
      return jsOnly === null
        ? null
        : `${jsOnly} of ${pairCount} answers only load after scripts run`

    const completeOkCount = numField(ev, 'completeOkCount')
    const stubCount = numField(ev, 'stubCount')
    if (completeOkCount !== null && completeOkCount < pairCount)
      return `${pairCount - completeOkCount} of ${pairCount} answers add nothing beyond the question`
    if (stubCount !== null && stubCount > 0)
      return `${stubCount} of ${pairCount} answers are one line with no detail`
    if (pairCount <= 2) return `Only ${pairCount} Q&A pairs on the page`
    return `${pairCount} Q&A pairs on the page`
  },
}

export function fallbackDiagnosis(key, score, evidence) {
  const built = DIAGNOSIS_BUILDERS[key]?.(score, evidence ?? {}) ?? null
  if (built !== null) return cap(built, 135)
  const title = CRITERION_TITLES[key] ?? key
  const generic = score === 100 ? `${title}: passing (100/100)` : `Scored ${score}/100 on ${title}`
  return cap(generic, 135)
}

function titleCase(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function fallbackTakeaway(slug, score) {
  const label = titleCase(slug)
  return cap(score === null ? `${label}: not yet assessed` : `${label}: ${score}/100`, 115)
}

export function fallbackFactorSummary(key, score, scoredCount, totalCount) {
  const scoreText = score === null ? '—' : String(score)
  return cap(`${factorLabel(key)}: ${scoreText}/100, ${scoredCount} of ${totalCount} criteria scored`, 115)
}

export function fallbackVerdict(total, coverage) {
  const totalText = total === null ? '—' : String(total)
  return cap(
    `Overall GEO score ${totalText}/100 across ${coverage.scored} of ${coverage.totalDefined} criteria.`,
    240,
  )
}
