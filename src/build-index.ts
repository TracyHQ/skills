import fs from 'node:fs/promises'
import path from 'node:path'

import { CurationRecordSchema, resolveTier, type CurationRecord } from './curation'
import { parseSkillFrontmatter } from './frontmatter'
import { fetchRepoMeta, fetchSkillMd, sha256, type Fetcher } from './github'
import { HydratedSkillSchema, SkillRecordSchema, type HydratedSkill } from './record'
import { validateRecordFile } from './validate'

export type BuildOptions = {
  rootDir: string
  fetcher: Fetcher
  /** Who added this record file — defaults to a git-log lookup in `bin/build-index.ts`. */
  submittedByOf?: (filePath: string) => string | null
}

export type BuildResult = { skills: HydratedSkill[]; warnings: string[] }

async function listRecordFiles(rootDir: string, warnings: string[]): Promise<string[]> {
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

    // A broken symlink, or an entry that vanished between readdir and stat. This registry
    // accepts PRs from outsiders, so a broken entry must be skipped with a warning, not
    // crash the whole build.
    let isDirectory: boolean
    try {
      isDirectory = (await fs.stat(dir)).isDirectory()
    } catch {
      warnings.push(`registry/${namespace}: cannot stat entry, skipped`)
      continue
    }
    if (!isDirectory) continue

    let files: string[]
    try {
      files = await fs.readdir(dir)
    } catch {
      warnings.push(`registry/${namespace}: cannot read directory, skipped`)
      continue
    }
    for (const file of files.sort()) {
      if (file.endsWith('.json')) out.push(path.join('registry', namespace, file))
    }
  }
  return out
}

type ReadJsonResult = { ok: true; value: unknown } | { ok: false; missing: boolean }

/**
 * Distinguishes "file does not exist" (normal — curation is optional) from "file exists but
 * the JSON is malformed" (abnormal — must warn). Collapsing both cases into the same `null`
 * would let a broken curation file silently fall back to "no curation", and nobody would know
 * why the record lost its tier.
 */
async function readJson(absolutePath: string): Promise<ReadJsonResult> {
  let text: string
  try {
    text = await fs.readFile(absolutePath, 'utf8')
  } catch {
    return { ok: false, missing: true }
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, missing: false }
  }
}

export async function buildIndex(options: BuildOptions): Promise<BuildResult> {
  const { rootDir, fetcher, submittedByOf } = options
  const warnings: string[] = []
  const skills: HydratedSkill[] = []

  for (const relativePath of await listRecordFiles(rootDir, warnings)) {
    const recordJson = await readJson(path.join(rootDir, relativePath))
    if (!recordJson.ok) {
      warnings.push(`${relativePath}: unreadable JSON`)
      continue
    }
    const raw = recordJson.value

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

    const curationJson = await readJson(path.join(rootDir, 'curation', record.namespace, `${record.slug}.json`))
    let curation: CurationRecord | null = null
    if (curationJson.ok) {
      const curationParsed = CurationRecordSchema.safeParse(curationJson.value)
      if (curationParsed.success) {
        curation = curationParsed.data
      } else {
        warnings.push(`curation/${record.namespace}/${record.slug}.json: invalid, ignored`)
      }
    } else if (!curationJson.missing) {
      // File exists but the JSON is malformed — very different from "no curation". Not
      // warning here would let a curator who broke a file watch the record lose its `curated`
      // tier and mistake it for a hash mismatch.
      warnings.push(`curation/${record.namespace}/${record.slug}.json: unreadable JSON, ignored`)
    }

    const { tier, demoted } = resolveTier(curation, contentHash)
    if (demoted && curation) {
      // This is the sign that the source repo changed after Tracy reviewed it — exactly the
      // scenario spec section 5 guards against.
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
