import { describe, expect, it } from 'vitest'

import { runAiReadiness } from '../analyze/aiReadiness'
import type { PageRecord } from '../types'

const SITE = 'https://juneflower.vn'

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

const run = (over: Partial<Parameters<typeof runAiReadiness>[0]> = {}) =>
  runAiReadiness({ robotsText: '', siteKey: SITE, pages: [page(`${SITE}/`)], sitemapUrls: [], ...over })

const ids = (findings: { checkId: string }[]) => findings.map((f) => f.checkId)

describe('ai-bots-allowed', () => {
  it('fires at P1 when robots.txt turns away a search engine, naming the bot', () => {
    const found = run({ robotsText: 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow:' })
    const f = found.find((x) => x.checkId === 'ai-bots-allowed')
    expect(f).toMatchObject({ count: 1, priority: 1 })
    expect(f?.urls[0]).toContain('googlebot')
  })
})

describe('ai-bots-allowed, beyond the homepage', () => {
  it('catches a section blocked while the homepage stays open, and names the path', () => {
    const found = run({
      robotsText: 'User-agent: *\nDisallow: /san-pham/',
      sitemapUrls: [`${SITE}/`, `${SITE}/san-pham/hoa-cuoi`, `${SITE}/danh-muc/hoa-bo`]
    })
    const f = found.find((x) => x.checkId === 'ai-bots-allowed')
    expect(f?.urls.some((u) => u.includes('/san-pham/'))).toBe(true)
    expect(f?.urls.every((u) => !u.includes('/danh-muc/'))).toBe(true)
  })
})

describe('a homepage that forbids indexing', () => {
  it('counts as turning every engine away, not as one page among many', () => {
    const found = run({ pages: [page(`${SITE}/`, { metaRobots: 'noindex, nofollow' })] })
    const f = found.find((x) => x.checkId === 'ai-bots-allowed')
    expect(f).toMatchObject({ priority: 1 })
    expect(f?.urls.some((u) => u.includes('noindex'))).toBe(true)
  })
})

describe('ai-training-bots-blocked', () => {
  it('reports a blocked training bot separately, at the lowest priority', () => {
    const found = run({ robotsText: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:' })
    expect(ids(found)).not.toContain('ai-bots-allowed')
    const f = found.find((x) => x.checkId === 'ai-training-bots-blocked')
    expect(f).toMatchObject({ count: 1, priority: 3 })
    expect(f?.urls[0]).toContain('gptbot')
  })
})

describe('sitemap-noindex-conflict', () => {
  it('fires when a page the sitemap advertises forbids indexing', () => {
    const url = `${SITE}/san-pham/hoa-cuoi`
    const found = run({
      pages: [page(`${SITE}/`), page(url, { metaRobots: 'noindex' })],
      sitemapUrls: [`${SITE}/`, url]
    })
    const f = found.find((x) => x.checkId === 'sitemap-noindex-conflict')
    expect(f).toMatchObject({ count: 1, priority: 3 })
    expect(f?.urls).toEqual([url])
  })

  it('names each url once, even when the crawl holds two records for it', () => {
    const url = `${SITE}/gio-hang/`
    const found = run({
      pages: [page(`${SITE}/`), page(url, { metaRobots: 'noindex' }), page(url, { metaRobots: 'noindex' })],
      sitemapUrls: [`${SITE}/`, url]
    })
    expect(found.find((x) => x.checkId === 'sitemap-noindex-conflict')).toMatchObject({ count: 1, urls: [url] })
  })

  it('stays silent for a utility page the sitemap never advertised', () => {
    const url = `${SITE}/gio-hang/`
    const found = run({
      pages: [page(`${SITE}/`), page(url, { metaRobots: 'noindex' })],
      sitemapUrls: [`${SITE}/`]
    })
    expect(ids(found)).not.toContain('sitemap-noindex-conflict')
  })
})

describe('crawl-delay-punitive', () => {
  it('calls out a delay so long the honouring bots can never finish', () => {
    const found = run({ robotsText: 'User-agent: *\nCrawl-Delay: 20' })
    const f = found.find((x) => x.checkId === 'crawl-delay-punitive')
    expect(f).toMatchObject({ priority: 2 })
    expect(f?.urls[0]).toContain('20')
  })

  it('drops to the softest priority for a delay that merely slows things down', () => {
    const found = run({ robotsText: 'User-agent: *\nCrawl-Delay: 7' })
    expect(found.find((x) => x.checkId === 'crawl-delay-punitive')).toMatchObject({ priority: 3 })
  })

  it('stays silent at a delay a crawler can live with', () => {
    expect(ids(run({ robotsText: 'User-agent: *\nCrawl-Delay: 2' }))).not.toContain('crawl-delay-punitive')
  })
})

describe('ai-bots-reachable', () => {
  const access = (over: Record<string, unknown> = {}) => ({
    baselineStatus: 200,
    controlStatus: 200,
    bots: [
      { bot: 'GPTBot', status: 200 },
      { bot: 'ClaudeBot', status: 200 }
    ],
    ...over
  })

  it('reports at P1 when an AI bot is turned away but an ordinary visitor is not', () => {
    const found = run({
      botAccess: access({ cdn: 'Fastly', bots: [{ bot: 'GPTBot', status: 403 }, { bot: 'ClaudeBot', status: 200 }] })
    })
    const f = found.find((x) => x.checkId === 'ai-bots-reachable')
    expect(f).toMatchObject({ count: 1, priority: 1 })
    expect(f?.urls[0]).toContain('GPTBot')
    expect(f?.urls[0]).toContain('403')
    expect(f?.title).toContain('Fastly')
  })

  it('softens to P3 when a search identity is refused too, which means identities are being verified', () => {
    const found = run({ botAccess: access({ controlStatus: 403, bots: [{ bot: 'GPTBot', status: 403 }] }) })
    expect(found.find((x) => x.checkId === 'ai-bots-reachable')).toMatchObject({ priority: 3 })
  })

  it('says nothing when the site refuses an ordinary visitor as well', () => {
    const found = run({ botAccess: access({ baselineStatus: 401, bots: [{ bot: 'GPTBot', status: 401 }] }) })
    expect(ids(found)).not.toContain('ai-bots-reachable')
  })
})

describe('utility-page-indexable', () => {
  it('fires for a checkout page nothing is hiding from search', () => {
    const url = `${SITE}/thanh-toan/`
    const found = run({ pages: [page(`${SITE}/`), page(url, { pageKind: 'checkout' })] })
    const f = found.find((x) => x.checkId === 'utility-page-indexable')
    expect(f).toMatchObject({ count: 1, priority: 2 })
    expect(f?.urls[0]).toContain('checkout')
  })

  it('leaves alone a cart page that already asks to stay out of search', () => {
    const found = run({
      pages: [page(`${SITE}/`), page(`${SITE}/gio-hang/`, { pageKind: 'cart', metaRobots: 'noindex, follow' })]
    })
    expect(ids(found)).not.toContain('utility-page-indexable')
  })
})
