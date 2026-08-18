import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { runCrawl } from '../crawler'

const html = (title: string, links: string[] = []) =>
  `<html><head><title>${title}</title><meta name="description" content="d"/></head>` +
  `<body><h1>${title}</h1><p>${'word '.repeat(200)}</p>${links.map((l) => `<a href="${l}">x</a>`).join('')}</body></html>`

const sitemap = (entries: { url: string; lastmod?: string }[]) =>
  `<?xml version="1.0"?><urlset>${entries
    .map((e) => `<url><loc>${e.url}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`)
    .join('')}</urlset>`

type Routes = Record<string, { status: number; body: string; finalUrl?: string }>

function fakeFetch(routes: Routes, log: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    log.push(url)
    const route = routes[url]
    if (!route) return new Response('missing', { status: 404 })
    const response = new Response(route.body, { status: route.status })
    if (route.finalUrl) Object.defineProperty(response, 'url', { value: route.finalUrl })
    return response
  }) as typeof fetch
}

const PAGES = {
  'https://a.com/': { url: 'https://a.com/', lastmod: '2026-07-01' },
  'https://a.com/about': { url: 'https://a.com/about', lastmod: '2026-07-02' },
  'https://a.com/blog/post': { url: 'https://a.com/blog/post', lastmod: '2026-07-03' }
}

function wpRoutes(overrides: Routes = {}): Routes {
  return {
    'https://a.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow:' },
    'https://a.com/sitemap.xml': { status: 200, body: sitemap(Object.values(PAGES)) },
    'https://a.com/': { status: 200, body: html('Home', ['https://a.com/about', 'https://a.com/blog/post']) },
    'https://a.com/about': { status: 200, body: html('About', ['https://a.com/']) },
    'https://a.com/blog/post': { status: 200, body: html('Post', ['https://a.com/']) },
    ...overrides
  }
}

const isPageFetch = (url: string) => Object.keys(PAGES).includes(url)

describe('runCrawl', () => {
  let workspacePath: string
  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'tracy-crawl-'))
  })
  afterAll(() => {
    // mkdtemp dirs are per-test; the OS reaps tmp, but be tidy about the last one
    rmSync(workspacePath, { recursive: true, force: true })
  })

  const input = (fetchFn: typeof fetch) => ({
    siteKey: 'https://a.com',
    workspacePath,
    platform: null,
    fetchFn,
    tuning: { minIntervalMs: 0 }
  })

  it('writes the full surface and digest tree on the first crawl', async () => {
    const { report, changed } = await runCrawl(input(fakeFetch(wpRoutes())))
    expect(changed).toBe(true)
    expect(report.discovered).toBe(3)
    expect(report.htmlFetched).toBe(3)
    for (const file of [
      'surface/seo/links.json',
      'surface/seo/findings.json',
      'surface/crawl-report.json',
      'digest/SITE-BRIEF.md',
      'digest/content-map.md',
      'digest/seo-findings.md',
      '.tracy/crawl-state.json'
    ]) {
      expect(existsSync(join(workspacePath, file)), file).toBe(true)
    }
    const pageFiles = readFileSync(join(workspacePath, '.tracy', 'crawl-state.json'), 'utf8')
    expect(Object.keys(JSON.parse(pageFiles).pages)).toHaveLength(3)
  })

  it('skips unchanged pages on the second run and reports no change', async () => {
    await runCrawl(input(fakeFetch(wpRoutes())))
    const log: string[] = []
    const { changed, report } = await runCrawl(input(fakeFetch(wpRoutes(), log)))
    expect(log.filter(isPageFetch)).toEqual([])
    expect(changed).toBe(false)
    expect(report.htmlFetched).toBe(0)
  })

  it('refetches only the page whose lastmod moved', async () => {
    await runCrawl(input(fakeFetch(wpRoutes())))
    const movedSitemap = sitemap([
      PAGES['https://a.com/'],
      PAGES['https://a.com/about'],
      { url: 'https://a.com/blog/post', lastmod: '2026-07-09' }
    ])
    const log: string[] = []
    const { changed } = await runCrawl(
      input(fakeFetch(wpRoutes({ 'https://a.com/sitemap.xml': { status: 200, body: movedSitemap } }), log))
    )
    expect(log.filter(isPageFetch)).toEqual(['https://a.com/blog/post'])
    expect(changed).toBe(true)
  })

  it('respects a robots file that blocks everything and still writes the thin picture', async () => {
    const routes = wpRoutes({ 'https://a.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /' } })
    const log: string[] = []
    const { report } = await runCrawl(input(fakeFetch(routes, log)))
    expect(log.filter(isPageFetch)).toEqual([])
    expect(report.robotsBlocked).toBe(3)
    expect(existsSync(join(workspacePath, 'surface', 'crawl-report.json'))).toBe(true)
    expect(existsSync(join(workspacePath, 'digest', 'SITE-BRIEF.md'))).toBe(true)
  })

  it('falls back to a shallow bfs when there is no sitemap', async () => {
    const routes = wpRoutes()
    delete (routes as Record<string, unknown>)['https://a.com/sitemap.xml']
    const { report } = await runCrawl(input(fakeFetch(routes)))
    expect(report.htmlFetched).toBeGreaterThanOrEqual(3)
    expect(report.discovered).toBeGreaterThanOrEqual(3)
  })

  it("records an off-site redirect as a hop, never as this site's content", async () => {
    // The sitemap names /outlet, but fetching it lands on another domain. With eyes shut the
    // crawl would judge that domain's HTML as a page of a.com — a phantom every check would bill.
    const routes = wpRoutes({
      'https://a.com/sitemap.xml': {
        status: 200,
        body: sitemap([...Object.values(PAGES), { url: 'https://a.com/outlet', lastmod: '2026-07-04' }])
      },
      'https://a.com/outlet': {
        status: 200,
        body: html('Checkout home', ['https://shop.example/cart']),
        finalUrl: 'https://shop.example/outlet'
      }
    })
    await runCrawl(input(fakeFetch(routes)))
    const hop = JSON.parse(readFileSync(join(workspacePath, 'surface', 'pages', 'a.com-outlet.json'), 'utf8'))
    expect(hop.redirectStub).toBe(true)
    expect(hop.canonical).toBe('https://shop.example/outlet')
    expect(hop.wordCount).toBe(0)
    const findings = JSON.parse(readFileSync(join(workspacePath, 'surface', 'seo', 'findings.json'), 'utf8'))
    for (const finding of findings) {
      expect(finding.urls).not.toContain('https://a.com/outlet')
    }
  })

  it('adopts the final url of a same-site redirect and never records the page twice', async () => {
    const routes = wpRoutes({
      'https://a.com/sitemap.xml': {
        status: 200,
        body: sitemap([...Object.values(PAGES), { url: 'https://a.com/blog/post/', lastmod: '2026-07-05' }])
      },
      'https://a.com/blog/post/': {
        status: 200,
        body: html('Post', ['https://a.com/']),
        finalUrl: 'https://a.com/blog/post'
      }
    })
    await runCrawl(input(fakeFetch(routes)))
    const page = JSON.parse(readFileSync(join(workspacePath, 'surface', 'pages', 'a.com-blog-post.json'), 'utf8'))
    expect(page.url).toBe('https://a.com/blog/post')
    // Recorded twice, the two identical "Post" pages would convict themselves of duplicate titles.
    const findings = JSON.parse(readFileSync(join(workspacePath, 'surface', 'seo', 'findings.json'), 'utf8'))
    expect(findings.map((f: { checkId: string }) => f.checkId)).not.toContain('duplicate-title')
  })

  it('closes a finding as verified when the next scan measures it gone', async () => {
    // First scan: /about has no meta description → a finding. Second scan: the description is
    // there and lastmod moved so the page is refetched → the finding closes, re-measured.
    const withoutMeta = wpRoutes({
      'https://a.com/about': {
        status: 200,
        body: `<html><head><title>About</title></head><body><h1>About</h1><p>${'word '.repeat(200)}</p></body></html>`
      }
    })
    await runCrawl(input(fakeFetch(withoutMeta)))
    const before = JSON.parse(readFileSync(join(workspacePath, 'surface', 'seo', 'findings.json'), 'utf8'))
    expect(before.map((f: { checkId: string }) => f.checkId)).toContain('missing-meta-description')

    const fixed = wpRoutes({
      'https://a.com/sitemap.xml': {
        status: 200,
        body: sitemap([
          PAGES['https://a.com/'],
          { url: 'https://a.com/about', lastmod: '2026-07-09' },
          PAGES['https://a.com/blog/post']
        ])
      }
    })
    const notes: string[] = []
    await runCrawl({
      ...input(fakeFetch(fixed)),
      onProgress: (p) => {
        if (p.note) notes.push(p.note.kind)
      }
    })
    const closed = JSON.parse(readFileSync(join(workspacePath, 'surface', 'seo', 'closed.json'), 'utf8'))
    expect(closed.map((c: { checkId: string }) => c.checkId)).toContain('missing-meta-description')
    expect(closed.find((c: { checkId: string }) => c.checkId === 'missing-meta-description').count).toBe(1)
    expect(notes).toContain('checks-closed')
  })

  it('names what it skipped and what it passed, not only what it failed', async () => {
    const { report } = await runCrawl(input(fakeFetch(wpRoutes())))

    // findings.json only ever recorded failures, so a screen showing fourteen problems could not
    // say out of how many, and a hundred skipped link checks were never mentioned at all.
    expect(report.checksPassed.length).toBeGreaterThan(0)
    // Every id is a check that ran and found nothing — so none of them may also be a finding.
    const raised = JSON.parse(
      readFileSync(join(workspacePath, 'surface', 'seo', 'findings.json'), 'utf8')
    ) as { checkId: string }[]
    for (const id of report.checksPassed) {
      expect(raised.some((f) => f.checkId === id)).toBe(false)
    }
    expect(report.skipped).toEqual({ linkChecks: expect.any(Number), pages: expect.any(Number) })
  })

  it('reports progress phases', async () => {
    const phases: string[] = []
    await runCrawl({ ...input(fakeFetch(wpRoutes())), onProgress: (p) => phases.push(p.phase) })
    for (const phase of ['harvest', 'analyze', 'digest']) expect(phases).toContain(phase)
  })

  it('keeps wall-clock time out of the content artifacts', async () => {
    const shopify = wpRoutes({
      'https://a.com/products.json?limit=250&page=1': {
        status: 200,
        body: JSON.stringify({
          products: [
            {
              id: 1,
              handle: 'p',
              title: 'P',
              body_html: '<p>b</p>',
              updated_at: '2026-07-01T00:00:00Z',
              variants: [{ price: '9.00' }],
              images: []
            }
          ]
        })
      },
      'https://a.com/products.json?limit=250&page=2': { status: 200, body: JSON.stringify({ products: [] }) },
      'https://a.com/collections.json?limit=250&page=1': { status: 200, body: JSON.stringify({ collections: [] }) }
    })
    await runCrawl({ ...input(fakeFetch(shopify)), platform: 'shopify' })

    const read = (file: string) => JSON.parse(readFileSync(join(workspacePath, file), 'utf8'))
    // A page and a product are content: identical input must serialise to identical bytes, or the
    // workspace repo grows by the whole surface on every Sync.
    expect(read('surface/pages/a.com.json')).not.toHaveProperty('fetchedAt')
    expect(read('surface/products/catalog.json').products[0]).not.toHaveProperty('updatedAt')
    // The report is the record of a run, so this is the one file that should move every time.
    expect(read('surface/crawl-report.json')).toHaveProperty('startedAt')
  })
})
