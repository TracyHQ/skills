// Turns `credentials.mjs check`'s per-key text lines into the one decision this skill's Q1 exists
// to make: which engines does THIS run declare. Nothing here talks to a network — it is the pure
// logic behind "missing key is a conversation, not a dead end" (SKILL.md, Credentials).
//
// The owner's rule, stated plainly: when a key is missing, the skill tells the user which engine
// has none and offers exactly two real choices — supply it now, or skip that engine for this run.
// Never silently skip (an engine that quietly drops out is a hole nobody agreed to), never
// silently fail (a missing key is not a reason to stop measuring the other three).
//
// A **declared** platform is one this run promises to collect and submit for. The backend's own
// integrity rule (told to us, not derived by us — a parallel change makes it accept a submission
// naming FEWER than 4 platforms) is: whatever you declare must have no holes — every declared
// platform × every declared intent needs a cell. This file is what keeps that promise: it turns
// "engine X has no key" into either "not declared" (skip) or "blocked" (nobody decided yet) —
// never into a declared platform with empty cells, and never into a platform that reappears in the
// grid after being skipped (see `assertRectangularGrid`).
//
// Usage (as a library — SKILL.md P1/Q1 calls these, there is no CLI here):
//   import { ENGINES, engineStatuses, resolveDeclaredPlatforms, assertRectangularGrid }
//     from './engine-preflight.mjs'
//   const statuses = engineStatuses((await credentialsCheck()).split('\n'))
//   const { declared, skipped, blocked } = resolveDeclaredPlatforms({ statuses, decisions })

// One route per engine (SKILL.md "Clean-room collection" / ARGUMENTS.md) — this table is the
// entire routing problem, so it is the entire input to preflight too.
export const ENGINES = [
  { engine: 'chatgpt', key: 'OPENAI_API_KEY' },
  { engine: 'claude', key: 'ANTHROPIC_API_KEY' },
  { engine: 'gemini', key: 'GEMINI_API_KEY' },
  { engine: 'google_ai_mode', key: 'SERPAPI_API_KEY' },
]

// Mirrors credentials.mjs's six-state vocabulary (scripts/credentials.mjs `check()`), read back
// out of its printed lines rather than re-implemented — this file must classify exactly what that
// one prints, not a paraphrase of it, or the two can drift silently.
export function parseCheckLine(line) {
  const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(String(line ?? '').trim())
  if (!m) return null
  const [, name, rest] = m
  let state
  if (/^missing\b/.test(rest)) state = 'missing'
  else if (/^ok\b/.test(rest)) state = 'ok'
  else if (/^REJECTED\b/.test(rest)) state = 'rejected'
  else if (/^inconclusive\b/.test(rest)) state = 'inconclusive'
  else if (/^unreachable\b/.test(rest)) state = 'unreachable'
  else if (/not probed here/.test(rest)) state = 'not-probed'
  else state = 'unknown'
  return { name, state, detail: rest }
}

// One status per ENGINE (not per key — MENTION_NETWORK_KEY is deliberately not in this table; it
// gates storage, not measurement, see SKILL.md "MCP is for storage"). A key `credentials.mjs`
// never mentioned at all reads as `missing`, the same as an explicit "missing" line — a key this
// run never checked is exactly as un-ready as one that was checked and found absent.
export function engineStatuses(checkLines, engines = ENGINES) {
  const byKey = new Map()
  for (const line of checkLines ?? []) {
    const parsed = parseCheckLine(line)
    if (parsed) byKey.set(parsed.name, parsed)
  }
  const out = {}
  for (const { engine, key } of engines) {
    const parsed = byKey.get(key)
    out[engine] = { key, state: parsed?.state ?? 'missing', detail: parsed?.detail ?? 'not checked this run' }
  }
  return out
}

// `inconclusive` (usually a 429) and `unreachable` (network) are NOT verdicts on the key —
// SETUP-ROUTES.md and RECOVERY.md both say retry before saying anything about the key. So they
// are not "ready", but they are also not the two states a Q1 gap conversation is about.
export const READY_STATE = 'ok'
export const RETRY_STATES = new Set(['inconclusive', 'unreachable'])
export const GAP_STATES = new Set(['missing', 'rejected'])

// Every engine whose key is not (yet) usable, with the two states Q1 must turn into a decision
// separated from the two that just need a retry first.
export function classifyGaps(statuses) {
  const gaps = []
  const retry = []
  for (const [engine, status] of Object.entries(statuses)) {
    if (status.state === READY_STATE) continue
    if (RETRY_STATES.has(status.state)) retry.push({ engine, ...status })
    else gaps.push({ engine, ...status }) // missing, rejected, unknown — all need a real decision
  }
  return { gaps, retry }
}

/**
 * The declared/skipped/blocked split Q1 produces.
 *
 * `decisions[engine]` is the user's answer for any engine that is not already `ok`:
 *   - 'skip'    → the user chose to run without it this time. Carries a `reason` for the report.
 *   - 'include' → the user says collect it anyway; only legal when the status IS 'ok' (a key
 *                 that started working between the two checks). Forcing a not-ok engine into
 *                 'include' is refused — that is exactly the silent hole this file exists to stop.
 *   - absent    → no decision yet. The engine is `blocked`, not silently declared and not
 *                 silently dropped — SKILL.md: "never silently skip, never silently fail."
 *
 * An engine that IS ok needs no decision at all: it declares itself, unless the user actively
 * chose to skip it (their call, always allowed).
 */
export function resolveDeclaredPlatforms({ statuses, decisions = {} }) {
  const declared = []
  const skipped = []
  const blocked = []
  for (const [engine, status] of Object.entries(statuses)) {
    const decision = decisions[engine]
    if (decision === 'skip') {
      skipped.push({ engine, key: status.key, state: status.state, reason: decisions[`${engine}Reason`] ?? `skipped by the user at Q1 (${status.key}: ${status.state})` })
      continue
    }
    if (status.state === READY_STATE) {
      declared.push(engine)
      continue
    }
    if (decision === 'include') {
      blocked.push({ engine, key: status.key, state: status.state, reason: `cannot declare ${engine} — ${status.key} is "${status.state}", not ok; add a working key or skip this engine` })
      continue
    }
    blocked.push({ engine, key: status.key, state: status.state, reason: `no decision yet for ${engine} (${status.key}: ${status.state}) — ask: supply the key now, or skip this engine for this run` })
  }
  return { declared, skipped, blocked }
}

/**
 * The backend's integrity rule, checked locally before a network round-trip spends it: every
 * DECLARED platform × every DECLARED intent has exactly one cell, and no cell exists for a
 * platform or intent that was never declared. That second half is what stops a skipped engine
 * from "reappearing" — a stray cell for an engine the user chose to skip is caught here as an
 * `extraPlatforms` violation, the same class of bug as a hole, not a bonus.
 */
export function assertRectangularGrid(cells, { declaredPlatforms, declaredIntents }) {
  const seen = new Set()
  const extraPlatforms = new Set()
  const extraIntents = new Set()
  for (const cell of cells ?? []) {
    const p = cell.platformSlug
    const i = cell.intentSlug
    if (!declaredPlatforms.includes(p)) extraPlatforms.add(p)
    if (!declaredIntents.includes(i)) extraIntents.add(i)
    seen.add(`${p}::${i}`)
  }
  const holes = []
  for (const p of declaredPlatforms) {
    for (const i of declaredIntents) {
      if (!seen.has(`${p}::${i}`)) holes.push({ platform: p, intent: i })
    }
  }
  return {
    ok: holes.length === 0 && extraPlatforms.size === 0 && extraIntents.size === 0,
    holes,
    extraPlatforms: [...extraPlatforms],
    extraIntents: [...extraIntents],
  }
}

// One line per gap engine, in the wording Q1 shows on the card — supply or skip, never a silent
// third thing. Kept here (not just in SKILL.md prose) so the wording the skill actually prints is
// the wording this file's tests pin, not a paraphrase an agent reconstructs from memory each run.
export function gapLine({ engine, key, state }) {
  const setup = {
    OPENAI_API_KEY: 'platform.openai.com → API keys (metered, no free tier)',
    ANTHROPIC_API_KEY: 'console.anthropic.com → API keys (metered, no free tier)',
    GEMINI_API_KEY: 'aistudio.google.com → Get API key (free tier)',
    SERPAPI_API_KEY: 'serpapi.com → Dashboard (free ~100 searches/month) — the ONLY route to google_ai_mode, there is no alternative engine to fall back to',
  }[key]
  const problem = state === 'rejected' ? `${key} was rejected (wrong, revoked, or out of quota)` : `no ${key} stored`
  return `${engine}: ${problem}. Supply it now (${setup}) or skip ${engine} for this run — an engine nobody saw an answer from will say so plainly in the report, not read as a zero.`
}
