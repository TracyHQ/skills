/**
 * What the site DOES when a machine says who it is.
 *
 * `robots.txt` is a declaration; this is the behaviour. The gap between them is now real: some
 * networks refuse AI crawlers at the edge by default, so a spotless robots.txt can sit in front of
 * a site no assistant can read. Nothing here needs a credential — it is the same public page,
 * asked for under a different name.
 */
export type BotProbe = { bot: string; status: number }

export type BotAccessSurface = {
  /** The same url under the crawler's own name. Everything else is only meaningful next to this. */
  baselineStatus: number
  /** Under Googlebot's name — the control that tells a bot block apart from identity screening. */
  controlStatus: number
  /** The network in front of the site, when its response headers name one. */
  cdn?: string
  bots: BotProbe[]
}

/**
 * The AI crawlers worth asking about, under the names their vendors publish. Googlebot is not in
 * this list: it is the control, probed separately, because it is the identity an edge network is
 * most likely to verify by address — and a refusal there says something different.
 */
const AI_BOTS: { bot: string; userAgent: string }[] = [
  {
    bot: 'GPTBot',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'
  },
  {
    bot: 'OAI-SearchBot',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot'
  },
  {
    bot: 'ChatGPT-User',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'
  },
  { bot: 'ClaudeBot', userAgent: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' },
  {
    bot: 'PerplexityBot',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot'
  }
]

const CONTROL_USER_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

/**
 * The fingerprint each network leaves in its own response headers. Matched on the header name
 * alone where that name belongs to one vendor, and on the value where the name is generic.
 * An unrecognised network stays unnamed: telling a merchant to go and check the wrong control
 * panel is worse than telling them nothing.
 */
const CDN_HEADERS: { header: string; contains?: string; name: string }[] = [
  { header: 'cf-ray', name: 'Cloudflare' },
  { header: 'server', contains: 'cloudflare', name: 'Cloudflare' },
  { header: 'x-amz-cf-id', name: 'CloudFront' },
  { header: 'server', contains: 'cloudfront', name: 'CloudFront' },
  { header: 'x-served-by', name: 'Fastly' },
  { header: 'server', contains: 'akamai', name: 'Akamai' },
  { header: 'x-akamai-transformed', name: 'Akamai' },
  { header: 'x-sucuri-id', name: 'Sucuri' },
  { header: 'x-iinfo', name: 'Imperva' },
  { header: 'server', contains: 'bunnycdn', name: 'BunnyCDN' },
  { header: 'x-vnis-id', name: 'VNIS' }
]

const PROBE_TIMEOUT_MS = 10_000

/**
 * One HEAD per identity, one at a time with a pause between — six requests to a site we are
 * already crawling politely, so they go single file rather than in a burst.
 *
 * It never throws. A site that answers nothing is an answer (`0`), and the analyze side already
 * refuses to say anything when the baseline itself did not get through.
 */
export async function harvestBotAccess(input: {
  url: string
  crawlerUserAgent: string
  fetchFn?: typeof fetch
  minIntervalMs?: number
}): Promise<BotAccessSurface> {
  const fetchFn = input.fetchFn ?? fetch
  const gap = input.minIntervalMs ?? 1000
  let first = true

  const ask = async (userAgent: string): Promise<{ status: number; headers?: Headers }> => {
    if (!first) await new Promise((resolve) => setTimeout(resolve, gap))
    first = false
    try {
      const response = await fetchFn(input.url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'user-agent': userAgent, accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      })
      return { status: response.status, headers: response.headers }
    } catch {
      return { status: 0 }
    }
  }

  const baseline = await ask(input.crawlerUserAgent)
  const control = await ask(CONTROL_USER_AGENT)
  const bots: BotProbe[] = []
  for (const { bot, userAgent } of AI_BOTS) {
    bots.push({ bot, status: (await ask(userAgent)).status })
  }

  return {
    baselineStatus: baseline.status,
    controlStatus: control.status,
    ...(recogniseCdn(baseline.headers) ? { cdn: recogniseCdn(baseline.headers) } : {}),
    bots
  }
}

function recogniseCdn(headers?: Headers): string | undefined {
  if (!headers) return undefined
  for (const rule of CDN_HEADERS) {
    const value = headers.get(rule.header)
    if (value === null) continue
    if (rule.contains && !value.toLowerCase().includes(rule.contains)) continue
    return rule.name
  }
  return undefined
}
