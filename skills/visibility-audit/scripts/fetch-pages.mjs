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
  const page = {
    ok: raw.ok && rendered.length > 0,
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
