import { describe, expect, it } from 'vitest'

import { parseRobots } from '../robots'

describe('parseRobots', () => {
  const text = [
    'User-agent: *',
    'Disallow: /admin',
    'Allow: /admin/public',
    'Crawl-delay: 2',
    'Sitemap: https://a.com/sitemap.xml'
  ].join('\n')

  it('honors disallow with allow override and crawl-delay', () => {
    const r = parseRobots(text, 'TracyBot')
    expect(r.isAllowed('/admin/secret')).toBe(false)
    expect(r.isAllowed('/admin/public/x')).toBe(true)
    expect(r.isAllowed('/blog')).toBe(true)
    expect(r.crawlDelayMs).toBe(2000)
    expect(r.sitemaps).toEqual(['https://a.com/sitemap.xml'])
  })

  it('prefers the TracyBot group over *', () => {
    const r = parseRobots('User-agent: TracyBot\nDisallow: /only-tracy\n\nUser-agent: *\nDisallow: /', 'TracyBot')
    expect(r.isAllowed('/only-tracy')).toBe(false)
    expect(r.isAllowed('/anything-else')).toBe(true)
  })

  it('empty or missing robots allows everything', () => {
    expect(parseRobots('', 'TracyBot').isAllowed('/x')).toBe(true)
  })
})
