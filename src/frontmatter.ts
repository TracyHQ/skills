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
  requiresMcp: string[]
} {
  let data: Record<string, unknown> = {}
  try {
    data = matter(source).data as Record<string, unknown>
  } catch {
    return { name: null, description: null, tags: [], requiresMcp: [] }
  }

  const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)
  const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : []

  // `requires-mcp` names the MCP servers a skill needs to run (Tracy Desk reads the same field
  // from installed skills). More tolerant than `tags` on purpose: Desk's parser accepts both
  // spellings and a comma-separated string, and diverging here would make the registry disagree
  // with what Desk shows after install for the very same SKILL.md.
  const rawRequires = data['requires-mcp'] ?? data['requires_mcp']
  let requiresMcp: string[] = []
  if (Array.isArray(rawRequires)) {
    requiresMcp = rawRequires.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
  } else if (typeof rawRequires === 'string') {
    requiresMcp = rawRequires
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  }

  return { name: str(data.name), description: str(data.description), tags, requiresMcp }
}
