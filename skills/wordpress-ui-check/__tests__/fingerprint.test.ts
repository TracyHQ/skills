import { describe, expect, it } from 'vitest'

import { classifyReread, findingFingerprint, pageFingerprint, visibleText } from '../scripts/fingerprint.mjs'

/**
 * The two fingerprints carry the whole memory of this skill, and both fail silently when they are
 * wrong: one too sensitive re-asks about settled findings, one too blunt reviews a changed page
 * against yesterday's answer. Neither shows up as an error anywhere.
 */
describe('pageFingerprint', () => {
  const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`

  it('ignores everything that changes without the page changing', () => {
    const before = page(`
      <script>var nonce="a1b2c3";</script>
      <style>.x-8f2a{color:red}</style>
      <!-- built 2026-08-20T01:00:00Z -->
      <h1>Wedding flowers</h1><p>Order 24 hours ahead.</p>`)
    const after = page(`
      <script>var nonce="zzzzzz";</script>
      <style>.x-1c9d{color:red}</style>
      <!-- built 2026-08-21T09:41:12Z -->
      <h1>Wedding flowers</h1>
      <p>Order   24 hours ahead.</p>`)
    expect(pageFingerprint(after)).toBe(pageFingerprint(before))
  })

  it('changes when a word a reader would see changes', () => {
    expect(pageFingerprint(page('<p>Order 24 hours ahead.</p>'))).not.toBe(
      pageFingerprint(page('<p>Order 48 hours ahead.</p>'))
    )
  })

  it('decodes the entities a reader never sees as entities', () => {
    expect(visibleText('<p>Ann&#39;s&nbsp;flowers &amp; gifts</p>')).toBe("ann's flowers & gifts")
  })

  // An entity outside the handful above becomes a space rather than surviving as itself. That is
  // deliberate and it is safe in the one direction that matters: an accented letter written as an
  // entity on one run is written as an entity on the next, so the hash still matches itself. It
  // would only mislead if a page swapped the literal character for its entity without changing a
  // word, which no CMS does mid-life, and the cost then is one page re-captured.
  it('does not pretend to know every entity', () => {
    expect(visibleText('<p>caf&eacute;</p>')).toBe('caf')
  })

  it('is stable across a run', () => {
    expect(pageFingerprint(page('<p>a</p>'))).toBe(pageFingerprint(page('<p>a</p>')))
  })
})

describe('findingFingerprint', () => {
  const base = { page: '/contact/', checkId: 'empty-block', viewport: 'desktop', selectors: ['main > section:nth-of-type(2)'], hint: 'Contact us' }

  it('treats the same fault at two viewports as two findings', () => {
    expect(findingFingerprint({ ...base, viewport: 'mobile' })).not.toBe(findingFingerprint(base))
  })

  it('does not depend on the order blocks were named in', () => {
    const a = findingFingerprint({ ...base, selectors: ['a', 'b'] })
    const b = findingFingerprint({ ...base, selectors: ['b', 'a'] })
    expect(a).toBe(b)
  })

  it('changes when the block it points at now says something else', () => {
    expect(findingFingerprint({ ...base, hint: 'About us' })).not.toBe(findingFingerprint(base))
  })

  it('survives a re-indent of the words it points at', () => {
    expect(findingFingerprint({ ...base, hint: '  contact   US ' })).toBe(findingFingerprint(base))
  })

  it('separates two checks firing on one block', () => {
    expect(findingFingerprint({ ...base, checkId: 'thin-page' })).not.toBe(findingFingerprint(base))
  })
})

describe('classifyReread', () => {
  it('says nothing happened when the first read matches what was stored', () => {
    expect(classifyReread('a', 'a', null)).toBe('unchanged')
  })

  it('calls it changed only once the new value holds still', () => {
    expect(classifyReread('a', 'b', 'b')).toBe('changed')
  })

  // Measured on juneflower: a product page prints a different breadcrumb on consecutive reads of
  // the same untouched page. Without this the review announces "1 page changed" on a site nobody
  // has touched, which is a false sentence in front of the customer.
  it('calls a page that disagrees with itself unstable, not changed', () => {
    expect(classifyReread('a', 'b', 'c')).toBe('unstable')
    expect(classifyReread('a', 'b', 'a')).toBe('unstable')
  })

  it('does not guess when the second read failed', () => {
    expect(classifyReread('a', 'b', null)).toBe('unstable')
  })
})
