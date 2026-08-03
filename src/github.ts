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
 * Encode từng segment của đường dẫn: split by `/`, encode mỗi segment, rồi join lại.
 * Điều này giữ `/` giữa các segment trong URL mà encode các ký tự nguy hiểm.
 */
function encodePath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/')
}

/**
 * Kiểm xem giá trị có chứa dot-segment (`.` hoặc `..`). Được dùng làm lớp phòng thủ độc lập
 * không phụ thuộc schema — ngay cả khi schema bỏ qua, lớp này vẫn chặn.
 */
function hasDotSegment(value: string): boolean {
  return value.split('/').some((s) => s === '.' || s === '..')
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Lớp phòng thủ cuối: chuẩn hoá URL rồi kiểm nó CÒN nằm trong repo đã khai.
 *
 * Vì sao không tin encodeURIComponent: nó không encode dấu `.`, nên `..` đi qua nguyên vẹn và
 * mọi client theo chuẩn WHATWG URL sẽ rút gọn dot-segment — thoát khỏi repo. Kiểm sau khi
 * chuẩn hoá là cách duy nhất không phụ thuộc vào việc đoán đúng tập ký tự nguy hiểm.
 *
 * Trả về href ĐÃ CHUẨN HOÁ, và caller phải fetch đúng chuỗi này — nếu fetch chuỗi gốc thì thứ
 * được kiểm và thứ được gửi đi là hai chuỗi khác nhau.
 */
function assertWithinRepo(rawUrl: string, expectedHost: string, expectedPrefix: string): string {
  const url = new URL(rawUrl)
  if (url.hostname !== expectedHost || !url.pathname.startsWith(expectedPrefix)) {
    throw new Error(`resolved URL escapes the declared repository: ${url.href}`)
  }
  return url.href
}

export async function fetchSkillMd(record: SkillRecord, fetcher: Fetcher): Promise<string> {
  // Lớp phòng thủ độc lập: từ chối dot-segment độc lập với schema
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
 * Thứ tư không ném khi API lỗi: thứ tư và ngày commit là thứ trang trí. Rate limit của GitHub
 * không được phép làm rỗng cả registry — record vẫn đúng khi thiếu chúng.
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
