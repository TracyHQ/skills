import { createHash } from 'node:crypto'

import * as cheerio from 'cheerio'

import { isSameSite } from '../sameSite'
import type { PageRecord } from '../types'
import { recognisePageKind } from './pageKind'

const TEXT_SAMPLE_LENGTH = 2000
/** Above this, a cross-site canonical is a syndication choice rather than a hop page. */
const STUB_MAX_WORDS = 50

/**
 * Pure HTML → PageRecord extraction (spec §4): everything the analyzers and the
 * Digest need from one rendered page, no network. Runs on every crawled page —
 * including ones whose content came from REST — because only the real HTML has
 * the title tag, canonical and structured data the site actually serves.
 */
/**
 * Bump this whenever `extractPage` starts reading something it did not read before. The saved
 * pages from every earlier version are then treated as stale and read again, which is the only
 * way a new field ever reaches a workspace that has already been crawled.
 *
 * 1 — the original shape.
 * 2 — `pageKind`: what the platform says a page is for.
 */
export const EXTRACTOR_VERSION = 2

export function extractPage(
  url: string,
  html: string,
  origin: string,
  platform: 'wordpress' | 'shopify' | 'joomla' | null = null
): PageRecord {
  const $ = cheerio.load(html)

  const headings: { level: number; text: string }[] = []
  for (let level = 1; level <= 6; level++) {
    $(`h${level}`).each((_, el) => {
      const text = $(el).text().trim()
      if (text) headings.push({ level, text })
    })
  }

  const images: { src: string; alt?: string }[] = []
  $('img[src]').each((_, el) => {
    images.push({ src: $(el).attr('src')!, alt: $(el).attr('alt') })
  })

  const internalLinks = new Set<string>()
  const externalLinks = new Set<string>()
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')!.trim()
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
    let resolved: URL
    try {
      resolved = new URL(href, url)
    } catch {
      return
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return
    resolved.hash = ''
    const target = resolved.toString()
    if (isSameSite(target, origin)) internalLinks.add(target)
    else externalLinks.add(target)
  })

  // The whole JSON-LD tree, walked recursively: an AggregateRating lives nested inside a Product,
  // a BreadcrumbList inside an @graph — a shallow read reports "no review schema" about a page
  // that has one, and the checks built on this would charge merchants for markup they wrote.
  const schemaTypes: string[] = []
  const schemaNodes: Record<string, unknown>[] = []
  const walkLd = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walkLd(item)
      return
    }
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    const type = record['@type']
    for (const t of Array.isArray(type) ? type : [type]) {
      if (typeof t === 'string') {
        if (!schemaTypes.includes(t)) schemaTypes.push(t)
        schemaNodes.push(record)
        break
      }
    }
    for (const value of Object.values(record)) walkLd(value)
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walkLd(JSON.parse($(el).text()))
    } catch {
      // Broken ld+json is the site's problem to have, not the crawler's to crash on.
    }
  })
  const productFacts = readProductFacts(schemaNodes)
  const orgFacts = readOrgFacts(schemaNodes)
  const videoFacts = readVideoFacts(schemaNodes)

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
  const title = $('head > title').first().text().trim()
  const metaDescription = $('meta[name="description"]').attr('content')?.trim()
  const canonical = $('link[rel="canonical"]').attr('href')?.trim()
  const metaRobots = $('meta[name="robots"]').attr('content')?.trim()

  const h1 = headings.filter((h) => h.level === 1).map((h) => h.text)
  const wordCount = bodyText ? bodyText.split(' ').length : 0
  const pageKind = recognisePageKind($('body').attr('class') ?? '', url, platform)

  return {
    url,
    status: 200,
    title: title || undefined,
    metaDescription: metaDescription || undefined,
    canonical: canonical || undefined,
    ...(isRedirectStub({ url, canonical, h1, wordCount }) ? { redirectStub: true as const } : {}),
    ...(metaRobots ? { metaRobots } : {}),
    ...(productFacts ? { productSchema: productFacts } : {}),
    ...(orgFacts ? { orgSchema: orgFacts } : {}),
    ...(videoFacts ? { videoSchema: videoFacts } : {}),
    h1,
    headings,
    ...(pageKind ? { pageKind } : {}),
    wordCount,
    textSample: bodyText.slice(0, TEXT_SAMPLE_LENGTH),
    images,
    internalLinks: [...internalLinks],
    externalLinks: [...externalLinks],
    schemaTypes,
    contentHash: createHash('sha1').update(bodyText).digest('hex')
  }
}

/**
 * A hop page: 200, but the body is only "Redirecting…" while the canonical names
 * another site. Shopify serves one at the apex of a headless store, so a crawl
 * seeded there sees it instead of the homepage.
 *
 * The three signals only convict together. A cross-site canonical alone is
 * syndication; an empty h1 alone is a design choice; a short page alone is a
 * short page. Judging a hop page as a real one hands the checks a page that has
 * no title, no h1 and no structured data — and every finding that follows is
 * about a page nobody can visit.
 */
function isRedirectStub(page: { url: string; canonical?: string; h1: string[]; wordCount: number }): boolean {
  if (!page.canonical || page.h1.length > 0 || page.wordCount >= STUB_MAX_WORDS) return false
  let absolute: string
  try {
    absolute = new URL(page.canonical, page.url).toString()
  } catch {
    return false
  }
  return !isSameSite(absolute, page.url)
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node['@type']
  return Array.isArray(t) ? t.includes(type) : t === type
}

const text = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0

/** MN's isValidGtin: pure digits, one of the four GTIN lengths. */
const GTIN_KEYS = ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14']
function validGtin(node: Record<string, unknown>): boolean {
  return GTIN_KEYS.some((k) => {
    const v = node[k]
    return typeof v === 'string' && /^\d{8}$|^\d{12,14}$/.test(v.trim())
  })
}

function readProductFacts(nodes: Record<string, unknown>[]): PageRecord['productSchema'] {
  const product = nodes.find((n) => hasType(n, 'Product'))
  if (!product) return undefined
  const offers = nodes.find((n) => hasType(n, 'Offer') || hasType(n, 'AggregateOffer'))
  const brand = product['brand']
  return {
    offers: Boolean(offers),
    price: Boolean(offers && (typeof offers.price === 'number' || text(offers.price))),
    currency: Boolean(offers && text(offers.priceCurrency)),
    availability: Boolean(offers && text(offers.availability)),
    gtin: validGtin(product),
    brand:
      text(brand) || (typeof brand === 'object' && brand !== null && text((brand as Record<string, unknown>).name)),
    mpn: text(product.mpn),
    sku: text(product.sku)
  }
}

function readOrgFacts(nodes: Record<string, unknown>[]): PageRecord['orgSchema'] {
  const org = nodes.find((n) => hasType(n, 'Organization'))
  if (!org) return undefined
  const logo = org.logo
  return {
    name: text(org.name),
    logo: text(logo) || (typeof logo === 'object' && logo !== null && text((logo as Record<string, unknown>).url)),
    sameAs: Array.isArray(org.sameAs) && org.sameAs.some(text)
  }
}

function readVideoFacts(nodes: Record<string, unknown>[]): PageRecord['videoSchema'] {
  const video = nodes.find((n) => hasType(n, 'VideoObject'))
  if (!video) return undefined
  return {
    name: text(video.name),
    thumbnail: text(video.thumbnailUrl) || (Array.isArray(video.thumbnailUrl) && video.thumbnailUrl.some(text)),
    url: text(video.contentUrl) || text(video.embedUrl)
  }
}
