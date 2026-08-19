import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { extractPage } from '../harvest/pageExtract'

const html = readFileSync(join(__dirname, 'fixtures', 'product-page.html'), 'utf8')
const url = 'https://a.com/products/anatomy-flashcards'

describe('extractPage', () => {
  it('extracts the on-page seo signals', () => {
    const page = extractPage(url, html, 'https://a.com')
    expect(page.title).toBe('Anatomy Flashcards — Acme Store')
    expect(page.metaDescription).toBe('Spaced-repetition flashcards covering all 12 cranial nerves.')
    expect(page.canonical).toBe('https://a.com/products/anatomy-flashcards')
    expect(page.h1).toEqual(['Anatomy Flashcards'])
    expect(page.headings).toContainEqual({ level: 2, text: 'Why students love them' })
    // The walk is recursive now: the Offer nested inside the Product is seen too.
    expect(page.schemaTypes).toEqual(['Product', 'Offer'])
  })

  it('reads what the Product markup actually carries, field by field', () => {
    const page = extractPage(url, html, 'https://a.com')
    expect(page.productSchema).toEqual({
      offers: true,
      price: true,
      currency: false,
      availability: false,
      gtin: false,
      brand: false,
      mpn: false,
      sku: false
    })
    expect(page.orgSchema).toBeUndefined()
    expect(page.videoSchema).toBeUndefined()
  })

  it('separates internal and external links and resolves relative hrefs', () => {
    const page = extractPage(url, html, 'https://a.com')
    expect(page.internalLinks).toContain('https://a.com/collections/study-tools')
    expect(page.internalLinks).toContain('https://a.com/products/about')
    expect(page.externalLinks).toEqual(['https://instagram.com/acme'])
    expect(page.internalLinks.every((l) => !l.includes('#') && !l.startsWith('mailto:'))).toBe(true)
  })

  it('keeps image alt state and counts words', () => {
    const page = extractPage(url, html, 'https://a.com')
    expect(page.images).toContainEqual({ src: '/img/deck.jpg', alt: 'A deck of flashcards' })
    expect(page.images).toContainEqual({ src: '/img/box.jpg', alt: undefined })
    expect(page.wordCount).toBeGreaterThan(20)
    expect(page.textSample.length).toBeLessThanOrEqual(2000)
  })

  it('hashes content deterministically', () => {
    const a = extractPage(url, html, 'https://a.com')
    const b = extractPage(url, html, 'https://a.com')
    expect(a.contentHash).toBe(b.contentHash)
    expect(a.contentHash).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('extractPage — site scope', () => {
  it('counts the www host as the same site as the apex it was seeded from', () => {
    const page = extractPage(
      'https://gymshark.com/',
      '<html><body><a href="https://www.gymshark.com/shop">Shop</a></body></html>',
      'https://gymshark.com'
    )
    expect(page.internalLinks).toEqual(['https://www.gymshark.com/shop'])
    expect(page.externalLinks).toEqual([])
  })

  it('keeps a checkout subdomain external', () => {
    const page = extractPage(
      'https://gymshark.com/',
      '<html><body><a href="https://uk.checkout.gymshark.com/cart">Cart</a></body></html>',
      'https://gymshark.com'
    )
    expect(page.internalLinks).toEqual([])
    expect(page.externalLinks).toEqual(['https://uk.checkout.gymshark.com/cart'])
  })
})

describe('extractPage — redirect stubs', () => {
  const stub = [
    '<html><head><link rel="canonical" href="https://us.checkout.gymshark.com/"></head>',
    '<body><img src="/logo.png" alt="Gymshark">Redirecting...</body></html>'
  ].join('')

  it('flags the 200 hop page a headless apex serves', () => {
    const page = extractPage('https://gymshark.com/', stub, 'https://gymshark.com')
    expect(page.redirectStub).toBe(true)
  })

  it('leaves a real page unflagged even when its canonical is cross-site', () => {
    const syndicated = [
      '<html><head><link rel="canonical" href="https://origin.example/post"></head><body><h1>A post</h1>',
      `<p>${'word '.repeat(120)}</p></body></html>`
    ].join('')
    expect(
      extractPage('https://mirror.example/post', syndicated, 'https://mirror.example').redirectStub
    ).toBeUndefined()
  })

  it('does not flag a short page whose canonical points at itself', () => {
    const thin = '<html><head><link rel="canonical" href="/thanks"></head><body>Thanks!</body></html>'
    expect(extractPage('https://acme.com/thanks', thin, 'https://acme.com').redirectStub).toBeUndefined()
  })

  it('does not flag a page with no canonical at all', () => {
    expect(
      extractPage('https://acme.com/x', '<html><body>Hi</body></html>', 'https://acme.com').redirectStub
    ).toBeUndefined()
  })
})

describe('what the platform says a page is for', () => {
  it('carries the kind through when the body class names it', () => {
    const cart =
      '<html><head><title>Gio hang</title></head><body class="page-template-default woocommerce-cart woocommerce-page">' +
      '<h1>Gio hang</h1></body></html>'
    expect(extractPage('https://juneflower.vn/gio-hang/', cart, 'https://juneflower.vn').pageKind).toBe('cart')
  })

  it('leaves an ordinary page without a kind', () => {
    const product =
      '<html><head><title>Hoa bo</title></head><body class="woocommerce-page"><h1>Hoa bo</h1></body></html>'
    expect(extractPage('https://juneflower.vn/san-pham/hoa-bo/', product, 'https://juneflower.vn').pageKind)
      .toBeUndefined()
  })
})
