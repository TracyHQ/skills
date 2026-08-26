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
  /**
   * `surface/coverage.json`, exactly as the mirror wrote it (ADR 0092 §3): which door built this
   * local copy, and what that door cannot see.
   *
   * Read from the file and never recomputed — nothing here knows what a Shopify door can see, and
   * the module that does is not called from here. Absent is an ordinary answer: a crawl with no
   * mirror behind it has no door to name, and the brief then says nothing about Coverage rather
   * than claiming completeness.
   */
  coverage?: CoverageDoc
}

/**
 * `surface/coverage.json` as this engine reads it — structural, and deliberately loose.
 *
 * The file is written by a published adapter that ships on its own release train, so a door this
 * bundle has never heard of must still produce a warning. Every field is optional for the same
 * reason: a shape that fails to parse would silently drop the one line the reader needs most.
 */
export type CoverageDoc = {
  door?: string
  /**
   * A gap carries more than this — a `reason` and sometimes a `remedy` — and the opening line
   * uses two fields of it. The index signature says that out loud rather than re-declaring a
   * shape this engine does not own.
   */
  gaps?: Array<{ what?: string; detail?: string; [field: string]: unknown }>
}

/** The doors in the reader's words. An unknown door falls back to its own name — never to silence. */
const DOOR_NAMES: Record<string, string> = {
  'shopify:admin': 'the Shopify admin door',
  'shopify:content': 'the Shopify content door',
  'wordpress:rest': 'the WordPress REST API',
  'joomla:web-services': 'Joomla Web Services'
}

/**
 * The brief's opening line: which door built this local copy, and what it cannot see.
 *
 * This is the half of Coverage that pays for the concept. A local copy built through a narrow door
 * LOOKS complete — right folders, right commit, content in place — and is missing drafts with
 * nothing saying so, which is how a Proposal comes out right about a narrow set and wrong about
 * the store. A warning that lives only on a screen leaves the one thing that writes Proposals
 * unaware of its own blind spot, so it goes here, first, before anything else.
 *
 * It carries an instruction and not just a fact, because the reader is an agent about to count
 * things: what it must do differently is the part a bare door name would leave it to infer.
 */
function coverageLine(coverage: CoverageDoc | undefined): string[] {
  if (!coverage?.door) return []
  const door = DOOR_NAMES[coverage.door] ?? coverage.door
  const gaps = (coverage.gaps ?? []).filter((gap) => gap.what)
  if (gaps.length === 0) {
    return [`> **Coverage:** this local copy was read through ${door}, which sees everything Tracy copies.`, '']
  }
  const missing = gaps
    .map((gap) => (gap.detail ? `${gap.what} — ${gap.detail}` : `${gap.what}`))
    .join(' Also missing: ')
  return [
    `> **Coverage:** this local copy was read through ${door}. Not in it: ${missing} ` +
      'Any count taken here is a count over what this door can see, so say that rather than ' +
      'describing it as the whole site.',
    ''
  ]
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
  llmsCuratedLinks,
  coverage
}: DigestInput): string[] {
  const lines: string[] = []
  // Before the title, because `fitBudget` trims from the tail and this line may never be the one
  // that goes. It is also the only one here that changes how everything below should be read.
  lines.push(...coverageLine(coverage))
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
  // Named "Crawl", not "Coverage": since ADR 0092 that word means which DOOR built this copy, and
  // one word meaning both how far the crawl reached and what the door can see is the exact
  // confusion the concept exists to remove.
  lines.push(
    `Crawl: ${report.htmlFetched} pages fetched, ${report.errors} errors, ${report.robotsBlocked} blocked by robots.`
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

/**
 * Joins lines, then trims whole lines from the tail until the budget holds — noting the cut.
 *
 * From the TAIL, and never below one line: that is what makes the brief's Coverage line
 * untrimmable. A size bound that could drop the sentence saying what is missing would leave a
 * truncated copy looking like a whole one.
 */
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
