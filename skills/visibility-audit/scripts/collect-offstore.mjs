// Collect the OFF-STORE signals (8 criteria the page itself can't answer): Reddit breadth,
// Google Business, Trustpilot, third-party videos, press/best-of coverage, entity databases,
// and whether the product is live on Google Shopping.
//
// One route: SerpApi. A single SERPAPI_API_KEY covers every search; Trustpilot is read straight
// off its own JSON-LD and Wikidata/Wikipedia are free APIs, so those three need no key at all.
//
// There is deliberately no browser route. Reading these signals out of a browser means driving a
// signed-out profile and trusting whatever the agent typed into a signals file — unverifiable
// from here, and personalized the moment someone runs it against their own logged-in Chrome.
// A missing SerpApi key is a setup step (P1 asks for one), never a reason to fall back to a lane
// whose numbers nobody can check.
//
// press.count is deliberately left null here: counting "earned" coverage is an LLM judgement
// (analyze-llm.mjs does it from press.candidates), the same split the backend uses.
//
// Usage:
//   node collect-offstore.mjs --brand "Acme" --domain acme.com --language en --country US \
//     --product-title "Acme Widget" --product-type "widget" --out offstore.json

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { foldDiacritics, isMainModule, parseJsonLd, parseArgv } from './util.mjs'

const SERPAPI_URL = 'https://serpapi.com/search.json'
const str = (x) => (typeof x === 'string' ? x : '')
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

const VIDEO_PLATFORMS = {
  youtube: /youtube\.com|youtu\.be/i,
  tiktok: /tiktok\.com/i,
  instagram: /instagram\.com/i,
  facebook: /facebook\.com|fb\.watch/i,
}

export async function serpApiSearch(params, { apiKey, fetchImpl = fetch, timeoutMs = 30000 }) {
  if (!apiKey) throw new Error('SERPAPI_API_KEY is not set')
  const qs = new URLSearchParams({ ...params, api_key: apiKey })
  const res = await fetchImpl(`${SERPAPI_URL}?${qs}`, { signal: AbortSignal.timeout(timeoutMs) })
  const json = await res.json()
  if (typeof json.error === 'string') throw new Error(`SerpAPI: ${json.error}`)
  return json
}

// ---- pure matchers (unit-tested; no network) --------------------------------

const norm = (s) => foldDiacritics(s).replace(/[^a-z0-9]/g, '')
const GENERIC_TOKENS = new Set(['store', 'shop', 'shops', 'official', 'online', 'market', 'the', 'com'])

// The most distinctive token of the shop name — generic commerce words would false-positive.
export function brandKey(brand) {
  const tokens = foldDiacritics(brand)
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !GENERIC_TOKENS.has(t))
    .sort((a, b) => b.length - a.length)
  return tokens[0] ?? ''
}

export function matchGoogleShopping(json, { brand, domain }) {
  const results = json.shopping_results ?? []
  const key = brandKey(brand)
  const dom = domain?.replace(/^www\./, '').toLowerCase() ?? ''

  let matchedTitle = null
  for (const r of results) {
    const seller = norm(str(r.source))
    const link = str(r.link).toLowerCase()
    if ((key.length >= 3 && seller.includes(key)) || (dom.length >= 4 && link.includes(dom))) {
      matchedTitle = str(r.title) || null
      break
    }
  }
  return {
    source: 'serpapi',
    onGoogleShopping: matchedTitle !== null,
    matchedTitle,
    resultCount: results.length,
  }
}

export function countVideoPlatforms(videoResults, ownSocialUrls = []) {
  const perPlatform = {}
  for (const v of videoResults ?? []) {
    const link = str(v.link)
    if (ownSocialUrls.some((u) => u && link.includes(u))) continue
    for (const [platform, re] of Object.entries(VIDEO_PLATFORMS)) {
      if (re.test(link)) {
        perPlatform[platform] = (perPlatform[platform] ?? 0) + 1
        break
      }
    }
  }
  return { perPlatform }
}

export function pickTrustpilotFromSerp(json, domain) {
  const organic = json.organic_results ?? []
  const hit = organic.find((r) => {
    try {
      return new URL(str(r.link)).pathname === `/review/${domain}`
    } catch {
      return false
    }
  })
  if (!hit) return null
  const rich = hit.rich_snippet
  const ext = [rich?.top?.detected_extensions, rich?.bottom?.detected_extensions].find(
    (b) => typeof b?.rating === 'number',
  )
  if (!ext) return null
  return {
    hasProfile: true,
    score: ext.rating,
    reviewCount: typeof ext.reviews === 'number' ? ext.reviews : 0,
    source: 'serpapi',
  }
}

export function readTrustpilotJsonLd(html) {
  for (const node of parseJsonLd(html).raw) {
    const ar = node.aggregateRating
    if (!ar) continue
    const score = Number(ar.ratingValue)
    const reviewCount = Number(ar.reviewCount ?? ar.ratingCount ?? 0)
    return {
      hasProfile: true,
      score: Number.isFinite(score) ? score : null,
      reviewCount: Number.isFinite(reviewCount) ? reviewCount : 0,
      source: 'jsonld',
    }
  }
  return { hasProfile: false, score: null, reviewCount: 0, source: 'jsonld' }
}

// ---- collectors -------------------------------------------------------------

const warn = (label, e) => {
  process.stderr.write(`warning: off-store ${label} failed: ${e.message}\n`)
  return null
}

async function serpapiSignals(subject, cfg) {
  const call = (params) => serpApiSearch(params, cfg)
  const isEnglish = subject.language === 'en'

  const reddit = isEnglish
    ? call({ engine: 'google', q: `site:reddit.com "${subject.brand}"`, num: '100' })
        .then((j) => ({ threadCount: Math.min(100, (j.organic_results ?? []).length), source: 'serpapi' }))
        .catch((e) => warn('reddit', e))
    : Promise.resolve(null)

  const mapsRegion = subject.city ?? subject.country
  const mapsQuery = mapsRegion ? `${subject.brand} ${mapsRegion}` : subject.brand
  const googleReviews = call({ engine: 'google_maps', type: 'search', q: mapsQuery })
    .then((j) => {
      const place = j.place_results ?? j.local_results?.[0]
      if (!place) {
        return { hasProfile: false, rating: null, reviewCount: 0, name: null, address: null, phone: null, source: 'serpapi' }
      }
      const f = (k) => (typeof place[k] === 'string' && place[k].trim() ? place[k] : null)
      return {
        hasProfile: true,
        rating: num(place.rating),
        reviewCount: num(place.reviews) ?? 0,
        name: f('title'),
        address: f('address'),
        phone: f('phone'),
        source: 'serpapi',
      }
    })
    .catch((e) => warn('google-reviews', e))

  const trustpilot = isEnglish
    ? (async () => {
        if (!subject.domain) return { hasProfile: false, score: null, reviewCount: 0, source: 'jsonld' }
        const domain = subject.domain.replace(/^www\./, '')
        const res = await fetch(`https://www.trustpilot.com/review/${domain}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MentionNetworkAudit/1.0)' },
          signal: AbortSignal.timeout(20000),
        })
        // Cloudflare blocks (403) → fall back to a site: search; a readable page with no rating
        // is a real signal, not a failure.
        if (!res.ok) {
          return pickTrustpilotFromSerp(
            await call({ engine: 'google', q: `site:trustpilot.com/review/${domain}`, num: '10' }),
            domain,
          )
        }
        return readTrustpilotJsonLd(await res.text())
      })().catch((e) => warn('trustpilot', e))
    : Promise.resolve(null)

  const video = call({ engine: 'google_videos', q: `"${subject.brand}"`, num: '100' })
    .then((j) => ({ ...countVideoPlatforms(j.video_results, subject.ownSocialUrls), source: 'serpapi' }))
    .catch((e) => warn('video', e))

  const press = (async () => {
    const region = subject.city ?? subject.country
    const category = subject.productType ?? subject.brand
    const [news, listicle] = await Promise.all([
      call({ engine: 'google', tbm: 'nws', q: `"${subject.brand}"`, num: '20' }),
      call({ engine: 'google', q: `best ${category} ${region}`, num: '20' }),
    ])
    const items = []
    for (const arr of [news.news_results, listicle.organic_results]) {
      for (const r of arr ?? []) {
        items.push({ title: str(r.title), link: str(r.link), snippet: str(r.snippet), source: str(r.source) })
      }
    }
    const seen = new Set()
    const candidates = items.filter((i) => i.link && !seen.has(i.link) && seen.add(i.link))
    return { candidates, count: null, source: 'serpapi' }
  })().catch((e) => warn('press', e))

  const entityDatabases = (async () => {
    const [wikidata, wikipedia, kg, crunchbase] = await Promise.all([
      hasWikidata(subject.brand).catch(() => false),
      hasWikipedia(subject.brand).catch(() => false),
      call({ engine: 'google', q: subject.brand }).catch(() => ({})),
      call({ engine: 'google', q: `site:crunchbase.com "${subject.brand}"`, num: '1' })
        .then((j) => (j.organic_results ?? []).length > 0)
        .catch(() => false),
    ])
    return {
      hasKnowledgePanel: !!kg.knowledge_graph,
      hasWikipedia: wikipedia,
      hasWikidata: wikidata,
      hasCrunchbase: crunchbase,
      source: 'wikidata+wikipedia+serpapi',
    }
  })().catch((e) => warn('entity-databases', e))

  const feed = call({
    engine: 'google_shopping',
    q: subject.productTitle,
    gl: String(subject.country || '').toLowerCase(),
    hl: subject.language,
  })
    .then((j) => matchGoogleShopping(j, subject))
    .catch((e) => warn('google-shopping', e))

  const [r, g, t, v, p, e, f] = await Promise.all([
    reddit,
    googleReviews,
    trustpilot,
    video,
    press,
    entityDatabases,
    feed,
  ])
  return {
    reddit: r,
    googleReviews: g,
    trustpilot: t,
    video: v,
    press: p,
    entityDatabases: e,
    feed: { googleMerchantFeed: f },
  }
}

export async function hasWikidata(brand, fetchImpl = fetch) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(brand)}&language=en&format=json&limit=1`
  const json = await (await fetchImpl(url, { signal: AbortSignal.timeout(15000) })).json()
  return (json.search?.length ?? 0) > 0
}

export async function hasWikipedia(brand, fetchImpl = fetch) {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(brand)}&limit=1&format=json`
  const json = await (await fetchImpl(url, { signal: AbortSignal.timeout(15000) })).json()
  return (json[1]?.length ?? 0) > 0
}

export async function collectOffStore(subject, { apiKey = null } = {}) {
  const signals = await serpapiSignals(subject, { apiKey })
  return { collectedAt: new Date().toISOString(), route: 'serpapi', subject, ...signals }
}

export async function main(argv, env = process.env) {
  const a = parseArgv(argv)
  if (!a.brand) throw new Error('--brand is required')
  if (!env.SERPAPI_API_KEY) {
    throw new Error(
      'SERPAPI_API_KEY is not set. Save one with scripts/credentials.mjs, then source the ' +
        'credential store before running this script.',
    )
  }
  const subject = {
    brand: a.brand,
    domain: a.domain ?? null,
    language: a.language ?? 'en',
    country: a.country ?? null,
    city: a.city ?? null,
    productTitle: a['product-title'] ?? a.brand,
    productType: a['product-type'] ?? null,
    ownSocialUrls: String(a['own-social'] ?? '')
      .split(',')
      .map((u) => u.trim().replace(/^https?:\/\//, ''))
      .filter(Boolean),
  }
  const result = await collectOffStore(subject, { apiKey: env.SERPAPI_API_KEY })

  if (a.out) {
    mkdirSync(dirname(a.out), { recursive: true })
    writeFileSync(a.out, JSON.stringify(result, null, 2))
  }
  return {
    out: a.out ?? null,
    route: 'serpapi',
    collected: Object.fromEntries(
      ['reddit', 'googleReviews', 'trustpilot', 'video', 'press', 'entityDatabases'].map((k) => [
        k,
        result[k] !== null,
      ]),
    ),
    googleShopping: result.feed.googleMerchantFeed !== null,
    pressCandidates: result.press?.candidates?.length ?? 0,
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
