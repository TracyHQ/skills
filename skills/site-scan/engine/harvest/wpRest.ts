import type { FetchQueue } from '../fetchQueue'

export type WpItem = {
  kind: 'post' | 'page'
  id: number
  url: string
  title: string
  excerpt: string
  modified: string
  categories: number[]
  tags: number[]
}

const PER_PAGE = 100

/**
 * Open WP REST content (spec §4): clean structured posts/pages when the site
 * exposes `/wp-json/wp/v2/*`. Pagination walks forward until a short page or an
 * error — WP answers past-the-end pages with 400, closed APIs with 401/403/404,
 * and every one of those simply ends the harvest. The remaining `maxItems`
 * budget is split between posts (first) and pages.
 */
export async function harvestWpRest(
  origin: string,
  queue: FetchQueue,
  maxItems: number
): Promise<{ items: WpItem[]; capped: number }> {
  const items: WpItem[] = []
  let capped = 0

  for (const kind of ['post', 'page'] as const) {
    const budget = maxItems - items.length
    if (budget <= 0) break
    const collection = kind === 'post' ? 'posts' : 'pages'
    for (let page = 1; ; page++) {
      const url = new URL(`/wp-json/wp/v2/${collection}?per_page=${PER_PAGE}&page=${page}`, origin).toString()
      const outcome = await queue.get(url)
      if (!outcome.ok) break
      let parsed: unknown
      try {
        parsed = JSON.parse(outcome.text)
      } catch {
        break
      }
      if (!Array.isArray(parsed)) break

      for (const raw of parsed) {
        const item = mapItem(kind, raw as Record<string, unknown>)
        if (!item) continue
        if (items.length >= maxItems) {
          capped++
          continue
        }
        items.push(item)
      }
      if (parsed.length < PER_PAGE || items.length >= maxItems) break
    }
  }
  return { items, capped }
}

function mapItem(kind: 'post' | 'page', raw: Record<string, unknown>): WpItem | undefined {
  if (typeof raw.id !== 'number' || typeof raw.link !== 'string') return undefined
  const rendered = (field: unknown): string =>
    typeof (field as { rendered?: unknown })?.rendered === 'string' ? (field as { rendered: string }).rendered : ''
  return {
    kind,
    id: raw.id,
    url: raw.link,
    title: stripTags(rendered(raw.title)),
    excerpt: stripTags(rendered(raw.excerpt)),
    modified: typeof raw.modified === 'string' ? raw.modified : '',
    categories: Array.isArray(raw.categories) ? raw.categories.filter((c): c is number => typeof c === 'number') : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is number => typeof t === 'number') : []
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
