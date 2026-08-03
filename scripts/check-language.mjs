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
 * WHAT IS AND IS NOT CHECKED
 *
 * Checked: everything Tracy writes in this repo — prose, comments, tests, and any string this
 * repo GENERATES into the served surface (the schema copy under `dist/skills/schema/`).
 *
 * Not checked, and deliberately excluded by name below:
 *
 *   - `dist/skills/index.json`, `dist/skills/search.json`, and every
 *     `dist/skills/<namespace>/<slug>.json` file. Every one of these is built from fields
 *     that are either coordinates (namespace, slug, tier, hashes, URLs — not prose in any
 *     language) or third-party content copied verbatim from someone else's `SKILL.md`
 *     (`displayName`, `description`, `tags`) or a third-party git author name (`submittedBy`).
 *     None of it is Tracy's own prose. Flagging it would mean either scanning the exact field
 *     this repo promises never to translate, or hand-maintaining a field allowlist that drifts
 *     the moment `HydratedSkillSchema` grows a field — both worse than excluding the files.
 *     "Translate the data" is a data-corruption bug, not a language fix.
 *   - `registry/**` is Tracy-controlled but holds only coordinates (namespace, slug, gitUrl,
 *     ref, skillPath) — no prose exists there to mistranslate, so it is safe to include in the
 *     scan below; it will simply never match.
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

/** Tracy-authored source. Anything added here must be prose we control. */
const SOURCE = [
  'README.md',
  'LICENSE',
  'LICENSE-DATA',
  'CODEOWNERS',
  'src',
  'bin',
  'schema',
  '.github',
  'registry',
  'scripts'
]

/**
 * Generated files that reach consumers. Only the schema copy: it is derived straight from
 * `SkillRecordSchema` in `src/record.ts`, so it is Tracy's own structure, not third-party
 * data. The per-skill index files are excluded above — see the module docblock.
 */
const GENERATED = ['dist/skills/schema']

function walk(rel) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [rel]
  return fs
    .readdirSync(abs)
    .sort()
    .flatMap((entry) => walk(path.join(rel, entry)))
}

const targets = [...SOURCE.flatMap(walk), ...GENERATED.flatMap(walk)]
const offenders = []

for (const rel of targets) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  text.split('\n').forEach((line, i) => {
    if (VIETNAMESE.test(line)) {
      offenders.push({ rel, line: i + 1, text: line.trim().slice(0, 110) })
    }
  })
}

if (offenders.length) {
  console.error('Non-English text in a public repo. Everything Tracy writes here must be English.')
  console.error('Rule: ADR 0016 in TracyHQ/tracy-docs.\n')
  for (const o of offenders) console.error(`  ${o.rel}:${o.line}\n    ${o.text}`)
  console.error(
    `\n${offenders.length} line(s). dist/skills/index.json, search.json and per-skill files carry third-party data and are exempt by design (see docblock above).`
  )
  process.exit(1)
}

console.log(`OK English — scanned ${targets.length} files`)
