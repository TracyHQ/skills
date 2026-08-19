import { parseRobots } from '../robots'
import type { Finding, PageRecord } from '../types'

/**
 * AI Readiness: can a machine reach this site at all, and is it allowed to.
 *
 * Every other Check in the engine measures something ON a page. These measure whether the page is
 * reachable in the first place, which is why they outrank everything: a site that turns crawlers
 * away can do the other twenty-five things perfectly and still be invisible.
 */

/**
 * Bots that decide whether a site can be FOUND — search indexes and answer engines alike.
 * `ChatGPT-User` and `Perplexity-User` are deliberately absent: both vendors document that
 * robots.txt may not apply to them, because those fetches are triggered by a person asking a
 * question rather than by bulk crawling. Grading a rule with no force would send merchants to
 * edit a file that changes nothing. Whether those two actually get in is measured by asking the
 * site directly — see `ai-bots-reachable`.
 */
const ANSWER_BOTS = ['googlebot', 'bingbot', 'coccocbot', 'oai-searchbot', 'perplexitybot']

/**
 * Bots that only gather material to train a model. Blocking these costs long-term familiarity,
 * never today's customer, and plenty of sites block them on purpose — so this is the softest
 * finding the engine can raise, and it says so in its own title.
 */
const TRAINING_BOTS = ['gptbot', 'claudebot', 'google-extended']

const MAX_SAMPLE_URLS = 20

/** How many distinct sections to test besides the homepage. */
const SAMPLE_SECTIONS = 5

/**
 * The paths worth asking robots.txt about: the homepage, plus one url from each of the first few
 * sections the sitemap declares. Asking only about `/` is how a shop that blocks its whole product
 * catalogue reads as wide open — the single most consequential blind spot this file removes.
 */
function samplePaths(sitemapUrls: string[]): string[] {
  const bySection = new Map<string, string>()
  for (const url of sitemapUrls) {
    try {
      const { pathname } = new URL(url)
      const section = pathname.split('/').filter(Boolean)[0] ?? ''
      if (section && !bySection.has(section)) bySection.set(section, pathname)
    } catch {
      // A url the sitemap malformed is the sitemap's problem, not this check's.
    }
  }
  return ['/', ...[...bySection.values()].slice(0, SAMPLE_SECTIONS)]
}

const isNoindex = (page?: PageRecord): boolean => Boolean(page?.metaRobots && /noindex/i.test(page.metaRobots))

const isHomepage = (page: PageRecord): boolean => {
  try {
    return new URL(page.url).pathname === '/'
  } catch {
    return false
  }
}

/** Every (bot, path) pair the rules turn away, as one evidence line each. */
function blockedPairs(robotsText: string, bots: string[], paths: string[], siteKey: string): string[] {
  const lines: string[] = []
  for (const bot of bots) {
    const rules = parseRobots(robotsText, bot)
    for (const path of paths) {
      if (!rules.isAllowed(path)) lines.push(`${bot} blocked on ${siteKey}${path === '/' ? '' : path}`)
    }
  }
  return lines
}

/** The ids this file runs, in order — the denominator for "what did the site pass". */
export const AI_READINESS_CHECK_IDS: string[] = ['ai-bots-allowed', 'ai-training-bots-blocked', 'page-noindex']

export function runAiReadiness(input: {
  robotsText: string
  siteKey: string
  pages: PageRecord[]
  sitemapUrls: string[]
}): Finding[] {
  const findings: Finding[] = []
  const paths = samplePaths(input.sitemapUrls)
  const blocked = blockedPairs(input.robotsText, ANSWER_BOTS, paths, input.siteKey)
  // A homepage carrying `noindex` shuts every engine out of the whole site as surely as a
  // Disallow line does, so it belongs to this finding rather than to the per-page one below.
  if (isNoindex(input.pages.find(isHomepage))) {
    blocked.unshift(`noindex on the homepage of ${input.siteKey}`)
  }
  if (blocked.length > 0) {
    findings.push({
      checkId: 'ai-bots-allowed',
      title: 'Search and answer engines are turned away',
      count: blocked.length,
      priority: 1,
      urls: blocked.slice(0, MAX_SAMPLE_URLS)
    })
  }
  const training = blockedPairs(input.robotsText, TRAINING_BOTS, paths, input.siteKey)
  if (training.length > 0) {
    findings.push({
      checkId: 'ai-training-bots-blocked',
      title: 'AI model training is blocked (ignore this if that was deliberate)',
      count: training.length,
      priority: 3,
      urls: training.slice(0, MAX_SAMPLE_URLS)
    })
  }

  // page-noindex — a url the sitemap advertises while the page itself forbids indexing. The
  // sitemap membership is what makes this sayable: `/cart/` carrying noindex is correct practice,
  // and guessing which paths are utility pages would only work in English on one platform. A site
  // contradicting its own sitemap needs no guessing.
  //
  // Deduplicated on purpose: the crawl can hold two records for one url when two sitemap entries
  // redirect to the same page (`/cart/` and `/gio-hang/` on a bilingual WooCommerce store), and a
  // list of evidence that names the same address twice reads as two problems.
  const advertised = new Set(input.sitemapUrls)
  const noindexed = [
    ...new Set(
      input.pages
        .filter((p) => !p.redirectStub && !isHomepage(p) && isNoindex(p) && advertised.has(p.url))
        .map((p) => p.url)
    )
  ]
  if (noindexed.length > 0) {
    findings.push({
      checkId: 'page-noindex',
      title: 'Pages the sitemap offers but the page itself hides',
      count: noindexed.length,
      priority: 2,
      urls: noindexed.slice(0, MAX_SAMPLE_URLS)
    })
  }

  return findings
}
