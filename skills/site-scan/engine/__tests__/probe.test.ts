import { describe, expect, it } from 'vitest'

import { probeSite } from '../probe'

const respond = (routes: Record<string, { status?: number; body: string }>): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const route = routes[String(input)]
    if (!route) return new Response('nope', { status: 404 })
    return new Response(route.body, { status: route.status ?? 200 })
  }) as typeof fetch

const SITEMAP = `<?xml version="1.0"?><urlset><url><loc>https://a.com/</loc></url><url><loc>https://a.com/x</loc></url></urlset>`

describe('probeSite', () => {
  it('reports what the two public files say about a site', async () => {
    const fetchFn = respond({
      'https://a.com/robots.txt': { body: 'User-agent: *\nDisallow:' },
      'https://a.com/sitemap.xml': { body: SITEMAP }
    })

    await expect(probeSite('https://a.com', { fetchFn })).resolves.toEqual({
      robotsAnswered: true,
      sitemapFound: true,
      estimatedUrls: 2,
      robotsBlocksAll: false
    })
  })

  it('counts the child sitemaps when the site answers with an index', async () => {
    const fetchFn = respond({
      'https://a.com/sitemap.xml': {
        body: `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>`
      }
    })

    const result = await probeSite('https://a.com', { fetchFn })

    expect(result.sitemapFound).toBe(true)
    expect(result.estimatedUrls).toBe(1)
  })

  it('says a site shuts everyone out when robots does', async () => {
    const fetchFn = respond({ 'https://a.com/robots.txt': { body: 'User-agent: *\nDisallow: /' } })

    await expect(probeSite('https://a.com', { fetchFn })).resolves.toMatchObject({
      robotsBlocksAll: true,
      sitemapFound: false
    })
  })

  // A first look must never throw: the caller is an onboarding screen with a person waiting at it.
  it('answers for an address that is not one', async () => {
    await expect(probeSite('not a url', { fetchFn: respond({}) })).resolves.toEqual({
      robotsAnswered: false,
      sitemapFound: false,
      estimatedUrls: 0,
      robotsBlocksAll: false
    })
  })
})
