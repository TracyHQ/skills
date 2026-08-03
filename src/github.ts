import { createHash } from 'node:crypto'

import { ownerOf, repoOf, type SkillRecord } from './record'

export type FetchResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
}

export type Fetcher = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN
  return {
    'User-Agent': 'tracy-skills-registry',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export async function fetchSkillMd(record: SkillRecord, fetcher: Fetcher): Promise<string> {
  const url = `https://raw.githubusercontent.com/${ownerOf(record.gitUrl)}/${repoOf(record.gitUrl)}/${record.ref}/${record.skillPath}/SKILL.md`
  const response = await fetcher(url, { headers: headers() })
  if (!response.ok) {
    throw new Error(`SKILL.md not found (HTTP ${response.status}): ${url}`)
  }
  return response.text()
}

/**
 * Sao không ném khi API lỗi: sao và ngày commit là thứ trang trí. Rate limit của GitHub
 * không được phép làm rỗng cả registry — record vẫn đúng khi thiếu chúng.
 */
export async function fetchRepoMeta(
  record: SkillRecord,
  fetcher: Fetcher
): Promise<{ stars: number; pushedAt: string | null }> {
  const url = `https://api.github.com/repos/${ownerOf(record.gitUrl)}/${repoOf(record.gitUrl)}`
  try {
    const response = await fetcher(url, { headers: headers() })
    if (!response.ok) return { stars: 0, pushedAt: null }
    const body = (await response.json()) as { stargazers_count?: unknown; pushed_at?: unknown }
    return {
      stars: typeof body.stargazers_count === 'number' ? body.stargazers_count : 0,
      pushedAt: typeof body.pushed_at === 'string' ? body.pushed_at : null
    }
  } catch {
    return { stars: 0, pushedAt: null }
  }
}
