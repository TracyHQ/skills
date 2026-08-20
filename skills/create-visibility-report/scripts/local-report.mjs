// Build the local artifact this skill now produces on every run — collection, detection and
// analysis are all local (SKILL.md "Local-first"), so the record of what they found must not live
// only in $RUN/cells/*.json until an MCP submit happens to succeed. This script reads what P4/P4.5
// already wrote to disk and renders one Markdown file; it makes no network call and needs no key.
//
// What this file deliberately does NOT do: compute a visibility score or an overall verdict. That
// number is the backend's own (private) formula — reproducing it here would be inventing scoring
// weights this repository was never given, which SKILL.md and this task both rule out. What it DOES
// report is arithmetic anyone can check against `cells/*.json` by eye: whether the target shop was
// named in each answer, and at what position — plus the real denominator of how many engines were
// even asked. See ANALYSIS.md for how `detection` itself gets produced.
//
// Usage:
//   node local-report.mjs --cells "$RUN/cells/" --meta "$RUN/meta.json" --state "$RUN/state.json" \
//     --out "$RUN/report.md"
//
// state.json (RECOVERY.md "The run directory") carries the two fields this script reads that
// nothing else in the pipeline needs: `declaredPlatforms` (the Q1 decision — which engines this
// run measures) and `skippedEngines` (why each one that isn't declared was left out). Falls back
// to inferring `declaredPlatforms` from the cells actually on disk when state.json predates this
// field, so an older run directory still renders something rather than throwing.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Same symlink trap as the sibling scripts — see submit.mjs's comment for why realpath is needed
// on both sides.
function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl)
  } catch {
    return false
  }
}

export const ALL_ENGINES = ['chatgpt', 'claude', 'gemini', 'google_ai_mode']

export function parseArgs(argv) {
  const out = { cells: null, meta: null, state: null, out: null }
  const keys = new Set(['cells', 'meta', 'state', 'out'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq)
    if (!keys.has(key)) continue
    let val
    if (eq !== -1) val = a.slice(eq + 1)
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) val = argv[++i]
    if (val !== undefined) out[key] = val
  }
  return out
}

export function loadCells(cellsPath) {
  const st = statSync(cellsPath)
  if (!st.isDirectory()) {
    const j = JSON.parse(readFileSync(cellsPath, 'utf8'))
    return Array.isArray(j) ? j : [j]
  }
  return readdirSync(cellsPath)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(cellsPath, f), 'utf8')))
}

/**
 * The line the owner's decision requires on every local report: the real denominator, stated
 * plainly, never a footnote appended to a claim of full coverage. `skipped` entries carry the
 * `reason` produced by `engine-preflight.mjs`'s `resolveDeclaredPlatforms` — printed verbatim so
 * the report says *why*, not just *that*, an engine went unmeasured.
 */
export function coverageLine({ declaredPlatforms, skipped = [], allEngines = ALL_ENGINES }) {
  const measured = allEngines.filter((e) => declaredPlatforms.includes(e))
  const notMeasured = allEngines.filter((e) => !declaredPlatforms.includes(e))
  const reasonFor = (engine) => skipped.find((s) => s.engine === engine)?.reason ?? 'not declared this run'
  const head = `Measured ${measured.length} of ${allEngines.length} engines: ${measured.join(', ') || '(none)'}.`
  if (notMeasured.length === 0) return head
  return `${head} Not measured: ${notMeasured.map((e) => `${e} (${reasonFor(e)})`).join('; ')}.`
}

// One cell's facts, read straight off `detection` — no scoring, just "where did the target shop
// first appear, if at all" (SKILL.md/ANALYSIS.md: `position` is a plain function of first
// appearance, `isTargetShop` is the one-flag-per-cell rule DETECTION_MULTIPLE_TARGETS enforces).
export function cellVerdict(cell) {
  const merchants = cell.detection?.merchants ?? []
  const flagged = merchants.find((m) => m.isTargetShop)
  const top = merchants
    .slice()
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
    .slice(0, 3)
    .map((m) => ({ name: m.name, domain: m.domain ?? null, position: m.position ?? null }))
  return {
    platform: cell.platformSlug,
    intent: cell.intentSlug,
    hasDetection: Boolean(cell.detection),
    targetMentioned: Boolean(flagged),
    targetPosition: flagged?.position ?? null,
    merchantCount: merchants.length,
    topMerchants: top,
  }
}

export function renderReportMarkdown({ meta, cells, declaredPlatforms, skipped = [], submission = null, generatedAt = new Date() }) {
  const shop = meta?.shop?.name ?? meta?.shopDomain ?? '(unknown shop)'
  const product = meta?.product?.title ?? '(unknown product)'
  const market = [meta?.locationCountry, meta?.locationCity, meta?.language].filter(Boolean).join(' · ') || '(unset)'

  const lines = []
  lines.push('# AI Visibility — local report')
  lines.push('')
  lines.push(`Generated ${generatedAt.toISOString()} · this file is produced entirely on this machine — nothing here required MENTION_NETWORK_KEY or a submit.`)
  lines.push('')
  lines.push(`**Shop:** ${shop}  `)
  lines.push(`**Product:** ${product}  `)
  lines.push(`**Market:** ${market}`)
  lines.push('')
  lines.push(coverageLine({ declaredPlatforms, skipped }))
  lines.push('')
  if (submission?.reportId) {
    lines.push(
      `Submitted to Mention Network — checkRunId \`${submission.checkRunId ?? '(unknown)'}\`, reportId \`${submission.reportId}\`. ` +
        'The hosted report carries the official score/verdict; this file is a local supplement, not a replacement.',
    )
  } else {
    lines.push(
      'Not submitted to Mention Network. This file is the whole deliverable for now — it carries no ' +
        'official score or verdict, only facts read directly off each answer (target-shop position, ' +
        'competitors named). Run P6 when ready to store it and get the hosted PDF.',
    )
  }
  lines.push('')
  lines.push('| Intent | Platform | Target position | Merchants seen | Top merchants |')
  lines.push('|---|---|---|---|---|')
  for (const cell of cells) {
    const v = cellVerdict(cell)
    const pos = !v.hasDetection ? '(not analyzed)' : v.targetMentioned ? `#${v.targetPosition}` : 'not listed'
    const top = v.topMerchants.map((m) => m.name).join(', ') || '—'
    lines.push(`| ${v.intent} | ${v.platform} | ${pos} | ${v.merchantCount} | ${top} |`)
  }
  lines.push('')
  return lines.join('\n')
}

export function main(argv) {
  const a = parseArgs(argv)
  for (const k of ['cells', 'meta', 'state', 'out']) {
    if (!a[k]) throw new Error(`--${k} is required`)
  }
  const cells = loadCells(a.cells)
  const meta = JSON.parse(readFileSync(a.meta, 'utf8'))
  const state = JSON.parse(readFileSync(a.state, 'utf8'))
  const declaredPlatforms = Array.isArray(state.declaredPlatforms)
    ? state.declaredPlatforms
    : [...new Set(cells.map((c) => c.platformSlug))] // older state.json predating this field
  const skipped = Array.isArray(state.skippedEngines) ? state.skippedEngines : []
  const submission = state.checkRunId || state.reportId ? { checkRunId: state.checkRunId ?? null, reportId: state.reportId ?? null } : null

  const markdown = renderReportMarkdown({ meta, cells, declaredPlatforms, skipped, submission })
  mkdirSync(dirname(a.out), { recursive: true })
  writeFileSync(a.out, markdown)
  return { out: a.out, declaredPlatforms, skipped: skipped.length, cells: cells.length }
}

if (isMainModule(import.meta.url)) {
  try {
    const r = main(process.argv.slice(2))
    console.log(`${r.out} — ${r.cells} cell(s), ${r.declaredPlatforms.length} engine(s) declared, ${r.skipped} skipped`)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
