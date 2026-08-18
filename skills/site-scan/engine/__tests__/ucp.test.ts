import { describe, expect, it } from 'vitest'

import { runUcpChecks } from '../analyze/ucpChecks'
import type { FetchOutcome, FetchQueue } from '../fetchQueue'
import { harvestUcp } from '../harvest/ucp'

const PROFILE = JSON.stringify({
  ucp: {
    version: '2026-04-08',
    capabilities: { 'dev.ucp.shopping.checkout': {} },
    services: { shopping: [{ endpoint: 'https://checkout.a.com/mcp' }] }
  }
})

type Route = { text: string; finalUrl?: string; status?: number }

function fakeQueue(routes: Record<string, Route>): FetchQueue {
  const get = async (url: string): Promise<FetchOutcome> => {
    const route = routes[url]
    if (!route) return { ok: false, kind: 'http', status: 404 }
    return { ok: true, status: route.status ?? 200, finalUrl: route.finalUrl ?? url, text: route.text }
  }
  return { get, head: get, aborted: false } as FetchQueue
}

describe('harvestUcp — redirects with eyes open', () => {
  it('never credits the brand origin with a profile that answered on another site', async () => {
    // The Gymshark shape: the brand apex 301s /.well-known/ucp to the checkout domain, which
    // serves a perfectly valid profile. Eyes shut, this read "brand: 200, json TRUE" — the
    // origin-split bug wearing a green checkmark.
    const queue = fakeQueue({
      'https://a.com/.well-known/ucp': { text: PROFILE, finalUrl: 'https://checkout.a.com/.well-known/ucp' },
      'https://checkout.a.com/.well-known/ucp': { text: PROFILE }
    })
    const surface = await harvestUcp('https://a.com', queue)
    expect(surface.brand.json).toBe(false)
    expect(surface.brand.redirectedTo).toBe('https://checkout.a.com')
    // The redirect target is the platform candidate the site itself named.
    expect(surface.platform?.origin).toBe('https://checkout.a.com')
    expect(surface.platform?.json).toBe(true)

    const ids = runUcpChecks(surface).map((f) => f.checkId)
    expect(ids).toContain('ucp-profile-unreachable')
    expect(ids).toContain('ucp-origin-split')
  })

  it('marks an agent file that redirects off the site as not served here', async () => {
    const queue = fakeQueue({
      'https://a.com/.well-known/ucp': { text: PROFILE },
      'https://a.com/llms.txt': { text: '<html>storefront shell</html>', finalUrl: 'https://checkout.a.com/llms.txt' },
      'https://a.com/agents.md': { text: '# agents' }
    })
    const surface = await harvestUcp('https://a.com', queue)
    const llms = surface.agentFiles.find((f) => f.path === '/llms.txt')
    expect(llms?.redirectedTo).toBe('https://checkout.a.com')

    const files = runUcpChecks(surface).find((f) => f.checkId === 'ucp-agent-files-missing')
    expect(files?.urls[0]).toContain('redirects off your domain')
  })

  it('still reads a profile served straight from the brand origin', async () => {
    const queue = fakeQueue({
      'https://a.com/.well-known/ucp': { text: PROFILE },
      'https://a.com/llms.txt': { text: 'hello agents' },
      'https://a.com/agents.md': { text: '# agents' }
    })
    const surface = await harvestUcp('https://a.com', queue)
    expect(surface.brand.json).toBe(true)
    expect(surface.brand.version).toBe('2026-04-08')
    expect(surface.platform).toBeUndefined()
    expect(runUcpChecks(surface).map((f) => f.checkId)).not.toContain('ucp-profile-unreachable')
  })

  it('treats a www redirect as the same site, not a split', async () => {
    const queue = fakeQueue({
      'https://a.com/.well-known/ucp': { text: PROFILE, finalUrl: 'https://www.a.com/.well-known/ucp' },
      'https://a.com/llms.txt': { text: 'hello' },
      'https://a.com/agents.md': { text: '# agents' }
    })
    const surface = await harvestUcp('https://a.com', queue)
    expect(surface.brand.json).toBe(true)
    expect(surface.brand.redirectedTo).toBeUndefined()
  })
})
