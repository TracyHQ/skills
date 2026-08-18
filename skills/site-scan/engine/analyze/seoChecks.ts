import type { Finding, PageRecord } from '../types'
import type { LinkGraph } from './linkGraph'

const MAX_SAMPLE_URLS = 20
const THIN_CONTENT_WORDS = 150

type CheckDef = {
  id: string
  title: string
  priority: 1 | 2 | 3
  affected: (pages: PageRecord[], graph: LinkGraph) => string[]
}

/**
 * The first deterministic Checks of the AI Visibility system (Domain Language:
 * Check → Finding; spec §6). Each rule is code-versioned by its stable id.
 * Heading, alt-text and structured-data rules moved to the MN Discoverability
 * port (`mnDiscoverability.ts`) under their framework ids — one rule, one home.
 * P1 has no per-site toggles or thresholds — the P2 Checks engine adds those
 * around these same rules, it does not redefine them.
 */
const CHECKS: CheckDef[] = [
  {
    id: 'missing-title',
    title: 'Pages without a title tag',
    priority: 1,
    affected: (pages) => pages.filter((p) => !p.title).map((p) => p.url)
  },
  {
    id: 'missing-meta-description',
    title: 'Pages without a meta description',
    priority: 1,
    affected: (pages) => pages.filter((p) => !p.metaDescription).map((p) => p.url)
  },
  {
    id: 'broken-internal-links',
    title: 'Internal links that lead nowhere',
    priority: 1,
    affected: (_pages, graph) => graph.brokenInternal.map((b) => `${b.from} → ${b.to} (${b.status})`)
  },
  {
    id: 'duplicate-title',
    title: 'Pages sharing the same title',
    priority: 2,
    affected: (pages) => duplicates(pages, (p) => p.title)
  },
  {
    id: 'duplicate-meta-description',
    title: 'Pages sharing the same meta description',
    priority: 2,
    affected: (pages) => duplicates(pages, (p) => p.metaDescription)
  },
  {
    id: 'thin-content',
    title: `Pages with under ${THIN_CONTENT_WORDS} words`,
    priority: 2,
    affected: (pages) => pages.filter((p) => p.wordCount < THIN_CONTENT_WORDS).map((p) => p.url)
  },
  {
    id: 'orphan-pages',
    title: 'Pages nothing links to',
    priority: 2,
    affected: (_pages, graph) => graph.orphans
  },
  {
    id: 'missing-canonical',
    title: 'Pages without a canonical url',
    priority: 3,
    affected: (pages) => pages.filter((p) => !p.canonical).map((p) => p.url)
  }
]

/**
 * The ids of every check in this file, in the order they run.
 *
 * A finding is only ever written when a check FAILS, so this list is the denominator: subtract the
 * findings from it and what remains is what the site passed. Without it, "fourteen problems" has
 * nothing to be fourteen out of.
 */
export const SEO_CHECK_IDS: string[] = CHECKS.map((check) => check.id)

export function runSeoChecks(allPages: PageRecord[], graph: LinkGraph): Finding[] {
  // Hop pages are 200s with nothing on them; every check would fire on one and
  // report a page the merchant cannot visit. They stay in the surface, not here.
  const pages = allPages.filter((p) => !p.redirectStub)
  const findings: Finding[] = []
  for (const check of CHECKS) {
    const affected = check.affected(pages, graph)
    if (affected.length === 0) continue
    findings.push({
      checkId: check.id,
      title: check.title,
      count: affected.length,
      priority: check.priority,
      urls: affected.slice(0, MAX_SAMPLE_URLS)
    })
  }
  return findings.sort((a, b) => a.priority - b.priority || b.count - a.count)
}

function duplicates(pages: PageRecord[], key: (p: PageRecord) => string | undefined): string[] {
  const seen = new Map<string, string[]>()
  for (const p of pages) {
    const value = key(p)
    if (!value) continue
    const bucket = seen.get(value)
    if (bucket) bucket.push(p.url)
    else seen.set(value, [p.url])
  }
  return [...seen.values()].filter((urls) => urls.length > 1).flat()
}
