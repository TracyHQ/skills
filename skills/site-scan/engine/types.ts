/**
 * Shared shapes of the public crawler (spec 2026-07-30-public-site-crawler-design.md).
 * Domain Language: Crawl / Probe / Surface / Digest / Check / Finding.
 */

export type SitemapEntry = { url: string; lastmod?: string }

/**
 * No `fetchedAt`. Wall-clock time belongs to {@link CrawlReport}, which is the record of a run —
 * putting it on the content too rewrites every page file on every Sync even when the site has not
 * moved, and the workspace is a git repo whose history never shrinks.
 */
export type PageRecord = {
  url: string
  status: number
  title?: string
  metaDescription?: string
  canonical?: string
  /** A 200 hop page, not content — kept in the surface, excluded from Checks. */
  redirectStub?: boolean
  h1: string[]
  headings: { level: number; text: string }[]
  wordCount: number
  /** First 2000 characters of the normalized body text. */
  textSample: string
  images: { src: string; alt?: string }[]
  internalLinks: string[]
  externalLinks: string[]
  /** `@type` values collected from ld+json blocks — the WHOLE tree, nested nodes included. */
  schemaTypes: string[]
  /** `<meta name="robots">`, kept for the noindex half of the ai-bots check. */
  metaRobots?: string
  /** What the page's Product markup actually carries (MN machine-readability checks). */
  productSchema?: {
    offers: boolean
    price: boolean
    currency: boolean
    availability: boolean
    gtin: boolean
    brand: boolean
    mpn: boolean
    sku: boolean
  }
  orgSchema?: { name: boolean; logo: boolean; sameAs: boolean }
  videoSchema?: { name: boolean; thumbnail: boolean; url: boolean }
  /** sha1 of the normalized body text — the incremental diff key. */
  contentHash: string
}

/**
 * One Check's countable result (Domain Language: Finding). `urls` holds at most 20 samples.
 *
 * `platformLimit` marks a finding the merchant cannot act on — the platform serves every store the
 * same way. It is still reported, because a merchant should know what an agent cannot see, but it
 * must never be scored against them and must never turn into a Proposal.
 */
export type Finding = {
  checkId: string
  title: string
  count: number
  priority: 1 | 2 | 3
  urls: string[]
  platformLimit?: boolean
}

/** The honesty contract: how complete this crawl's picture actually is (spec §8). */
export type CrawlReport = {
  startedAt: string
  finishedAt: string
  discovered: number
  htmlFetched: number
  structuredItems: number
  robotsBlocked: number
  errors: number
  /** URLs dropped by the 500 HTML-fetch cap. */
  cappedHtml: number
  cappedStructured: number
  /**
   * What this run deliberately did not read, said out loud instead of left for the reader to infer.
   * A silent screen reads as "nothing wrong here", which is a different claim from "not checked".
   */
  skipped: {
    /** Internal links whose destination was never asked about, capped at 100 HEAD requests. */
    linkChecks: number
    /** Pages named by the sitemap that fell outside the 500-page ceiling. */
    pages: number
  }
  /**
   * Every check that ran and found nothing — the denominator `findings.json` never had, since only
   * a failure leaves a trace there.
   */
  checksPassed: string[]
  marketAgeDays?: number
  vitalsAgeDays?: number
}

/** Per-URL memory for T3 incremental crawls — lives at .tracy/crawl-state.json, git-excluded. */
export type CrawlState = { pages: Record<string, { lastmod?: string; etag?: string; contentHash?: string }> }

/**
 * What a public dataset can say about a site before the merchant has handed over any credential.
 * Everything here is `observed` — seen from outside — and must never be presented in the same
 * language as data a site attested through its own API (ADR 0004 §9).
 *
 * Copied by hand from the desktop app's `Enrichment`, where it is inferred from a zod schema.
 * Only the digest's input type needs it, so the engine takes the shape and leaves the validator
 * behind rather than pulling a runtime dependency into a bundle that has no use for one.
 */
export type EnrichedItem = {
  id: string
  name: string
  /** `app` is an App Store listing; `script` is a page-embedded tag; `other` is neither or unknown. */
  kind: 'app' | 'script' | 'other'
  version?: string
  attributes?: {
    /**
     * NOT an install date. It is when the crawler first saw the thing, and entries on one site
     * routinely share a timestamp to the second. Named for what it is so nothing can honestly
     * render it as "installed on".
     */
    firstSeenAt?: string
    categories?: string[]
    /** Arrives from the vendor as a string; the worker coerces it before it gets here. */
    averageRating?: number
    installs?: number
    installs30d?: number
  }
}

/**
 * `found: false` is the ordinary case, not an error: the dataset covers commerce sites, so a
 * WordPress or Joomla site that is not a shop is absent from it exactly as a non-existent domain is.
 */
export type Enrichment =
  | {
      found: true
      platform?: string
      items: EnrichedItem[]
      /** The pages Tracy already manages — the one group present on every platform and every size. */
      pages?: { kind: string; url: string }[]
      /** A rank alone reads as bad news; the percentile beside it turns it into information. */
      standing?: { rank?: number; platformRank?: number; percentile?: number; plan?: string }
      features?: string[]
      categories?: string[]
      reviews?: { source: string; rating: number; count: number }[]
      /** Every hostname the vendor groups under this brand, the merchant's own included. */
      reach?: string[]
    }
  | { found: false }
