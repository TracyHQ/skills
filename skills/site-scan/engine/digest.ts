import type { ShopifyCollection, ShopifyProduct } from './harvest/shopifyPublic'
import type { WpItem } from './harvest/wpRest'
import type { CrawlReport, Enrichment, Finding, PageRecord } from './types'

export const DIGEST_BYTE_BUDGET = 32 * 1024

const TOP_FINDINGS = 50
const TOP_RECENT_PAGES = 30

export type DigestInput = {
  siteKey: string
  pages: PageRecord[]
  findings: Finding[]
  report: CrawlReport
  wpItems?: WpItem[]
  shopify?: { products: ShopifyProduct[]; collections: ShopifyCollection[] }
  enrichment?: Enrichment
  /**
   * What the caller already knows the site runs on. Authoritative over enrichment's guess: the
   * desktop app detected it against the site itself, and every platform-gated skill reads the
   * brief's Platform line to decide which of its procedures apply.
   */
  platform?: string | null
  /**
   * The stack layer the desktop app's Sync writes beside this surface: merged technologies with
   * evidence (`surface/stack.json`) and the installed-extension inventory
   * (`surface/inventory.json`). The brief NAMES them — the files carry the detail, and a
   * pointer costs nothing until it is followed.
   */
  stack?: { technologies?: { name?: string; version?: string; evidence?: string }[] }
  extensionInventory?: { items?: { state?: string }[]; gaps?: unknown[] }
  /** Same-site links the owner curated in llms.txt — their hand-written map for AI readers. */
  llmsCuratedLinks?: number
}

/**
 * The Digests (Domain Language): code-generated Markdown summaries of the Local
 * copy, the reading set of an AI Scan. Deterministic — same input, same bytes;
 * no timestamps beyond what the report carries, no LLM anywhere. Every file
 * stays under `DIGEST_BYTE_BUDGET` by folding detail into groups and saying so.
 */
export function generateDigests(input: DigestInput): {
  'SITE-BRIEF.md': string
  'content-map.md': string
  'seo-findings.md': string
} {
  return {
    'SITE-BRIEF.md': fitBudget(siteBrief(input)),
    'content-map.md': fitBudget(contentMap(input)),
    'seo-findings.md': fitBudget(seoFindings(input))
  }
}

function siteBrief({
  siteKey,
  pages,
  report,
  wpItems,
  shopify,
  enrichment,
  platform,
  stack,
  extensionInventory,
  llmsCuratedLinks
}: DigestInput): string[] {
  const lines: string[] = []
  lines.push(`# Site brief — ${siteKey}`)
  lines.push('')
  lines.push('What the public web sees of this site (Evidence: Observed unless noted).')
  lines.push('')
  const enriched = enrichment && enrichment.found ? enrichment : undefined
  const knownPlatform = platform ?? enriched?.platform
  if (knownPlatform) lines.push(`- Platform: ${knownPlatform}`)
  lines.push(`- Crawled pages: ${pages.length} (of ${report.discovered} discovered)`)
  if (shopify) {
    lines.push(`- Catalog: ${shopify.products.length} products in ${shopify.collections.length} collections`)
    const prices = shopify.products.map((p) => Number(p.priceRange.min)).filter((n) => Number.isFinite(n) && n > 0)
    if (prices.length > 0) {
      lines.push(`- Price range: ${Math.min(...prices).toFixed(2)} – ${Math.max(...prices).toFixed(2)}`)
    }
  }
  if (wpItems && wpItems.length > 0) {
    const posts = wpItems.filter((i) => i.kind === 'post').length
    lines.push(`- Content: ${posts} posts, ${wpItems.length - posts} pages via the open REST api`)
  }
  if (enriched?.categories?.length) lines.push(`- Categories (Evidence: Estimated): ${enriched.categories.join(', ')}`)
  const stackEntries = (stack?.technologies ?? []).filter((entry) => entry.name)
  if (stackEntries.length > 0) {
    const named = stackEntries
      .slice(0, 4)
      .map((entry) => `${entry.name}${entry.version ? ` ${entry.version}` : ''}${entry.evidence === 'verified' ? ' (Verified)' : ''}`)
    const more = stackEntries.length > 4 ? ` +${stackEntries.length - 4} more` : ''
    lines.push(`- Stack: ${named.join(' · ')}${more} — read surface/stack.json`)
  }
  if (llmsCuratedLinks) {
    lines.push(`- llms.txt: present — ${llmsCuratedLinks} owner-curated links (their own map for AI readers)`)
  }
  const inventoryItems = extensionInventory?.items ?? []
  if (inventoryItems.length > 0) {
    const disabled = inventoryItems.filter((item) => item.state === 'disabled').length
    const gaps = extensionInventory?.gaps?.length ?? 0
    lines.push(
      `- Extensions: ${inventoryItems.length} installed${disabled ? `, ${disabled} disabled` : ''}${gaps ? `, ${gaps} gaps` : ''} — read surface/inventory.json`
    )
  }
  lines.push('')
  lines.push(
    `Coverage: ${report.htmlFetched} pages fetched, ${report.errors} errors, ${report.robotsBlocked} blocked by robots.`
  )
  if (report.cappedHtml > 0)
    lines.push(`Capped: ${report.cappedHtml} urls beyond the html budget — see surface/crawl-report.json.`)
  lines.push('')
  // The preflight pointer of ADR 0078: the digest names where shared working memory lives, the
  // agent decides whether to read it — a pointer costs nothing until it is followed.
  lines.push('Teammates may have shared session notes in TracyWork/team/ — search them when a task touches earlier work.')
  return lines
}

function contentMap({ pages }: DigestInput): string[] {
  const lines: string[] = []
  lines.push('# Content map')
  lines.push('')
  const sections = new Map<string, PageRecord[]>()
  for (const p of pages) {
    const section = sectionOf(p.url)
    const bucket = sections.get(section)
    if (bucket) bucket.push(p)
    else sections.set(section, [p])
  }
  lines.push('| Section | Pages |')
  lines.push('| --- | --- |')
  for (const [section, sectionPages] of [...sections.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`| ${section} | ${sectionPages.length} |`)
  }
  lines.push('')
  lines.push(`## Sample pages (${Math.min(TOP_RECENT_PAGES, pages.length)} of ${pages.length})`)
  for (const p of pages.slice(0, TOP_RECENT_PAGES)) {
    lines.push(`- ${p.url}${p.title ? ` — ${p.title}` : ''}`)
  }
  if (pages.length > TOP_RECENT_PAGES) {
    lines.push('')
    lines.push(`${pages.length - TOP_RECENT_PAGES} more URLs. Read surface/pages/ for any page in full.`)
  }
  return lines
}

function seoFindings({ findings }: DigestInput): string[] {
  const lines: string[] = []
  lines.push('# SEO findings (Evidence: Observed)')
  lines.push('')
  if (findings.length === 0) {
    lines.push('No findings — every crawled page passed the current checks.')
    return lines
  }
  for (const finding of findings.slice(0, TOP_FINDINGS)) {
    lines.push(`## P${finding.priority} · ${finding.title} — ${finding.count}`)
    lines.push(`Check: \`${finding.checkId}\``)
    for (const url of finding.urls.slice(0, 5)) lines.push(`- ${url}`)
    lines.push('')
  }
  if (findings.length > TOP_FINDINGS) {
    lines.push(`${findings.length - TOP_FINDINGS} more findings — see surface/seo/findings.json.`)
  }
  return lines
}

function sectionOf(url: string): string {
  try {
    const path = new URL(url).pathname
    const first = path.split('/').filter(Boolean)[0]
    return first ? `/${first}` : '/'
  } catch {
    return '/'
  }
}

/** Joins lines, then trims whole lines from the tail until the budget holds — noting the cut. */
function fitBudget(lines: string[]): string {
  let kept = lines.length
  let text = lines.join('\n')
  while (Buffer.byteLength(text, 'utf8') > DIGEST_BYTE_BUDGET && kept > 1) {
    kept = Math.max(1, Math.floor(kept * 0.9))
    text = [
      ...lines.slice(0, kept),
      '',
      `(trimmed to fit ${DIGEST_BYTE_BUDGET / 1024}KB. Read surface/ for the whole picture.)`
    ].join('\n')
  }
  return text
}
