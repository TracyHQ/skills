// Collect everything the on-page scorers read: the PDP (pre-JS and, when supplied, post-JS),
// robots.txt, the store-level pages (About / Contact / the four policies) and the product
// snapshot from Shopify's public `<pdp>.json`. Writes ONE pages.json the scorer step consumes.
//
// Rendering: the backend renders with Cloudflare/Firecrawl. Client-side we do a plain fetch,
// which is exactly what a non-JS AI crawler sees, and accept a post-JS capture from the agent
// via --rendered-html (a rendered DOM saved to a file by whatever produced it). This skill never
// captures one itself: every lane it has is an API key, and a browser is not one.
// Without it `renderer: 'plain'` is recorded and `crawlable-text` scores `na` rather than a
// free 100 for comparing the page against itself.
//
// Usage:
//   node fetch-pages.mjs --pdp-url https://shop.com/products/x --out pages.json
//   node fetch-pages.mjs --pdp-url ... --rendered-html dom.html --out pages.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isMainModule, parseArgv } from './util.mjs'

const UA = 'Mozilla/5.0 (compatible; MentionNetworkAudit/1.0; non-JS fetch)'
const META_ROBOTS_RE = /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i

const STORE_PAGE_PATHS = {
  about: ['/pages/about', '/pages/about-us'],
  contact: ['/pages/contact', '/pages/contact-us'],
  refund: ['/policies/refund-policy'],
  shipping: ['/policies/shipping-policy'],
  privacy: ['/policies/privacy-policy'],
  terms: ['/policies/terms-of-service'],
}

export async function plainFetch(url, { timeoutMs = 30000, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    return {
      ok: res.ok,
      html: await res.text(),
      status: res.status,
      xRobotsTag: res.headers.get('x-robots-tag'),
    }
  } catch (e) {
    process.stderr.write(`warning: fetch failed ${url}: ${e.message}\n`)
    return { ok: false, html: '', status: null, xRobotsTag: null }
  }
}

/**
 * The store's OWN social profiles, read off the PDP (footer/nav links to social platforms).
 *
 * Why this is collected here rather than typed in: `collect-offstore.mjs` counts third-party
 * video mentions, and a store's own YouTube channel is not a third-party mention. Passing the
 * store's own profiles is what excludes them — and when nobody passes them the criterion reads
 * the brand's own marketing as earned coverage and scores higher than the truth.
 *
 * A profile URL with NO path is deliberately dropped. `countVideoPlatforms` excludes a result
 * when the result's link CONTAINS one of these strings, so a bare `youtube.com` would exclude
 * every YouTube result in existence — turning an over-count into a zero, which is the worse
 * error of the two because it looks like a real finding.
 */
const SOCIAL_HOSTS =
  /^(?:www\.)?((?:m\.)?youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|pinterest\.[a-z.]+|linkedin\.com|vimeo\.com)$/i

export function discoverSocials(pdpHtml) {
  const found = new Set()
  for (const m of String(pdpHtml || '').matchAll(/href=["']([^"']+)["']/gi)) {
    let url
    try {
      url = new URL(m[1])
    } catch {
      continue // relative href — never an off-site social profile
    }
    if (!SOCIAL_HOSTS.test(url.hostname)) continue
    const path = url.pathname.replace(/\/+$/, '')
    if (!path || path === '/') continue // bare domain — see the docblock
    found.add(`${url.hostname.replace(/^www\./, '')}${path}`.toLowerCase())
  }
  return [...found]
}

// href values under /about or /contact found on the PDP (footer/nav) — extra candidates for
// themes that don't use the canonical Shopify paths. Uncapped, like the backend: the paths are
// deduped and `fetchFirstOk` stops at the first hit, so truncating only risks dropping the real
// About page behind a few "about-shipping"-style siblings.
export function discoverLinks(origin, pdpHtml) {
  const about = new Set()
  const contact = new Set()
  for (const m of String(pdpHtml || '').matchAll(/href=["']([^"']+)["']/gi)) {
    let path
    try {
      path = new URL(m[1], origin).pathname.toLowerCase()
    } catch {
      continue
    }
    if (/about/.test(path)) about.add(path)
    else if (/contact/.test(path)) contact.add(path)
  }
  return { about: [...about], contact: [...contact] }
}

async function fetchFirstOk(origin, paths, opts) {
  for (const path of paths) {
    const url = `${origin}${path}`
    const res = await plainFetch(url, opts)
    if (res.ok && res.html.length > 0) return { ok: true, url, html: res.html, status: res.status }
  }
  return null
}

// Shopify serves the product JSON next to the PDP. It carries body_html, vendor, product_type,
// images and variant prices — the same fields the backend reads out of its own product table.
export async function fetchProductJson(pdpUrl, opts) {
  const clean = pdpUrl.split('?')[0].replace(/\/$/, '')
  const res = await plainFetch(`${clean}.json`, opts)
  if (!res.ok) return null
  try {
    const p = JSON.parse(res.html)?.product
    if (!p) return null
    const price = Number(p.variants?.[0]?.price)
    return {
      title: p.title ?? null,
      vendor: p.vendor ?? null,
      handle: p.handle ?? null,
      description: p.body_html ?? null,
      productType: p.product_type ?? null,
      price: Number.isFinite(price) ? price : null,
      currency: null, // not in this payload; the caller fills it from the shop/meta
      imageUrl: p.images?.[0]?.src ?? p.image?.src ?? null,
      imageCount: Array.isArray(p.images) ? p.images.length : 0,
    }
  } catch {
    return null
  }
}

// Did we actually receive the STORE'S page, or something standing in front of it?
//
// Measured 2026-08-20 on gymshark.com: the fetch returned HTTP 200 and 60,037 characters, so
// every check we had (`res.ok`, `html.length > 0`) passed. Strip the script and style tags and
// what remained was 14 characters — "Redirecting..." — on a document carrying captcha and bot
// markers. We never saw Gymshark's page at all.
//
// The audit scored it anyway: 22/100, verdict "weak", and a ten-item "Fix these first" list
// telling a merchant their product schema was missing and their page text was empty. For a real
// store owner that is worse than an error. An error they would retry; a plausible, actionable,
// confidently wrong report they would act on.
//
// So length is not evidence of arrival. A product page a shopper can read has visible prose, at
// least one heading, and links out. A bot wall, a JS shell and a redirect stub all have none of
// those while still being large — the weight is all in <script>. Judge the page by what a reader
// would see, never by the size of the payload.
const SHELL_MARKERS = /captcha|are you a robot|just a moment|checking your browser|enable javascript|access denied|cf-browser-verification/i

export function visibleTextOf(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * `{ received, reason, signals }` — whether this document is plausibly the store's own page.
 * `received:false` means NOTHING on-page was measured; it must never be scored as a finding
 * about the store.
 */
export function assessPageArrival(html) {
  const text = visibleTextOf(html)
  const signals = {
    htmlLength: String(html || '').length,
    visibleTextLength: text.length,
    headings: (String(html || '').match(/<h[1-3]\b/gi) || []).length,
    links: (String(html || '').match(/<a\b/gi) || []).length,
    shellMarker: SHELL_MARKERS.test(String(html || '')),
  }
  // Thresholds are deliberately far below any real product page rather than tuned close to one:
  // the job here is to catch a wall, not to grade a thin page. A genuinely sparse PDP should
  // still be SCORED (and score badly) — that is a true finding about the store. Only a document
  // with essentially no reader-visible content at all is treated as "never arrived".
  if (signals.visibleTextLength < 200 && signals.headings === 0 && signals.links <= 2) {
    return {
      received: false,
      reason: signals.shellMarker
        ? 'bot-wall'
        : signals.htmlLength > 2000
          ? 'js-shell'
          : 'empty-response',
      signals,
    }
  }
  return { received: true, reason: null, signals }
}

export async function collectPages(pdpUrl, { renderedHtml = null, timeoutMs = 30000 } = {}) {
  const origin = new URL(pdpUrl).origin
  const opts = { timeoutMs }

  const [raw, robotsRes, product] = await Promise.all([
    plainFetch(pdpUrl, opts),
    plainFetch(`${origin}/robots.txt`, opts),
    fetchProductJson(pdpUrl, opts),
  ])

  const rendered = renderedHtml ?? raw.html
  const renderer = renderedHtml ? 'browser' : 'plain'
  const arrival = assessPageArrival(rendered)
  const page = {
    // `ok` keeps its old meaning (the transport worked) so nothing downstream changes silently.
    // `received` is the new, stricter question — see assessPageArrival: a 200 with 60KB of
    // <script> and 14 characters of text is `ok:true, received:false`.
    ok: raw.ok && rendered.length > 0,
    received: raw.ok && arrival.received,
    arrival,
    renderedHtml: rendered,
    rawSourceHtml: raw.html,
    status: raw.status,
    renderer,
    ...(raw.ok ? {} : { error: 'fetch-failed' }),
  }

  const robots = {
    ok: robotsRes.ok,
    body: robotsRes.ok ? robotsRes.html : '',
    metaRobots: rendered.match(META_ROBOTS_RE)?.[1]?.trim() ?? null,
    xRobotsTag: raw.xRobotsTag,
  }

  const discovered = discoverLinks(origin, raw.html)
  const [about, contact, refund, shipping, privacy, terms] = await Promise.all([
    fetchFirstOk(origin, [...STORE_PAGE_PATHS.about, ...discovered.about], opts),
    fetchFirstOk(origin, [...STORE_PAGE_PATHS.contact, ...discovered.contact], opts),
    fetchFirstOk(origin, STORE_PAGE_PATHS.refund, opts),
    fetchFirstOk(origin, STORE_PAGE_PATHS.shipping, opts),
    fetchFirstOk(origin, STORE_PAGE_PATHS.privacy, opts),
    fetchFirstOk(origin, STORE_PAGE_PATHS.terms, opts),
  ])

  return {
    pdpUrl,
    fetchedAt: new Date().toISOString(),
    page,
    robots,
    product,
    storePages: { about, contact, policies: { refund, shipping, privacy, terms } },
    storeSocials: discoverSocials(raw.html),
  }
}

export async function main(argv) {
  const a = parseArgv(argv)
  if (!a['pdp-url']) throw new Error('--pdp-url is required')
  const renderedHtml = a['rendered-html'] ? readFileSync(a['rendered-html'], 'utf8') : null
  const bundle = await collectPages(a['pdp-url'], {
    renderedHtml,
    timeoutMs: a['timeout-ms'] ? Number(a['timeout-ms']) : 30000,
  })
  if (a.out) {
    mkdirSync(dirname(a.out), { recursive: true })
    writeFileSync(a.out, JSON.stringify(bundle, null, 2))
  }
  const sp = bundle.storePages
  return {
    out: a.out ?? null,
    pageOk: bundle.page.ok,
    renderer: bundle.page.renderer,
    status: bundle.page.status,
    robotsOk: bundle.robots.ok,
    productJson: !!bundle.product,
    storeSocials: bundle.storeSocials.length,
    storePages: {
      about: !!sp.about,
      contact: !!sp.contact,
      refund: !!sp.policies.refund,
      shipping: !!sp.policies.shipping,
      privacy: !!sp.policies.privacy,
      terms: !!sp.policies.terms,
    },
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
