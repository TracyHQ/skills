import type { FetchQueue } from '../fetchQueue'
import { isSameSite } from '../sameSite'

/** What the open web says about a site's agent-facing surface. Written to `surface/ucp.json`. */
export type UcpSurface = {
  /** The profile as served from the site's own origin — the only address an agent is given. */
  brand: UcpProbe
  /**
   * The same profile on the platform origin, when the brand one is missing. Shopify keeps serving
   * it there for a headless store, so finding it is what separates "not agent-ready" from
   * "agent-ready at an address nobody will look up".
   */
  platform?: UcpProbe
  /** The other machine-readable files a platform publishes at the root, probed on the brand origin. */
  agentFiles: { path: string; status: number; json: boolean; redirectedTo?: string }[]
}

export type UcpProbe = {
  origin: string
  status: number
  /** False when the body did not parse, including the 200-and-HTML soft 404. */
  json: boolean
  version?: string
  capabilities: string[]
  paymentHandlers: string[]
  signingKeys: boolean
  /** The MCP endpoint the profile names, which is routinely on another origin. */
  endpoint?: string
  /**
   * Set when the request left the site: whatever answered lives on THIS origin, not the one an
   * agent is given. A 200 read through such a redirect is the origin-split bug wearing a green
   * checkmark — the probe stays unusable and the destination becomes a platform candidate.
   */
  redirectedTo?: string
}

const PROFILE_PATH = '/.well-known/ucp'
const AGENT_FILES = ['/llms.txt', '/agents.md']

/**
 * The agent-facing surface of a Crawl (Domain Language: Surface).
 *
 * Reads only what the open web serves — no credential, no POST. The catalog checks that need a
 * `tools/call` against the merchant's own MCP endpoint are deliberately not here: posting to
 * someone else's commerce endpoint is a different act from crawling, and it needs a rule written
 * down before code does it.
 */
export async function harvestUcp(
  origin: string,
  queue: FetchQueue,
  platformOrigins: string[] = []
): Promise<UcpSurface> {
  const brand = await probeProfile(origin, queue)

  let platform: UcpProbe | undefined
  if (!usable(brand)) {
    // Where the brand probe was redirected is the strongest platform candidate there is —
    // the site itself just pointed at it.
    const candidates = [...(brand.redirectedTo ? [brand.redirectedTo] : []), ...platformOrigins]
    for (const candidate of candidates) {
      if (isSameSite(candidate, origin)) continue
      const probe = await probeProfile(candidate, queue)
      if (usable(probe)) {
        platform = probe
        break
      }
    }
  }

  const agentFiles: UcpSurface['agentFiles'] = []
  for (const path of AGENT_FILES) {
    const outcome = await queue.get(new URL(path, origin).toString())
    const redirectedTo = outcome.ok && !isSameSite(outcome.finalUrl, origin) ? originOf(outcome.finalUrl) : undefined
    agentFiles.push({
      path,
      status: outcome.ok ? 200 : (outcome.status ?? 0),
      json: false,
      ...(redirectedTo ? { redirectedTo } : {})
    })
  }

  return { brand, platform, agentFiles }
}

/** A profile that both answered and parsed — the pair the checks care about, so it is named once. */
export function usable(probe: UcpProbe): boolean {
  return probe.status === 200 && probe.json && probe.version !== undefined
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

async function probeProfile(origin: string, queue: FetchQueue): Promise<UcpProbe> {
  const outcome = await queue.get(new URL(PROFILE_PATH, origin).toString())
  const empty: UcpProbe = {
    origin,
    status: outcome.ok ? 200 : (outcome.status ?? 0),
    json: false,
    capabilities: [],
    paymentHandlers: [],
    signingKeys: false
  }
  if (!outcome.ok) return empty
  if (!isSameSite(outcome.finalUrl, origin)) {
    // Followed off the site: the answer is real, the address is not. See UcpProbe.redirectedTo.
    return { ...empty, redirectedTo: originOf(outcome.finalUrl) }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(outcome.text) as Record<string, unknown>
  } catch {
    // A storefront that answers 200 with its HTML shell for every unknown path. Status alone would
    // read this as a published profile.
    return empty
  }

  const ucp = (parsed.ucp ?? {}) as Record<string, unknown>
  const services = (ucp.services ?? {}) as Record<string, { endpoint?: string }[]>
  const endpoint = Object.values(services)
    .flat()
    .find((s) => typeof s?.endpoint === 'string')?.endpoint

  return {
    origin,
    status: 200,
    json: true,
    version: typeof ucp.version === 'string' ? ucp.version : undefined,
    capabilities: Object.keys((ucp.capabilities ?? {}) as object).sort(),
    paymentHandlers: Object.keys((ucp.payment_handlers ?? {}) as object).sort(),
    signingKeys: Array.isArray(parsed.signing_keys) || Array.isArray(ucp.signing_keys),
    endpoint
  }
}
