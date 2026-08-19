import { describe, expect, it } from 'vitest'

import { harvestBotAccess } from '../harvest/botAccess'

const URL_UNDER_TEST = 'https://juneflower.vn/'

/** A fetch that answers by the name the caller wore, and can carry headers back. */
const fakeFetch = (
  byAgent: Record<string, number>,
  headers: Record<string, string> = {}
): typeof fetch =>
  (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
    const agent = init?.headers?.['user-agent'] ?? ''
    const match = Object.keys(byAgent).find((name) => agent.toLowerCase().includes(name.toLowerCase()))
    return { status: match ? byAgent[match] : 200, headers: new Headers(headers) }
  }) as unknown as typeof fetch

const harvest = (fetchFn: typeof fetch) =>
  harvestBotAccess({ url: URL_UNDER_TEST, crawlerUserAgent: 'TracyBot/1.0', fetchFn, minIntervalMs: 0 })

describe('harvestBotAccess', () => {
  it('asks the same page under each bot name and reports what each one got', async () => {
    const surface = await harvest(fakeFetch({ GPTBot: 403, ClaudeBot: 200 }))
    expect(surface.baselineStatus).toBe(200)
    expect(surface.bots.find((b) => b.bot === 'GPTBot')?.status).toBe(403)
    expect(surface.bots.find((b) => b.bot === 'ClaudeBot')?.status).toBe(200)
  })

  it('asks under Googlebot too, as the control for identity screening', async () => {
    const surface = await harvest(fakeFetch({ Googlebot: 403 }))
    expect(surface.controlStatus).toBe(403)
  })

  it('names the network in front of the site when its headers say so', async () => {
    const surface = await harvest(fakeFetch({}, { 'cf-ray': 'a2d6eca20f308a0d-DXB' }))
    expect(surface.cdn).toBe('Cloudflare')
  })

  it('leaves the network unnamed rather than guessing', async () => {
    const surface = await harvest(fakeFetch({}, { 'x-cache-handler': 'a2opt-cache-engine' }))
    expect(surface.cdn).toBeUndefined()
  })

  it('records a request that never answered as zero, and does not throw', async () => {
    const dead = (async () => {
      throw new Error('network is gone')
    }) as unknown as typeof fetch
    const surface = await harvest(dead)
    expect(surface.baselineStatus).toBe(0)
    expect(surface.bots.every((b) => b.status === 0)).toBe(true)
  })
})
