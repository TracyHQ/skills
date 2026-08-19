// Tiny credential store so the user enters a secret ONCE and every Mention Network skill reuses it.
//
// Design + security boundary:
//   - The file lives OUTSIDE this skill directory (default ~/.config/mention-network/credentials,
//     override with $MENTION_NETWORK_CREDENTIALS). It must never sit inside the installed skill
//     or a git repo: this skill is distributed from a public registry, and a store written next
//     to the scripts is a store one `git add -A` away from being published.
//   - dotenv format (`NAME=value` per line), so the skill loads it by *sourcing* it into the
//     shell for one command (`set -a; . "$CREDS"; set +a; node collect-*.mjs …`). Secrets
//     therefore reach the collectors via env, never through the agent's text context.
//   - This tool NEVER prints a secret. `save` reads each value from the ENVIRONMENT (not argv,
//     which would echo it), and `status` masks to the last 4 chars. There is deliberately no
//     `get` that prints raw values — consume them by sourcing the file.
//   - dir 0700, file 0600.
//
// Every lane this skill has is an API key, so everything it needs is storable here: one LLM key
// (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY) to write the diagnosis prose, SERPAPI_API_KEY
// for the off-store signals, and MENTION_NETWORK_KEY for the MCP the finished audit is stored on.
//
// Usage:
//   node credentials.mjs status                  # masked list of what's stored
//   node credentials.mjs path                    # print the file path
//   node credentials.mjs export                  # path + the file as stored, values masked
//   ANTHROPIC_API_KEY=sk-ant-... node credentials.mjs save ANTHROPIC_API_KEY [MORE...]
//   node credentials.mjs remove GEMINI_API_KEY [MORE...]
//   node credentials.mjs check [NAME...]         # ask each provider whether the key still works
//
// Replacing a key is just `save` again — it overwrites. `remove` exists for the other case:
// a key you have stopped using should leave the file, not sit there looking available to a
// preflight that will then route work to a provider you no longer pay for.
//
// Load into a shell for a collector run (the skill does this, not this tool):
//   CREDS="${MENTION_NETWORK_CREDENTIALS:-$HOME/.config/mention-network/credentials}"
//   set -a; [ -f "$CREDS" ] && . "$CREDS"; set +a

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// `import.meta.url === pathToFileURL(process.argv[1]).href` breaks silently — no error, exit 0,
// `main()` never runs — when the script is reached through a symlink. Hosts do symlink installed
// skill directories, and Node's ESM loader resolves import.meta.url through the symlink target
// while process.argv[1] keeps the path actually invoked. realpath both sides.
function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl)
  } catch {
    return false
  }
}

export const KNOWN = [
  'MENTION_NETWORK_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'SERPAPI_API_KEY',
]

export function credsPath(env = process.env) {
  return env.MENTION_NETWORK_CREDENTIALS || join(homedir(), '.config', 'mention-network', 'credentials')
}

// Parse a dotenv-ish file: `NAME=value` lines; ignore blanks and `#` comments; first `=` splits.
export function parseEnv(text) {
  const map = new Map()
  for (const line of String(text).split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq === -1) continue
    const key = s.slice(0, eq).trim()
    let val = s.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key) map.set(key, val)
  }
  return map
}

export function serializeEnv(map) {
  const header =
    '# Mention Network credentials — DO NOT COMMIT. Shared by every Mention Network skill.\n' +
    '# Loaded by the skills via: set -a; . "$CREDS"; set +a\n'
  const body = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  return header + (body ? body + '\n' : '')
}

// Real provider keys are 40+ chars, so the last 4 identify which key this is without helping
// anyone reconstruct it. Below 12 there is nothing safe to show: revealing 4 of a 5-character
// value is most of it, and the only thing the tail is for is telling two keys apart.
export function mask(value) {
  if (typeof value !== 'string' || value.length === 0) return '(empty)'
  return value.length < 12 ? '****' : '****' + value.slice(-4)
}

function readStore(env) {
  const p = credsPath(env)
  return existsSync(p) ? parseEnv(readFileSync(p, 'utf8')) : new Map()
}

function writeStore(map, env) {
  const p = credsPath(env)
  mkdirSync(dirname(p), { recursive: true })
  // A directory left at 0755 lets other local users see that a credentials file exists. That is
  // not a disclosure of the keys, so it does not stop the write — but it is worth one line on
  // stderr, because the silent version of this is how nobody ever finds out.
  try {
    chmodSync(dirname(p), 0o700)
  } catch (e) {
    process.stderr.write(`warning: could not restrict ${dirname(p)} to 0700 (${e.message})\n`)
  }

  // Refuse to write through a symlink. `writeFileSync` follows one, so a link planted at this
  // path before first run redirects every key the user saves to a file the attacker chose — and
  // the chmod below then obligingly makes that file 0600, which looks like the store is secure.
  // Replacing the link instead would silently break someone who symlinked the store on purpose,
  // so this stops and says which path to use.
  try {
    if (lstatSync(p).isSymbolicLink()) {
      throw new Error(
        `${p} is a symlink; refusing to write credentials through it. ` +
          'Point $MENTION_NETWORK_CREDENTIALS at the real file if that link is intentional.',
      )
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e // ENOENT is the normal first-run case
  }
  // `mode` on the create, not a chmod after it: writeFileSync without it creates the file at
  // 0644 under a default umask, so there is a window — short, but real on a shared host — where
  // plaintext API keys sit world-readable. The chmod stays for the case where the file already
  // existed with looser permissions, which `mode` does not fix.
  writeFileSync(p, serializeEnv(map), { mode: 0o600 })
  chmodSync(p, 0o600)
  return p
}

export function statusLines(env = process.env) {
  const stored = readStore(env)
  return KNOWN.map((name) => {
    const inFile = stored.has(name)
    const inEnv = typeof env[name] === 'string' && env[name].length > 0
    const where = inFile ? `stored ${mask(stored.get(name))}` : inEnv ? `env only ${mask(env[name])}` : 'missing'
    return `${name}: ${where}`
  })
}

// Persist the given names, taking each value from the ENVIRONMENT (never argv).
export function save(names, env = process.env) {
  if (!names.length) throw new Error('save needs at least one NAME (value is read from the env of the same name)')
  const store = readStore(env)
  const saved = []
  for (const name of names) {
    const val = env[name]
    if (typeof val !== 'string' || val.length === 0) {
      throw new Error(`${name} is not set in the environment — export it first (so it is not echoed in argv), then save`)
    }
    store.set(name, val)
    saved.push(name)
  }
  const p = writeStore(store, env)
  return { path: p, saved }
}

// Drop names from the store. Silent on a name that was never there: the caller asked for it to
// be absent and it is absent, and an error here would only make "clean up my keys" a two-step
// dance of checking first.
export function remove(names, env = process.env) {
  if (!names.length) throw new Error('remove needs at least one NAME')
  const store = readStore(env)
  const removed = names.filter((name) => store.delete(name))
  const p = writeStore(store, env)
  return { path: p, removed, absent: names.filter((n) => !removed.includes(n)) }
}

// The file as stored, values masked. `status` answers "have I got one?"; this answers "what is
// actually in the file, in the order it is in" — which is what you want before hand-editing it.
export function exportLines(env = process.env) {
  const stored = readStore(env)
  const out = [`# ${credsPath(env)}`]
  if (stored.size === 0) out.push('# (empty — nothing saved yet)')
  for (const [name, value] of stored) out.push(`${name}=${mask(value)}`)
  return out
}

/**
 * The cheapest request each provider offers that answers "is this key still good?".
 *
 * A list endpoint, never a generation: `check` must be free to run as often as the user likes,
 * and a key that has been revoked is exactly as visible from a 401 on a list call as from a
 * burned inference. `null` marks a key this script cannot probe on its own.
 */
const PROBES = {
  ANTHROPIC_API_KEY: (key) => [
    'https://api.anthropic.com/v1/models?limit=1',
    { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } },
  ],
  OPENAI_API_KEY: (key) => [
    'https://api.openai.com/v1/models',
    { headers: { Authorization: `Bearer ${key}` } },
  ],
  GEMINI_API_KEY: (key) => [
    // `x-goog-api-key`, not `?key=` — a secret in a query string is a secret in every proxy and
    // edge access log along the way, TLS or not.
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    { headers: { 'x-goog-api-key': key } },
  ],
  SERPAPI_API_KEY: (key) => [
    `https://serpapi.com/account?api_key=${encodeURIComponent(key)}`,
    {},
  ],
  // Deliberately absent: MENTION_NETWORK_KEY. Probing it means speaking MCP over HTTP, and a
  // half-implementation here would report "ok" for a key the real preflight then rejects. P1
  // already calls the MCP for real — that is the check, and saying so is more useful than a
  // second opinion this file is not equipped to give.
  MENTION_NETWORK_KEY: null,
}

// One line per name: ok / rejected / unreachable / skipped. Never throws on a bad key — a
// failing probe is the answer, not an error.
export async function check(names, env = process.env, fetchImpl = fetch) {
  const stored = readStore(env)
  const targets = names.length ? names : KNOWN
  const lines = []
  for (const name of targets) {
    if (!KNOWN.includes(name)) {
      lines.push(`${name}: unknown name (one of: ${KNOWN.join(', ')})`)
      continue
    }
    // `status` distinguishes stored from env-only and so must this: telling someone a key is
    // stored when it only lives in this shell is how it disappears the next time they open one.
    const isStored = stored.has(name)
    const value = stored.get(name) ?? env[name] ?? ''
    if (!value) {
      lines.push(`${name}: missing — nothing to check`)
      continue
    }
    const where = isStored ? 'stored' : 'env only'
    const probe = PROBES[name]
    if (!probe) {
      lines.push(`${name}: ${where} ${mask(value)} — not probed here; P1 verifies it against the MCP`)
      continue
    }
    const [url, init] = probe(value)
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) })
      if (res.ok) lines.push(`${name}: ok — ${where} ${mask(value)}`)
      else if (res.status === 401 || res.status === 403) {
        lines.push(`${name}: REJECTED ${res.status} — the key is wrong, revoked or out of quota`)
      } else lines.push(`${name}: inconclusive — provider answered ${res.status}`)
    } catch (e) {
      lines.push(`${name}: unreachable (${e.message}) — network, not necessarily the key`)
    }
  }
  return lines
}

export async function main(argv, env = process.env) {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'status':
      return statusLines(env).join('\n')
    case 'path':
      return credsPath(env)
    case 'export':
      return exportLines(env).join('\n')
    case 'save': {
      const { path, saved } = save(rest, env)
      return `saved ${saved.join(', ')} → ${path} (chmod 600)`
    }
    case 'remove': {
      const { path, removed, absent } = remove(rest, env)
      const parts = []
      if (removed.length) parts.push(`removed ${removed.join(', ')}`)
      if (absent.length) parts.push(`not stored: ${absent.join(', ')}`)
      return `${parts.join('; ')} → ${path}`
    }
    case 'check':
      return (await check(rest, env)).join('\n')
    default:
      throw new Error(
        'usage: credentials.mjs <status|path|export|save NAME...|remove NAME...|check [NAME...]>',
      )
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2))
    .then((out) => console.log(out))
    .catch((e) => {
      console.error(e.message)
      process.exit(1)
    })
}
