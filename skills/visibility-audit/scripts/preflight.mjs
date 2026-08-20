// The lane-impact preflight: before anything is fetched or graded, answer "is there a usable
// key for this lane, and — either way — what does that lane buy". Covers the two lanes that are
// genuinely a CHOICE: the grading LLM (one of ANTHROPIC/OPENAI/GEMINI_API_KEY) and off-store
// (SERPAPI_API_KEY). The page lane needs no key and always runs; MCP is a save step, not a
// scoring lane, and is out of scope here (see SKILL.md P1/P6).
//
// This adds NO new key-probing: `hasKey` is read from the environment the same way `pickRoute`
// (llm.mjs) and `collect-offstore.mjs` already do. SKILL.md's P1 still runs
// `credentials.mjs status` / `check` for the masked display and the "is it still valid" probe —
// this module only answers "what happens to the framework without this lane's key".
//
// Why it exists: "15 criteria go na" and "7 criteria go na" (SKILL.md's own numbers) read as
// interchangeable severity. They are not. `specifications`, `faq-product`, `unique-description`
// and `answer-formatting` are Critical/weight-3 inside the LLM lane; `reddit` and
// `press-and-lists` are Critical/weight-3 inside the off-store lane. A user deciding whether to
// stop and get a key needs to see THAT, not just a denominator — this is what P1 shows before
// Q1 ever asks a question, and it is why a bare `dry-run` still prints it (SKILL.md: the plan is
// never skipped, only the confirm question is).
//
// Usage:
//   node preflight.mjs            # human-readable lines
//   node preflight.mjs --json     # the same data, structured

import { CRITERIA, TOTAL_CRITERIA, globalWeight } from './framework.mjs'
import { CONTENT_LLM_KEYS, VOICE_LLM_KEYS, CREDIBILITY_LLM_KEYS } from './analyze-llm.mjs'
import { ROUTES, ROUTE_KEY_ENV, pickRoute } from './llm.mjs'
import { isMainModule, parseArgv } from './util.mjs'

// The 15 LLM-graded criteria — reused from analyze-llm.mjs's own exports rather than re-typed
// here, so the two lists cannot drift apart silently.
export const LLM_LANE_CRITERIA = [...CONTENT_LLM_KEYS, ...VOICE_LLM_KEYS, ...CREDIBILITY_LLM_KEYS]

// The 7 off-store criteria. Nothing in scorers.mjs tags a criterion with which lane feeds it, so
// this is transcribed by hand from the scorers that read `ctx.offStore.*` / `ctx.feed.*` (each
// one's `na` reason there literally says "No <X> data collected") — the same 7 SKILL.md's "What
// each lane buys" table already names. Keep the two lists in sync if either changes.
export const OFFSTORE_LANE_CRITERIA = [
  'reddit',
  'trustpilot',
  'google-reviews',
  'social-video-mentions',
  'press-and-lists',
  'entity-databases',
  'google-merchant-feed',
]

/**
 * What a set of criteria is worth: how many, which are Critical impact, and their combined
 * share of the 100-point global weight. Pure lookup over `framework.mjs` — no scoring, no
 * measurement, just "what this lane's key would have bought".
 */
export function laneImpact(keys) {
  const rows = keys.map((key) => {
    const def = CRITERIA[key]
    if (!def) throw new Error(`preflight: '${key}' is not a criterion in framework.mjs`)
    return { key, weight: def.weight, impact: def.impact, globalWeightPct: globalWeight(key) }
  })
  const criticalKeys = rows.filter((r) => r.impact === 'Critical').map((r) => r.key)
  const weightPct = Math.round(rows.reduce((sum, r) => sum + r.globalWeightPct, 0) * 10) / 10
  return { count: rows.length, criticalKeys, weightPct, rows }
}

/**
 * The grading-LLM lane's preflight: which provider (if any) is usable, and what is lost without
 * one. `hasKey`/`route` come straight from `pickRoute`, the same function `analyze-llm.mjs`
 * itself uses to choose a provider — this never disagrees with what the run would actually do.
 */
export function llmLanePreflight(env = process.env) {
  const route = pickRoute(env)
  return {
    lane: 'llm',
    hasKey: route !== null,
    route,
    storedProviders: ROUTES.filter((r) => (env[ROUTE_KEY_ENV[r]] ?? '').trim() !== ''),
    impact: laneImpact(LLM_LANE_CRITERIA),
  }
}

/** The off-store lane's preflight: SerpApi is the only route there is (see collect-offstore.mjs). */
export function offstoreLanePreflight(env = process.env) {
  const hasKey = typeof env.SERPAPI_API_KEY === 'string' && env.SERPAPI_API_KEY.trim() !== ''
  return { lane: 'offstore', hasKey, impact: laneImpact(OFFSTORE_LANE_CRITERIA) }
}

/** Both lanes together, plus the ceiling on how many of the 40 criteria this run can possibly score. */
export function preflight(env = process.env) {
  const llm = llmLanePreflight(env)
  const offstore = offstoreLanePreflight(env)
  const lostToMissingKeys = (llm.hasKey ? 0 : llm.impact.count) + (offstore.hasKey ? 0 : offstore.impact.count)
  return {
    llm,
    offstore,
    totalCriteria: TOTAL_CRITERIA,
    // A ceiling, not a prediction: the page lane can still add its own `na`/`gated` rows (a
    // 404'd policy page, a non-English `reddit`/`trustpilot` gate) on top of this.
    maxScoreable: TOTAL_CRITERIA - lostToMissingKeys,
  }
}

function laneLine(p) {
  const label = p.lane === 'llm' ? 'Grading LLM' : 'Off-store'
  if (p.hasKey) {
    const who = p.lane === 'llm' ? p.route : 'serpapi'
    return `${label}: ${who} key present — up to ${p.impact.count} criteria scoreable (~${p.impact.weightPct}% of total weight)`
  }
  const critical = p.impact.criticalKeys
  const criticalNote = critical.length
    ? `, including ${critical.length} Critical criteri${critical.length === 1 ? 'on' : 'a'}: ${critical.join(', ')}`
    : ''
  return (
    `${label}: no key — ${p.impact.count} criteria go na (~${p.impact.weightPct}% of total weight)` +
    `${criticalNote}. Supply a key, or proceed and score without this lane.`
  )
}

export function main(argv, env = process.env) {
  const a = parseArgv(argv)
  const result = preflight(env)
  if (a.json) return JSON.stringify(result, null, 2)
  return [
    laneLine(result.llm),
    laneLine(result.offstore),
    `Scoreable this run: up to ${result.maxScoreable}/${result.totalCriteria} (page-lane na/gated not counted yet)`,
  ].join('\n')
}

if (isMainModule(import.meta.url)) {
  console.log(main(process.argv.slice(2)))
}
