import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildIndex } from '../build-index'
import { sha256 } from '../github'

const SKILL_MD = `---
name: Refund Audit
description: Đối chiếu refund với sổ quỹ.
tags: [woocommerce]
---
body
`

let root: string

async function writeRecord(namespace: string, slug: string) {
  await fs.mkdir(path.join(root, 'registry', namespace), { recursive: true })
  await fs.writeFile(
    path.join(root, 'registry', namespace, `${slug}.json`),
    JSON.stringify({
      namespace,
      slug,
      gitUrl: `https://github.com/${namespace}/skills`,
      ref: 'main',
      skillPath: `skills/${slug}`
    })
  )
}

const fetcher = vi.fn(async (url: string) => {
  if (url.startsWith('https://raw.githubusercontent.com/')) {
    return { ok: true, status: 200, text: async () => SKILL_MD, json: async () => ({}) }
  }
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ stargazers_count: 7, pushed_at: '2026-08-01T00:00:00Z' })
  }
})

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-'))
  fetcher.mockClear()
})

describe('buildIndex', () => {
  it('hydrates a record from its SKILL.md', async () => {
    await writeRecord('tracyhq', 'refund-audit')

    const { skills, warnings } = await buildIndex({ rootDir: root, fetcher, submittedByOf: () => 'lee' })

    expect(warnings).toEqual([])
    expect(skills).toHaveLength(1)
    expect(skills[0]!).toMatchObject({
      namespace: 'tracyhq',
      slug: 'refund-audit',
      displayName: 'Refund Audit',
      description: 'Đối chiếu refund với sổ quỹ.',
      tags: ['woocommerce'],
      externalStars: 7,
      lastCommitAt: '2026-08-01T00:00:00Z',
      submittedBy: 'lee',
      tier: 'listed',
      contentHash: sha256(SKILL_MD),
      sourceUrl: 'https://github.com/tracyhq/skills/tree/main/skills/refund-audit'
    })
  })

  it('keeps curated when the reviewed hash matches', async () => {
    await writeRecord('tracyhq', 'refund-audit')
    await fs.mkdir(path.join(root, 'curation', 'tracyhq'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'curation', 'tracyhq', 'refund-audit.json'),
      JSON.stringify({ tier: 'curated', reviewedHash: sha256(SKILL_MD), reviewedAt: '2026-08-03', reviewer: 'lee' })
    )

    const { skills } = await buildIndex({ rootDir: root, fetcher })
    const [first] = skills
    expect(first).toBeDefined()
    expect(first!.tier).toBe('curated')
  })

  it('demotes curated to listed and warns when the content changed', async () => {
    await writeRecord('tracyhq', 'refund-audit')
    await fs.mkdir(path.join(root, 'curation', 'tracyhq'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'curation', 'tracyhq', 'refund-audit.json'),
      JSON.stringify({ tier: 'curated', reviewedHash: 'c'.repeat(64), reviewedAt: '2026-08-03', reviewer: 'lee' })
    )

    const { skills, warnings } = await buildIndex({ rootDir: root, fetcher })
    const [first] = skills
    expect(first).toBeDefined()
    expect(first!.tier).toBe('listed')
    expect(warnings.join(' ')).toContain('demoted')
    expect(warnings.join(' ')).toContain('c'.repeat(64))
  })

  it('drops quarantined records from the index', async () => {
    await writeRecord('tracyhq', 'refund-audit')
    await fs.mkdir(path.join(root, 'curation', 'tracyhq'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'curation', 'tracyhq', 'refund-audit.json'),
      JSON.stringify({ tier: 'quarantined', reviewedHash: sha256(SKILL_MD), reviewedAt: '2026-08-03', reviewer: 'lee' })
    )

    const { skills } = await buildIndex({ rootDir: root, fetcher })
    expect(skills).toEqual([])
  })

  it('warns and skips a record whose SKILL.md is missing', async () => {
    await writeRecord('tracyhq', 'gone')
    const missing = vi.fn(async (url: string) =>
      url.startsWith('https://raw.')
        ? { ok: false, status: 404, text: async () => '', json: async () => ({}) }
        : { ok: true, status: 200, text: async () => '', json: async () => ({ stargazers_count: 0 }) }
    )

    const { skills, warnings } = await buildIndex({ rootDir: root, fetcher: missing })
    expect(skills).toEqual([])
    expect(warnings.join(' ')).toContain('SKILL.md not found')
  })

  it('falls back to the slug when frontmatter has no name', async () => {
    await writeRecord('tracyhq', 'refund-audit')
    const bare = vi.fn(async (url: string) =>
      url.startsWith('https://raw.')
        ? { ok: true, status: 200, text: async () => 'no frontmatter', json: async () => ({}) }
        : { ok: true, status: 200, text: async () => '', json: async () => ({ stargazers_count: 0 }) }
    )

    const { skills } = await buildIndex({ rootDir: root, fetcher: bare })
    const [first] = skills
    expect(first).toBeDefined()
    expect(first!.displayName).toBe('refund-audit')
    expect(first!.description).toBeNull()
  })

  it('sorts by namespace then slug so the output is stable', async () => {
    await writeRecord('zzz', 'a-skill')
    await writeRecord('aaa', 'b-skill')
    await writeRecord('aaa', 'a-skill')

    const { skills } = await buildIndex({ rootDir: root, fetcher })
    expect(skills.map((s) => `${s.namespace}/${s.slug}`)).toEqual(['aaa/a-skill', 'aaa/b-skill', 'zzz/a-skill'])
  })
})
