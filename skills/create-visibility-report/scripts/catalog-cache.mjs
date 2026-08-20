// A dated, local copy of whatever the MCP's live catalog last returned — so "the MCP wasn't
// reachable this run" degrades to a documented fallback instead of stopping the run or inventing a
// value. SKILL.md "Live data comes from the MCP" — never from memory — still holds: this file is
// not a second source of truth, it is a receipt of the ONE time the real source was reachable,
// kept around for the run where it isn't.
//
// Lives beside the credential store (same reasoning: outside the skill bundle, never in the `.tgz`,
// never in git) — same parent directory as `credentials.mjs`'s file, a sibling `catalog-cache/`
// folder inside it, so both are governed by the one `$MENTION_NETWORK_CREDENTIALS` override.
//
// What goes stale, and how the user finds out: every catalog value here — intents, prompt
// templates, product-name rules, localization rules, the detect-extraction spec, model ids — has
// moved by migration before (SKILL.md: gpt-4o→gpt-5.5, gemini-2.5-pro→gemini-3.5-flash→
// gemini-3.6-flash, fastest_shipping→free_shipping). `load()` always returns the `fetchedAt`
// timestamp alongside the data, and `main()`'s CLI output prints it — SKILL.md's fallback
// instructions require every step that reads a cached catalog to say its age out loud, on the
// confirm card and in the run's own state, not just here.
//
// Usage:
//   node catalog-cache.mjs save <name> <jsonfile>   # write after a successful live MCP fetch
//   node catalog-cache.mjs load <name>              # prints {fetchedAt, data}, exits 1 if none cached

import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { credsPath } from './credentials.mjs'

function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl)
  } catch {
    return false
  }
}

// The catalog calls P1/P3 make and are worth caching — kept as an explicit allowlist so a typo'd
// name fails loudly instead of silently writing a file nothing will ever look for.
export const KNOWN_CATALOGS = [
  'describe_check_grid',
  'get_prompt_templates',
  'get_product_name_rules',
  'get_template_localization_rules',
  'get_detect_extraction_spec',
]

export function cacheDir(env = process.env) {
  return join(dirname(credsPath(env)), 'catalog-cache')
}

export function cachePath(name, env = process.env) {
  return join(cacheDir(env), `${name}.json`)
}

export function saveCatalog(name, data, env = process.env, now = new Date()) {
  if (!KNOWN_CATALOGS.includes(name)) {
    throw new Error(`unknown catalog name "${name}" (one of: ${KNOWN_CATALOGS.join(', ')})`)
  }
  const dir = cacheDir(env)
  mkdirSync(dir, { recursive: true })
  const record = { fetchedAt: now.toISOString(), data }
  const p = cachePath(name, env)
  writeFileSync(p, JSON.stringify(record, null, 2))
  return { path: p, fetchedAt: record.fetchedAt }
}

// Returns null (never throws) when nothing is cached — "no fallback available" is a normal,
// expected answer the first time a machine ever runs this skill, not an error.
export function loadCatalog(name, env = process.env) {
  const p = cachePath(name, env)
  if (!existsSync(p)) return null
  const record = JSON.parse(readFileSync(p, 'utf8'))
  return { path: p, fetchedAt: record.fetchedAt, data: record.data }
}

// How stale, in human terms — for the one line SKILL.md requires every fallback use to print.
export function ageDescription(fetchedAt, now = new Date()) {
  const ms = now.getTime() - new Date(fetchedAt).getTime()
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'fetched earlier today'
  if (days === 1) return 'fetched 1 day ago'
  return `fetched ${days} days ago`
}

export function main(argv, env = process.env) {
  const [cmd, name, arg] = argv
  if (cmd === 'save') {
    if (!name || !arg) throw new Error('usage: catalog-cache.mjs save <name> <jsonfile>')
    const data = JSON.parse(readFileSync(arg, 'utf8'))
    const { path, fetchedAt } = saveCatalog(name, data, env)
    return `saved ${name} → ${path} (fetchedAt ${fetchedAt})`
  }
  if (cmd === 'load') {
    if (!name) throw new Error('usage: catalog-cache.mjs load <name>')
    const found = loadCatalog(name, env)
    if (!found) throw new Error(`no cached "${name}" — there is no local fallback for this catalog yet; the live MCP fetch must succeed at least once`)
    return JSON.stringify({ fetchedAt: found.fetchedAt, age: ageDescription(found.fetchedAt), data: found.data })
  }
  throw new Error('usage: catalog-cache.mjs <save <name> <jsonfile> | load <name>>')
}

if (isMainModule(import.meta.url)) {
  try {
    console.log(main(process.argv.slice(2)))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
