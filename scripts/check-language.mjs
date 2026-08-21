#!/usr/bin/env node
/**
 * Fail the build if Tracy-authored text in this public repo is not in English.
 *
 *   node scripts/check-language.mjs
 *
 * WHY THIS EXISTS
 *
 * ADR 0016 (TracyHQ/tracy-docs) requires every public-repo surface Tracy writes — README,
 * source comments, commit messages, and any string this repo generates onto a served surface
 * — to be in English. The incident that produced the rule was a Vietnamese `note` string
 * inside `mcp-registry`'s `dist/findings/index.json`, served to every consumer of that public
 * API and missed across several reviews, because a reviewer fluent in the language does not
 * perceive it as the wrong language. That is exactly the class of mistake to hand to a
 * machine: mechanical, invisible to the person best placed to notice it, and only embarrassing
 * once an outside reader hits it. This copy adapts `mcp-registry/scripts/check-language.mjs`
 * to this repo's layout; ADR 0016 says the script does not travel on its own, so a new public
 * repo must copy it in by hand.
 *
 * WHAT CHANGED ON 2026-08-13, AND WHY THE FIRST VERSION MISSED A REAL VIOLATION
 *
 * This script ran green in CI for ten days while four Vietnamese sentences sat in
 * `registry.tracy.ai/skills/index.json` and rendered on tracy.ai/skills/. It missed them
 * because both of its boundaries were drawn from one assumption:
 *
 *     this repo INDEXES other people's skills.
 *
 * That was true when it was written. It stopped being true when Tracy began HOSTING its own
 * skills here, under the `tracyhq` namespace, with `gitUrl` pointing back at this repo. Two
 * holes opened at once, and they are the same hole seen twice:
 *
 *   1. `skills/` — the directory holding Tracy's own SKILL.md files — was never in SOURCE.
 *      Nobody removed it; it did not exist when SOURCE was written.
 *   2. `dist/skills/*.json` was excluded wholesale, on the reasoning that every `description`
 *      in it is third-party content this repo promises never to translate. That reasoning is
 *      still right about third-party records and now wrong about Tracy's own.
 *
 * The lesson is not "scan more". It is that an exclusion justified by WHO WROTE THE TEXT has
 * to be computed from who wrote the text, not from a path. So Tracy-owned namespaces are now
 * derived from the registry coordinates (`gitUrl` under github.com/TracyHQ), and the exemption
 * follows ownership wherever the files move. A new Tracy skill is covered the day it lands; a
 * new third-party skill stays exempt without anyone editing this file.
 *
 * WHAT IS AND IS NOT CHECKED
 *
 * Checked: everything Tracy writes in this repo — prose, comments, tests, its own SKILL.md
 * files, the generated schema, and Tracy's own records on the served surface.
 *
 * Not checked, deliberately:
 *
 *   - Records in `dist/` belonging to a namespace Tracy does not own. `displayName`,
 *     `description`, `tags` and `submittedBy` there are copied verbatim from someone else's
 *     `SKILL.md`. "Translate the data" is a data-corruption bug, not a language fix.
 *   - Double-quoted spans inside a skill DESCRIPTION. Those are trigger phrases — specimens of
 *     what a user might type, which is how a skill written for Vietnamese speakers gets found
 *     at all. Translating them would silently break the feature they exist for. The prose
 *     AROUND them is Tracy's and is still checked, which is exactly what caught the four
 *     sentences above: the phrases in quotes were fine, and the two Vietnamese words that
 *     introduced them were not. (Those words are not reproduced here — this file is scanned
 *     by its own rule, and quoting a violation to explain it is how the last version of this
 *     script failed itself.)
 *
 *     This exemption is deliberately narrow — a quoted span is only ignored on a line that is
 *     a skill description (frontmatter `description:`, or a `description`/`displayName` value
 *     in a record). Everywhere else, quotes mean nothing and the text inside them is scanned
 *     like any other. A blanket "ignore anything in quotes" would be a hole wide enough to
 *     hide a paragraph in.
 *
 * WHY CODE POINTS INSTEAD OF LITERAL CHARACTERS
 *
 * The first version of this class of script (in mcp-registry) wrote the alphabet out
 * literally and therefore failed its own check. Adding a self-exemption would have left a
 * hole big enough to hide a real violation in, so the pattern is built from escapes and the
 * comments name characters instead of showing them. This file is scanned by the same rule as
 * every other: `scripts/` is listed in SOURCE below, on purpose, so this file checks itself.
 * A gatekeeper that exempts its own directory is a gatekeeper nobody is checking.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * Letters unique to Vietnamese:
 *   U+0102/0103  A-breve
 *   U+0110/0111  D-stroke
 *   U+01A0/01A1  O-horn
 *   U+01AF/01B0  U-horn
 *   U+1EA0-1EF9  the Vietnamese tone-mark block (hook-above and dot-below)
 *
 * Deliberately EXCLUDES the acute, grave and circumflex forms in Latin-1 Supplement that
 * Vietnamese shares with Portuguese, French, Spanish and Hungarian — real names anywhere in
 * this dataset could use those, and flagging them would train everyone to ignore this check.
 *
 * It cannot catch Vietnamese typed without diacritics. The written rule in ADR 0016 covers
 * what a regex cannot.
 */
const VIETNAMESE = /[\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/u

/**
 * Vietnamese the character class above cannot see, because every diacritic in these words is one
 * the Latin languages share. Widening the class instead would flag this repo's legitimate French
 * and Spanish specimens, so the second reader is a short list of function words with no
 * plausible collision in the languages this repo actually quotes.
 *
 * Six words, built from escapes for the same reason the alphabet above is: written literally
 * they would match themselves and this file would fail its own check.
 *
 * Deliberately excluded, each for a measured reason: the word meaning "to be" collides with a
 * French adverb; one more is also a common given name; and a third appears inside
 * `faq-analysis.mjs`'s question cues, which are language DATA the matcher compares against and
 * must never be translated. Measured across every tracked file, the six below add exactly one
 * hit, and that hit was a real defect.
 *
 * THE DEFECT THEY FOUND, AND WHY A CHARACTER CLASS COULD NEVER HAVE
 *
 * `site-scan/engine/digest.ts` wrote a sentence into the digest a user reads — a count of
 * remaining findings and a pointer to the JSON holding them. Its only diacritic was an
 * o-with-grave, shared with French, so the class above passed it.
 *
 * Worse, the shipped artifact is a bundle, and esbuild escapes non-ASCII: in
 * `site-scan/scripts/scan.cjs` that o-with-grave became a `\x` escape and the em dash a `\u`
 * escape. No character check can reach text that has been escaped away, which means the string
 * a user actually saw was invisible to this script by construction — while the source it was
 * built from had already been fixed and the bundle never rebuilt.
 *
 * The words survive escaping. They are ASCII, so they pass through a bundler unchanged, and
 * that is the whole reason this second reader exists.
 */
const VIETNAMESE_WORDS =
  /(?<![\p{L}\p{N}])(c\u00F2n|x\u0065m|v\u00E0|ch\u006F|c\u00E1c|n\u00E0y)(?![\p{L}\p{N}])/iu

/**
 * Everything this file counts as non-English, applied to one line.
 *
 * Note what this deliberately does NOT do: decode escape sequences before judging. Escaping
 * serves two opposite purposes — a bundler uses it to compress non-ASCII away, and hand-written
 * source uses it to name a character explicitly, as the fold map further down does. Decoding
 * treats the second as the first: it produced 34 false readings on this repo's own code, most of
 * them inside this very file, which is a gate nobody would keep.
 *
 * It is also unnecessary, for the reason given above: escaping reaches the characters and leaves
 * the words alone.
 */
function isNonEnglish(line) {
  return VIETNAMESE.test(line) || VIETNAMESE_WORDS.test(line)
}

/**
 * Tracy-authored source. Anything added here must be prose we control.
 *
 * `skills/` is here because this repo hosts Tracy's own skills, not only pointers to other
 * people's. Its absence is what let four Vietnamese descriptions reach production.
 */
const SOURCE = [
  'README.md',
  'registry/README.md',
  'LICENSE',
  'LICENSE-DATA',
  'CODEOWNERS',
  'src',
  'bin',
  'schema',
  '.github',
  'registry',
  'scripts',
  'skills'
]

/**
 * Generated files that reach consumers and are wholly Tracy's own structure. The schema copy
 * is derived straight from `SkillRecordSchema` in `src/record.ts`.
 *
 * The record files under `dist/skills/` are NOT here: they mix Tracy's prose with third-party
 * prose, so they cannot be judged by path. They are handled by `distOffenders()` below, which
 * judges them one record at a time by who owns the namespace.
 */
const GENERATED = ['dist/skills/schema']

/** Every file under `rel`, or `[rel]` if it is a file, or `[]` if it does not exist. */
function walk(rel) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [rel]
  return fs
    .readdirSync(abs)
    .sort()
    .flatMap((entry) => walk(path.join(rel, entry)))
}

/**
 * The namespaces Tracy writes, read from the registry rather than hardcoded.
 *
 * A record's `gitUrl` is where the SKILL.md actually lives, so it answers "did Tracy write
 * this?" directly. Hardcoding `tracyhq` would work today and rot the first time a Tracy skill
 * ships under a second namespace — the same way hardcoding paths rotted the last version.
 */
function tracyNamespaces() {
  const owned = new Set()
  for (const rel of walk('registry')) {
    if (!rel.endsWith('.json')) continue
    let record
    try {
      record = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    } catch {
      continue // `pnpm validate` owns malformed records; this script only reads them.
    }
    if (typeof record?.gitUrl !== 'string' || typeof record?.namespace !== 'string') continue
    if (/^https:\/\/github\.com\/TracyHQ\//i.test(record.gitUrl)) owned.add(record.namespace)
  }
  return owned
}

/**
 * Blank out double-quoted spans, keeping the quotes so the surrounding prose still reads as
 * separate words. Applied ONLY to skill descriptions — see the docblock.
 */
function withoutQuotedPhrases(text) {
  return text.replace(/"[^"]*"/g, '""')
}

/** A frontmatter description line in a SKILL.md, e.g. `description: Draft the ...`. */
const FRONTMATTER_DESCRIPTION = /^description:/

/** Lines that are Tracy's own SKILL.md descriptions get the quoted-phrase exemption. */
function scanSourceFile(rel, offenders) {
  const isSkillDoc = rel.startsWith(`skills${path.sep}`) && rel.endsWith('SKILL.md')
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')

  text.split('\n').forEach((line, i) => {
    const subject =
      isSkillDoc && FRONTMATTER_DESCRIPTION.test(line) ? withoutQuotedPhrases(line) : line
    if (isNonEnglish(subject)) {
      offenders.push({ rel, line: i + 1, text: line.trim().slice(0, 110) })
    }
  })
}

/**
 * Tracy's own records on the served surface.
 *
 * `index.json` is the file consumers actually read, and it carries every namespace at once —
 * so it is scanned record by record and third-party entries are skipped, rather than the whole
 * file being excluded as it was before. `displayName` and `description` get the quoted-phrase
 * exemption; every other string field is coordinates or Tracy's classification and gets none.
 */
function distOffenders(owned, offenders) {
  const rel = path.join('dist', 'skills', 'index.json')
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return // Not built yet; CI runs this step after `build-index`.

  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch (error) {
    console.error(`Could not parse ${rel}: ${error.message}`)
    process.exit(1)
  }

  const records = Array.isArray(parsed) ? parsed : (parsed.skills ?? parsed.items ?? [])
  const DESCRIPTIVE = new Set(['description', 'displayName'])

  for (const record of records) {
    if (!owned.has(record?.namespace)) continue
    for (const [field, value] of Object.entries(record)) {
      if (typeof value !== 'string') continue
      const subject = DESCRIPTIVE.has(field) ? withoutQuotedPhrases(value) : value
      if (VIETNAMESE.test(subject)) {
        offenders.push({
          rel,
          line: `${record.namespace}/${record.slug}`,
          text: `${field}: ${value.trim().slice(0, 96)}`
        })
      }
    }
  }
}

const owned = tracyNamespaces()

/**
 * Commit messages.
 *
 * ADR 0016 has always covered them — the docblock at the top of this file says so — and this
 * script has never read one. Five Vietnamese subjects reached the public history of this repo
 * while every run stayed green, and they cannot be taken back: rewriting the history of a public
 * repository invalidates every clone, fork and open PR, which is a price far above five lines.
 * So the history stands and this closes the door behind it.
 *
 * Choosing what to read is the whole difficulty. A pull_request build checks out a MERGE commit
 * whose first parent is the base and whose second is the branch, so `base..head` is exactly the
 * commits under review — no more, and none of the base's. Elsewhere (a push build, a local run)
 * that shape does not exist and the comparison falls back to the default branch.
 *
 * When neither is available the check SAYS it is skipping rather than passing silently. A gate
 * that quietly checks nothing reports the same green as one that checked everything, and that is
 * how the four Vietnamese descriptions this script was written for survived in the first place.
 */
function commitRange() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    const parents = git('rev-list', '--parents', '-n', '1', 'HEAD').split(/\s+/)
    if (parents.length === 3) return `${parents[1]}..${parents[2]}` // a PR merge ref
  } catch { /* not a merge, or no git */ }
  for (const base of ['origin/main', 'main']) {
    try {
      git('rev-parse', '--verify', base)
      const range = `${base}..HEAD`
      git('rev-list', '--count', range)
      return range
    } catch { /* try the next one */ }
  }
  return null
}

function scanCommitMessages(offenders) {
  const range = commitRange()
  if (!range) {
    console.warn('check-language: no commit range to compare against — commit messages NOT checked')
    return 0
  }
  let raw
  try {
    raw = execFileSync('git', ['log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', range],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    console.warn(`check-language: could not read commits in ${range} — commit messages NOT checked`)
    return 0
  }
  const commits = raw.split('\x1e').map((c) => c.trim()).filter(Boolean)
  for (const commit of commits) {
    const [sha, subject, body] = commit.split('\x1f')
    for (const [where, text] of [['subject', subject], ['body', body]]) {
      if (!text) continue
      const bad = text.split('\n').find(isNonEnglish)
      if (bad) offenders.push({ rel: `commit ${sha.slice(0, 9)} (${where})`, line: 1, text: bad.trim().slice(0, 110) })
    }
  }
  return commits.length
}

const targets = [...SOURCE.flatMap(walk), ...GENERATED.flatMap(walk)]
const offenders = []

for (const rel of targets) scanSourceFile(rel, offenders)
distOffenders(owned, offenders)
const commitCount = scanCommitMessages(offenders)

if (offenders.length) {
  console.error('Non-English text in a public repo. Everything Tracy writes here must be English.')
  console.error('Rule: ADR 0016 in TracyHQ/tracy-docs.\n')
  for (const o of offenders) console.error(`  ${o.rel}:${o.line}\n    ${o.text}`)
  console.error(
    `\n${offenders.length} finding(s). Records in namespaces Tracy does not own carry third-party ` +
      'prose and are exempt by design; so are quoted trigger phrases inside a skill description ' +
      '(see the docblock above).'
  )
  process.exit(1)
}

console.log(
  `OK English — scanned ${targets.length} files and ${commitCount} commit message(s)` +
    `, plus served records in ${owned.size} Tracy-owned namespace(s): ${[...owned].sort().join(', ') || 'none'}`
)
