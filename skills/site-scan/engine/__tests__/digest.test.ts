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

  /**
   * The Digest's opening line (ADR 0092 §3) — the half of Coverage that pays for the concept.
   *
   * A local copy built through a narrow door LOOKS complete: right folders, right commit, content
   * in place, drafts missing with nothing saying so. A warning that lives only on a screen leaves
   * the one thing that writes Proposals unaware of its own blind spot, so the brief opens with it.
   *
   * Every case here is driven by the FILE the mirror wrote. Nothing is recomputed, and nothing
   * here knows what a door can see — that is the adapter's to declare and this line's to repeat.
   */
  describe('the Coverage line', () => {
    const base = { siteKey: 'https://a.com', pages: [page('https://a.com/')], findings, report }

    it('opens the brief by naming the door and what that door cannot see', () => {
      const brief = generateDigests({
        ...base,
        coverage: {
          door: 'shopify:content',
          gaps: [
            {
              what: 'draft and archived products',
              reason: 'platform-limit',
              detail: 'The Storefront API serves published products only.'
            }
          ]
        }
      })['SITE-BRIEF.md']

      const first = brief.split('\n')[0]
      expect(first).toContain('Coverage')
      expect(first).toContain('the Shopify content door')
      expect(first).toContain('draft and archived products')
      expect(first).toContain('The Storefront API serves published products only.')
    })

    it("names the born-admin door in the reader's words, never by what Shopify calls the store", () => {
      // The fallback would print `shopify:born-admin` verbatim, which is not silence but is not a
      // sentence either — and the line it lands in is read by the thing that writes Proposals.
      // ADR 0095 consequence 6 also forbids the phrase Shopify uses for such a store.
      const brief = generateDigests({
        ...base,
        coverage: {
          door: 'shopify:born-admin',
          gaps: [
            {
              what: 'customers and their orders',
              reason: 'platform-limit',
              detail: 'This door was minted with a fixed scope set that carries no customer access.'
            }
          ]
        }
      })['SITE-BRIEF.md']

      const first = brief.split('\n')[0]
      expect(first).toContain('the admin door on the store Tracy built')
      expect(first).toContain('customers and their orders')
      expect(first).not.toContain('shopify:born-admin')
      expect(first.toLowerCase()).not.toContain('preview store')
    })

    it('tells the reader to hedge, so a count here is not reported as a count over the site', () => {
      const brief = generateDigests({
        ...base,
        coverage: {
          door: 'shopify:content',
          gaps: [{ what: 'draft and archived products', reason: 'platform-limit', detail: 'Published only.' }]
        }
      })['SITE-BRIEF.md']

      // Its own line of the same blockquote: what the reader must DO is a separate idea from
      // what is missing, and fusing the two is what made the first version a run-on.
      expect(brief.split('\n')[1]).toMatch(/what this door can see/)
    })

    it('terminates the sentence even when a gap carries no detail', () => {
      // The no-detail branch used to run straight into the next sentence with no full stop:
      // "…draft and archived products Any count taken here…", in the one line that must not skim.
      const brief = generateDigests({
        ...base,
        coverage: { door: 'shopify:content', gaps: [{ what: 'draft and archived products', reason: 'permission' }] }
      })['SITE-BRIEF.md']

      expect(brief.split('\n')[0]).toMatch(/draft and archived products\.$/)
    })

    it('names a few gaps and points at the file for the rest, instead of building a wall', () => {
      // The content door declares three gaps by design plus one per role it is refused, so nine
      // full sentences joined end to end is the realistic case, not the pathological one.
      const many = Array.from({ length: 9 }, (_, i) => ({
        what: `thing ${i}`,
        reason: 'permission' as const,
        detail: `A whole sentence explaining thing ${i}, at the length these actually run to.`
      }))
      const first = generateDigests({ ...base, coverage: { door: 'shopify:content', gaps: many } })[
        'SITE-BRIEF.md'
      ].split('\n')[0]

      expect(first).toContain('thing 0; thing 1; thing 2; thing 3; and 5 more — see surface/coverage.json.')
      expect(first).not.toContain('thing 8')
      expect(first.length).toBeLessThan(300)
    })

    it('says a wide door sees everything, as a claim and not as silence', () => {
      const brief = generateDigests({ ...base, coverage: { door: 'shopify:admin', gaps: [] } })['SITE-BRIEF.md']

      expect(brief.split('\n')[0]).toContain('the Shopify admin door')
      expect(brief.split('\n')[0]).toContain('sees everything')
    })

    it('says nothing at all with no Coverage file, and never claims completeness', () => {
      // A Crawl with no mirror behind it has no door to name. That is correct, not a gap.
      const brief = generateDigests(base)['SITE-BRIEF.md']

      expect(brief).not.toContain('Coverage:')
      expect(brief).not.toContain('sees everything')
      expect(brief.split('\n')[0]).toBe('# Site brief — https://a.com')
    })

    it('repeats a door it has never heard of rather than dropping the warning', () => {
      // A newer adapter can name a door this bundle predates. Silence would read as complete.
      const brief = generateDigests({
        ...base,
        coverage: { door: 'squarespace:content', gaps: [{ what: 'everything', reason: 'permission', detail: 'x' }] }
      })['SITE-BRIEF.md']

      expect(brief.split('\n')[0]).toContain('squarespace:content')
    })

    it('survives the byte budget — it is never the line that gets trimmed', () => {
      const pages = Array.from({ length: 5000 }, (_, i) => page(`https://a.com/blog/post-${i}`))
      const brief = generateDigests({
        ...base,
        pages,
        coverage: {
          door: 'shopify:content',
          gaps: [{ what: 'draft and archived products', reason: 'platform-limit', detail: 'Published only.' }]
        }
      })['SITE-BRIEF.md']

      expect(Buffer.byteLength(brief, 'utf8')).toBeLessThanOrEqual(DIGEST_BYTE_BUDGET)
      expect(brief.split('\n')[0]).toContain('draft and archived products')
    })

    it('keeps the crawl reach under its own name, so one word does not mean two things', () => {
      // "Coverage" is the door now (ADR 0092). What the crawl reached is the crawl's own line.
      const brief = generateDigests({ ...base, coverage: { door: 'shopify:admin', gaps: [] } })['SITE-BRIEF.md']

      expect(brief).toContain('Crawl: 3 pages fetched, 0 errors, 0 blocked by robots.')
      expect(brief.match(/Coverage/g)).toHaveLength(1)
    })
  })

  it('names the stack and the inventory as pointers, evidence shown, detail left in the files', () => {
    const base = { siteKey: 'https://a.com', pages: [page('https://a.com/')], findings, report }
    const digests = generateDigests({
      ...base,
      stack: {
        technologies: [
          { name: 'Joomla', version: '5.2.3', evidence: 'verified' },
          { name: 'PHP', version: '8.3', evidence: 'verified' },
          { name: 'Cloudflare', evidence: 'observed' },
          { name: 'Bootstrap', evidence: 'observed' },
          { name: 'jQuery', evidence: 'observed' }
        ]
      },
      extensionInventory: { items: [{ state: 'enabled' }, { state: 'disabled' }, { state: 'enabled' }], gaps: [{}] }
    })
    const brief = digests['SITE-BRIEF.md']
    expect(brief).toContain('- Stack: Joomla 5.2.3 (Verified) · PHP 8.3 (Verified) · Cloudflare · Bootstrap +1 more — read surface/stack.json')
    expect(brief).toContain('- Extensions: 3 installed, 1 disabled, 1 gaps — read surface/inventory.json')
    // Absent files say nothing at all — no data and no line are the same honest answer.
    expect(generateDigests(base)['SITE-BRIEF.md']).not.toContain('- Stack:')
  })
})
