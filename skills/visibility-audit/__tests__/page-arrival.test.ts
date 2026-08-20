// gymshark.com, 2026-08-20 — the first real run this skill ever had.
//
// The fetch returned HTTP 200 and 60,037 characters, so `res.ok` and `html.length > 0` both
// passed. Strip script and style and 14 characters remained: "Redirecting...", on a document
// carrying captcha and bot markers. The store's page was never seen.
//
// The audit scored it anyway — 22/100, verdict "weak", and a ten-item "Fix these first" list
// telling a merchant their product schema was missing and their page text was empty. That is
// worse than an error: an error gets retried, a plausible wrong report gets acted on.
//
// These tests exist so that never ships again.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain ESM, no type declarations by design
import { assessPageArrival, visibleTextOf } from '../scripts/fetch-pages.mjs'

const BOT_WALL =
  '<!doctype html><html><head><title>Redirecting</title>' +
  `<script>${'var captcha_token="x";'.repeat(400)}</script>` +
  '<script>/* bot detection */</script></head>' +
  '<body><a href="/">Redirecting...</a></body></html>'

const REAL_PDP =
  '<html><head><title>Vital Leggings</title></head><body>' +
  '<h1>Vital Seamless Leggings</h1>' +
  `<p>${'Soft four-way stretch fabric that moves with you. '.repeat(10)}</p>` +
  '<a href="/size-guide">Size guide</a><a href="/returns">Returns</a><a href="/faq">FAQ</a>' +
  '</body></html>'

describe('assessPageArrival', () => {
  it('a large payload whose text is 14 characters has NOT arrived', () => {
    const a = assessPageArrival(BOT_WALL)
    expect(a.received).toBe(false)
    expect(a.reason).toBe('bot-wall')
    // Size was the old (only) check and it is exactly what fooled it — pin that the signal
    // used is reader-visible text, not payload length.
    expect(a.signals.htmlLength).toBeGreaterThan(5000)
    expect(a.signals.visibleTextLength).toBeLessThan(200)
  })

  it('a real product page has arrived', () => {
    expect(assessPageArrival(REAL_PDP).received).toBe(true)
  })

  // The gate must not swallow genuine findings. A thin-but-real page is a TRUE result about the
  // store and has to keep being scored — otherwise this fix trades one silent lie for another.
  it('a thin but genuine page still counts as arrived, and is scored', () => {
    const thin =
      '<html><body><h1>Plain Tee</h1><p>' +
      'A cotton t-shirt. Machine washable. Available in three colours and four sizes. '.repeat(4) +
      '</p><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></body></html>'
    expect(assessPageArrival(thin).received).toBe(true)
  })

  it('an empty document is distinguished from a bot wall', () => {
    expect(assessPageArrival('').reason).toBe('empty-response')
    const shell = '<html><head>' + `<script>${'x'.repeat(4000)}</script>` + '</head><body></body></html>'
    expect(assessPageArrival(shell).reason).toBe('js-shell')
  })

  it('visibleTextOf ignores script and style entirely', () => {
    expect(visibleTextOf('<style>a{}</style><script>var a=1</script><p>Hello</p>')).toBe('Hello')
  })
})
