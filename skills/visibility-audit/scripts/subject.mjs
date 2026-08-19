// The audited subject: shop + product + market, merged from what the user confirmed (meta.json)
// and what the storefront actually served (pages.json). Both the analyze step and the scoring
// step read it, so they can never grade two different products.

export function resolveSubject(meta, pages) {
  const m = meta ?? {}
  const fetched = pages?.product ?? null
  const p = m.product ?? {}
  // meta wins where the user (or Shopify's own catalog) gave a value; the PDP JSON fills gaps.
  const pick = (key) => (p[key] !== undefined && p[key] !== null && p[key] !== '' ? p[key] : (fetched?.[key] ?? null))

  const price = pick('price')
  return {
    shop: {
      name: m.shop?.name ?? '',
      primaryDomain: m.shop?.primaryDomain ?? null,
      storeUrl: m.shop?.storeUrl ?? (pages?.pdpUrl ? new URL(pages.pdpUrl).origin : ''),
    },
    product: {
      title: pick('title') ?? '',
      vendor: pick('vendor'),
      handle: pick('handle'),
      description: pick('description'),
      productType: pick('productType'),
      price: typeof price === 'string' ? Number(price) : price,
      currency: pick('currency'),
      imageUrl: pick('imageUrl'),
    },
    pdpUrl: m.pdpUrl ?? pages?.pdpUrl ?? null,
    language: m.language ?? 'en',
    location: { country: m.location?.country ?? null, city: m.location?.city ?? null },
    competitorPrices: Array.isArray(m.competitorPrices) ? m.competitorPrices : [],
  }
}
