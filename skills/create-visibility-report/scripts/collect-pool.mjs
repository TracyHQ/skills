// Fan out P4 collection across a whole grid with the concurrency caps SKILL.md prescribes,
// instead of the agent hand-rolling `launch each … & … wait` per run. It does not change what a
// cell costs, only how many run at once — and collection is where the wall-clock of a run goes.
//
// Every route here is an API key, so the whole grid goes through this script: the three model
// engines on `api` and google_ai_mode on `serpapi`. There is no route the agent has to collect
// by hand alongside it.
//
// Usage:
//   node collect-pool.mjs --grid "$RUN/grid.json" [--concurrency api=4,serpapi=4]
//
// --grid <file> is REQUIRED — there is no default and nothing is discovered; the caller (SKILL.md
// P4) builds grid.json itself from the approved prompts (Q2) and the live grid, and writes it to
// the run directory ($RUN, see RECOVERY.md "The run directory") before calling this script.
//
// grid.json is an array of jobs:
//   { "route": "api", "provider": "anthropic", "model": "<grid apiModelId>", "platform": "claude",
//     "intent": "where_to_buy", "prompt": "...", "out": "$RUN/cells/where_to_buy.claude.json" }
//   { "route": "api", "provider": "openai", "model": "gpt-5.5", "platform": "chatgpt", ... }
//   { "route": "api", "provider": "gemini", "model": "gemini-3.5", "platform": "gemini", ... }
//   { "route": "serpapi", "hl": "ar", "gl": "SA", "location": "Riyadh", "intent": "...",
//     "platform": "google_ai_mode", "prompt": "...", "out": "..." }
//     — "location" is OPTIONAL (Q1's city question, SKILL.md P2 "City"); omit it for the
//     country-level default. It threads straight to collect-serpapi.mjs's own --location.
//   Every job may also carry "timeoutMs" (passed through as --timeout-ms to the collector; see
//   collect-api.mjs's DEFAULT_TIMEOUT_MS for what happens when it's omitted).
//
// Each job is handed to the matching collect-*.mjs unchanged — this script only pools and
// retries at the process level; the collectors keep their own retry/backoff for 429/503
// (RECOVERY.md "Collection failures"). One outer retry catches the rest (a killed process, a
// bad flag) before a cell is reported failed. A cell that fails twice is left `failed` for the
// agent to triage per RECOVERY.md — never silently dropped, never retried forever.
//
// Prints a JSON summary to stdout: { total, ok, failed: [{ job, log }], durationMs }. Exits 1 if
// any cell is still failed after its retry. Per-job stdout+stderr is written to
// "<run dir>/logs/<cell file>.log" (a SIBLING of `job.out`'s directory, never inside it) — RECOVERY.md
// requires `cells/` to hold nothing but cell files, so a job's own output never lands next to it.

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl)
  } catch {
    return false
  }
}

const HERE = dirname(fileURLToPath(import.meta.url))

// SKILL.md P4: API and SerpApi tolerate 4-6 concurrent per key. Conservative end as the default,
// and the pool is per provider (see `poolKeyFor`) so one provider's rate limit cannot stall the
// others' cells.
export const DEFAULT_CONCURRENCY = { api: 4, serpapi: 4 }

export function parseArgs(argv) {
  const out = { grid: null, concurrency: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    const rawKey = eq === -1 ? a.slice(2) : a.slice(2, eq)
    let val
    if (eq !== -1) val = a.slice(eq + 1)
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) val = argv[++i]
    if (val === undefined) continue
    if (rawKey === 'grid') out.grid = val
    if (rawKey === 'concurrency') {
      for (const pair of val.split(',')) {
        const [k, v] = pair.split('=')
        if (k && v) out.concurrency[k.trim()] = Number(v)
      }
    }
  }
  return out
}

const SCRIPT_BY_ROUTE = {
  api: 'collect-api.mjs',
  serpapi: 'collect-serpapi.mjs',
}

export function poolKeyFor(job) {
  if (job.route === 'api') return `api:${job.provider}` // one pool per provider key
  return job.route // 'serpapi' — a single key, a single pool
}

// route-family prefix used to look up the concurrency cap ('api:openai' -> 'api').
function routeFamily(poolKey) {
  return poolKey.split(':')[0]
}

export function buildArgs(job) {
  if (!SCRIPT_BY_ROUTE[job.route]) throw new Error(`unknown route "${job.route}" (want api|serpapi)`)
  const common = ['--intent', job.intent, '--out', job.out]
  if (job.platform) common.push('--platform', job.platform)
  if (job.timeoutMs) common.push('--timeout-ms', String(job.timeoutMs))
  if (job.route === 'api') {
    if (!job.provider || !job.model) throw new Error(`api job for intent "${job.intent}" needs "provider" and "model"`)
    return ['--provider', job.provider, '--model', job.model, ...common]
  }
  // serpapi
  if (!job.hl || !job.gl) throw new Error(`serpapi job for intent "${job.intent}" needs "hl" and "gl"`)
  const serpArgs = ['--hl', job.hl, '--gl', job.gl]
  // Optional — Q1's city question (SKILL.md P2 "City"). Country-level stays the default when a
  // job carries no location, exactly like every other engine.
  if (job.location) serpArgs.push('--location', job.location)
  return [...serpArgs, ...common]
}

// Runs one job as a child process, prompt on stdin, stdout+stderr captured in-memory (written to
// disk by runJob, below, via logPathFor — never next to `job.out` itself).
// Injectable `spawnFn` for tests — default is the real node:child_process.spawn.
export function runOnce(job, { spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    const script = join(HERE, SCRIPT_BY_ROUTE[job.route])
    const args = buildArgs(job)
    const child = spawnFn('node', [script, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let log = ''
    child.stdout.on('data', (d) => { log += d })
    child.stderr.on('data', (d) => { log += d })
    child.on('error', (e) => resolve({ ok: false, log: log + String(e.message) }))
    child.on('close', (code) => resolve({ ok: code === 0, log }))
    child.stdin.write(job.prompt ?? '')
    child.stdin.end()
  })
}

// RECOVERY.md: "cells/ — one <intent>.<platform>.json per cell — nothing else in here", enforced
// by submit.mjs treating every *.json there as a cell. So the pool's own retry log for a job
// cannot live next to `job.out` — it goes into a sibling "logs/" directory instead, one level up
// from wherever `job.out`'s parent (normally "cells/") sits: "<run dir>/cells/x.json" logs to
// "<run dir>/logs/x.json.log".
export function logPathFor(out) {
  return join(dirname(out), '..', 'logs', `${basename(out)}.log`)
}

export async function runJob(job, deps = {}) {
  let result = await runOnce(job, deps)
  let attempts = 1
  if (!result.ok) {
    await new Promise((r) => setTimeout(r, deps.retryDelayMs ?? 3000))
    result = await runOnce(job, deps)
    attempts = 2
  }
  const logPath = logPathFor(job.out)
  if (!deps.skipLogWrite) {
    try {
      mkdirSync(dirname(logPath), { recursive: true })
      writeFileSync(logPath, result.log)
    } catch { /* best-effort — a bad --out dir surfaces via the job's own failure */ }
  }
  return { job, ok: result.ok, attempts, log: logPath }
}

// A tiny concurrency-limited map: at most `limit` promises from `worker` in flight at once.
async function mapPool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function lane() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return results
}

export async function runGrid(jobs, { concurrency = {}, ...deps } = {}) {
  const caps = { ...DEFAULT_CONCURRENCY, ...concurrency }
  const groups = new Map()
  for (const job of jobs) {
    const key = poolKeyFor(job)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(job)
  }
  const started = Date.now()
  const perGroup = await Promise.all(
    [...groups.entries()].map(([key, group]) => mapPool(group, caps[routeFamily(key)] ?? 4, (j) => runJob(j, deps))),
  )
  const results = perGroup.flat()
  return {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).map((r) => ({ job: r.job, log: r.log })),
    durationMs: Date.now() - started,
  }
}

export async function main(argv, deps = {}) {
  const a = parseArgs(argv)
  if (!a.grid) throw new Error('--grid <file> is required')
  const jobs = JSON.parse(readFileSync(a.grid, 'utf8'))
  if (!Array.isArray(jobs)) throw new Error('grid file must be a JSON array of jobs')
  return runGrid(jobs, { concurrency: a.concurrency, ...deps })
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2))
    .then((r) => {
      console.log(JSON.stringify(r, null, 2))
      if (r.failed.length) process.exit(1)
    })
    .catch((e) => { console.error(e.message); process.exit(1) })
}
