import matter from 'gray-matter'

/**
 * `SKILL.md` is written by outsiders, so every field can have the wrong type. This function
 * never throws: a broken frontmatter should leave the record without a description, not break
 * the whole build.
 */
export function parseSkillFrontmatter(source: string): {
  name: string | null
  description: string | null
  tags: string[]
} {
  let data: Record<string, unknown> = {}
  try {
    data = matter(source).data as Record<string, unknown>
  } catch {
    return { name: null, description: null, tags: [] }
  }

  const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)
  const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : []

  return { name: str(data.name), description: str(data.description), tags }
}
