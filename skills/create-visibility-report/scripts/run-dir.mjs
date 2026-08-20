// Resolve (and create) the run directory for one report, then print its absolute path.
//
//   RUN="$(node "$HERE/scripts/run-dir.mjs" --domain kbeautyarabia.com)"
//   RUN="$(node "$HERE/scripts/run-dir.mjs" --domain kbeautyarabia.com --resume)"
//
//   --domain <shopDomain>   required
//   --root <dir>            where run dirs live (default `.mn-runs` under the cwd)
//   --resume                reuse the newest existing run for this store instead of making one;
//                           prints nothing and exits 1 when there is none
//
// The layout is the one RECOVERY.md documents — `.mn-runs/<slugged shopDomain>/<YYYY-MM-DDTHHMM>/`
// — with runs nested under the store so `resume` is "the newest entry in this store's folder"
// rather than a scan of every run ever made. The timestamp sorts lexically, so newest is the last
// name, not a stat of each candidate.
//
// SKILL.md P4 calls this at the start of every BYOK run to establish `$RUN`, and RECOVERY.md's
// `resume` step calls it again with `--resume` — always through this script, in both directions,
// never by hand-typing `.mn-runs/<domain>/...`: `slug()` below rewrites the domain
// (`kbeautyarabia.com` → `kbeautyarabia-com`), so a hand-typed path built from the raw domain
// looks plausible but is not the directory `--resume` will ever find.
//
// Self-contained on purpose — no shared imports. That is NOT a claim that this is a copy of
// `visibility-audit/scripts/run-dir.mjs`; the two are deliberately different tools that happen to
// share a name and a shape: the sibling imports from its own `util.mjs`, roots runs under
// `.mn-audits` (this one uses `.mn-runs`), stamps with `YYYY-MM-DD-HHmm` (this one uses
// `YYYY-MM-DDTHHMM`), and requires `--handle` because an audit is scoped to one product page,
// which a visibility report is not. The two directories share no modules on purpose — importing a
// sibling's `util.mjs` would make copying this file between them a silent breakage rather than a
// portable copy — but "self-contained" and "identical" are different claims; diff the two before
// assuming parity.

import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl)
  } catch {
    return false
  }
}

export function parseArgv(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq)
    if (eq !== -1) out[key] = a.slice(eq + 1)
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i]
    else out[key] = true
  }
  return out
}

/** Filesystem-safe, and stable for the same store across runs. */
export function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** `YYYY-MM-DDTHHMM` in local time — this directory is read by whoever ran it, not by a server. */
export function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `T${p(now.getHours())}${p(now.getMinutes())}`
  )
}

export function newestExisting(storeDir, readdir = readdirSync) {
  if (!existsSync(storeDir)) return null
  const runs = readdir(storeDir).sort()
  return runs.length ? join(storeDir, runs[runs.length - 1]) : null
}

export function resolveRunDir({ domain, root = '.mn-runs', resume = false, now = new Date() }, deps = {}) {
  if (!domain) throw new Error('--domain is required')
  const storeDir = join(resolve(root), slug(domain))
  if (resume) {
    const found = newestExisting(storeDir, deps.readdir)
    if (!found) throw new Error(`no existing run directory under ${storeDir}`)
    return found
  }
  return join(storeDir, stamp(now))
}

export function main(argv) {
  const a = parseArgv(argv)
  const dir = resolveRunDir({ domain: a.domain, root: a.root ?? '.mn-runs', resume: !!a.resume })
  mkdirSync(dir, { recursive: true })
  return dir
}

if (isMainModule(import.meta.url)) {
  try {
    console.log(main(process.argv.slice(2)))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
