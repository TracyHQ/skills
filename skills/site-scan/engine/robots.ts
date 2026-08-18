export type RobotsRules = {
  isAllowed(path: string): boolean
  crawlDelayMs: number | undefined
  sitemaps: string[]
}

type Group = { agents: string[]; allow: string[]; disallow: string[]; crawlDelay?: number }

/**
 * Minimal REP parser for the crawler (spec §5): user-agent groups (the specific
 * agent's group beats `*`), longest-match rule wins, Allow beats Disallow on a
 * length tie. Wildcard `*`/`$` patterns inside paths are NOT supported — plain
 * prefix matching is enough for P1; an unsupported pattern simply matches as a
 * literal prefix and errs on the permissive side.
 */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const groups: Group[] = []
  const sitemaps: string[] = []
  let current: Group | undefined
  let currentOpenForAgents = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (field === 'sitemap') {
      if (value) sitemaps.push(value)
      continue
    }
    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group; a rule line closes the run.
      if (!current || !currentOpenForAgents) {
        current = { agents: [], allow: [], disallow: [] }
        groups.push(current)
        currentOpenForAgents = true
      }
      current.agents.push(value.toLowerCase())
      continue
    }
    if (!current) continue
    currentOpenForAgents = false
    if (field === 'disallow') {
      if (value) current.disallow.push(value)
      continue
    }
    if (field === 'allow') {
      if (value) current.allow.push(value)
      continue
    }
    if (field === 'crawl-delay') {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed >= 0) current.crawlDelay = parsed
    }
  }

  const ua = userAgent.toLowerCase()
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.startsWith(a)))
  const wildcard = groups.filter((g) => g.agents.includes('*'))
  const active = specific.length > 0 ? specific : wildcard

  const allow = active.flatMap((g) => g.allow)
  const disallow = active.flatMap((g) => g.disallow)
  const crawlDelay = active.map((g) => g.crawlDelay).find((d) => d !== undefined)

  return {
    isAllowed(path: string): boolean {
      const longestMatch = (rules: string[]) =>
        rules.reduce((best, rule) => (path.startsWith(rule) && rule.length > best ? rule.length : best), 0)
      const allowLen = longestMatch(allow)
      const disallowLen = longestMatch(disallow)
      return allowLen >= disallowLen
    },
    crawlDelayMs: crawlDelay === undefined ? undefined : crawlDelay * 1000,
    sitemaps
  }
}
