import { parseSitemapXml } from './harvest/sitemap'
import { parseRobots } from './robots'
import { CRAWLER_USER_AGENT } from './userAgent'

/**
 * The first look at an address: what its two public files say, and nothing else.
 *
 * This is what a caller needs before deciding anything about a site — is anybody home, does it
 * publish a map, does it shut crawlers out — and it is deliberately smaller than a Scan: two
 * requests, no workspace, nothing written. Recognising the platform is NOT here, because that
 * belongs to whoever is asking; this half is pure public web.
 *
 * It never throws. The caller is an onboarding screen with a person waiting at it, so an address
 * that answers nothing is an answer, not a failure.
 */
export type ProbeResult = {
  /** robots.txt replied at all. Together with the sitemap this is what "reachable" rests on. */
  robotsAnswered: boolean
  sitemapFound: boolean
  /** Pages in the sitemap, or child sitemaps when the site answers with an index. */
  estimatedUrls: number
  robotsBlocksAll: boolean
}

const PROBE_TIMEOUT_MS = 8000

const EMPTY: ProbeResult = {
  robotsAnswered: false,
  sitemapFound: false,
  estimatedUrls: 0,
  robotsBlocksAll: false
}

export async function probeSite(url: string, opts?: { fetchFn?: typeof fetch }): Promise<ProbeResult> {
  const fetchFn = opts?.fetchFn ?? fetch
  const origin = safeOrigin(url)
  if (!origin) return EMPTY

  // Both at once, outside any politeness queue: two concurrent requests once is well within
  // polite, and somebody is watching a spinner.
  const grab = async (path: string): Promise<string | undefined> => {
    try {
      const response = await fetchFn(new URL(path, origin).toString(), {
        redirect: 'follow',
        headers: { 'user-agent': CRAWLER_USER_AGENT, accept: 'text/plain,application/xml,*/*' },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      })
      if (!response.ok) return undefined
      return await response.text()
    } catch {
      return undefined
    }
  }

  const [robotsText, sitemapXml] = await Promise.all([grab('/robots.txt'), grab('/sitemap.xml')])

  const robots = parseRobots(robotsText ?? '', 'TracyBot')
  const sitemap = sitemapXml === undefined ? undefined : parseSitemapXml(sitemapXml)

  return {
    robotsAnswered: robotsText !== undefined,
    sitemapFound: sitemap !== undefined,
    estimatedUrls:
      sitemap === undefined ? 0 : sitemap.kind === 'urlset' ? sitemap.entries.length : sitemap.sitemaps.length,
    robotsBlocksAll: !robots.isAllowed('/')
  }
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}
