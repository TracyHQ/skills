import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from './logger'

import { siteSlug } from './siteSlug'
import { analyzeLinkGraph } from './analyze/linkGraph'
import { MN_DISCOVERABILITY, runMnDiscoverability } from './analyze/mnDiscoverability'
import { runSeoChecks } from './analyze/seoChecks'
import { runUcpChecks } from './analyze/ucpChecks'
import { generateDigests } from './digest'
import { createFetchQueue } from './fetchQueue'
import { extractPage } from './harvest/pageExtract'
import { harvestShopifyPublic } from './harvest/shopifyPublic'
import { harvestSitemap } from './harvest/sitemap'
import { harvestUcp, type UcpSurface } from './harvest/ucp'
import { harvestWpRest } from './harvest/wpRest'
import {
  noteAgentDoor,
  noteAgentFiles,
  noteCatalog,
  noteClosed,
  noteInventory,
  type NoteKind,
  noteRobots,
  noteStub,
  noteVerdict
} from './narration'
import { parseRobots } from './robots'
import { isSameSite } from './sameSite'
import type { CrawlReport, CrawlState, Finding, PageRecord, SitemapEntry } from './types'
import { CRAWLER_USER_AGENT } from './userAgent'

const logger = loggerService.withContext('tracySiteCrawler')

export const HTML_FETCH_CAP = 500
export const STRUCTURED_ITEM_CAP = 5000
const BFS_MAX_DEPTH = 3
const STATE_FILE = path.join('.tracy', 'crawl-state.json')

/**
 * What the crawl is doing right now, in enough detail for the UI to name it.
 *
 * `url` and `step` are raw on purpose — a count is not a sentence, and the merchant wants to see
 * their own catalog going past. Turning either into words is the renderer's job, because the words
 * are user-visible and have to come from i18n.
 */
export type CrawlProgress = {
  phase: 'probe' | 'harvest' | 'analyze' | 'digest'
  fetched: number
  total: number
  /** The page being read, when one page is what is happening. */
  url?: string
  /** The harvest step, for the stretch before any page is fetched. */
  step?: 'mirror' | 'robots' | 'sitemap' | 'catalog' | 'agent-door' | 'links' | 'checks' | 'verify'
  /**
   * A discovery worth reacting to, as a fact. The reaction itself — surprise, praise, alarm — is
   * copy, so it lives in the renderer's i18n; a rule fires it, no model anywhere.
   */
  note?: { kind: NoteKind; count?: number }
  /**
   * A finished step's audit record: what it read and what it found. Emitted once at the step's
   * boundary; the trace recorder freezes it onto the span so the timeline can answer "which
   * pages, exactly?" forever after.
   */
  stepIo?: { key: string; read?: unknown; found?: unknown }
}

export type { NoteKind }

/** Thrown when `shouldStop` answers yes — the one error `guarded` refuses to swallow. */
export class CrawlCancelled extends Error {
  constructor() {
    super('crawl cancelled')
  }
}

export type CrawlInput = {
  siteKey: string
  workspacePath: string
  platform: 'wordpress' | 'shopify' | 'joomla' | null
  fetchFn?: typeof fetch
  onProgress?: (p: CrawlProgress) => void
  /** Checked at every progress beat: deleting a site mid-crawl must stop the crawl, not race it. */
  shouldStop?: () => boolean
  /** Test seam: politeness stays on in production, tests turn the pacing off. */
  tuning?: { minIntervalMs?: number }
}

/**
 * T2/T3 — one full or incremental Crawl (spec §3.2/§3.3): harvest → analyze →
 * digest, writing the spec §8 tree under the workspace. Git is deliberately not
 * this module's org — the Sync router owns committing. Every phase is
 * fault-isolated: a failing source degrades the picture, never the run (§9).
 */
export async function runCrawl(input: CrawlInput): Promise<{ report: CrawlReport; changed: boolean }> {
  const startedAt = new Date().toISOString()
  const origin = new URL(input.siteKey).origin
  const progress = (
    phase: CrawlProgress['phase'],
    fetched: number,
    total: number,
    extra: {
      url?: string
      step?: CrawlProgress['step']
      note?: CrawlProgress['note']
      stepIo?: CrawlProgress['stepIo']
    } = {}
  ) => {
    if (input.shouldStop?.()) throw new CrawlCancelled()
    input.onProgress?.({ phase, fetched, total, ...extra })
  }

  const queue = createFetchQueue({
    fetchFn: input.fetchFn,
    userAgent: CRAWLER_USER_AGENT,
    minIntervalMs: input.tuning?.minIntervalMs
  })

  let errors = 0
  const guarded = async <T>(label: string, value: T, work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      if (error instanceof CrawlCancelled) throw error
      errors++
      logger.warn(`crawl phase failed: ${label}`, { error: String(error) })
      return value
    }
  }

  // --- Harvest ---------------------------------------------------------------
  progress('harvest', 0, 0, { step: 'robots' })
  const robotsUrl = new URL('/robots.txt', origin).toString()
  const robotsOutcome = await queue.get(robotsUrl)
  const robots = parseRobots(robotsOutcome.ok ? robotsOutcome.text : '', 'TracyBot')
  progress('harvest', 0, 0, {
    stepIo: {
      key: 'crawl.robots',
      read: { url: robotsUrl },
      found: { answered: robotsOutcome.ok, openToTracy: robots.isAllowed('/') }
    }
  })

  progress('harvest', 0, 0, { step: 'sitemap' })
  let inventory = await guarded<SitemapEntry[]>('sitemap', [], () => harvestSitemap(origin, queue))
  progress('harvest', 0, 0, { note: noteInventory(inventory.length) })
  progress('harvest', 0, 0, {
    stepIo: {
      key: 'crawl.sitemap',
      read: { url: new URL('/sitemap.xml', origin).toString() },
      found: { count: inventory.length, urls: inventory.map((e) => e.url) }
    }
  })

  const wpItems =
    input.platform === 'wordpress'
      ? await guarded('wp-rest', { items: [], capped: 0 }, () => harvestWpRest(origin, queue, STRUCTURED_ITEM_CAP))
      : undefined
  if (input.platform === 'shopify') progress('harvest', 0, 0, { step: 'catalog' })
  const shopify =
    input.platform === 'shopify'
      ? await guarded('shopify', { products: [], collections: [], capped: 0 }, () =>
          harvestShopifyPublic(origin, queue, STRUCTURED_ITEM_CAP)
        )
      : undefined

  if (shopify) {
    progress('harvest', 0, 0, {
      stepIo: {
        key: 'crawl.catalog',
        read: { endpoint: `${origin}/products.json`, pages: Math.ceil(shopify.products.length / 250) || 1 },
        found: {
          products: shopify.products.length,
          collections: shopify.collections.length,
          capped: shopify.capped,
          savedTo: 'surface/products/catalog.json'
        }
      }
    })
  }
  if (wpItems) {
    progress('harvest', 0, 0, {
      stepIo: {
        key: 'crawl.catalog',
        read: { endpoint: `${origin}/wp-json/wp/v2` },
        found: { items: wpItems.items.length, capped: wpItems.capped, savedTo: 'surface/content.json' }
      }
    })
  }

  // The agent-facing surface. Public GETs only, so it runs for every site regardless of platform
  // or credential; a failure here degrades the picture and never the run.
  progress('harvest', 0, 0, { step: 'agent-door' })
  const ucp = await guarded<UcpSurface | undefined>('ucp', undefined, () =>
    harvestUcp(origin, queue, checkoutOrigins(origin, shopify?.products[0]?.url))
  )
  const catalogNote = shopify && noteCatalog(shopify.products.length)
  if (catalogNote) progress('harvest', 0, 0, { note: catalogNote })
  if (ucp) {
    progress('harvest', 0, 0, { note: noteAgentDoor(ucp) })
    const filesNote = noteAgentFiles(ucp)
    if (filesNote) progress('harvest', 0, 0, { note: filesNote })
    progress('harvest', 0, 0, {
      stepIo: {
        key: 'crawl.agent-door',
        read: {
          urls: [
            new URL('/.well-known/ucp', origin).toString(),
            ...ucp.agentFiles.map((f) => new URL(f.path, origin).toString())
          ]
        },
        found: {
          profile: { status: ucp.brand.status, json: ucp.brand.json, redirectedTo: ucp.brand.redirectedTo },
          files: ucp.agentFiles,
          savedTo: 'surface/ucp.json'
        }
      }
    })
  }

  const previous = await readState(input.workspacePath)
  const state: CrawlState = { pages: {} }
  const pages: PageRecord[] = []
  let htmlFetched = 0
  let robotsBlocked = 0
  let cappedHtml = 0

  const isAllowed = (url: string) => robots.isAllowed(new URL(url).pathname)

  const recordedUrls = new Set<string>()
  /** The pages step's audit: which urls were freshly read and which reused the saved copy. */
  const fetchedUrls: string[] = []
  const cachedUrls: string[] = []
  const fetchPage = async (url: string, lastmod?: string): Promise<PageRecord | undefined> => {
    const outcome = await queue.get(url)
    if (!outcome.ok) {
      errors++
      return undefined
    }
    htmlFetched++
    // Redirects are followed with eyes open. Off the site: whatever answered is another site's
    // page — judging it would charge this merchant for that one's HTML, so it is kept only as a
    // hop record. On the site (apex → www): the final url is the page's real identity, and a
    // second route to an already-recorded page must not count it twice.
    if (!isSameSite(outcome.finalUrl, origin)) {
      const page: PageRecord = {
        url,
        status: outcome.status,
        canonical: outcome.finalUrl,
        redirectStub: true,
        h1: [],
        headings: [],
        wordCount: 0,
        textSample: '',
        images: [],
        internalLinks: [],
        externalLinks: [],
        schemaTypes: [],
        contentHash: createHash('sha1').update(`redirect ${outcome.finalUrl}`).digest('hex')
      }
      const stubNote = noteStub(page)
      if (stubNote) progress('harvest', htmlFetched, 0, { note: stubNote })
      state.pages[url] = { lastmod, etag: outcome.etag, contentHash: page.contentHash }
      pages.push(page)
      return page
    }
    const pageUrl = outcome.finalUrl || url
    const page = extractPage(pageUrl, outcome.text, origin)
    const stubNote = noteStub(page)
    if (stubNote) progress('harvest', htmlFetched, 0, { note: stubNote })
    state.pages[url] = { lastmod, etag: outcome.etag, contentHash: page.contentHash }
    if (!recordedUrls.has(page.url)) {
      recordedUrls.add(page.url)
      pages.push(page)
    }
    return page
  }

  if (inventory.length > 0) {
    const allowed: SitemapEntry[] = []
    for (const entry of inventory) {
      if (isAllowed(entry.url)) allowed.push(entry)
      else robotsBlocked++
    }
    const robotsNote = noteRobots(allowed.length, robotsBlocked)
    if (robotsNote) progress('harvest', 0, 0, { note: robotsNote })
    const ranked = allowed.sort(byDepthThenFreshness)
    const selected = ranked.slice(0, HTML_FETCH_CAP)
    cappedHtml = ranked.length - selected.length

    let done = 0
    for (const entry of selected) {
      const remembered = previous.pages[entry.url]
      if (remembered?.lastmod !== undefined && remembered.lastmod === entry.lastmod) {
        const cached = await readCachedPage(input.workspacePath, entry.url)
        if (cached) {
          state.pages[entry.url] = remembered
          pages.push(cached)
          cachedUrls.push(entry.url)
          continue
        }
      }
      await fetchPage(entry.url, entry.lastmod)
      fetchedUrls.push(entry.url)
      progress('harvest', ++done, selected.length, { url: entry.url })
    }
  } else {
    // No sitemap at all — walk the site shallowly from the homepage (spec §4 fallback).
    const seen = new Set<string>()
    let frontier = [normalize(origin + '/')]
    for (let depth = 0; depth <= BFS_MAX_DEPTH && frontier.length > 0; depth++) {
      const next: string[] = []
      for (const url of frontier) {
        if (seen.has(url) || seen.size >= HTML_FETCH_CAP) continue
        seen.add(url)
        if (!isAllowed(url)) {
          robotsBlocked++
          continue
        }
        const page = await fetchPage(url)
        fetchedUrls.push(url)
        progress('harvest', pages.length, seen.size, { url })
        for (const link of page?.internalLinks ?? []) {
          const clean = normalize(link)
          if (!seen.has(clean)) next.push(clean)
        }
      }
      frontier = next
    }
    inventory = [...seen].map((url) => ({ url }))
    // Unreached frontier URLs beyond the cap are the capped remainder.
    cappedHtml = Math.max(0, frontier.filter((url) => !seen.has(url)).length)
  }

  // --- Analyze ---------------------------------------------------------------
  progress('analyze', pages.length, pages.length)
  progress('analyze', pages.length, pages.length, {
    stepIo: {
      key: 'crawl.pages',
      read: { fetched: fetchedUrls, cached: cachedUrls },
      found: { pages: pages.length, hops: pages.filter((p) => p.redirectStub).length, savedTo: 'surface/pages/' }
    }
  })
  progress('analyze', pages.length, pages.length, { step: 'links' })
  // Hop pages are surface, not site: as graph nodes they can only read as orphans of a place
  // nobody can visit.
  const graph = await guarded(
    'link-graph',
    { orphans: [], depthByUrl: {}, brokenInternal: [], headChecksSkipped: 0 },
    () =>
      analyzeLinkGraph(
        pages.filter((p) => !p.redirectStub),
        {
          headCheck: async (url) => {
            const outcome = await queue.head(url)
            return outcome.ok ? outcome.status : (outcome.status ?? 599)
          }
        }
      )
  )
  progress('analyze', pages.length, pages.length, {
    stepIo: {
      key: 'analyze.links',
      read: { pages: pages.length },
      found: { broken: graph.brokenInternal, orphans: graph.orphans.length, savedTo: 'surface/seo/links.json' }
    }
  })
  progress('analyze', pages.length, pages.length, { step: 'checks' })
  const robotsText = robotsOutcome.ok ? robotsOutcome.text : ''
  // 8 SEO + the pinned MN table + 4 agent-door checks when the door was probed.
  const checksRun = 8 + Object.keys(MN_DISCOVERABILITY).length + (ucp ? 4 : 0)
  const findings = [
    ...runSeoChecks(pages, graph),
    ...runMnDiscoverability(pages, robotsText, input.siteKey),
    ...(ucp ? runUcpChecks(ucp) : [])
  ]

  // The Verify half of the loop (Domain Language: "the next Scan re-counts and can close them as
  // verified"): a check the previous Scan raised that this one measured as gone is CLOSED — the
  // moment the product can point at and say "this got fixed, we re-measured". Strictly gone, not
  // improved: 312 → 5 is progress, 312 → absent is proof. Platform limits never close because
  // they were never anyone's to fix.
  const previousFindings = await readJson<Finding[]>(path.join(input.workspacePath, 'surface', 'seo', 'findings.json'))
  const closed = (Array.isArray(previousFindings) ? previousFindings : [])
    .filter((prev) => !prev.platformLimit && !findings.some((f) => f.checkId === prev.checkId))
    .map(({ checkId, title, count }) => ({ checkId, title, count }))
  progress('analyze', pages.length, pages.length, {
    stepIo: {
      key: 'analyze.checks',
      read: { pages: pages.length, checks: checksRun },
      found: {
        findings: findings.map((f) => ({ checkId: f.checkId, count: f.count, priority: f.priority })),
        savedTo: 'surface/seo/findings.json'
      }
    }
  })
  progress('analyze', pages.length, pages.length, { step: 'verify' })
  const closedNote = noteClosed(closed.length)
  if (closedNote) progress('analyze', pages.length, pages.length, { note: closedNote })
  progress('analyze', pages.length, pages.length, { note: noteVerdict(findings) })
  progress('analyze', pages.length, pages.length, {
    stepIo: {
      key: 'analyze.verify',
      read: { previousFindings: Array.isArray(previousFindings) ? previousFindings.length : 0 },
      found: { closed, savedTo: 'surface/seo/closed.json' }
    }
  })

  // --- Digest + write --------------------------------------------------------
  progress('digest', pages.length, pages.length)
  const report: CrawlReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    discovered: inventory.length,
    htmlFetched,
    structuredItems: (wpItems?.items.length ?? 0) + (shopify?.products.length ?? 0),
    robotsBlocked,
    errors,
    cappedHtml,
    cappedStructured: (wpItems?.capped ?? 0) + (shopify?.capped ?? 0)
  }
  const digests = generateDigests({
    siteKey: input.siteKey,
    pages,
    findings,
    report,
    wpItems: wpItems?.items,
    shopify: shopify ? { products: shopify.products, collections: shopify.collections } : undefined
  })

  await writeTree(input.workspacePath, {
    pages,
    graph,
    findings,
    closed,
    report,
    digests,
    shopify,
    wpItems,
    state,
    ucp
  })

  const changed = JSON.stringify(previous.pages) !== JSON.stringify(state.pages)
  return { report, changed }
}

/**
 * Where a platform may still be serving the profile when the brand domain is not.
 *
 * Derived from a product url rather than guessed: a headless storefront's own links point at
 * whatever origin the platform actually answers on, which is the address the profile lives at.
 */
function checkoutOrigins(origin: string, productUrl?: string): string[] {
  const out: string[] = []
  try {
    const host = new URL(origin).hostname.replace(/^www\./, '')
    out.push(`https://${host.split('.')[0]}.myshopify.com`)
  } catch {
    // A siteKey that will not parse has no platform origin to guess at.
  }
  if (productUrl) {
    try {
      out.push(new URL(productUrl).origin)
    } catch {
      // Ignore an unparseable product url — the myshopify guess above still stands.
    }
  }
  return [...new Set(out)]
}

function byDepthThenFreshness(a: SitemapEntry, b: SitemapEntry): number {
  const depth = (e: SitemapEntry) => new URL(e.url).pathname.split('/').filter(Boolean).length
  return depth(a) - depth(b) || (b.lastmod ?? '').localeCompare(a.lastmod ?? '')
}

function normalize(url: string): string {
  const u = new URL(url)
  u.hash = ''
  return u.toString()
}

function pageFileName(url: string): string {
  return `${siteSlug(url)}.json`
}

async function readState(workspacePath: string): Promise<CrawlState> {
  try {
    return JSON.parse(await readFile(path.join(workspacePath, STATE_FILE), 'utf8')) as CrawlState
  } catch {
    return { pages: {} }
  }
}

/** A missing or unreadable file is simply "no previous record" — first scans have nothing to verify. */
async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return undefined
  }
}

async function readCachedPage(workspacePath: string, url: string): Promise<PageRecord | undefined> {
  try {
    const raw = await readFile(path.join(workspacePath, 'surface', 'pages', pageFileName(url)), 'utf8')
    return JSON.parse(raw) as PageRecord
  } catch {
    return undefined
  }
}

async function writeTree(
  workspacePath: string,
  content: {
    pages: PageRecord[]
    graph: Awaited<ReturnType<typeof analyzeLinkGraph>>
    findings: ReturnType<typeof runSeoChecks>
    closed: { checkId: string; title: string; count: number }[]
    report: CrawlReport
    digests: ReturnType<typeof generateDigests>
    shopify?: { products: unknown[]; collections: unknown[] }
    wpItems?: { items: unknown[] }
    state: CrawlState
    ucp?: UcpSurface
  }
): Promise<void> {
  const write = async (relative: string, data: unknown) => {
    const target = path.join(workspacePath, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
  }

  for (const page of content.pages) await write(path.join('surface', 'pages', pageFileName(page.url)), page)
  if (content.shopify) {
    await write(path.join('surface', 'products', 'catalog.json'), {
      products: content.shopify.products,
      collections: content.shopify.collections
    })
  }
  if (content.wpItems && content.wpItems.items.length > 0) {
    await write(path.join('surface', 'content.json'), content.wpItems.items)
  }
  if (content.ucp) await write(path.join('surface', 'ucp.json'), content.ucp)
  await write(path.join('surface', 'seo', 'links.json'), content.graph)
  await write(path.join('surface', 'seo', 'findings.json'), content.findings)
  await write(path.join('surface', 'seo', 'closed.json'), content.closed)
  await write(path.join('surface', 'crawl-report.json'), content.report)
  for (const [name, body] of Object.entries(content.digests)) await write(path.join('digest', name), body)
  await write(STATE_FILE, content.state)
  await excludeStateFromGit(workspacePath)
}

/** Keeps crawl-state out of the Sync commits via .git/info/exclude — no tracked file touched. */
async function excludeStateFromGit(workspacePath: string): Promise<void> {
  const gitDir = path.join(workspacePath, '.git')
  if (!existsSync(gitDir)) return
  const excludePath = path.join(gitDir, 'info', 'exclude')
  try {
    const existing = existsSync(excludePath) ? await readFile(excludePath, 'utf8') : ''
    if (!existing.includes(STATE_FILE)) {
      await mkdir(path.dirname(excludePath), { recursive: true })
      await appendFile(excludePath, `\n${STATE_FILE}\n`)
    }
  } catch (error) {
    logger.warn('could not exclude crawl state from git', { error: String(error) })
  }
}
