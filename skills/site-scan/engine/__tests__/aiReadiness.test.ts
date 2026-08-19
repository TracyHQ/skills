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

describe('page-noindex', () => {
  it('fires when a page the sitemap advertises forbids indexing', () => {
    const url = `${SITE}/san-pham/hoa-cuoi`
    const found = run({
      pages: [page(`${SITE}/`), page(url, { metaRobots: 'noindex' })],
      sitemapUrls: [`${SITE}/`, url]
    })
    const f = found.find((x) => x.checkId === 'page-noindex')
    expect(f).toMatchObject({ count: 1, priority: 2 })
    expect(f?.urls).toEqual([url])
  })

  it('names each url once, even when the crawl holds two records for it', () => {
    const url = `${SITE}/gio-hang/`
    const found = run({
      pages: [page(`${SITE}/`), page(url, { metaRobots: 'noindex' }), page(url, { metaRobots: 'noindex' })],
      sitemapUrls: [`${SITE}/`, url]
    })
    expect(found.find((x) => x.checkId === 'page-noindex')).toMatchObject({ count: 1, urls: [url] })
  })

  it('stays silent for a utility page the sitemap never advertised', () => {
    const url = `${SITE}/gio-hang/`
    const found = run({
      pages: [page(`${SITE}/`), page(url, { metaRobots: 'noindex' })],
      sitemapUrls: [`${SITE}/`]
    })
    expect(ids(found)).not.toContain('page-noindex')
  })
})
