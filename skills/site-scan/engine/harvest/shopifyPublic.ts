import type { FetchQueue } from '../fetchQueue'

/**
 * No `updated_at`. Shopify bumps it on every product for reasons of its own — Gymshark's 5,000
 * products all moved between two crawls twelve minutes apart, with nothing else changed — so
 * carrying it makes a 5 MB catalog a fresh git object on every Sync and nothing reads it back.
 */
export type ShopifyProduct = {
  id: number
  handle: string
  url: string
  title: string
  bodyHtml: string
  priceRange: { min: string; max: string }
  images: number
}

export type ShopifyCollection = { handle: string; title: string }

const PAGE_LIMIT = 250

/**
 * The public Shopify catalog (spec §4): `products.json` / `collections.json`
 * paginate at 250 per request, so even a large store costs a few dozen cheap
 * structured calls. Walks forward until an empty page; a missing endpoint or a
 * storefront-password page (non-JSON) is simply an empty catalog.
 */
export async function harvestShopifyPublic(
  origin: string,
  queue: FetchQueue,
  maxItems: number
): Promise<{ products: ShopifyProduct[]; collections: ShopifyCollection[]; capped: number }> {
  let capped = 0

  const products: ShopifyProduct[] = []
  for await (const raw of paginate(origin, queue, 'products.json', 'products')) {
    const product = mapProduct(origin, raw)
    if (!product) continue
    if (products.length >= maxItems) {
      capped++
      continue
    }
    products.push(product)
  }

  const collections: ShopifyCollection[] = []
  for await (const raw of paginate(origin, queue, 'collections.json', 'collections')) {
    const record = raw as Record<string, unknown>
    if (typeof record.handle !== 'string' || typeof record.title !== 'string') continue
    if (collections.length >= maxItems) {
      capped++
      continue
    }
    collections.push({ handle: record.handle, title: record.title })
  }

  return { products, collections, capped }
}

async function* paginate(
  origin: string,
  queue: FetchQueue,
  endpoint: string,
  key: string
): AsyncGenerator<unknown, void, void> {
  for (let page = 1; ; page++) {
    const url = new URL(`/${endpoint}?limit=${PAGE_LIMIT}&page=${page}`, origin).toString()
    const outcome = await queue.get(url)
    if (!outcome.ok) return
    let items: unknown
    try {
      items = (JSON.parse(outcome.text) as Record<string, unknown>)[key]
    } catch {
      return
    }
    if (!Array.isArray(items) || items.length === 0) return
    yield* items
    if (items.length < PAGE_LIMIT) return
  }
}

function mapProduct(origin: string, raw: unknown): ShopifyProduct | undefined {
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'number' || typeof record.handle !== 'string') return undefined
  const variants = Array.isArray(record.variants) ? (record.variants as { price?: unknown }[]) : []
  const prices = variants
    .map((v) => (typeof v.price === 'string' ? Number(v.price) : NaN))
    .filter((p) => Number.isFinite(p))
  return {
    id: record.id,
    handle: record.handle,
    url: new URL(`/products/${record.handle}`, origin).toString(),
    title: typeof record.title === 'string' ? record.title : record.handle,
    bodyHtml: typeof record.body_html === 'string' ? record.body_html : '',
    priceRange: prices.length
      ? { min: Math.min(...prices).toFixed(2), max: Math.max(...prices).toFixed(2) }
      : { min: '', max: '' },
    images: Array.isArray(record.images) ? record.images.length : 0
  }
}
