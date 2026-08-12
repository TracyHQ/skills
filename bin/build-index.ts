import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import { buildIndex } from '../src/build-index'

// This repo's own `owner/repo`, lowercase. Matched against each record's `gitUrl` so a skill
// added together with its record in the same PR gets read from the local checkout instead of
// 404ing against `raw.githubusercontent.com` on the default branch, where it doesn't exist yet.
const SELF_REPO = 'tracyhq/skills'

const root = process.cwd()
const outDir = path.join(root, 'dist', 'skills')

function submittedByOf(relativePath: string): string | null {
  try {
    const out = execFileSync('git', ['log', '--diff-filter=A', '--format=%an', '--', relativePath], {
      cwd: root,
      encoding: 'utf8'
    })
    return out.trim().split('\n').filter(Boolean).pop() ?? null
  } catch {
    return null
  }
}

const { skills, warnings } = await buildIndex({
  rootDir: root,
  fetcher: fetch as never,
  submittedByOf,
  selfRepo: SELF_REPO
})

for (const warning of warnings) console.warn(`warn ${warning}`)

await fs.rm(outDir, { recursive: true, force: true })
await fs.mkdir(outDir, { recursive: true })

const write = async (relative: string, data: unknown) => {
  const target = path.join(outDir, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, `${JSON.stringify(data, null, 2)}\n`)
}

await write('index.json', skills)
await write(
  'search.json',
  skills.map(({ namespace, slug, displayName, description, platforms, tags, requiresMcp, tier, externalStars }) => ({
    namespace,
    slug,
    displayName,
    description,
    platforms,
    tags,
    requiresMcp,
    tier,
    externalStars
  }))
)
for (const skill of skills) await write(path.posix.join(skill.namespace, `${skill.slug}.json`), skill)
await fs.cp(path.join(root, 'schema'), path.join(outDir, 'schema'), { recursive: true })

console.log(`wrote ${skills.length} skill(s) to ${outDir}`)
