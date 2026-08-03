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

  it('throws when status is 403', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '', json: async () => ({}) })
    await expect(fetchSkillMd(record, fetcher)).rejects.toThrow('SKILL.md not found')
  })

  it('throws when fetcher throws', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network error'))
    await expect(fetchSkillMd(record, fetcher)).rejects.toThrow('network error')
  })

  it('encodes ref slashes as segments, not raw characters', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok('# hi'))
    const recordWithMultipartRef = { ...record, ref: 'release/2026-08' }
    await fetchSkillMd(recordWithMultipartRef, fetcher)
    const callUrl = fetcher.mock.calls[0]?.[0] as string
    expect(callUrl).toBe('https://raw.githubusercontent.com/TracyHQ/skills/release/2026-08/skills/refund-audit/SKILL.md')
  })

  it('throws when ref escapes via path traversal (e.g. main/../../../evil)', async () => {
    const fetcher = vi.fn()
    const maliciousRecord = { ...record, ref: 'main/../../../evil/evil/main' }
    await expect(fetchSkillMd(maliciousRecord, fetcher)).rejects.toThrow('resolved URL escapes the declared repository')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('throws when skillPath escapes via path traversal', async () => {
    const fetcher = vi.fn()
    const maliciousRecord = { ...record, skillPath: '../../../evil' }
    await expect(fetchSkillMd(maliciousRecord, fetcher)).rejects.toThrow('resolved URL escapes the declared repository')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fetcher receives the normalized URL (href from new URL())', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok('# hi'))
    const recordWithMultipartRef = { ...record, ref: 'release/2026-08' }
    await fetchSkillMd(recordWithMultipartRef, fetcher)
    const callUrl = fetcher.mock.calls[0]?.[0] as string
    // URL should be normalized: new URL('https://example.com/a/./b/../c').href returns https://example.com/a/c
    const normalizedUrl = new URL(callUrl).href
    expect(normalizedUrl).toBe(callUrl)
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

  it('never throws: fetcher throws', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network error'))
    await expect(fetchRepoMeta(record, fetcher)).resolves.toEqual({ stars: 0, pushedAt: null })
  })

  it('never throws: ok=true but json() throws', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => {
        throw new Error('parse error')
      }
    })
    await expect(fetchRepoMeta(record, fetcher)).resolves.toEqual({ stars: 0, pushedAt: null })
  })

  it('never throws: JSON missing stargazers_count', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok('', { pushed_at: '2026-08-01T00:00:00Z' }))
    await expect(fetchRepoMeta(record, fetcher)).resolves.toEqual({ stars: 0, pushedAt: '2026-08-01T00:00:00Z' })
  })

  it('never throws: stargazers_count is a string', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok('', { stargazers_count: '12', pushed_at: '2026-08-01T00:00:00Z' }))
    await expect(fetchRepoMeta(record, fetcher)).resolves.toEqual({ stars: 0, pushedAt: '2026-08-01T00:00:00Z' })
  })
})

describe('sha256', () => {
  it('hashes deterministically', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
