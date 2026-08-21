import { parseRobots } from '../robots'
import { isDocument } from '../types'
import type { Finding, PageRecord } from '../types'

/**
 * The Discoverability factor of the Mention Network Product-Visibility framework, ported as
 * deterministic Checks (Domain Language: Check → Finding).
 *
 * Criterion ids, weights and impacts are pinned 1:1 to the framework's own
 * `framework.constants.ts` — the two products must keep speaking the same names, so a test in
 * this repo hand-encodes the table and fails if either side drifts. `google-merchant-feed` is
 * the one criterion NOT here: it needs a paid SerpAPI lookup, which makes it Source work, not
 * crawl work.
 *
 * The MN originals audit ONE product page with rendered HTML and a shop context; this port
 * counts across the whole crawl with raw HTML only. Two rules are therefore adaptations, marked
 * `adapted` below and in their doc: `crawlable-text` cannot diff rendered-vs-raw (no renderer
 * here — but a raw-only crawl IS the no-JS view, so "almost no raw text" carries the intent),
 * and `brand-in-title` has no vendor field, so the brand token is the site's own host label.
 */
export type MnImpact = 'Critical' | 'High' | 'Medium'

export const MN_DISCOVERABILITY: Record<
  string,
  { weight: 1 | 2 | 3; impact: MnImpact; subGroup: string; adapted?: true }
> = {
  'ai-bots-allowed': { weight: 3, impact: 'Critical', subGroup: 'access-findability' },
  'internal-linking': { weight: 1, impact: 'Medium', subGroup: 'access-findability' },
  'crawlable-text': { weight: 2, impact: 'High', subGroup: 'content-readability', adapted: true },
  'image-alt-text': { weight: 1, impact: 'Medium', subGroup: 'content-readability' },
  'heading-hierarchy': { weight: 1, impact: 'Medium', subGroup: 'content-readability' },
  'brand-in-title': { weight: 3, impact: 'Critical', subGroup: 'content-readability', adapted: true },
  'product-schema': { weight: 3, impact: 'Critical', subGroup: 'machine-readability' },
  'product-schema-rich': { weight: 2, impact: 'High', subGroup: 'machine-readability' },
  'review-schema': { weight: 2, impact: 'High', subGroup: 'machine-readability' },
  'shipping-schema': { weight: 2, impact: 'High', subGroup: 'machine-readability' },
  'faq-schema': { weight: 2, impact: 'High', subGroup: 'machine-readability' },
  'organization-schema': { weight: 3, impact: 'Critical', subGroup: 'machine-readability' },
  'breadcrumb-schema': { weight: 1, impact: 'Medium', subGroup: 'machine-readability' },
  'video-schema': { weight: 1, impact: 'Medium', subGroup: 'machine-readability' }
}

const PRIORITY: Record<MnImpact, 1 | 2 | 3> = { Critical: 1, High: 2, Medium: 3 }
const MAX_SAMPLE_URLS = 20
/** MN image-alt quality bar, verbatim: filename-ish alts count as missing. */
const FILENAME_RE = /^(img[_-]|dsc[_-]?\d)|\.(jpe?g|png|gif|webp|svg|bmp|avif)$/i
/** Adapted crawlable-text: below this many words of raw text, the page is invisible without JS. */
const CRAWLABLE_MIN_WORDS = 30

/**
 * A product page is one whose path contains `/products/` — Shopify's convention, and the source of
 * the largest known measuring error in this engine: WooCommerce uses `/san-pham/`, Joomla uses
 * something else again, so on those platforms this finds almost nothing. Fixing the recognition is
 * stage 4's work; until then the crawl at least refuses to report a product check as passed on a
 * set it knows it got wrong.
 */
export const isProductPage = (page: PageRecord): boolean =>
  !page.redirectStub && page.url.includes('/products/')

/** The nine checks whose verdict is only as good as {@link isProductPage}. */
export const PRODUCT_SCOPED_CHECK_IDS: string[] = [
  'brand-in-title',
  'internal-linking',
  'product-schema',
  'product-schema-rich',
  'review-schema',
  'shipping-schema',
  'faq-schema',
  'breadcrumb-schema',
  'video-schema'
]

/** MN alt rules verbatim: non-empty, not a filename, ≥4 words, ≤125 chars, unique on the page. */
function altPasses(alt: string, counts: Map<string, number>): boolean {
  const trimmed = alt.trim()
  if (!trimmed || FILENAME_RE.test(trimmed)) return false
  const words = trimmed.split(/\s+/).filter(Boolean).length
  if (words < 4 || trimmed.length > 125) return false
  return (counts.get(trimmed.toLowerCase()) ?? 0) <= 1
}

/** MN heading rule: exactly one h1 and no level ever jumps more than one step down. */
function headingsFail(page: PageRecord): boolean {
  if (page.h1.length !== 1) return true
  let prev = 0
  for (const h of page.headings) {
    if (prev > 0 && h.level > prev + 1) return true
    prev = h.level
  }
  return false
}

export function runMnDiscoverability(allPages: PageRecord[], robotsText: string, siteKey: string): Finding[] {
  const pages = allPages.filter((p) => !p.redirectStub && isDocument(p))
  const products = pages.filter(isProductPage)
  const findings: Finding[] = []
  const add = (checkId: string, title: string, urls: string[], count = urls.length) => {
    if (count === 0) return
    findings.push({
      checkId,
      title,
      count,
      priority: PRIORITY[MN_DISCOVERABILITY[checkId].impact],
      urls: urls.slice(0, MAX_SAMPLE_URLS)
    })
  }

  // ai-bots-allowed — MN tiers: Google blocked is the disaster, OpenAI-search blocked the warning.
  // Meta-robots noindex on the homepage counts as blocking Google, exactly as MN scores it.
  const home = pages.find((p) => {
    try {
      return new URL(p.url).pathname === '/'
    } catch {
      return false
    }
  })
  const noindex = Boolean(home?.metaRobots && /noindex/i.test(home.metaRobots))
  const blockedBots = ['googlebot', 'oai-searchbot', 'chatgpt-user'].filter(
    (bot) => !parseRobots(robotsText, bot).isAllowed('/')
  )
  if (noindex) blockedBots.unshift('noindex (meta robots)')
  add(
    'ai-bots-allowed',
    'Search and answer engines are turned away',
    blockedBots.map((bot) => `${bot} blocked on ${siteKey}`)
  )

  // crawlable-text (adapted) — raw text is what a no-JS crawler gets; almost none means invisible.
  add(
    'crawlable-text',
    'Pages with almost no machine-readable text',
    pages.filter((p) => p.wordCount < CRAWLABLE_MIN_WORDS).map((p) => p.url)
  )

  // image-alt-text — pages where any image fails the MN quality bar.
  add(
    'image-alt-text',
    'Pages whose images an assistant cannot describe',
    pages
      .filter((p) => {
        if (p.images.length === 0) return false
        const counts = new Map<string, number>()
        for (const img of p.images) {
          const key = (img.alt ?? '').trim().toLowerCase()
          if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        return p.images.some((img) => !altPasses(img.alt ?? '', counts))
      })
      .map((p) => p.url)
  )

  add(
    'heading-hierarchy',
    'Pages whose structure a machine cannot follow',
    pages.filter(headingsFail).map((p) => p.url)
  )

  // brand-in-title (adapted) — the brand token is the site's own host label. Matching is
  // punctuation-blind and prefix-lenient: fifibakeryny.com's titles say "– FIFI Bakery", which
  // names the brand even though the domain wears an extra "ny". A rule that demands the whole
  // label verbatim convicts every store whose domain carries a suffix — erring toward not
  // accusing is the honest side of an adapted check.
  const brand = hostLabel(siteKey)
  if (brand) {
    add(
      'brand-in-title',
      'Product pages whose title never names the brand',
      products.filter((p) => !titleNamesBrand(p.title ?? '', brand)).map((p) => p.url)
    )
  }

  // internal-linking — MN: reachable means a collections link or a breadcrumb trail.
  add(
    'internal-linking',
    'Product pages no path leads out of',
    products
      .filter(
        (p) => !p.schemaTypes.includes('BreadcrumbList') && !p.internalLinks.some((l) => l.includes('/collections/'))
      )
      .map((p) => p.url)
  )

  // The machine-readability family. MN scores 0/50/100 per page; a finding counts every page
  // that is not at 100 — partial markup is still markup an assistant cannot rely on.
  add(
    'product-schema',
    'Product pages an AI cannot read the price of',
    products
      .filter(
        (p) => !p.productSchema || !(p.productSchema.price && p.productSchema.currency && p.productSchema.availability)
      )
      .map((p) => p.url)
  )
  add(
    'product-schema-rich',
    'Products no assistant can identify exactly',
    products
      .filter((p) => {
        const facts = p.productSchema
        if (!facts) return true
        return !(facts.gtin || (facts.brand && facts.mpn))
      })
      .map((p) => p.url)
  )
  add(
    'review-schema',
    'Product pages whose ratings are invisible to AI',
    products
      .filter((p) => !p.schemaTypes.includes('AggregateRating') && !p.schemaTypes.includes('Review'))
      .map((p) => p.url)
  )
  add(
    'shipping-schema',
    'Product pages that never say how they ship',
    products.filter((p) => !p.schemaTypes.includes('OfferShippingDetails')).map((p) => p.url)
  )
  add(
    'faq-schema',
    'Product pages with no machine-readable answers',
    products.filter((p) => !p.schemaTypes.includes('FAQPage')).map((p) => p.url)
  )
  add(
    'breadcrumb-schema',
    'Product pages with no category trail for machines',
    products.filter((p) => !p.schemaTypes.includes('BreadcrumbList')).map((p) => p.url)
  )

  // organization-schema — site-level: one full Organization anywhere clears it (MN full = name+logo+sameAs).
  // Zero real pages means zero knowledge — "no markup anywhere" is only sayable about pages we read.
  const orgs = pages.map((p) => p.orgSchema).filter((o): o is NonNullable<PageRecord['orgSchema']> => Boolean(o))
  if (pages.length === 0) {
    // nothing observed, nothing claimed
  } else if (orgs.length === 0) {
    add('organization-schema', 'No machine-readable brand identity anywhere', [`no Organization markup on ${siteKey}`])
  } else if (!orgs.some((o) => o.name && o.logo && o.sameAs)) {
    const best = orgs[0]
    const missing = [!best.name && 'name', !best.logo && 'logo', !best.sameAs && 'sameAs'].filter(Boolean).join(', ')
    add('organization-schema', 'Brand identity markup is incomplete', [`Organization missing: ${missing}`])
  }

  // video-schema — MN scores only pages that HAVE a video; absence is not a failure.
  add(
    'video-schema',
    'Product videos machines cannot read',
    products
      .filter((p) => p.videoSchema && !(p.videoSchema.name && p.videoSchema.thumbnail && p.videoSchema.url))
      .map((p) => p.url)
  )

  return findings.sort((a, b) => a.priority - b.priority || b.count - a.count)
}

/** The title, squeezed to letters and digits, must carry the host label's first ≥5 characters. */
function titleNamesBrand(title: string, host: string): boolean {
  const squeezed = title.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return squeezed.includes(host.slice(0, Math.min(5, host.length)))
}

function hostLabel(siteKey: string): string | null {
  try {
    const host = new URL(siteKey).hostname.replace(/^www\./, '')
    return host.split('.')[0]?.toLowerCase() || null
  } catch {
    return null
  }
}
