// Whether a key is needed is the server's call, not the client's. MCP accepts a
// request with no Bearer (MCP_OPTIONAL_API_KEY, on by default) and assigns the
// anonymous principal; verified on prod 2026-08-19: no Bearer → 200, and
// tools/list returns all 22 tools. The client used to throw first, meaning the
// skill refused a call the server was willing to serve — the deploy opened the
// lock and the skill stayed dead, while the error blamed "missing key", so
// nobody looked here.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain ESM, no type declarations (see mcp-client.mjs's header)
import { rpc } from '../scripts/mcp-client.mjs'

function fakeFetch(seen: { headers?: Record<string, string> }) {
  return async (_url: string, init: { headers: Record<string, string> }) => {
    seen.headers = init.headers
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ result: { ok: true } }),
    }
  }
}

describe('rpc: header Authorization', () => {
  it('no key -> sends NO Authorization header, and does not throw', async () => {
    const seen: { headers?: Record<string, string> } = {}
    const prev = process.env.MENTION_NETWORK_KEY
    delete process.env.MENTION_NETWORK_KEY
    try {
      await expect(
        rpc('tools/list', {}, { url: 'https://example.invalid', fetchImpl: fakeFetch(seen) })
      ).resolves.toBeTruthy()
    } finally {
      if (prev !== undefined) process.env.MENTION_NETWORK_KEY = prev
    }
    expect(seen.headers).not.toHaveProperty('Authorization')
  })

  it('with a key -> still sends Bearer, unchanged', async () => {
    const seen: { headers?: Record<string, string> } = {}
    await rpc('tools/list', {}, {
      url: 'https://example.invalid',
      key: 'mn_mcp_abc',
      fetchImpl: fakeFetch(seen),
    })
    expect(seen.headers?.Authorization).toBe('Bearer mn_mcp_abc')
  })

  // A WRONG key still 401s at the server, so sending a broken one is WORSE than
  // sending none — which is why this drops the header instead of sending "".
  it('empty key -> drops the header entirely, never sends "Bearer "', async () => {
    const seen: { headers?: Record<string, string> } = {}
    await rpc('tools/list', {}, {
      url: 'https://example.invalid',
      key: '',
      fetchImpl: fakeFetch(seen),
    })
    expect(seen.headers).not.toHaveProperty('Authorization')
  })
})
