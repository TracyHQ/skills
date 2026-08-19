// Resolve (and create) the run directory for one audit, then print its absolute path.
//
// Why this is a script and not a sentence in SKILL.md: every later step writes into `$RUN`, and
// the instructions used `$RUN` ten times without ever assigning it. An unset variable does not
// stop anything — `--out "$RUN/audit.json"` becomes `--out "/audit.json"`, which fails with a
// confusing EROFS on a Mac and, on a container running as root, quietly writes the audit to the
// filesystem root instead. One command that prints the path removes the whole class:
//
//   RUN="$(node "$HERE/scripts/run-dir.mjs" --domain acme.com --handle widget)"
//
//   --domain <shopDomain>   required
//   --handle <product>      required — the PDP handle, so two products on one store don't collide
//   --root <dir>            where run dirs live (default `.mn-audits` under the cwd)
//   --resume                reuse the newest existing dir for this store+product instead of
//                           making a new one; prints nothing and exits 1 when there is none
//   --fresh                 always make a new one (the default)
//
// Naming is `<domain>-<handle>-<YYYY-MM-DD-HHmm>`, sorted lexically = sorted by time, which is
// what makes `--resume` "the newest" a string comparison rather than a stat of every candidate.

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isMainModule, parseArgv } from './util.mjs'

/** Filesystem-safe, and stable for the same store+product across runs. */
export function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** `YYYY-MM-DD-HHmm` in local time — the run dir is read by whoever ran it, not by a server. */
export function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}`
  )
}

export function newestExisting(root, prefix, readdir = readdirSync) {
  if (!existsSync(root)) return null
  const matches = readdir(root)
    .filter((name) => name.startsWith(`${prefix}-`))
    .sort()
  return matches.length ? join(root, matches[matches.length - 1]) : null
}

export function resolveRunDir(
  { domain, handle, root = '.mn-audits', resume = false, now = new Date() },
  deps = {},
) {
  if (!domain) throw new Error('--domain is required')
  if (!handle) throw new Error('--handle is required')
  const absRoot = resolve(root)
  const prefix = `${slug(domain)}-${slug(handle)}`

  if (resume) {
    const found = newestExisting(absRoot, prefix, deps.readdir)
    if (!found) throw new Error(`no existing run directory for ${prefix} under ${absRoot}`)
    return found
  }
  return join(absRoot, `${prefix}-${stamp(now)}`)
}

export function main(argv) {
  const a = parseArgv(argv)
  const dir = resolveRunDir({
    domain: a.domain,
    handle: a.handle,
    root: a.root ?? '.mn-audits',
    resume: !!a.resume,
  })
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
