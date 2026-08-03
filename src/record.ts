import { z } from 'zod'

/** Chỉ chấp nhận repo GitHub qua HTTPS: mọi fetcher ở `github.ts` dựng URL từ giả định này. */
const GitUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:') return false
      if (url.hostname !== 'github.com') return false
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
 * path traversal trên máy người dùng, không phải lỗi hiển thị.
 */
const SkillPathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/'), 'must be relative')
  .refine((value) => !value.split('/').includes('..'), 'must not contain ".."')
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

/** Owner trong `gitUrl`, dùng để đối chiếu với `namespace`. */
export function ownerOf(gitUrl: string): string {
  return new URL(gitUrl).pathname.split('/').filter(Boolean)[0] ?? ''
}

/** Repo name trong `gitUrl`, dùng để dựng URL raw. */
export function repoOf(gitUrl: string): string {
  return new URL(gitUrl).pathname.split('/').filter(Boolean)[1] ?? ''
}
