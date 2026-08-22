import * as htmlparser2 from 'htmlparser2'

import type { FetchQueue } from '../fetchQueue'
import { isSameSite } from '../sameSite'
import type { SitemapEntry } from '../types'

const MAX_CHILD_SITEMAPS = 50

export type ParsedSitemap = { kind: 'index'; sitemaps: string[] } | { kind: 'urlset'; entries: SitemapEntry[] }

/**
 * The url inventory of a Crawl (spec §4): walk `sitemap.xml`, follow index
 * children (bounded), keep only same-site urls, dedupe by url. No sitemap at
 * all is a normal outcome — the orchestrator falls back to a shallow BFS.
 *
 * Candidates, in trust order: the `Sitemap:` lines of robots.txt first — the protocol's one
 * official declaration channel, and the only way a sitemap under a non-conventional name is
 * ever found — then the `/sitemap.xml` convention (apex, then `www.`), then the big CMSes' own
 * names (`/sitemap_index.xml`, `/wp-sitemap.xml`) for sites that alias nothing to the
 * convention. The first candidate that yields any urls wins; nothing is merged across them.
 *
 * Every root fetch follows redirects with eyes open: a candidate that lands on another site
 * (a headless apex 301s to its checkout domain) is NOT this site's sitemap — reading it
 * silently is how a crawl inherits someone else's url inventory, and a robots line naming a
 * foreign host is dropped for the same reason. Children named by an index we already trusted
 * are followed as declared — their entries still pass the same-site filter.
 */
export async function harvestSitemap(
  origin: string,
  queue: FetchQueue,
  declared: readonly string[] = []
): Promise<SitemapEntry[]> {
  const host = new URL(origin).hostname
  const candidates = [
    ...declared.filter((url) => isSameSite(url, origin)),
    new URL('/sitemap.xml', origin).toString(),
    ...(host.startsWith('www.') ? [] : [`https://www.${host}/sitemap.xml`]),
    new URL('/sitemap_index.xml', origin).toString(),
    new URL('/wp-sitemap.xml', origin).toString()
  ]

  const tried = new Set<string>()
  for (const candidate of candidates) {
    if (tried.has(candidate)) continue
    tried.add(candidate)
    const root = await fetchAndParse(candidate, queue, origin)
    if (!root) continue

    const collected = new Map<string, SitemapEntry>()
    const absorb = (entries: SitemapEntry[]) => {
      for (const entry of entries) {
        if (isSameSite(entry.url, origin) && !collected.has(entry.url)) collected.set(entry.url, entry)
      }
    }

    if (root.kind === 'urlset') {
      absorb(root.entries)
    } else {
      for (const childUrl of root.sitemaps.slice(0, MAX_CHILD_SITEMAPS)) {
        const child = await fetchAndParse(childUrl, queue)
        if (child?.kind === 'urlset') absorb(child.entries)
      }
    }
    if (collected.size > 0) return [...collected.values()]
  }
  return []
}

/** With `mustStayOn`, a fetch whose redirects left that site returns nothing — see harvestSitemap. */
async function fetchAndParse(url: string, queue: FetchQueue, mustStayOn?: string): Promise<ParsedSitemap | undefined> {
  const outcome = await queue.get(url)
  if (!outcome.ok) return undefined
  if (mustStayOn && !isSameSite(outcome.finalUrl, mustStayOn)) return undefined
  return parseSitemapXml(outcome.text)
}

export function parseSitemapXml(xml: string): ParsedSitemap {
  const sitemaps: string[] = []
  const entries: SitemapEntry[] = []
  let isIndex = false
  let inSitemapTag = false
  let inUrlTag = false
  let currentField: 'loc' | 'lastmod' | undefined
  let loc = ''
  let lastmod = ''

  const parser = new htmlparser2.Parser(
    {
      onopentag(name) {
        const tag = name.toLowerCase()
        if (tag === 'sitemapindex') isIndex = true
        if (tag === 'sitemap') {
          inSitemapTag = true
          loc = ''
        }
        if (tag === 'url') {
          inUrlTag = true
          loc = ''
          lastmod = ''
        }
        if (tag === 'loc' || tag === 'lastmod') currentField = tag
      },
      ontext(text) {
        if (currentField === 'loc') loc += text
        if (currentField === 'lastmod') lastmod += text
      },
      onclosetag(name) {
        const tag = name.toLowerCase()
        if (tag === 'loc' || tag === 'lastmod') currentField = undefined
        if (tag === 'sitemap' && inSitemapTag) {
          inSitemapTag = false
          if (loc.trim()) sitemaps.push(loc.trim())
        }
        if (tag === 'url' && inUrlTag) {
          inUrlTag = false
          if (loc.trim()) {
            const entry: SitemapEntry = { url: loc.trim() }
            if (lastmod.trim()) entry.lastmod = lastmod.trim()
            entries.push(entry)
          }
        }
      }
    },
    { xmlMode: true }
  )
  parser.write(xml)
  parser.end()

  return isIndex ? { kind: 'index', sitemaps } : { kind: 'urlset', entries }
}
