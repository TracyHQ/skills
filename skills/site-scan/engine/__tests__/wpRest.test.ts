import { describe, expect, it } from 'vitest'

import type { FetchOutcome, FetchQueue } from '../fetchQueue'
import { harvestWpRest } from '../harvest/wpRest'

type Route = { body: unknown; totalPages?: number }

function fakeQueue(routes: Record<string, Route>): FetchQueue {
  const get = async (url: string): Promise<FetchOutcome> => {
    const route = routes[url]
    if (!route) return { ok: false, kind: 'http', status: 404 }
    return { ok: true, status: 200, finalUrl: url, text: JSON.stringify(route.body) }
  }
  return { get, head: get, aborted: false } as FetchQueue
}

const post = (id: number, slug: string) => ({
  id,
  link: `https://a.com/blog/${slug}`,
  title: { rendered: `Post ${id}` },
  excerpt: { rendered: `<p>Excerpt ${id}</p>` },
  modified: '2026-07-01T00:00:00',
  categories: [1],
  tags: [2, 3]
})

describe('harvestWpRest', () => {
  it('pages through posts and pages and maps rendered fields', async () => {
    const queue = fakeQueue({
      'https://a.com/wp-json/wp/v2/posts?per_page=100&page=1': { body: [post(1, 'one'), post(2, 'two')] },
      'https://a.com/wp-json/wp/v2/pages?per_page=100&page=1': { body: [post(10, 'about')] }
    })
    const { items, capped } = await harvestWpRest('https://a.com', queue, 5000)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ kind: 'post', id: 1, url: 'https://a.com/blog/one', title: 'Post 1' })
    expect(items[0].excerpt).not.toContain('<p>')
    expect(items[2].kind).toBe('page')
    expect(capped).toBe(0)
  })

  it('stops at maxItems and reports the cut', async () => {
    const queue = fakeQueue({
      'https://a.com/wp-json/wp/v2/posts?per_page=100&page=1': {
        body: [post(1, 'one'), post(2, 'two'), post(3, 'three')]
      }
    })
    const { items, capped } = await harvestWpRest('https://a.com', queue, 2)
    expect(items).toHaveLength(2)
    expect(capped).toBeGreaterThan(0)
  })

  it('treats a closed or missing rest api as an empty harvest', async () => {
    const { items, capped } = await harvestWpRest('https://a.com', fakeQueue({}), 5000)
    expect(items).toEqual([])
    expect(capped).toBe(0)
  })

  it('treats a non-array response as a closed api', async () => {
    const queue = fakeQueue({
      'https://a.com/wp-json/wp/v2/posts?per_page=100&page=1': { body: { code: 'rest_forbidden' } }
    })
    const { items } = await harvestWpRest('https://a.com', queue, 5000)
    expect(items).toEqual([])
  })
})
