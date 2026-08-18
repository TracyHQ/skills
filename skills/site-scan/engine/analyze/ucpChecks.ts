import type { UcpSurface } from '../harvest/ucp'
import { usable } from '../harvest/ucp'
import type { Finding } from '../types'

/**
 * The agent-facing Checks (Domain Language: Check → Finding).
 *
 * Every one of these is answered by a GET on the open web, so they run on any site without a
 * credential. The catalog checks — is a product visible, does the agent get the local price —
 * need a `tools/call` against the merchant's own endpoint and are not here yet.
 *
 * Two of them carry `platformLimit`. Shopify serves one profile shape to every store, so a field
 * missing from all of them is the platform's decision, not the merchant's, and scoring it would be
 * charging a merchant for something no merchant can change.
 */
type UcpCheck = {
  id: string
  title: (surface: UcpSurface) => string
  priority: 1 | 2 | 3
  platformLimit?: true
  /** The evidence lines, or none when the check passes. At most a handful — these are site-level. */
  evidence: (surface: UcpSurface) => string[]
}

const CHECKS: UcpCheck[] = [
  {
    id: 'ucp-profile-unreachable',
    title: () => 'AI cannot find an entrance on your own domain',
    priority: 1,
    evidence: ({ brand, platform }) => {
      if (usable(brand)) return []
      const lines = [`${brand.origin}/.well-known/ucp → ${describe(brand)}`]
      if (platform) lines.push(`${platform.origin}/.well-known/ucp → 200, the profile is there instead`)
      return lines
    }
  },
  {
    id: 'ucp-origin-split',
    title: () => 'Your agent profile lives on the checkout domain, not your brand domain',
    priority: 2,
    evidence: ({ brand, platform }) =>
      !usable(brand) && platform ? [`agents are told ${brand.origin}, the profile answers on ${platform.origin}`] : []
  },
  {
    id: 'ucp-agent-files-missing',
    title: (surface) => `Agent instruction files missing (${missingFiles(surface).length} of 2)`,
    priority: 2,
    evidence: (surface) =>
      missingFiles(surface).map(
        (f) =>
          `${f.path} → ${f.redirectedTo ? `redirects off your domain, to ${f.redirectedTo}` : f.status || 'unreachable'}`
      )
  },
  {
    id: 'ucp-signing-keys-absent',
    title: () => 'The profile is unsigned — an agent cannot prove it came from you',
    priority: 3,
    platformLimit: true,
    evidence: (surface) => {
      const profile = active(surface)
      return profile && !profile.signingKeys ? ['no signing_keys — Shopify does not publish them for any store'] : []
    }
  }
]

export function runUcpChecks(surface: UcpSurface): Finding[] {
  const findings: Finding[] = []
  for (const check of CHECKS) {
    const evidence = check.evidence(surface)
    if (evidence.length === 0) continue
    findings.push({
      checkId: check.id,
      title: check.title(surface),
      count: evidence.length,
      priority: check.priority,
      urls: evidence,
      ...(check.platformLimit ? { platformLimit: true as const } : {})
    })
  }
  return findings.sort((a, b) => a.priority - b.priority)
}

/** Whichever profile actually answered — the brand one if it works, else the platform fallback. */
function active(surface: UcpSurface) {
  if (usable(surface.brand)) return surface.brand
  return surface.platform && usable(surface.platform) ? surface.platform : undefined
}

/** A file that answered through an off-site redirect is not served on the brand origin. */
function missingFiles(surface: UcpSurface) {
  return surface.agentFiles.filter((f) => f.status !== 200 || f.redirectedTo)
}

function describe(probe: { status: number; json: boolean; redirectedTo?: string }): string {
  if (probe.redirectedTo) return `redirects off your domain, to ${probe.redirectedTo}`
  if (probe.status !== 200) return String(probe.status || 'unreachable')
  return probe.json ? '200 but no ucp.version' : '200 but not JSON'
}
