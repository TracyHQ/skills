import { describe, expect, it } from 'vitest'

import type { FetchOutcome, FetchQueue } from '../fetchQueue'
import { harvestShopifyPublic } from '../harvest/shopifyPublic'

function fakeQueue(routes: Record<string, unknown>): FetchQueue {
  const get = async (url: string): Promise<FetchOutcome> => {
    const body = routes[url]
    if (body === undefined) return { ok: false, kind: 'http', status: 404 }
    return { ok: true, status: 200, finalUrl: url, text: typeof body === 'string' ? body : JSON.stringify(body) }
  }
  return { get, head: get, aborted: false } as FetchQueue
}

const product = (id: number) => ({
  id,
  handle: `product-${id}`,
  title: `Product ${id}`,
  body_html: `<p>Body ${id}</p>`,
  updated_at: '2026-07-01T00:00:00-04:00',
  variants: [{ price: '19.00' }, { price: '25.00' }],
  images: [{ src: 'a.jpg' }, { src: 'b.jpg' }]
})

describe('harvestShopifyPublic', () => {
  it('pages the catalog until an empty page and computes price ranges', async () => {
    const page1 = Array.from({ length: 250 }, (_, i) => product(i + 1))
    const routes = {
      'https://a.com/products.json?limit=250&page=1': { products: page1 },
      'https://a.com/products.json?limit=250&page=2': { products: [product(251), product(252), product(253)] },
      'https://a.com/products.json?limit=250&page=3': { products: [] },
      'https://a.com/collections.json?limit=250&page=1': {
        collections: [{ handle: 'study-tools', title: 'Study tools' }]
      },
      'https://a.com/collections.json?limit=250&page=2': { collections: [] }
    }
    const { products, collections, capped } = await harvestShopifyPublic('https://a.com', fakeQueue(routes), 5000)
    expect(products).toHaveLength(253)
    expect(products[0]).toMatchObject({
      id: 1,
      handle: 'product-1',
      url: 'https://a.com/products/product-1',
      priceRange: { min: '19.00', max: '25.00' },
      images: 2
    })
    expect(collections).toEqual([{ handle: 'study-tools', title: 'Study tools' }])
    expect(capped).toBe(0)
  })

  it('stops at maxItems and reports the cut', async () => {
    const routes = {
      'https://a.com/products.json?limit=250&page=1': { products: [product(1), product(2), product(3)] }
    }
    const { products, capped } = await harvestShopifyPublic('https://a.com', fakeQueue(routes), 2)
    expect(products).toHaveLength(2)
    expect(capped).toBeGreaterThan(0)
  })

  it('treats missing endpoints and bad json as an empty catalog', async () => {
    const empty = await harvestShopifyPublic('https://a.com', fakeQueue({}), 5000)
    expect(empty.products).toEqual([])
    expect(empty.collections).toEqual([])

    const garbled = await harvestShopifyPublic(
      'https://a.com',
      fakeQueue({ 'https://a.com/products.json?limit=250&page=1': '<html>not json</html>' }),
      5000
    )
    expect(garbled.products).toEqual([])
  })
})
