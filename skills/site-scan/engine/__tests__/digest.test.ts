import { describe, expect, it } from 'vitest'

import { generateDigests } from '../digest'
import type { CrawlReport, Finding, PageRecord } from '../types'

const DIGEST_BYTE_BUDGET = 32 * 1024

function page(url: string, overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    url,
    status: 200,
    title: `Title ${url}`,
    metaDescription: 'desc',
    canonical: url,
    h1: ['h'],
    headings: [],
    wordCount: 300,
    textSample: '',
    images: [],
    internalLinks: [],
    externalLinks: [],
    schemaTypes: [],
    contentHash: 'x',
    ...overrides
  }
}

const report: CrawlReport = {
  startedAt: '2026-07-30T02:00:00Z',
  finishedAt: '2026-07-30T02:04:00Z',
  discovered: 3,
  htmlFetched: 3,
  structuredItems: 2,
  robotsBlocked: 0,
  errors: 0,
  cappedHtml: 0,
  cappedStructured: 0,
  skipped: { linkChecks: 0, pages: 0 },
  checksPassed: [],
  checksInconclusive: [],
  productPages: 0
}

const findings: Finding[] = [
  {
    checkId: 'missing-meta-description',
    title: 'Pages without a meta description',
    count: 23,
    priority: 1,
    urls: ['https://a.com/p1', 'https://a.com/p2']
  }
]

describe('generateDigests', () => {
  it('writes the three digests with the site story and prioritized findings', () => {
    const digests = generateDigests({
      siteKey: 'https://a.com',
      pages: [page('https://a.com/'), page('https://a.com/blog/post')],
      findings,
      report,
      shopify: {
        products: [
          {
            id: 1,
            handle: 'deck',
            url: 'https://a.com/products/deck',
            title: 'Deck',
            bodyHtml: '',
            priceRange: { min: '19.00', max: '25.00' },
            images: 2
          }
        ],
        collections: [{ handle: 'tools', title: 'Tools' }]
      }
    })
    expect(digests['SITE-BRIEF.md']).toContain('https://a.com')
    expect(digests['SITE-BRIEF.md']).toContain('1 products')
    // The ADR 0078 preflight pointer: the brief names where shared session notes live.
    expect(digests['SITE-BRIEF.md']).toContain('TracyWork/team/')
    expect(digests['content-map.md']).toContain('/blog')
    expect(digests['seo-findings.md']).toContain('Pages without a meta description')
    expect(digests['seo-findings.md']).toContain('Observed')
  })

  it('stays under the byte budget for a huge site and notes what it folded', () => {
    const pages = Array.from({ length: 5000 }, (_, i) => page(`https://a.com/blog/post-${i}`))
    const digests = generateDigests({ siteKey: 'https://a.com', pages, findings, report })
    for (const content of Object.values(digests)) {
      expect(Buffer.byteLength(content, 'utf8')).toBeLessThanOrEqual(DIGEST_BYTE_BUDGET)
    }
    expect(digests['content-map.md']).toMatch(/more URLs\. Read surface\/pages\//)
  })

  it('is deterministic for the same input', () => {
    const input = { siteKey: 'https://a.com', pages: [page('https://a.com/')], findings, report }
    expect(generateDigests(input)).toEqual(generateDigests(input))
  })

  it('names the platform the caller knows, over the enrichment guess', () => {
    // Every platform-gated skill reads this line to decide which procedures apply, so the
    // caller's own detection must win over a vendor dataset's guess.
    const base = { siteKey: 'https://a.com', pages: [page('https://a.com/')], findings, report }
    const known = generateDigests({ ...base, platform: 'joomla' })
    expect(known['SITE-BRIEF.md']).toContain('- Platform: joomla')

    const guessed = generateDigests({
      ...base,
      enrichment: { found: true, platform: 'shopify', items: [] }
    })
    expect(guessed['SITE-BRIEF.md']).toContain('- Platform: shopify')

    const both = generateDigests({
      ...base,
      platform: 'joomla',
      enrichment: { found: true, platform: 'shopify', items: [] }
    })
    expect(both['SITE-BRIEF.md']).toContain('- Platform: joomla')

    expect(generateDigests(base)['SITE-BRIEF.md']).not.toContain('- Platform:')
  })
})
