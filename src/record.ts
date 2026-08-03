import { isAbsolute as isAbsolutePosix } from 'node:path/posix'
import { isAbsolute as isAbsoluteWin32 } from 'node:path/win32'

import { z } from 'zod'

/**
 * Chỉ chấp nhận repo GitHub qua HTTPS, không userinfo/port/query/fragment: mọi fetcher ở
 * `github.ts` dựng URL từ giả định này — userinfo lọt qua có thể mang credential vào lệnh
 * `git clone`, còn query/fragment là rác vẫn bị coi là đúng format nếu không chặn.
 */
const GitUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:') return false
      if (url.hostname !== 'github.com') return false
      if (url.username || url.password) return false
      if (url.port) return false
      if (url.search || url.hash) return false
      const parts = url.pathname.split('/').filter(Boolean)
      return parts.length === 2
    } catch {
      return false
    }
  }, 'gitUrl must be https://github.com/{owner}/{repo}')

const SlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case')

/**
 * `skillPath` bị ghép vào đường dẫn khi Desk clone repo về, nên một `..` ở đây là
 * path traversal trên máy người dùng, không phải lỗi hiển thị. Phải kiểm tuyệt đối theo
 * cả POSIX lẫn win32 (`node:path`): trên Windows, `path.resolve(base, "C:/x")` coi
 * `C:/x` là tuyệt đối và vứt bỏ toàn bộ `base`, nên chỉ chặn `/` ở đầu là không đủ. Kiểm
 * riêng drive-letter vì dạng drive-relative (`C:foo/bar`) không được `win32.isAbsolute`
 * coi là tuyệt đối nhưng vẫn nguy hiểm.
 */
const SkillPathSchema = z
  .string()
  .min(1)
  .refine((value) => !isAbsolutePosix(value) && !isAbsoluteWin32(value), 'must be relative')
  .refine((value) => !/^[a-zA-Z]:/.test(value), 'must not start with a drive letter')
  .refine((value) => !value.split(/[\\/]/).includes('..'), 'must not contain ".."')
  .refine((value) => !value.includes('\\') && !value.includes('\0'), 'must not contain backslash or NUL')

export const SkillRecordSchema = z.object({
  $schema: z.string().optional(),
  namespace: SlugSchema,
  slug: SlugSchema,
  gitUrl: GitUrlSchema,
  ref: z.string().min(1).default('main'),
  skillPath: SkillPathSchema
})

export type SkillRecord = z.infer<typeof SkillRecordSchema>

export const TierSchema = z.enum(['listed', 'curated', 'quarantined'])
export type Tier = z.infer<typeof TierSchema>

/** Hình dạng một entry trong `dist/skills/index.json`. Mọi field ngoài record là do CI suy ra. */
export const HydratedSkillSchema = SkillRecordSchema.omit({ $schema: true }).extend({
  displayName: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  contentHash: z.string().length(64),
  externalStars: z.number().int().nonnegative(),
  lastCommitAt: z.string().nullable(),
  submittedBy: z.string().nullable(),
  tier: TierSchema,
  sourceUrl: z.string().url()
})

export type HydratedSkill = z.infer<typeof HydratedSkillSchema>

/**
 * Owner trong `gitUrl`, dùng để đối chiếu với `namespace`.
 *
 * CẢNH BÁO: phải gọi `SkillRecordSchema.parse()` (hoặc validate tương đương) trên `gitUrl`
 * TRƯỚC khi gọi hàm này. Hàm giả định `gitUrl` đã đúng dạng
 * `https://github.com/{owner}/{repo}` nên không tự phòng thủ lại — truyền chuỗi rỗng hoặc
 * không phải URL hợp lệ (`ownerOf('')`, `ownerOf('not-a-url')`) sẽ ném `TypeError` từ
 * `new URL()` thay vì trả lỗi có cấu trúc.
 */
export function ownerOf(gitUrl: string): string {
  return new URL(gitUrl).pathname.split('/').filter(Boolean)[0] ?? ''
}

/**
 * Repo name trong `gitUrl`, dùng để dựng URL raw.
 *
 * CẢNH BÁO: cùng ràng buộc như `ownerOf` — phải `SkillRecordSchema.parse()` trước khi gọi.
 * Hàm không tự validate `gitUrl`, input chưa qua schema sẽ khiến `new URL()` ném `TypeError`.
 */
export function repoOf(gitUrl: string): string {
  return new URL(gitUrl).pathname.split('/').filter(Boolean)[1] ?? ''
}
