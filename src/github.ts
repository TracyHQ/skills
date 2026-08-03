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

/**
 * Encode each path segment: split by `/`, encode each segment, then join back. This keeps
 * the `/` between URL segments while encoding the dangerous characters.
 */
function encodePath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/')
}

/**
 * Checks whether a value contains a dot-segment (`.` or `..`). Used as an independent
 * defense layer that does not depend on the schema — even if the schema lets one through,
 * this layer still blocks it.
 */
function hasDotSegment(value: string): boolean {
  return value.split('/').some((s) => s === '.' || s === '..')
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Last line of defense: normalize the URL, then check it still lands inside the declared
 * repository.
 *
 * Why not trust encodeURIComponent: it does not encode `.`, so `..` passes through intact
 * and any WHATWG-URL-compliant client will collapse the dot-segment — escaping the repo.
 * Checking after normalization is the only approach that does not depend on guessing the
 * right set of dangerous characters.
 *
 * Returns the NORMALIZED href, and the caller must fetch this exact string — fetching the
 * original string instead means the thing that was checked and the thing that was sent are
 * two different strings.
 */
function assertWithinRepo(rawUrl: string, expectedHost: string, expectedPrefix: string): string {
  const url = new URL(rawUrl)
  if (url.hostname !== expectedHost || !url.pathname.startsWith(expectedPrefix)) {
    throw new Error(`resolved URL escapes the declared repository: ${url.href}`)
  }
  return url.href
}

export async function fetchSkillMd(record: SkillRecord, fetcher: Fetcher): Promise<string> {
  // Independent defense layer: reject dot-segments regardless of what the schema allowed
  if (hasDotSegment(record.ref) || hasDotSegment(record.skillPath)) {
    throw new Error(`ref or skillPath contains a dot segment: ${record.ref} ${record.skillPath}`)
  }

  const owner = encodeURIComponent(ownerOf(record.gitUrl))
  const repo = encodeURIComponent(repoOf(record.gitUrl))
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodePath(record.ref)}/${encodePath(record.skillPath)}/SKILL.md`
  const safeUrl = assertWithinRepo(url, 'raw.githubusercontent.com', `/${owner}/${repo}/`)
  const response = await fetcher(safeUrl, { headers: headers() })
  if (!response.ok) {
    throw new Error(`SKILL.md not found (HTTP ${response.status}): ${safeUrl}`)
  }
  return response.text()
}

/**
 * This does not throw when the API fails: stars and the commit date are cosmetic. A GitHub
 * rate limit must not be allowed to empty out the whole registry — a record is still valid
 * without them.
 */
export async function fetchRepoMeta(
  record: SkillRecord,
  fetcher: Fetcher
): Promise<{ stars: number; pushedAt: string | null }> {
  const owner = encodeURIComponent(ownerOf(record.gitUrl))
  const repo = encodeURIComponent(repoOf(record.gitUrl))
  const url = `https://api.github.com/repos/${owner}/${repo}`
  try {
    const safeUrl = assertWithinRepo(url, 'api.github.com', `/repos/${owner}/${repo}`)
    const response = await fetcher(safeUrl, { headers: headers() })
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
