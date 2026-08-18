import { describe, expect, it, vi } from 'vitest'

import { analyzeLinkGraph } from '../analyze/linkGraph'
import type { PageRecord } from '../types'

function page(url: string, internalLinks: string[]): PageRecord {
  return {
    url,
    status: 200,
    h1: [],
    headings: [],
    wordCount: 100,
    textSample: '',
    images: [],
    internalLinks,
    externalLinks: [],
    schemaTypes: [],
    contentHash: 'x'
  }
}

describe('analyzeLinkGraph', () => {
  it('computes depth from the shortest url and spots orphans', async () => {
    const pages = [
      page('https://a.com/', ['https://a.com/blog']),
      page('https://a.com/blog', ['https://a.com/blog/post']),
      page('https://a.com/blog/post', []),
      page('https://a.com/lonely', [])
    ]
    const graph = await analyzeLinkGraph(pages, {})
    expect(graph.depthByUrl['https://a.com/']).toBe(0)
    expect(graph.depthByUrl['https://a.com/blog']).toBe(1)
    expect(graph.depthByUrl['https://a.com/blog/post']).toBe(2)
    expect(graph.orphans).toEqual(['https://a.com/lonely'])
  })

  it('head-checks internal links that point outside the crawled set', async () => {
    const headCheck = vi.fn(async (url: string) => (url.endsWith('/dead') ? 404 : 200))
    const pages = [page('https://a.com/', ['https://a.com/dead', 'https://a.com/fine'])]
    const graph = await analyzeLinkGraph(pages, { headCheck })
    expect(graph.brokenInternal).toEqual([{ from: 'https://a.com/', to: 'https://a.com/dead', status: 404 }])
    expect(headCheck).toHaveBeenCalledTimes(2)
  })

  it('caps head checks and counts what it skipped', async () => {
    const headCheck = vi.fn(async () => 200)
    const links = Array.from({ length: 150 }, (_, i) => `https://a.com/u${i}`)
    const graph = await analyzeLinkGraph([page('https://a.com/', links)], { headCheck, maxHeadChecks: 100 })
    expect(headCheck).toHaveBeenCalledTimes(100)
    expect(graph.headChecksSkipped).toBe(50)
  })
})
