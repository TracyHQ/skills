import { describe, expect, it } from 'vitest'

import { MN_DISCOVERABILITY, runMnDiscoverability } from '../analyze/mnDiscoverability'
import type { PageRecord } from '../types'

const page = (url: string, over: Partial<PageRecord> = {}): PageRecord => ({
  url,
  status: 200,
  h1: ['One'],
  headings: [{ level: 1, text: 'One' }],
  wordCount: 400,
  textSample: 'plenty of words',
  images: [],
  internalLinks: [],
  externalLinks: [],
  schemaTypes: [],
  contentHash: 'x'.repeat(40),
  ...over
})

const SITE = 'https://gymshark.com'
const ids = (findings: { checkId: string }[]) => findings.map((f) => f.checkId)

describe('the pinned MN framework table', () => {
  // Hand-encoded from mention-network-shopify framework.constants.ts. If either side changes a
  // weight or an impact, this fails — the two products must keep speaking the same names.
  it('carries the 13 portable Discoverability criteria with their exact weights and impacts', () => {
    expect(Object.keys(MN_DISCOVERABILITY)).toHaveLength(13)
    expect(MN_DISCOVERABILITY['brand-in-title']).toMatchObject({ weight: 3, impact: 'Critical', adapted: true })
    expect(MN_DISCOVERABILITY['product-schema']).toMatchObject({ weight: 3, impact: 'Critical' })
    expect(MN_DISCOVERABILITY['organization-schema']).toMatchObject({ weight: 3, impact: 'Critical' })
    expect(MN_DISCOVERABILITY['crawlable-text']).toMatchObject({ weight: 2, impact: 'High', adapted: true })
    expect(MN_DISCOVERABILITY['product-schema-rich']).toMatchObject({ weight: 2, impact: 'High' })
    expect(MN_DISCOVERABILITY['review-schema']).toMatchObject({ weight: 2, impact: 'High' })
    expect(MN_DISCOVERABILITY['shipping-schema']).toMatchObject({ weight: 2, impact: 'High' })
    expect(MN_DISCOVERABILITY['faq-schema']).toMatchObject({ weight: 2, impact: 'High' })
    for (const id of ['internal-linking', 'image-alt-text', 'heading-hierarchy', 'breadcrumb-schema', 'video-schema']) {
      expect(MN_DISCOVERABILITY[id]).toMatchObject({ weight: 1, impact: 'Medium' })
    }
    // google-merchant-feed is deliberately absent: it needs a paid lookup, which is Source work.
    expect(MN_DISCOVERABILITY['google-merchant-feed']).toBeUndefined()
    // ai-bots-allowed left for aiReadiness.ts, where Tracy sets its own severity.
    expect(MN_DISCOVERABILITY['ai-bots-allowed']).toBeUndefined()
  })
})

describe('the machine-readability family', () => {
  const product = (over: Partial<PageRecord> = {}) => page(`${SITE}/products/leggings`, over)

  it('reads price+currency+availability as the bar for product-schema, MN verbatim', () => {
    const full = product({
      title: 'Gymshark Leggings',
      schemaTypes: ['Product', 'Offer'],
      productSchema: {
        offers: true,
        price: true,
        currency: true,
        availability: true,
        gtin: true,
        brand: true,
        mpn: false,
        sku: true
      }
    })
    const partial = product({ productSchema: { ...full.productSchema!, availability: false } })
    expect(ids(runMnDiscoverability([full], SITE))).not.toContain('product-schema')
    expect(ids(runMnDiscoverability([partial], SITE))).toContain('product-schema')
  })

  it('accepts a GTIN or brand+MPN as an exact identity, nothing less', () => {
    const base = { offers: true, price: true, currency: true, availability: true }
    const gtin = product({ productSchema: { ...base, gtin: true, brand: false, mpn: false, sku: false } })
    const brandMpn = product({ productSchema: { ...base, gtin: false, brand: true, mpn: true, sku: false } })
    const skuOnly = product({ productSchema: { ...base, gtin: false, brand: false, mpn: false, sku: true } })
    expect(ids(runMnDiscoverability([gtin], SITE))).not.toContain('product-schema-rich')
    expect(ids(runMnDiscoverability([brandMpn], SITE))).not.toContain('product-schema-rich')
    expect(ids(runMnDiscoverability([skuOnly], SITE))).toContain('product-schema-rich')
  })

  it('sees a nested AggregateRating now that extraction walks the whole tree', () => {
    const rated = product({ schemaTypes: ['Product', 'AggregateRating'] })
    expect(ids(runMnDiscoverability([rated], SITE))).not.toContain('review-schema')
    expect(ids(runMnDiscoverability([product()], SITE))).toContain('review-schema')
  })

  it('never scores a page for the video it does not have — absence is not failure', () => {
    const noVideo = product()
    const brokenVideo = product({ videoSchema: { name: true, thumbnail: false, url: true } })
    expect(ids(runMnDiscoverability([noVideo], SITE))).not.toContain('video-schema')
    expect(ids(runMnDiscoverability([brokenVideo], SITE))).toContain('video-schema')
  })

  it('clears organization-schema with one full identity anywhere, and names what a partial one lacks', () => {
    const partial = page(`${SITE}/`, { orgSchema: { name: true, logo: false, sameAs: false } })
    const found = runMnDiscoverability([partial], SITE)
    const f = found.find((x) => x.checkId === 'organization-schema')
    expect(f?.urls[0]).toContain('logo, sameAs')
    const full = page(`${SITE}/`, { orgSchema: { name: true, logo: true, sameAs: true } })
    expect(ids(runMnDiscoverability([full], SITE))).not.toContain('organization-schema')
  })
})

describe('the readability family', () => {
  it('flags a heading skip even when the single h1 is in place', () => {
    const skipped = page(`${SITE}/about`, {
      headings: [
        { level: 1, text: 'About' },
        { level: 4, text: 'Deep' }
      ]
    })
    expect(ids(runMnDiscoverability([skipped], SITE))).toContain('heading-hierarchy')
  })

  it('holds alt text to the MN bar: four words, unique, not a filename', () => {
    const bad = page(`${SITE}/p`, {
      images: [
        { src: 'a.jpg', alt: 'IMG_2041.jpg' },
        { src: 'b.jpg', alt: 'Black seamless leggings, side view' }
      ]
    })
    const good = page(`${SITE}/q`, { images: [{ src: 'a.jpg', alt: 'Black seamless leggings, side view' }] })
    const found = runMnDiscoverability([bad, good], SITE)
    const f = found.find((x) => x.checkId === 'image-alt-text')
    expect(f?.count).toBe(1)
    expect(f?.urls).toEqual([`${SITE}/p`])
  })

  it('treats the host label as the brand and excuses nothing on product pages', () => {
    const unbranded = page(`${SITE}/products/x`, { title: 'Seamless Leggings - Black' })
    const branded = page(`${SITE}/products/y`, { title: 'Gymshark Seamless Leggings' })
    const found = runMnDiscoverability([unbranded, branded], SITE)
    const f = found.find((x) => x.checkId === 'brand-in-title')
    expect(f?.urls).toEqual([`${SITE}/products/x`])
  })

  it('recognizes the brand through punctuation and a suffixed domain', () => {
    // fifibakeryny.com titles its products "抹茶奶酥吐司 – FIFI Bakery": the brand is named, the
    // domain merely wears an extra "ny". The rule must not convict every product for that.
    const site = 'https://fifibakeryny.com'
    const branded = page(`${site}/products/toast`, { title: '抹茶奶酥吐司（450克） – FIFI Bakery' })
    const unbranded = page(`${site}/products/plain`, { title: 'Matcha Milk Toast' })
    const found = runMnDiscoverability([branded, unbranded], site)
    expect(found.find((x) => x.checkId === 'brand-in-title')?.urls).toEqual([`${site}/products/plain`])
  })

  it('lets a breadcrumb or a collections link satisfy internal-linking, MN verbatim', () => {
    const trailed = page(`${SITE}/products/a`, { schemaTypes: ['BreadcrumbList'] })
    const linked = page(`${SITE}/products/b`, { internalLinks: [`${SITE}/collections/leggings`] })
    const stranded = page(`${SITE}/products/c`)
    const found = runMnDiscoverability([trailed, linked, stranded], SITE)
    expect(found.find((x) => x.checkId === 'internal-linking')?.urls).toEqual([`${SITE}/products/c`])
  })
})

describe('hop pages', () => {
  it('never judges a redirect stub', () => {
    const stub = page(`${SITE}/`, { redirectStub: true, wordCount: 1, h1: [], headings: [] })
    expect(runMnDiscoverability([stub], SITE)).toEqual([])
  })
})
