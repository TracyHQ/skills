import { describe, expect, it, vi } from 'vitest'

import { fetchRepoMeta, fetchSkillMd, sha256 } from '../github'
import type { SkillRecord } from '../record'

const record: SkillRecord = {
  namespace: 'tracyhq',
  slug: 'refund-audit',
  gitUrl: 'https://github.com/TracyHQ/skills',
  ref: 'main',
  skillPath: 'skills/refund-audit'
}

const ok = (body: string, json: unknown = {}) => ({
  ok: true,
  status: 200,
  text: async () => body,
  json: async () => json
})

describe('fetchSkillMd', () => {
  it('requests the raw SKILL.md at ref and path', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok('# hi'))
    await fetchSkillMd(record, fetcher)
    expect(fetcher).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/TracyHQ/skills/main/skills/refund-audit/SKILL.md',
      expect.anything()
    )
  })

  it('throws a readable error on 404', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '', json: async () => ({}) })
    await expect(fetchSkillMd(record, fetcher)).rejects.toThrow('SKILL.md not found')
  })
})

describe('fetchRepoMeta', () => {
  it('reads stars and pushed_at', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok('', { stargazers_count: 12, pushed_at: '2026-08-01T00:00:00Z' }))
    await expect(fetchRepoMeta(record, fetcher)).resolves.toEqual({ stars: 12, pushedAt: '2026-08-01T00:00:00Z' })
  })

  it('degrades to zero stars when the API fails', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '', json: async () => ({}) })
    await expect(fetchRepoMeta(record, fetcher)).resolves.toEqual({ stars: 0, pushedAt: null })
  })
})

describe('sha256', () => {
  it('hashes deterministically', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
