/**
 * llms.txt — the owner-written map of a site for AI readers (llmstxt.org): an H1 naming the
 * site, an optional blockquote summary, and sections of markdown links to the pages that
 * matter. This parser is deliberately forgiving: the convention is young and hand-written
 * files stray, and a link we can extract is worth more than a strict validation failure.
 */

export interface LlmsTxtLink {
  url: string
  title?: string
}

export interface ParsedLlmsTxt {
  /** Whether the file opens with an H1 — the one structural element the convention requires. */
  hasTitle: boolean
  /** The blockquote summary under the H1, when the owner wrote one. */
  summary?: string
  links: LlmsTxtLink[]
}

const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g

export function parseLlmsTxt(text: string): ParsedLlmsTxt {
  const lines = text.split('\n')
  const hasTitle = lines.some((line) => /^#\s+\S/.test(line.trim()))
  const summaryLine = lines.find((line) => line.trim().startsWith('> '))
  const summary = summaryLine?.trim().slice(2).trim() || undefined

  const links: LlmsTxtLink[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const url = match[2].trim()
    if (!/^https?:\/\//.test(url) || seen.has(url)) continue
    seen.add(url)
    const title = match[1].trim()
    links.push(title ? { url, title } : { url })
  }
  return { hasTitle, ...(summary ? { summary } : {}), links }
}
