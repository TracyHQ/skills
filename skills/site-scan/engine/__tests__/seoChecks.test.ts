import { describe, expect, it } from 'vitest'

import type { LinkGraph } from '../analyze/linkGraph'
import { runSeoChecks } from '../analyze/seoChecks'
import type { PageRecord } from '../types'

function page(url: string, overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    url,
    status: 200,
    title: `Title of ${url}`,
    metaDescription: `Description of ${url}`,
    canonical: url,
    h1: ['One heading'],
    headings: [{ level: 1, text: 'One heading' }],
    wordCount: 500,
    textSample: '',
    images: [{ src: 'a.jpg', alt: 'ok' }],
    internalLinks: [],
    externalLinks: [],
    schemaTypes: ['Article'],
    contentHash: 'x',
    ...overrides
  }
}

const emptyGraph: LinkGraph = { orphans: [], depthByUrl: {}, brokenInternal: [], headChecksSkipped: 0 }

describe('runSeoChecks', () => {
  it('returns no findings for a clean site', () => {
    expect(runSeoChecks([page('https://a.com/')], emptyGraph)).toEqual([])
  })

  it('counts each defect under its check id', () => {
    const pages = [
      page('https://a.com/1', { metaDescription: undefined }),
      page('https://a.com/2', { metaDescription: undefined, title: undefined }),
      page('https://a.com/5', { wordCount: 80 }),
      page('https://a.com/7', { canonical: undefined }),
      page('https://a.com/9', { title: 'Same' }),
      page('https://a.com/10', { title: 'Same' })
    ]
    const graph: LinkGraph = {
      orphans: ['https://a.com/5'],
      depthByUrl: {},
      brokenInternal: [{ from: 'https://a.com/1', to: 'https://a.com/dead', status: 404 }],
      headChecksSkipped: 0
    }
    const findings = runSeoChecks(pages, graph)
    const byId = Object.fromEntries(findings.map((f) => [f.checkId, f]))
    expect(byId['missing-meta-description'].count).toBe(2)
    expect(byId['missing-title'].count).toBe(1)
    expect(byId['duplicate-title'].count).toBe(2)
    expect(byId['thin-content'].count).toBe(1)
    expect(byId['missing-canonical'].count).toBe(1)
    expect(byId['orphan-pages'].count).toBe(1)
    expect(byId['broken-internal-links'].count).toBe(1)
  })

  // h1, alt text and structured data are judged by the MN Discoverability port now —
  // one rule, one home; see mnDiscoverability.test.ts.
  it('leaves h1, alt and schema defects to the MN port', () => {
    const pages = [
      page('https://a.com/3', { h1: ['a', 'b'], headings: [] }),
      page('https://a.com/4', { h1: [], headings: [] }),
      page('https://a.com/6', { images: [{ src: 'x.jpg', alt: undefined }] }),
      page('https://a.com/8', { schemaTypes: [] })
    ]
    expect(runSeoChecks(pages, emptyGraph)).toEqual([])
  })

  it('sorts by priority then count and caps sample urls at 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => page(`https://a.com/p${i}`, { metaDescription: undefined }))
    const findings = runSeoChecks(many, emptyGraph)
    expect(findings[0].checkId).toBe('missing-meta-description')
    expect(findings[0].priority).toBe(1)
    expect(findings[0].count).toBe(30)
    expect(findings[0].urls).toHaveLength(20)
    for (let i = 1; i < findings.length; i++) {
      const prev = findings[i - 1]
      const cur = findings[i]
      expect(prev.priority < cur.priority || (prev.priority === cur.priority && prev.count >= cur.count)).toBe(true)
    }
  })
})

describe('runSeoChecks — redirect stubs', () => {
  const emptyGraph = { orphans: [], depthByUrl: {}, brokenInternal: [], headChecksSkipped: 0 }
  const stub = {
    url: 'https://gymshark.com/',
    status: 200,
    canonical: 'https://us.checkout.gymshark.com/',
    redirectStub: true,
    h1: [],
    headings: [],
    wordCount: 1,
    textSample: 'Redirecting...',
    images: [],
    internalLinks: [],
    externalLinks: [],
    schemaTypes: [],
    contentHash: 'a'.repeat(40)
  }

  it('reports nothing when the only page crawled was a hop page', () => {
    expect(runSeoChecks([stub], emptyGraph)).toEqual([])
  })

  it('still counts the real pages beside it', () => {
    const real = { ...stub, url: 'https://www.gymshark.com/shop', canonical: undefined, redirectStub: undefined }
    const findings = runSeoChecks([stub, real], emptyGraph)
    expect(findings.find((f) => f.checkId === 'missing-title')?.count).toBe(1)
    expect(findings.every((f) => !f.urls.includes(stub.url))).toBe(true)
  })
})
