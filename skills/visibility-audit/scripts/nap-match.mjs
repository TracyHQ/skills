// NAP (Name / Address / Phone) match between the store's own Organization schema and its
// Google Business Profile. Ported from the backend's `nap-match.util.ts`.
// Only fields present on BOTH sides are compared; nothing comparable → null (not a verdict).

import { foldDiacritics } from './util.mjs'

const LEGAL_SUFFIX_RE = /\b(inc|llc|ltd|co|corp|company|gmbh|limited)\b/g
const ADDR_ABBREV = {
  st: 'street',
  ave: 'avenue',
  av: 'avenue',
  rd: 'road',
  blvd: 'boulevard',
  ln: 'lane',
  dr: 'drive',
  hwy: 'highway',
  ste: 'suite',
  fl: 'floor',
}

const blank = (s) => !s || String(s).trim() === ''

// Fold BEFORE the [^a-z0-9] filter, or an accented letter is deleted rather than folded
// ("café" → "caf") and the two sides stop lining up at all.
function normName(s) {
  return foldDiacritics(s)
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normAddressTokens(s) {
  return foldDiacritics(s)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ADDR_ABBREV[t] ?? t)
}

function phoneDigits(s) {
  return String(s).replace(/\D/g, '')
}

function tokenJaccard(a, b) {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  const union = new Set([...sa, ...sb]).size
  return inter / union
}

function cmpName(a, b) {
  const na = normName(a)
  const nb = normName(b)
  if (!na || !nb) return 'skip'
  if (na === nb || na.includes(nb) || nb.includes(na)) return 'match'
  return tokenJaccard(na.split(' '), nb.split(' ')) >= 0.6 ? 'match' : 'mismatch'
}

function cmpPhone(a, b) {
  const da = phoneDigits(a)
  const db = phoneDigits(b)
  if (da.length < 7 || db.length < 7) return 'skip'
  const len = Math.min(da.length, db.length, 10)
  return da.slice(-len) === db.slice(-len) ? 'match' : 'mismatch'
}

function cmpAddress(a, b) {
  const ta = normAddressTokens(a)
  const tb = normAddressTokens(b)
  if (ta.length === 0 || tb.length === 0) return 'skip'
  return tokenJaccard(ta, tb) >= 0.5 ? 'match' : 'mismatch'
}

export function matchNap(onsite, gbp) {
  const verdicts = [
    blank(onsite.name) || blank(gbp.name) ? 'skip' : cmpName(onsite.name, gbp.name),
    blank(onsite.phone) || blank(gbp.phone) ? 'skip' : cmpPhone(onsite.phone, gbp.phone),
    blank(onsite.address) || blank(gbp.address) ? 'skip' : cmpAddress(onsite.address, gbp.address),
  ]
  const comparable = verdicts.filter((v) => v !== 'skip')
  if (comparable.length === 0) return null
  return comparable.includes('mismatch') ? 'mismatch' : 'match'
}
