import type { UcpSurface } from './harvest/ucp'
import { usable } from './harvest/ucp'
import type { Finding } from './types'

/**
 * The narration script of a Scan — every beat the log can react to, in one file.
 *
 * Each rule maps a measured fact to a note; the note's wording (the surprise, the praise, the
 * alarm) lives in the renderer's i18n under `scan_note.*`. No model anywhere: a beat fires when
 * its number says so, which is what keeps the commentary honest — a line can only ever claim
 * what its rule measured.
 *
 * Harvest tells what was found, analyze tells what it means, this file tells how it lands.
 * Adding a beat is one rule here plus one line of copy per locale.
 */
export type NoteKind =
  | 'sitemap-found'
  | 'sitemap-missing'
  | 'robots-blocks-all'
  | 'catalog-size'
  | 'redirect-stub'
  | 'agent-door-found'
  | 'agent-door-split'
  | 'agent-door-missing'
  | 'agent-files-missing'
  | 'checks-found'
  | 'checks-clean'
  | 'checks-closed'

export type Note = { kind: NoteKind; count?: number }

/** The map handed over, or the shrug: a shop with no sitemap leaves crawlers feeling around. */
export function noteInventory(urls: number): Note {
  return urls > 0 ? { kind: 'sitemap-found', count: urls } : { kind: 'sitemap-missing' }
}

/** Only a catalog that exists is worth admiring out loud. */
export function noteCatalog(products: number): Note | undefined {
  return products > 0 ? { kind: 'catalog-size', count: products } : undefined
}

/** Fires only when robots turned away every single url — a partial block is routine, not a beat. */
export function noteRobots(allowed: number, blocked: number): Note | undefined {
  return allowed === 0 && blocked > 0 ? { kind: 'robots-blocks-all', count: blocked } : undefined
}

/** The double take: the "homepage" answered with a hop page instead of a shopfront. */
export function noteStub(page: { redirectStub?: boolean }): Note | undefined {
  return page.redirectStub ? { kind: 'redirect-stub' } : undefined
}

/**
 * Three endings, and the middle one is the twist: the door exists, on a domain no assistant will
 * ever be told about.
 */
export function noteAgentDoor(ucp: UcpSurface): Note {
  if (usable(ucp.brand)) return { kind: 'agent-door-found' }
  return ucp.platform ? { kind: 'agent-door-split' } : { kind: 'agent-door-missing' }
}

export function noteAgentFiles(ucp: UcpSurface): Note | undefined {
  const missing = ucp.agentFiles.filter((f) => f.status !== 200).length
  return missing > 0 ? { kind: 'agent-files-missing', count: missing } : undefined
}

/** The closing beat: what the whole read added up to. Platform limits are not counted — they are
 *  nobody's fault, so they cannot be the verdict. */
export function noteVerdict(findings: Finding[]): Note {
  const actionable = findings.filter((f) => !f.platformLimit).length
  return actionable > 0 ? { kind: 'checks-found', count: actionable } : { kind: 'checks-clean' }
}

/** The payoff beat: checks the previous Scan raised that this one measured as gone. */
export function noteClosed(closed: number): Note | undefined {
  return closed > 0 ? { kind: 'checks-closed', count: closed } : undefined
}
