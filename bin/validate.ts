import fs from 'node:fs/promises'
import path from 'node:path'

import { ownerOf, repoOf, SkillRecordSchema } from '../src/record'
import { validateNumberedReference, validateRecordFile, validateSkillFrontmatter } from '../src/validate'

/** Same identity `bin/build-index.ts` uses to decide a skill's source is on this disk. */
const SELF_REPO = 'tracyhq/skills'

/**
 * Numbered lists in a skill's `references/`, and every citation of them inside that skill.
 * See {@link validateNumberedReference} for the failure this exists to stop.
 */
async function checkNumberedReferences(absSkillDir: string, skillPath: string) {
  const refDir = path.join(absSkillDir, 'references')
  const refs = await fs.readdir(refDir).catch(() => [] as string[])
  const out: { code: string; message: string }[] = []
  if (refs.length === 0) return out

  // Every text file in the skill can carry a citation — SKILL.md, scripts, examples.
  const citations: { file: string; text: string }[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (/\.(md|sh|mjs|js|ts|json|txt)$/.test(entry.name)) {
        citations.push({
          file: path.posix.join(skillPath, path.relative(absSkillDir, full).split(path.sep).join('/')),
          text: await fs.readFile(full, 'utf8').catch(() => '')
        })
      }
    }
  }
  await walk(absSkillDir)

  for (const ref of refs.filter((f) => f.endsWith('.md')).sort()) {
    const source = await fs.readFile(path.join(refDir, ref), 'utf8').catch(() => null)
    if (source === null) continue
    out.push(
      ...validateNumberedReference(path.posix.join(skillPath, 'references', ref), source, citations)
    )
  }
  return out
}

const root = process.cwd()
const registryDir = path.join(root, 'registry')
let failed = 0

const namespaces = await fs.readdir(registryDir).catch(() => [] as string[])
for (const namespace of namespaces.sort()) {
  const dir = path.join(registryDir, namespace)
  if (!(await fs.stat(dir)).isDirectory()) continue
  for (const file of (await fs.readdir(dir)).sort()) {
    if (!file.endsWith('.json')) continue
    const relative = path.posix.join('registry', namespace, file)
    let raw: unknown
    try {
      raw = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'))
    } catch (error) {
      console.error(`FAIL ${relative}: unreadable JSON — ${error instanceof Error ? error.message : error}`)
      failed += 1
      continue
    }
    const errors = validateRecordFile(relative, raw)
    // The frontmatter half (ADR 0053) — only for skills whose source is in this repository. A
    // record pointing at somebody else's repo names a SKILL.md this checkout does not have, and
    // a gate nobody can satisfy is a gate that gets switched off.
    const record = SkillRecordSchema.safeParse(raw)
    if (errors.length === 0 && record.success) {
      const inThisRepo = `${ownerOf(record.data.gitUrl)}/${repoOf(record.data.gitUrl)}`.toLowerCase()
      if (inThisRepo === SELF_REPO) {
        const skillFile = path.join(root, record.data.skillPath, 'SKILL.md')
        const source = await fs.readFile(skillFile, 'utf8').catch(() => null)
        if (source === null) {
          errors.push({ code: 'skill_md_missing', message: `SKILL.md not found at ${record.data.skillPath}` })
        } else {
          errors.push(
            ...validateSkillFrontmatter(path.posix.join(record.data.skillPath, 'SKILL.md'), source, record.data)
          )
          errors.push(...(await checkNumberedReferences(path.join(root, record.data.skillPath), record.data.skillPath)))
        }
      }
    }
    if (errors.length === 0) {
      console.log(`ok   ${relative}`)
      continue
    }
    failed += 1
    for (const error of errors) console.error(`FAIL ${relative}: [${error.code}] ${error.message}`)
  }
}

if (failed > 0) {
  console.error(`${failed} record(s) failed validation`)
  process.exit(1)
}
