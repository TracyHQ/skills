import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { FetchOutcome, FetchQueue } from '../fetchQueue'
import { harvestSitemap } from '../harvest/sitemap'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

function fakeQueue(bodies: Record<string, string | { text: string; finalUrl: string }>): FetchQueue {
  const get = async (url: string): Promise<FetchOutcome> => {
    const route = bodies[url]
    if (route === undefined) return { ok: false, kind: 'http', status: 404 }
    if (typeof route === 'string') return { ok: true, status: 200, finalUrl: url, text: route }
    return { ok: true, status: 200, finalUrl: route.finalUrl, text: route.text }
  }
  return { get, head: get, aborted: false } as FetchQueue
}

describe('harvestSitemap', () => {
  it('walks a sitemap index, merges children, dedupes and keeps only same-origin urls', async () => {
    const queue = fakeQueue({
      'https://a.com/sitemap.xml': fixture('sitemap-index.xml'),
      'https://a.com/sitemap-posts.xml': fixture('sitemap-posts.xml'),
      'https://a.com/sitemap-pages.xml': fixture('sitemap-pages.xml')
    })
    const entries = await harvestSitemap('https://a.com', queue)
    const urls = entries.map((e) => e.url)
    expect(urls).toContain('https://a.com/blog/first-post')
    expect(urls).toContain('https://a.com/blog/second-post')
    expect(urls).toContain('https://a.com/about')
    expect(urls).not.toContain('https://elsewhere.com/not-ours')
    expect(urls.filter((u) => u === 'https://a.com/blog/first-post')).toHaveLength(1)
    expect(entries.find((e) => e.url === 'https://a.com/blog/first-post')?.lastmod).toBe('2026-07-01T10:00:00+00:00')
    expect(entries.find((e) => e.url === 'https://a.com/about')?.lastmod).toBe('2026-06-15')
  })

  it('reads a plain urlset directly', async () => {
    const queue = fakeQueue({ 'https://a.com/sitemap.xml': fixture('sitemap-posts.xml') })
    const entries = await harvestSitemap('https://a.com', queue)
    expect(entries).toHaveLength(2)
  })

  it('returns an empty inventory when there is no sitemap', async () => {
    const queue = fakeQueue({})
    expect(await harvestSitemap('https://a.com', queue)).toEqual([])
  })

  it('refuses a root sitemap that redirects off the site, then finds the real one on www', async () => {
    // A headless apex 301s its guessed /sitemap.xml to the checkout domain; the real inventory
    // lives on www — same site, so its entries are this site's entries.
    const wwwSitemap = '<?xml version="1.0"?><urlset><url><loc>https://www.a.com/products/x</loc></url></urlset>'
    const queue = fakeQueue({
      'https://a.com/sitemap.xml': {
        text: '<?xml version="1.0"?><urlset><url><loc>https://checkout.a.com/only</loc></url></urlset>',
        finalUrl: 'https://checkout.a.com/sitemap.xml'
      },
      'https://www.a.com/sitemap.xml': wwwSitemap
    })
    const entries = await harvestSitemap('https://a.com', queue)
    expect(entries.map((e) => e.url)).toEqual(['https://www.a.com/products/x'])
  })

  it('tries www when the apex simply has no sitemap', async () => {
    const queue = fakeQueue({
      'https://www.a.com/sitemap.xml':
        '<?xml version="1.0"?><urlset><url><loc>https://www.a.com/about</loc></url></urlset>'
    })
    const entries = await harvestSitemap('https://a.com', queue)
    expect(entries.map((e) => e.url)).toEqual(['https://www.a.com/about'])
  })
})
