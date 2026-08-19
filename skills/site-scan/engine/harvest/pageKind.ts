/**
 * What a page is FOR, when the platform running it says so out loud.
 *
 * The question "should this page be indexed" needs to know what the page is, and the tempting
 * answer — match the url against `/cart/`, `/checkout/`, `/account/` — dies the moment a shop is
 * not in English. juneflower calls them `/gio-hang/`, `/thanh-toan/`, `/tai-khoan/`, and the next
 * store will call them something else again.
 *
 * So this reads what the platform itself wrote. WooCommerce stamps `woocommerce-cart` on the body
 * of its cart page no matter what the merchant named the url; a Shopify theme stamps
 * `template-cart`. That is a fact published by the site, not a guess about it — the same standard
 * the rest of the engine holds itself to.
 *
 * Shopify also gets a url fallback, and only Shopify: `/cart`, `/account` and `/search` are fixed
 * routes the platform owns and a merchant cannot rename, so on a headless storefront that ships
 * no theme classes the path is still a fact. Everywhere else an unrecognised page stays
 * unrecognised: saying nothing is cheaper to live with than accusing the wrong page.
 *
 * Joomla is not here yet. Nobody has measured what its login and cart views stamp on the body,
 * and a table entry written from memory is how a check starts lying.
 */
export type PageKind = 'cart' | 'checkout' | 'account' | 'search'

/** Body-class markers, longest and most specific first. */
const CLASS_MARKERS: { marker: string; kind: PageKind }[] = [
  { marker: 'woocommerce-checkout', kind: 'checkout' },
  { marker: 'woocommerce-cart', kind: 'cart' },
  { marker: 'woocommerce-account', kind: 'account' },
  { marker: 'template-customers', kind: 'account' },
  { marker: 'template-checkout', kind: 'checkout' },
  { marker: 'template-cart', kind: 'cart' },
  { marker: 'template-search', kind: 'search' },
  { marker: 'search-results', kind: 'search' },
  { marker: 'search-no-results', kind: 'search' }
]

/** Routes Shopify owns outright, so the path is the platform speaking, not the merchant. */
const SHOPIFY_ROUTES: { prefix: string; kind: PageKind }[] = [
  { prefix: '/cart', kind: 'cart' },
  { prefix: '/checkout', kind: 'checkout' },
  { prefix: '/account', kind: 'account' },
  { prefix: '/search', kind: 'search' }
]

export function recognisePageKind(
  bodyClass: string,
  url: string,
  platform: 'wordpress' | 'shopify' | 'joomla' | null
): PageKind | undefined {
  const classes = bodyClass.toLowerCase()
  for (const { marker, kind } of CLASS_MARKERS) {
    if (classes.includes(marker)) return kind
  }
  // The path is only allowed to answer on Shopify, and only for the routes Shopify owns. Letting
  // it answer anywhere would be the url guessing this file exists to avoid.
  if (platform !== 'shopify') return undefined
  try {
    const { pathname } = new URL(url)
    return SHOPIFY_ROUTES.find((route) => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`))?.kind
  } catch {
    return undefined
  }
}
