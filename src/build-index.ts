import fs from 'node:fs/promises'
import path from 'node:path'

import { CurationRecordSchema, resolveTier } from './curation'
import { parseSkillFrontmatter } from './frontmatter'
import { fetchRepoMeta, fetchSkillMd, sha256, type Fetcher } from './github'
import { HydratedSkillSchema, SkillRecordSchema, type HydratedSkill } from './record'
import { validateRecordFile } from './validate'

export type BuildOptions = {
  rootDir: string
  fetcher: Fetcher
  /** Ai thêm file record này — mặc định suy từ git log ở `bin/build-index.ts`. */
  submittedByOf?: (filePath: string) => string | null
}

export type BuildResult = { skills: HydratedSkill[]; warnings: string[] }

async function listRecordFiles(rootDir: string): Promise<string[]> {
  const registryDir = path.join(rootDir, 'registry')
  const out: string[] = []
  let namespaces: string[]
  try {
    namespaces = await fs.readdir(registryDir)
  } catch {
    return out
  }
  for (const namespace of namespaces.sort()) {
    const dir = path.join(registryDir, namespace)
    if (!(await fs.stat(dir)).isDirectory()) continue
    for (const file of (await fs.readdir(dir)).sort()) {
      if (file.endsWith('.json')) out.push(path.join('registry', namespace, file))
    }
  }
  return out
}

async function readJson(absolutePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(absolutePath, 'utf8'))
  } catch {
    return null
  }
}

export async function buildIndex(options: BuildOptions): Promise<BuildResult> {
  const { rootDir, fetcher, submittedByOf } = options
  const warnings: string[] = []
  const skills: HydratedSkill[] = []

  for (const relativePath of await listRecordFiles(rootDir)) {
    const raw = await readJson(path.join(rootDir, relativePath))
    if (raw === null) {
      warnings.push(`${relativePath}: unreadable JSON`)
      continue
    }

    const errors = validateRecordFile(relativePath, raw)
    if (errors.length > 0) {
      warnings.push(`${relativePath}: ${errors.map((e) => `${e.code} (${e.message})`).join('; ')}`)
      continue
    }

    const record = SkillRecordSchema.parse(raw)

    let source: string
    try {
      source = await fetchSkillMd(record, fetcher)
    } catch (error) {
      warnings.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    const contentHash = sha256(source)
    const frontmatter = parseSkillFrontmatter(source)
    const meta = await fetchRepoMeta(record, fetcher)

    const curationRaw = await readJson(path.join(rootDir, 'curation', record.namespace, `${record.slug}.json`))
    const curationParsed = curationRaw === null ? null : CurationRecordSchema.safeParse(curationRaw)
    if (curationParsed && !curationParsed.success) {
      warnings.push(`curation/${record.namespace}/${record.slug}.json: invalid, ignored`)
    }
    const curation = curationParsed?.success ? curationParsed.data : null

    const { tier, demoted } = resolveTier(curation, contentHash)
    if (demoted && curation) {
      // Đây là dấu hiệu repo nguồn đã đổi sau khi Tracy review — chính kịch bản §5 của spec chặn.
      warnings.push(
        `${record.namespace}/${record.slug}: demoted from curated to listed — reviewed ${curation.reviewedHash}, now ${contentHash}`
      )
    }
    if (tier === 'quarantined') continue

    skills.push(
      HydratedSkillSchema.parse({
        namespace: record.namespace,
        slug: record.slug,
        gitUrl: record.gitUrl,
        ref: record.ref,
        skillPath: record.skillPath,
        displayName: frontmatter.name ?? record.slug,
        description: frontmatter.description,
        tags: frontmatter.tags,
        contentHash,
        externalStars: meta.stars,
        lastCommitAt: meta.pushedAt,
        submittedBy: submittedByOf?.(relativePath) ?? null,
        tier,
        sourceUrl: `${record.gitUrl}/tree/${record.ref}/${record.skillPath}`
      })
    )
  }

  return { skills, warnings }
}
