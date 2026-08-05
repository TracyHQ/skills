import { isAbsolute as isAbsolutePosix } from 'node:path/posix'
import { isAbsolute as isAbsoluteWin32 } from 'node:path/win32'

import { z } from 'zod'

/**
 * Only accepts a GitHub repo over HTTPS, no userinfo/port/query/fragment: every fetcher in
 * `github.ts` builds its URL from this assumption — userinfo slipping through could carry a
 * credential into a `git clone` command, and query/fragment junk would otherwise pass as a
 * valid format if left unchecked.
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
 * `skillPath` gets joined into a filesystem path when Desk clones the repo down, so a `..`
 * here is a path traversal on the user's machine, not a display bug. It must be checked as
 * absolute on both POSIX and win32 (`node:path`): on Windows, `path.resolve(base, "C:/x")`
 * treats `C:/x` as absolute and discards `base` entirely, so blocking a leading `/` alone is
 * not enough. The drive-letter case is checked separately because a drive-relative form
 * (`C:foo/bar`) is not considered absolute by `win32.isAbsolute` but is still dangerous.
 */
const SkillPathSchema = z
  .string()
  .min(1)
  .refine((value) => !isAbsolutePosix(value) && !isAbsoluteWin32(value), 'must be relative')
  .refine((value) => !/^[a-zA-Z]:/.test(value), 'must not start with a drive letter')
  .refine((value) => !value.split(/[\\/]/).includes('..'), 'must not contain ".."')
  .refine((value) => !value.includes('\\') && !value.includes('\0'), 'must not contain backslash or NUL')

/**
 * `ref` is joined into the same raw URL as `skillPath`, so it needs the same level of
 * defense. A `ref` like `main/../../other` gets normalized by `new URL()` and escapes into a
 * different repo — constraining `skillPath` while leaving `ref` open only closes half the
 * door.
 * Allowed: branch names, tags, and SHAs. Not allowed: `..`, whitespace, `?`, `#`, `\`, NUL.
 */
const RefSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._\-\/]+$/, 'ref may only contain letters, digits, dot, underscore, hyphen and slash')
  .refine((v) => !v.split('/').includes('..'), 'ref must not contain ".."')
  .refine((v) => !v.startsWith('/') && !v.endsWith('/'), 'ref must not start or end with "/"')

/**
 * The platforms a skill runs on. A closed vocabulary, and deliberately not the same axis as
 * the `tags:` in the author's `SKILL.md`.
 *
 * Tags answer "what does this skill do" (`security`, `wp-cli`, `maintenance`). Platform
 * answers "what does it run on". Carrying both on one free-text list meant every client had
 * to re-derive the second from the first by intersecting against a hardcoded list of four
 * names, and nothing checked the result: `Joomla!`, `joomla-6`, or no platform tag at all
 * were indistinguishable from a correct record until someone noticed a chip row looked wrong.
 *
 * Closed rather than free-text because a filter vocabulary is a product decision, not a
 * description. An open list produces one chip per spelling, which is the failure this field
 * exists to prevent. Adding a platform is a deliberate edit here, and it is the one place
 * that has to change.
 *
 * Kept out of `SKILL.md` on purpose. Records point at repos Tracy does not own — the skill
 * that exposed this problem lives in a third party's repo — so a classification that only the
 * source repo can set is one Tracy cannot fix. This field is Tracy's own classification,
 * alongside `tier`, and it lives where Tracy can correct it.
 */
export const PlatformSchema = z.enum(['wordpress', 'woocommerce', 'joomla', 'shopify'])
export type Platform = z.infer<typeof PlatformSchema>

export const SkillRecordSchema = z.object({
  $schema: z.string().optional(),
  namespace: SlugSchema,
  slug: SlugSchema,
  gitUrl: GitUrlSchema,
  ref: RefSchema.default('main'),
  skillPath: SkillPathSchema,
  /**
   * Empty is legal — a skill genuinely may not be platform-specific — but never silent:
   * `build-index` warns by slug, because the alternative is a record that quietly disappears
   * from every platform filter and only surfaces as a gap in someone's UI.
   */
  platforms: z
    .array(PlatformSchema)
    .refine((value) => new Set(value).size === value.length, 'platforms must not repeat a value')
    .default([])
})

export type SkillRecord = z.infer<typeof SkillRecordSchema>

export const TierSchema = z.enum(['listed', 'curated', 'quarantined'])
export type Tier = z.infer<typeof TierSchema>

/** Shape of one entry in `dist/skills/index.json`. Every field beyond the record is derived by CI. */
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
 * The owner in `gitUrl`, used to cross-check against `namespace`.
 *
 * WARNING: `SkillRecordSchema.parse()` (or an equivalent validation) must be called on
 * `gitUrl` BEFORE calling this function. It assumes `gitUrl` is already in the form
 * `https://github.com/{owner}/{repo}` and does not defend against that itself — passing an
 * empty string or an invalid URL (`ownerOf('')`, `ownerOf('not-a-url')`) throws a `TypeError`
 * from `new URL()` instead of returning a structured error.
 */
export function ownerOf(gitUrl: string): string {
  return new URL(gitUrl).pathname.split('/').filter(Boolean)[0] ?? ''
}

/**
 * The repo name in `gitUrl`, used to build the raw URL.
 *
 * WARNING: same constraint as `ownerOf` — `SkillRecordSchema.parse()` must run first. This
 * function does not validate `gitUrl` itself; an input that has not passed the schema will
 * make `new URL()` throw.
 */
export function repoOf(gitUrl: string): string {
  return new URL(gitUrl).pathname.split('/').filter(Boolean)[1] ?? ''
}
