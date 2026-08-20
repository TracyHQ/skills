// Deterministic guards on the AI-written copy, ported from `scorers/narrative-guard.ts`.
//
// A schema-valid string is not a trustworthy string: the page text the LLM reads is merchant
// controlled and can carry instructions, and models invent numbers. These guards run BEFORE a
// line is stamped `source: 'llm'`; a violation falls that ONE surface back to its template.
//   - numeric grounding : every number in the copy must trace to the score/evidence
//   - prescription leak : a failing criterion may describe the gap, never prescribe the fix

const NUMERIC_EPS = 0.01
const STRUCTURAL_NUMBERS = [0, 1, 100]

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)

function collectEvidenceNumbers(value, out = []) {
  if (isFiniteNumber(value)) out.push(value)
  else if (Array.isArray(value)) for (const item of value) collectEvidenceNumbers(item, out)
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectEvidenceNumbers(v, out)
  }
  return out
}

function expand(base) {
  const allowed = new Set(base)
  for (const n of base) if (n >= 0 && n <= 1) allowed.add(Math.round(n * 100)) // fraction → percent
  const ints = [...allowed].filter(Number.isInteger)
  for (const a of ints) for (const b of ints) if (a !== b) allowed.add(Math.abs(a - b))
  return [...allowed]
}

function allowedNumbers(score, evidence) {
  return expand([...collectEvidenceNumbers(evidence), score, ...STRUCTURAL_NUMBERS])
}

export function extractNumbers(text) {
  const normalized = String(text).replace(/(?<=\d),(?=\d{3}\b)/g, '')
  return (normalized.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite)
}

export function numbersGrounded(text, score, evidence) {
  const allowed = allowedNumbers(score, evidence)
  return extractNumbers(text).every((n) => allowed.some((a) => Math.abs(a - n) <= NUMERIC_EPS))
}

// For surfaces with no single owning criterion (sub-group takeaway, factor summary, verdict).
export function numbersInAllowedSet(text, allowed) {
  const list = expand([...allowed, ...STRUCTURAL_NUMBERS])
  return extractNumbers(text).every((n) => list.some((a) => Math.abs(a - n) <= NUMERIC_EPS))
}

const IMPERATIVE_VERBS = new Set([
  'add', 'include', 'use', 'consider', 'try', 'ensure', 'make', 'create', 'implement', 'enable',
  'provide', 'write', 'update', 'optimize', 'optimise', 'increase', 'reduce', 'remove', 'avoid',
  'set', 'fix', 'improve', 'start', 'register', 'submit', 'list', 'upload', 'embed', 'publish',
  'put', 'place', 'insert', 'define', 'specify', 'mention', 'describe', 'expand', 'rewrite',
  'clarify', 'boost', 'build', 'get', 'apply', 'link', 'declare', 'populate',
])

const REMEDIATION_PHRASES = [
  'you should', 'you can', 'you could', 'you need to', 'we recommend', 'to fix', 'to improve',
  'to boost', 'to increase', 'make sure', 'be sure to', 'in order to',
]

export function hasPrescription(text) {
  const lower = String(text).toLowerCase()
  if (REMEDIATION_PHRASES.some((p) => lower.includes(p))) return true
  for (const clause of lower.split(/[.;:\n]+/)) {
    const first = clause.trim().match(/^[a-z]+/)?.[0]
    if (first && IMPERATIVE_VERBS.has(first)) return true
  }
  return false
}

// null = safe to stamp `llm`; otherwise the reason, so the caller can log why it fell back.
export function diagnosisRejection(text, score, evidence) {
  if (!numbersGrounded(text, score, evidence)) return 'ungrounded-number'
  if (score < 100 && hasPrescription(text)) return 'prescription'
  return null
}

// Collapse the model's key/text pairs into a record, enforcing the expected key set:
// unknown keys are dropped, and a key seen twice is dropped ENTIRELY (we cannot tell which
// duplicate is real). Absent keys fall back to their template upstream.
export function reconcilePairs(pairs, expectedKeys) {
  const expected = new Set(expectedKeys)
  const counts = new Map()
  for (const p of pairs) counts.set(p.key, (counts.get(p.key) ?? 0) + 1)

  const record = {}
  const dropped = []
  for (const p of pairs) {
    if (!expected.has(p.key) || (counts.get(p.key) ?? 0) > 1) {
      if (!dropped.includes(p.key)) dropped.push(p.key)
      continue
    }
    record[p.key] = p.text
  }
  return { record, dropped }
}
