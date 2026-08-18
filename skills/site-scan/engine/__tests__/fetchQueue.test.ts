import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFetchQueue } from '../fetchQueue'

describe('createFetchQueue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('never exceeds 2 in-flight requests', async () => {
    let inFlight = 0
    let peak = 0
    const fetchFn = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 50))
      inFlight--
      return new Response('ok', { status: 200 })
    })
    const q = createFetchQueue({ fetchFn: fetchFn as never, userAgent: 'TracyBot/0.0 (+https://trytracy.com/bot)' })
    const all = Promise.all(Array.from({ length: 6 }, (_, i) => q.get(`https://a.com/${i}`)))
    await vi.runAllTimersAsync()
    await all
    expect(peak).toBeLessThanOrEqual(2)
    expect(fetchFn).toHaveBeenCalledTimes(6)
  })

  it('retries 429 with backoff then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('fine', { status: 200 }))
    const q = createFetchQueue({ fetchFn: fetchFn as never, userAgent: 'TracyBot/0.0' })
    const p = q.get('https://a.com/x')
    await vi.runAllTimersAsync()
    const out = await p
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.text).toBe('fine')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('reports a plain http error without retrying non-retryable statuses', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('gone', { status: 404 }))
    const q = createFetchQueue({ fetchFn: fetchFn as never, userAgent: 'TracyBot/0.0' })
    const p = q.get('https://a.com/missing')
    await vi.runAllTimersAsync()
    const out = await p
    expect(out).toMatchObject({ ok: false, kind: 'http', status: 404 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('aborts the whole queue after 10 consecutive errors', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('down')
    })
    const q = createFetchQueue({ fetchFn: fetchFn as never, userAgent: 'TracyBot/0.0' })
    const results = Promise.all(Array.from({ length: 12 }, (_, i) => q.get(`https://a.com/${i}`)))
    await vi.runAllTimersAsync()
    const outs = await results
    expect(q.aborted).toBe(true)
    expect(outs.filter((o) => !o.ok && o.kind === 'queue-aborted').length).toBeGreaterThan(0)
  })

  it('sends the identifying user-agent header', async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)['user-agent']).toContain('TracyBot')
      return new Response('ok', { status: 200 })
    })
    const q = createFetchQueue({ fetchFn: fetchFn as never, userAgent: 'TracyBot/0.0 (+https://trytracy.com/bot)' })
    const p = q.get('https://a.com/')
    await vi.runAllTimersAsync()
    await p
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
