// Validate and submit a BYOK check from files on disk — so the agent never has to inline a
// full cells array (tens of KB of answer text) into an MCP tool call by hand. Reads the cells
// a collector wrote and a small meta file, runs validate_byok_submission (always), and only
// submits if it comes back clean.
//
// Usage:
//   node submit.mjs --cells cells/ --meta meta.json           # validate → submit
//   node submit.mjs --cells cells/ --meta meta.json --validate-only
//   node submit.mjs --cells cells.json --meta meta.json       # cells file also works
//
// --cells: a directory of *.json cell files (each a full cell: {intentSlug, platformSlug,
//   promptText, collectionMethod, response}), OR a single .json that is an array of cells or
//   {cells:[...]}. Use collect-*.mjs with --intent so each file is already a full cell.
// --meta: JSON { shop, product, locationCountry, locationCity?, language?, currency?,
//   idempotencyKey? }. A fresh idempotencyKey (uuid) is generated when absent — reusing one
//   returns the prior run (deduped) instead of a new report.
//
// Needs MENTION_NETWORK_KEY in the env (source the credential store first).

import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { callTool } from './mcp-client.mjs'

// The product image must not be empty. SKILL.md used to say "always set imageUrl" in prose while
// this script sent `meta.product` through untouched — and one forgotten field meant that product
// NEVER had an image: the backend writes `products.image_url` only at trigger time, there is no
// path to correct it afterwards, and both the Recent checks table and the Website Audit screen
// show an empty cell for good. Prose cannot enforce it, so the script fetches it.
//
// Order: whatever meta already has → /products/<handle>.js → /products.json (match on handle,
// then title). If none of them yields one, STOP with a clear error rather than submitting
// quietly — telling the operator beats creating one more permanently blank row.
const IMG_TIMEOUT_MS = 8000

function normalizeImageUrl(url) {
  const u = typeof url === 'string' ? url.trim() : ''
  if (!u) return null
  return u.startsWith('//') ? `https:${u}` : u
}

// Which domain to call: shop.primaryDomain is the real one, storeUrl is the *.myshopify.com.
export function storefrontDomain(shop = {}) {
  const primary = typeof shop.primaryDomain === 'string' ? shop.primaryDomain.trim() : ''
  const store = typeof shop.storeUrl === 'string' ? shop.storeUrl.trim() : ''
  return primary || store || null
}

// The handle from meta, or peeled out of an externalProductId shaped `<shop>:<handle>`.
export function productHandle(product = {}) {
  const h = typeof product.handle === 'string' ? product.handle.trim() : ''
  if (h) return h
  const ext = typeof product.externalProductId === 'string' ? product.externalProductId : ''
  const m = ext.match(/^[^:]+:(.+)$/)
  return m ? m[1] : null
}

async function getJson(url, fetchImpl) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), IMG_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { signal: ctl.signal })
    if (!res?.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function resolveProductImage(meta, fetchImpl = fetch) {
  const existing = normalizeImageUrl(meta?.product?.imageUrl)
  if (existing) return existing

  const domain = storefrontDomain(meta?.shop)
  if (!domain) return null
  const handle = productHandle(meta?.product)

  if (handle) {
    const detail = await getJson(`https://${domain}/products/${handle}.js`, fetchImpl)
    const fromDetail =
      normalizeImageUrl(detail?.featured_image) ??
      normalizeImageUrl((detail?.images ?? []).find(Boolean))
    if (fromDetail) return fromDetail
  }

  const title = typeof meta?.product?.title === 'string' ? meta.product.title.trim() : ''
  for (let page = 1; page <= 3; page++) {
    const cat = await getJson(`https://${domain}/products.json?limit=250&page=${page}`, fetchImpl)
    const list = cat?.products ?? []
    if (!list.length) break
    const hit =
      (handle && list.find((p) => p?.handle === handle)) ||
      (title && list.find((p) => p?.title?.trim().toLowerCase() === title.toLowerCase()))
    const src = normalizeImageUrl(hit?.images?.[0]?.src)
    if (src) return src
  }
  return null
}

// `import.meta.url === pathToFileURL(process.argv[1]).href` breaks silently — no error, exit 0,
// `main()` never runs — when the script is reached through a symlink: `.claude/skills/*` here is
// a symlink into `agent-pack/skills/*`, and Node's ESM loader resolves import.meta.url through
// the symlink target while process.argv[1] keeps the path actually invoked. realpath both sides.
function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl)
  } catch {
    return false
  }
}

export function parseArgs(argv) {
  const out = { cells: null, meta: null, validateOnly: false }
  const keys = { cells: 'cells', meta: 'meta' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--validate-only') { out.validateOnly = true; continue }
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    const rawKey = eq === -1 ? a.slice(2) : a.slice(2, eq)
    const key = keys[rawKey]
    if (!key) continue
    let val
    if (eq !== -1) val = a.slice(eq + 1)
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) val = argv[++i]
    if (val !== undefined) out[key] = val
  }
  return out
}

export function isCell(x) {
  return Boolean(x && typeof x === 'object' && x.intentSlug && x.platformSlug && x.promptText && x.response)
}

// Load cells from a dir of full-cell files, or a single array/{cells} json file.
export function loadCells(path) {
  const st = statSync(path)
  let cells
  if (st.isDirectory()) {
    cells = readdirSync(path)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(path, f), 'utf8')))
  } else {
    const j = JSON.parse(readFileSync(path, 'utf8'))
    cells = Array.isArray(j) ? j : Array.isArray(j.cells) ? j.cells : [j]
  }
  const bad = cells.filter((c) => !isCell(c))
  if (bad.length) {
    throw new Error(
      `${bad.length} file(s) are not full cells (need intentSlug/platformSlug/promptText/response). ` +
      'Re-run the collector with --intent/--platform so it emits a full cell, not just the response.',
    )
  }
  return cells
}

// How many cells carry a client-written `detection` (P4.5). 0 means the backend will analyze
// every cell itself — not wrong, but slower (measured 2026-07-28: supplying detection returned
// `stage: done` on the first poll instead of several rounds of backend analysis). Surfaced so
// that gap is visible in the tool output itself, not only in a prose reminder an agent can skip
// past — SKILL.md P4.5 has measured that omission twice already.
export function detectionCoverage(cells) {
  const withDetection = cells.filter((c) => c.detection).length
  return { withDetection, total: cells.length, partial: withDetection > 0 && withDetection < cells.length }
}

export async function main(argv, env = process.env, deps = {}) {
  const call = deps.callTool ?? callTool
  const a = parseArgs(argv)
  if (!a.cells) throw new Error('--cells <dir|file> is required')
  const cells = loadCells(a.cells)
  const coverage = detectionCoverage(cells)

  const validation = await call('validate_byok_submission', { cells })
  // `warnings` has been its own field since 2026-07-28. Severity is still filtered inside
  // `errors` for an older backend, because soft warnings used to travel in that same array — and
  // treating the whole array as blocking means a warning like "no prices could be extracted"
  // (deliberately non-blocking) either stops the submit or pushes the agent into throwing away
  // `detection` to get past the gate.
  const all = validation?.errors ?? []
  const errors = all.filter((e) => e?.severity !== 'warning')
  const warnings = [...(validation?.warnings ?? []), ...all.filter((e) => e?.severity === 'warning')]
  if (errors.length) {
    return { ok: false, errors, warnings, coverage }
  }
  if (a.validateOnly) {
    return { ok: true, validatedCells: cells.length, warnings, coverage }
  }

  if (!a.meta) throw new Error('--meta <file> is required to submit (or pass --validate-only)')
  const meta = JSON.parse(readFileSync(a.meta, 'utf8'))

  // Blocked here, before the submit: a missing image is permanent damage (see the note on
  // resolveProductImage), so stopping beats writing a row nobody can ever fix.
  const imageUrl = await (deps.resolveProductImage ?? resolveProductImage)(meta)
  if (!imageUrl) {
    throw new Error(
      'product.imageUrl is empty and no image could be found on the storefront ' +
        `(${storefrontDomain(meta.shop) ?? 'domain unknown'}). ` +
        'Set meta.product.imageUrl and run again — submitting without one leaves that product ' +
        'with a permanently blank thumbnail in both Recent checks and the Website Audit.',
    )
  }

  const idempotencyKey = meta.idempotencyKey ?? randomUUID()
  const payload = {
    idempotencyKey,
    shop: meta.shop,
    product: { ...meta.product, imageUrl },
    locationCountry: meta.locationCountry,
    ...(meta.locationCity ? { locationCity: meta.locationCity } : {}),
    ...(meta.language ? { language: meta.language } : {}),
    ...(meta.currency ? { currency: meta.currency } : {}),
    cells,
  }
  const result = await call('submit_byok_check', payload)
  return { ok: true, idempotencyKey, warnings, coverage, ...result }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2))
    .then((r) => {
      // Print the warning BEFORE the error branch: it is the only thing in the output that tells
      // the agent the report's PRICE/SHIPPING columns are about to be empty, and because it
      // blocks nothing it is very easy to skim past when it sits further down.
      for (const w of r?.warnings ?? []) {
        const at = w.cell ? ` [${w.cell.platformSlug}::${w.cell.intentSlug}]` : ''
        console.error(`WARN  ${w.code}${at} — ${w.message}`)
      }
      if (r && r.ok === false) {
        console.error(`validate_byok_submission found ${r.errors.length} error(s):`)
        console.error(JSON.stringify(r.errors, null, 2))
        process.exit(1)
      }
      if (r?.coverage?.withDetection === 0) {
        console.error(`note: 0/${r.coverage.total} cells carry detection — P4.5 did not run, the backend will analyze all of them itself (slower first poll). Fine if that was a deliberate choice (SKILL.md P4.5 "When it is legitimate to skip").`)
      } else if (r?.coverage?.partial) {
        console.error(`warning: only ${r.coverage.withDetection}/${r.coverage.total} cells carry detection — that's DETECTION_PARTIAL, submit will be rejected. Analyze the rest or strip detection from all.`)
      }
      if (r) console.log(JSON.stringify(r, null, 2))
    })
    .catch((e) => { console.error(e.message); process.exit(1) })
}
