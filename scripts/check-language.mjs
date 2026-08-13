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
    if (VIETNAMESE.test(subject)) {
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
const targets = [...SOURCE.flatMap(walk), ...GENERATED.flatMap(walk)]
const offenders = []

for (const rel of targets) scanSourceFile(rel, offenders)
distOffenders(owned, offenders)

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
  `OK English — scanned ${targets.length} files` +
    `, plus served records in ${owned.size} Tracy-owned namespace(s): ${[...owned].sort().join(', ') || 'none'}`
)
