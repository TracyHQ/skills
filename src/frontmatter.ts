import matter from 'gray-matter'

/**
 * `SKILL.md` do người ngoài viết, nên mọi field đều có thể sai kiểu. Hàm này không bao giờ ném:
 * một frontmatter hỏng phải làm record thiếu mô tả, không được làm gãy cả lần build.
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
