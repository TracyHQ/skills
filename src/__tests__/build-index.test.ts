import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildIndex } from '../build-index'
import { sha256 } from '../github'

const SKILL_MD = `---
name: Refund Audit
description: Reconciles refunds against the ledger.
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
      description: 'Reconciles refunds against the ledger.',
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

  it('skips a broken symlink in registry/ instead of crashing the whole build', async () => {
    await writeRecord('tracyhq', 'refund-audit')
    await fs.symlink(
      path.join(root, 'does-not-exist'),
      path.join(root, 'registry', 'broken-sym')
    )

    const { skills, warnings } = await buildIndex({ rootDir: root, fetcher })

    expect(skills).toHaveLength(1)
    expect(skills[0]!.slug).toBe('refund-audit')
    expect(warnings.join(' ')).toContain('broken-sym')
    expect(warnings.join(' ')).toContain('cannot stat')
  })

  it('quietly skips a stray file sitting directly under registry/', async () => {
    await writeRecord('tracyhq', 'refund-audit')
    await fs.writeFile(path.join(root, 'registry', 'README.md'), 'not a namespace directory')

    const { skills, warnings } = await buildIndex({ rootDir: root, fetcher })

    expect(skills).toHaveLength(1)
    expect(skills[0]!.slug).toBe('refund-audit')
    expect(warnings).toEqual([])
  })

  it('fetches over HTTP when selfRepo is set but the record points elsewhere', async () => {
    await writeRecord('tracyhq', 'refund-audit')

    const { skills, warnings } = await buildIndex({ rootDir: root, fetcher, selfRepo: 'tracyhq/skills-desk' })

    expect(warnings).toEqual([])
    expect(skills).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('https://raw.githubusercontent.com/'),
      expect.anything()
    )
  })

  it('reads SKILL.md from disk when the record points at selfRepo and the file exists', async () => {
    await writeRecord('tracyhq', 'refund-audit')
    await fs.mkdir(path.join(root, 'skills', 'refund-audit'), { recursive: true })
    await fs.writeFile(path.join(root, 'skills', 'refund-audit', 'SKILL.md'), SKILL_MD)

    const { skills, warnings } = await buildIndex({ rootDir: root, fetcher, selfRepo: 'tracyhq/skills' })

    expect(warnings).toEqual([])
    expect(skills).toHaveLength(1)
    expect(skills[0]!.contentHash).toBe(sha256(SKILL_MD))
    for (const call of fetcher.mock.calls) {
      expect(call[0]).not.toContain('raw.githubusercontent.com')
    }
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('https://api.github.com/'), expect.anything())
  })

  it('warns and skips, without falling back to HTTP, when selfRepo matches but the file is missing on disk', async () => {
    await writeRecord('tracyhq', 'refund-audit')

    const { skills, warnings } = await buildIndex({ rootDir: root, fetcher, selfRepo: 'tracyhq/skills' })

    expect(skills).toEqual([])
    expect(warnings.join(' ')).toContain('SKILL.md not found on disk')
    for (const call of fetcher.mock.calls) {
      expect(call[0]).not.toContain('raw.githubusercontent.com')
    }
  })

  it('matches selfRepo case-insensitively against gitUrl', async () => {
    await fs.mkdir(path.join(root, 'registry', 'tracyhq'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'registry', 'tracyhq', 'refund-audit.json'),
      JSON.stringify({
        namespace: 'tracyhq',
        slug: 'refund-audit',
        gitUrl: 'https://github.com/TracyHQ/Skills',
        ref: 'main',
        skillPath: 'skills/refund-audit'
      })
    )
    await fs.mkdir(path.join(root, 'skills', 'refund-audit'), { recursive: true })
    await fs.writeFile(path.join(root, 'skills', 'refund-audit', 'SKILL.md'), SKILL_MD)

    const { skills, warnings } = await buildIndex({ rootDir: root, fetcher, selfRepo: 'tracyhq/skills' })

    expect(warnings).toEqual([])
    expect(skills).toHaveLength(1)
    expect(skills[0]!.contentHash).toBe(sha256(SKILL_MD))
  })

  it('behaves exactly as before when selfRepo is not passed', async () => {
    await writeRecord('tracyhq', 'refund-audit')

    const { skills, warnings } = await buildIndex({ rootDir: root, fetcher })

    expect(warnings).toEqual([])
    expect(skills).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('https://raw.githubusercontent.com/'),
      expect.anything()
    )
  })

  it('warns when a curation file exists but is not valid JSON', async () => {
    await writeRecord('tracyhq', 'refund-audit')
    await fs.mkdir(path.join(root, 'curation', 'tracyhq'), { recursive: true })
    await fs.writeFile(path.join(root, 'curation', 'tracyhq', 'refund-audit.json'), '{ this is not valid json')

    const { skills, warnings } = await buildIndex({ rootDir: root, fetcher })

    expect(skills[0]!.tier).toBe('listed')
    expect(warnings.join(' ')).toContain('curation/tracyhq/refund-audit.json')
    expect(warnings.join(' ')).toContain('unreadable JSON')
  })
})
