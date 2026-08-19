import { describe, expect, it } from 'vitest'

import { recognisePageKind } from '../harvest/pageKind'

describe('recognisePageKind', () => {
  it('reads WooCommerce naming its own pages, whatever the merchant called the url', () => {
    const vn = 'https://juneflower.vn/gio-hang/'
    expect(recognisePageKind('page-template-default woocommerce-cart woocommerce-page', vn, 'wordpress')).toBe('cart')
    expect(recognisePageKind('woocommerce-checkout woocommerce-page', vn, 'wordpress')).toBe('checkout')
    expect(recognisePageKind('woocommerce-account woocommerce-page', vn, 'wordpress')).toBe('account')
  })

  it('reads a Shopify theme naming its template', () => {
    expect(recognisePageKind('template-cart template-cart', 'https://gymshark.com/cart', 'shopify')).toBe('cart')
  })

  it('falls back to Shopify fixed routes, which no merchant can rename', () => {
    expect(recognisePageKind('bg-natural-white-60 min-h-full', 'https://www.allbirds.com/cart', 'shopify')).toBe('cart')
    expect(recognisePageKind('', 'https://www.allbirds.com/account/login', 'shopify')).toBe('account')
  })

  it('reads a WordPress search results page', () => {
    expect(recognisePageKind('search search-results', 'https://juneflower.vn/?s=hoa+cuoi', 'wordpress')).toBe('search')
  })

  it('says nothing about an ordinary page rather than guessing from its url', () => {
    expect(recognisePageKind('woocommerce-page', 'https://juneflower.vn/san-pham/hoa-bo/', 'wordpress')).toBeUndefined()
    expect(recognisePageKind('', 'https://juneflower.vn/gio-hang/', 'wordpress')).toBeUndefined()
  })

  it('keeps the fixed-route fallback to Shopify, where those routes are the platform speaking', () => {
    expect(recognisePageKind('', 'https://juneflower.vn/cart/', 'wordpress')).toBeUndefined()
    expect(recognisePageKind('', 'https://somesite.com/cart', null)).toBeUndefined()
  })
})
