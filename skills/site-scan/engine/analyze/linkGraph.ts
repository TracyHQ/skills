import type { PageRecord } from '../types'

export type LinkGraph = {
  orphans: string[]
  depthByUrl: Record<string, number>
  brokenInternal: { from: string; to: string; status: number }[]
  headChecksSkipped: number
}

const DEFAULT_MAX_HEAD_CHECKS = 100

/**
 * The internal link graph (spec §6): click depth by BFS from the shortest url
 * (the homepage), orphan pages nothing links to, and broken internal links —
 * links pointing outside the crawled set get a HEAD check, capped because a
 * link-heavy site could otherwise turn verification into a second crawl.
 */
export async function analyzeLinkGraph(
  pages: PageRecord[],
  opts: { headCheck?: (url: string) => Promise<number>; maxHeadChecks?: number }
): Promise<LinkGraph> {
  const known = new Map(pages.map((p) => [p.url, p]))
  const incoming = new Set<string>()
  for (const p of pages) for (const link of p.internalLinks) incoming.add(link)

  const root = pages.map((p) => p.url).sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
  const depthByUrl: Record<string, number> = {}
  if (root !== undefined) {
    const queue: { url: string; depth: number }[] = [{ url: root, depth: 0 }]
    while (queue.length > 0) {
      const { url, depth } = queue.shift()!
      if (depthByUrl[url] !== undefined) continue
      depthByUrl[url] = depth
      for (const link of known.get(url)?.internalLinks ?? []) {
        if (known.has(link) && depthByUrl[link] === undefined) queue.push({ url: link, depth: depth + 1 })
      }
    }
  }

  const orphans = pages.map((p) => p.url).filter((url) => url !== root && !incoming.has(url))

  const brokenInternal: LinkGraph['brokenInternal'] = []
  let headChecksSkipped = 0
  if (opts.headCheck) {
    const maxHeadChecks = opts.maxHeadChecks ?? DEFAULT_MAX_HEAD_CHECKS
    const unknownTargets = new Map<string, string>() // target -> first source
    for (const p of pages) {
      for (const link of p.internalLinks) {
        if (!known.has(link) && !unknownTargets.has(link)) unknownTargets.set(link, p.url)
      }
    }
    const targets = [...unknownTargets.entries()]
    headChecksSkipped = Math.max(0, targets.length - maxHeadChecks)
    for (const [target, from] of targets.slice(0, maxHeadChecks)) {
      const status = await opts.headCheck(target)
      if (status >= 400) brokenInternal.push({ from, to: target, status })
    }
  }

  return { orphans, depthByUrl, brokenInternal, headChecksSkipped }
}
