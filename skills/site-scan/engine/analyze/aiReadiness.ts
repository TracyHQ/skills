import type { BotAccessSurface } from '../harvest/botAccess'
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

/**
 * Crawl-Delay thresholds, in seconds. Google ignores the directive outright, so this is squarely
 * an AI-and-second-tier-engine problem: Bing, CocCocBot, GPTBot, ClaudeBot and PerplexityBot honour
 * it, and at twenty seconds a four-hundred-product catalogue takes over two hours to read once.
 * That is not a block, it is a chokehold, and the outcome is the same.
 */
const CRAWL_DELAY_HARSH_S = 10
const CRAWL_DELAY_NOTABLE_S = 5

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

/** 2xx and 3xx both mean the door opened; anything else is a door held shut. */
const reachable = (status: number): boolean => status >= 200 && status < 400

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
export const AI_READINESS_CHECK_IDS: string[] = [
  'ai-bots-allowed',
  'ai-training-bots-blocked',
  'crawl-delay-punitive',
  'ai-bots-reachable',
  'sitemap-noindex-conflict'
]

export function runAiReadiness(input: {
  robotsText: string
  siteKey: string
  pages: PageRecord[]
  sitemapUrls: string[]
  botAccess?: BotAccessSurface
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

  // crawl-delay-punitive — the delay that applies to the bots this file cares about, whichever
  // group of the file names them. Read from the same parse as everything above; the parser has
  // returned this number all along and nothing has ever read it.
  const delaysMs = [...ANSWER_BOTS, ...TRAINING_BOTS].map((bot) => parseRobots(input.robotsText, bot).crawlDelayMs ?? 0)
  const worstDelayS = Math.max(0, ...delaysMs) / 1000
  if (worstDelayS > CRAWL_DELAY_NOTABLE_S) {
    findings.push({
      checkId: 'crawl-delay-punitive',
      title: 'Crawlers are told to wait so long they never finish',
      count: 1,
      priority: worstDelayS > CRAWL_DELAY_HARSH_S ? 2 : 3,
      urls: [`Crawl-Delay: ${worstDelayS} on ${input.siteKey}/robots.txt`]
    })
  }

  // ai-bots-reachable — what the site DOES, next to what robots.txt SAYS. A clean robots.txt is
  // no comfort when the edge turns AI crawlers away before they ever read it, which is now the
  // default on some networks.
  //
  // Two guards keep this from convicting a healthy site. The baseline: if an ordinary visitor is
  // refused too, this is not about bots and nothing is reported. The control: a request wearing
  // Googlebot's name, whose refusal means the edge is checking whether declared identities can be
  // verified — our address cannot be, and neither can anyone else's but Google's own. Then the
  // honest reading is "identities are being screened", not "AI is blocked", and the finding says so.
  const access = input.botAccess
  if (access && reachable(access.baselineStatus)) {
    const refused = access.bots.filter((probe) => !reachable(probe.status))
    if (refused.length > 0) {
      const screened = !reachable(access.controlStatus)
      const where = access.cdn ? ` at the ${access.cdn} edge` : ''
      findings.push({
        checkId: 'ai-bots-reachable',
        title: screened
          ? `Bot identities are screened${where}, so AI crawlers may never reach the site`
          : `AI crawlers are refused${where} while ordinary visitors are let in`,
        count: refused.length,
        priority: screened ? 3 : 1,
        urls: refused.map((probe) => `${probe.bot} → ${probe.status} on ${input.siteKey}`).slice(0, MAX_SAMPLE_URLS)
      })
    }
  }

  // sitemap-noindex-conflict — the sitemap invites a crawler to a page that turns it away.
  //
  // The blame is on the sitemap, and the name says so. A cart page carrying `noindex` is correct
  // practice; listing that page in the sitemap is not. Naming this after the tag would send a
  // merchant to remove the one thing on the page that is right.
  //
  // Sitemap membership is also what makes the check sayable at all. Asking "should this page be
  // indexed" needs to know what the page is FOR, and a list of utility paths would only work in
  // English on one platform — juneflower calls them `/gio-hang/` and `/thanh-toan/`. Asking
  // instead whether the site contradicts its own declarations needs no such list, works in every
  // language, and rests on two facts the site published itself.
  //
  // What it does NOT catch: a utility page that never asked to be hidden. On juneflower four of
  // the six — `/cart/`, `/my-account/`, `/checkout/`, `/thanh-toan/` — say `index, follow`,
  // orphan copies from a demo import that no plugin ever configured. That is the worse half of
  // the problem and it needs the platform recognition stage 4 owes the engine anyway.
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
      checkId: 'sitemap-noindex-conflict',
      title: 'Sitemap advertises pages that ask not to be indexed',
      count: noindexed.length,
      priority: 3,
      urls: noindexed.slice(0, MAX_SAMPLE_URLS)
    })
  }

  return findings
}
