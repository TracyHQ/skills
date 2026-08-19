// Pure helpers the scorers read: HTML → text, JSON-LD parsing, robots.txt parsing, GTIN check.
// Ported from the backend's `discoverability.util.ts`, `jsonld.parser.ts` and `html-text.util.ts`
// so a client-side run scores the same page the same way. No dependencies, no I/O.

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ---- text ------------------------------------------------------------------

export function stripTags(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// \u escapes on purpose: the literal marks are invisible in an editor and get lost on a copy.
const COMBINING_MARKS = /[\u0300-\u036f]/g

// Latin letters NFD cannot decompose, so they need an explicit map — same list as the backend's.
// The first key is D-WITH-STROKE (U+0111), the lower-case Vietnamese letter; it is written as an
// escape for the same reason the combining marks above are, and because this file ships in a
// public repo whose CI reads a bare one as prose left untranslated. The rest are German, Latin
// and Polish letters that no such rule touches, so they stay readable.
const EXTRA_FOLD_MAP = { '\u0111': 'd', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l' }

export function foldDiacriticsChar(ch) {
  const folded = ch.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '')
  return EXTRA_FOLD_MAP[folded] ?? folded
}

// "Kärcher" and "Karcher" are the same word to a shopper, so they must be to us as well: every
// comparison of two human-typed strings folds first. Ported from the backend's fold-diacritics.
export function foldDiacritics(input) {
  let out = ''
  for (const ch of String(input || '')) out += foldDiacriticsChar(ch)
  return out
}

export function normalizeText(input) {
  return foldDiacritics(input)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(input) {
  const norm = normalizeText(input)
  return norm.length ? norm.split(' ') : []
}

// Only strip what really looks like a tag on the post-decode pass: "&lt; 30 &gt; 18"
// decodes to "< 30 > 18" and a broad regex would swallow that run of real words.
const DECODED_TAG_RE = /<\/?[a-z][a-z0-9-]*\b[^>]*>/gi

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
}

// Visible text for the LLM batches: drop script/style/tags, collapse whitespace, cap length.
export function htmlToText(html, cap = 8000) {
  if (!html) return ''
  let text = String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  // Decode then strip again: acceptedAnswer.text usually carries escaped HTML (some of it
  // escaped twice). Decoding after the strip would mint tags nothing removes afterwards,
  // inflating the word count and handing the model markup to grade.
  for (let pass = 0; pass < 2; pass++) {
    const decoded = decodeEntities(text)
    if (decoded === text) break
    text = decoded.replace(DECODED_TAG_RE, ' ')
  }
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?…)\]])/g, '$1')
    .trim()
  return text.length > cap ? text.slice(0, cap) : text
}

const MATCH_WINDOW = 40
const MATCH_MARKS = [0, 0.2, 0.4, 0.6, 0.8]
const MATCH_MIN_HITS = 3
const MATCH_WHOLE_BELOW = 60

export function normalizeForMatch(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// Body text PLUS ld+json contents — not the script-free version. JSON-LD lives inside a
// script tag, so dropping every script first means a description taken from JSON-LD can
// never match itself. Ordinary scripts stay out: text inside `window.product = {...}` is
// data for JS to build the DOM, exactly what this guard exists to reject.
export function buildRawHaystack(rawHtml) {
  if (!rawHtml) return ''
  const kept = String(rawHtml).replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (_m, attrs, body) =>
      /type\s*=\s*["']?application\/ld\+json/i.test(attrs) ? ` ${body} ` : ' ',
  )
  return normalizeForMatch(htmlToText(kept, Number.MAX_SAFE_INTEGER))
}

// Five short windows instead of one leading slice: themes inject tab labels and badges in
// the MIDDLE of a description, so the opening run is often broken while the text is fully
// present (measured: a leading 100-char compare threw away a 1,361-char description).
export function textPresentInRaw(text, rawHaystack) {
  const needle = normalizeForMatch(text)
  if (!needle || !rawHaystack) return false
  if (needle.length < MATCH_WHOLE_BELOW) return rawHaystack.includes(needle)

  const maxStart = needle.length - MATCH_WINDOW
  const hits = MATCH_MARKS.filter((mark) => {
    const start = Math.min(Math.floor(needle.length * mark), maxStart)
    return rawHaystack.includes(needle.slice(start, start + MATCH_WINDOW))
  }).length
  return hits >= MATCH_MIN_HITS
}

// Keep head AND tail (70/30): FAQ, how-to-use and care blocks almost always sit at the
// bottom of a product page, so chopping the tail chops exactly what we came to grade.
export function capText(text, cap) {
  if (text.length <= cap) return text
  const ellipsis = ' […] '
  const budget = cap - ellipsis.length
  const head = Math.floor(budget * 0.7)
  return `${text.slice(0, head)}${ellipsis}${text.slice(text.length - (budget - head))}`
}

const NOISE_TAG_RE = /<(header|nav|footer|aside)\b[^>]*>/gi
const SHOPIFY_CHROME_RE =
  /<([a-z0-9-]+)\b[^>]*\bid="shopify-section-[^"]*(?:header|footer|announcement|cart|drawer|popup|newsletter|menu)[^"]*"[^>]*>/gi
// Screen-reader labels and slide counters: invisible to shoppers, and written in the
// STORE'S language — the English string list below cannot catch them, a class filter can.
const SR_ONLY_RE =
  /<([a-z0-9-]+)\b[^>]*\bclass="[^"]*(?:visually-hidden|visuallyhidden|sr-only|screen-reader|skip-to-content)[^"]*"[^>]*>/gi

// Remove elements by NESTING DEPTH. A non-greedy regex stops at the first closing tag, so
// <footer><nav>…</nav>…</footer> only lost half of itself (measured: 13 chrome tags on a
// real PDP, 2 removed) and the leftover menu drowned the real copy.
function removeElements(html, openTagRe) {
  let result = ''
  let cursor = 0
  const open = new RegExp(openTagRe.source, 'gi')
  let match
  while ((match = open.exec(html)) !== null) {
    if (match.index < cursor) continue
    const tag = (match[1] ?? '').toLowerCase()
    const token = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
    token.lastIndex = match.index + match[0].length
    let depth = 1
    let end = -1
    let t
    while (depth > 0 && (t = token.exec(html)) !== null) {
      depth += t[1] ? -1 : 1
      if (depth === 0) end = t.index + t[0].length
    }
    // Unclosed tag (broken theme): drop the tag itself, never the rest of the page.
    const cut = end === -1 ? match.index + match[0].length : end
    result += `${html.slice(cursor, match.index)} `
    cursor = cut
    open.lastIndex = cut
  }
  return result + html.slice(cursor)
}

// Theme furniture repeated on every PDP: no product information, just cap budget and noise.
const BOILERPLATE_RE = [
  /\bSkip to (?:content|product information|information)\b/gi,
  /\bOpen media \d+ in modal\b/gi,
  /\bPlay video\b/gi,
  /\b\d+ \/ of \d+\b/gi,
  /\b\d+% \(\d+\)/g,
  /\bBe the first to write a review\b/gi,
  /\bWrite a review\b/gi,
  /\bShare Share Link Close share Copy link\b/gi,
  /\bView full details\b/gi,
]

// Main-content text: prefer <main>, then drop page chrome (semantic tags + Shopify
// `shopify-section-*` header/footer/announcement) so the LLM does not grade a menu.
export function extractMainText(html, cap = 8000) {
  if (!html) return ''
  const src = String(html)
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(src)?.[1]
  const region = [NOISE_TAG_RE, SHOPIFY_CHROME_RE, SR_ONLY_RE].reduce(
    (acc, re) => removeElements(acc, re),
    main ?? src,
  )
  let text = htmlToText(region, Number.MAX_SAFE_INTEGER)
  for (const re of BOILERPLATE_RE) text = text.replace(re, ' ')
  return capText(text.replace(/\s+/g, ' ').trim(), cap)
}

// ---- small value helpers ---------------------------------------------------

export function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

export function firstOf(value) {
  return Array.isArray(value) ? value[0] : value
}

export function toNum(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function nonEmptyStr(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export function brandText(value) {
  const s = nonEmptyStr(value)
  if (s) return s
  const obj = asObject(value)
  return obj ? nonEmptyStr(obj.name) : null
}

// Resellers often set vendor = the store's own name; that is not the product's brand.
export function isShopNameLike(brand, shopName) {
  const b = normalizeText(brand)
  const s = normalizeText(shopName)
  if (!b || !s) return false
  return b.includes(s) || s.includes(b)
}

export function isValidGtin(value) {
  const s = typeof value === 'number' ? String(value) : nonEmptyStr(value)
  if (!s) return false
  const digits = s.replace(/\s/g, '')
  if (!/^\d+$/.test(digits)) return false
  if (![8, 12, 13, 14].includes(digits.length)) return false
  const nums = digits.split('').map(Number)
  const check = nums.pop()
  let sum = 0
  for (let i = nums.length - 1, pos = 0; i >= 0; i--, pos++) {
    sum += nums[i] * (pos % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === check
}

// ---- JSON-LD ---------------------------------------------------------------

const LD_JSON_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

export function typesOf(node) {
  const t = node?.['@type']
  if (typeof t === 'string') return [t]
  if (Array.isArray(t)) return t.filter((x) => typeof x === 'string')
  return []
}

export function findNodesByType(raw, type) {
  return raw.filter((n) => typesOf(n).includes(type))
}

export function firstNodeByType(raw, type) {
  return findNodesByType(raw, type)[0] ?? null
}

function walk(value, nodes, types) {
  if (Array.isArray(value)) {
    for (const v of value) walk(v, nodes, types)
    return
  }
  if (value && typeof value === 'object') {
    nodes.push(value)
    for (const t of typesOf(value)) types.add(t)
    for (const key of Object.keys(value)) {
      if (key === '@context') continue
      walk(value[key], nodes, types)
    }
  }
}

// Every ld+json block on the page, flattened (nested @graph / Review / AggregateRating included).
export function parseJsonLd(html) {
  const nodes = []
  const types = new Set()
  let parseErrors = 0

  for (const m of String(html || '').matchAll(LD_JSON_RE)) {
    const rawText = m[1].trim()
    if (!rawText) continue
    try {
      walk(JSON.parse(rawText), nodes, types)
    } catch {
      parseErrors += 1
    }
  }

  const product = nodes.find((n) => typesOf(n).includes('Product')) ?? null
  const rawOffers = product?.offers
  const offers = Array.isArray(rawOffers) ? (rawOffers[0] ?? null) : (rawOffers ?? null)

  return { product, offers, types: [...types], raw: nodes, parseErrors }
}

// ---- robots.txt ------------------------------------------------------------

export function parseRobots(body) {
  const groups = []
  let current = null
  let expectingAgents = false
  for (const rawLine of String(body || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (field === 'user-agent') {
      if (!current || !expectingAgents) {
        current = { agents: [], disallows: [] }
        groups.push(current)
        expectingAgents = true
      }
      current.agents.push(value.toLowerCase())
    } else if (field === 'disallow' && current) {
      expectingAgents = false
      current.disallows.push(value)
    } else if (current) {
      expectingAgents = false
    }
  }
  return groups
}

// Is this bot disallowed from product/collection paths? (its own group, else the `*` group)
export function isBotBlocked(groups, bot) {
  const name = String(bot).toLowerCase()
  const specific = groups.filter((g) => g.agents.includes(name))
  const wildcard = groups.filter((g) => g.agents.includes('*'))
  const applicable = specific.length ? specific : wildcard
  const paths = ['/products/sample', '/collections/sample']
  return applicable.some((g) =>
    g.disallows.some((d) => d !== '' && paths.some((p) => p.startsWith(d))),
  )
}

// ---- CLI entrypoint guard ---------------------------------------------------

// `import.meta.url === pathToFileURL(process.argv[1]).href` breaks silently — no error, exit 0,
// `main()` never runs — when the script is reached through a symlink: `.claude/skills/*` here is
// a symlink into `agent-pack/skills/*`, and Node's ESM loader resolves import.meta.url through
// the symlink target while process.argv[1] keeps the path actually invoked. realpath both sides.
export function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl)
  } catch {
    return false
  }
}

// ---- tiny argv parser shared by the CLI scripts ----------------------------

// `--key value`, `--key=value`, and bare `--flag` (→ true). Unknown keys are kept as-is so a
// caller can pass through extras; callers validate what they need.
export function parseArgv(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq)
    if (eq !== -1) {
      out[key] = a.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) out[key] = argv[++i]
    else out[key] = true
  }
  return out
}
