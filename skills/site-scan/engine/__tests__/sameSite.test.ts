import { describe, expect, it } from 'vitest'

import { isSameSite } from '../sameSite'

describe('isSameSite', () => {
  it('folds the www label away in either direction', () => {
    expect(isSameSite('https://gymshark.com/', 'https://www.gymshark.com/shop')).toBe(true)
    expect(isSameSite('https://www.gymshark.com/', 'https://gymshark.com/shop')).toBe(true)
  })

  it('keeps deeper subdomains separate', () => {
    expect(isSameSite('https://gymshark.com/', 'https://uk.checkout.gymshark.com/')).toBe(false)
    expect(isSameSite('https://a.myshopify.com/', 'https://b.myshopify.com/')).toBe(false)
  })

  it('only folds the leading label', () => {
    expect(isSameSite('https://gymshark.com/', 'https://wwwgymshark.com/')).toBe(false)
    expect(isSameSite('https://shop.com/', 'https://shop.com/www/page')).toBe(true)
  })

  it('ignores scheme and port-free host differences but not the host itself', () => {
    expect(isSameSite('http://acme.com/', 'https://acme.com/')).toBe(true)
    expect(isSameSite('https://acme.com/', 'https://acme.org/')).toBe(false)
  })

  it('treats unparseable input as not matching', () => {
    expect(isSameSite('not a url', 'https://acme.com/')).toBe(false)
    expect(isSameSite('https://acme.com/', 'not a url')).toBe(false)
    expect(isSameSite('not a url', 'not a url')).toBe(false)
  })
})
