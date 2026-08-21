// The server decides whether a key is required, not the client. MCP accepts a request with no
// Bearer header (MCP_OPTIONAL_API_KEY, on by default) and assigns the `anonymous` principal;
// measured on prod 2026-08-19: no Bearer → 200, and tools/list returns all 22 tools.
// The client used to throw before sending, which meant the skill refused a call the server was
// willing to serve — the deploy unlocked it and the skill still died, and because the error
// blamed a "missing key" nobody thought to look here.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain ESM, no type declarations (see the mcp-client.mjs header)
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

describe('rpc: the Authorization header', () => {
  it('no key → sends NO Authorization header, and does not throw', async () => {
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

  it('with a key → still sends Bearer, exactly as before', async () => {
    const seen: { headers?: Record<string, string> } = {}
    await rpc('tools/list', {}, {
      url: 'https://example.invalid',
      key: 'mn_mcp_abc',
      fetchImpl: fakeFetch(seen),
    })
    expect(seen.headers?.Authorization).toBe('Bearer mn_mcp_abc')
  })

  // A WRONG key is still a 401 at the server, so sending a broken key is WORSE than sending
  // nothing — that is why this drops the header entirely instead of sending an empty string.
  it('empty key → drops the header entirely, does not send "Bearer "', async () => {
    const seen: { headers?: Record<string, string> } = {}
    await rpc('tools/list', {}, {
      url: 'https://example.invalid',
      key: '',
      fetchImpl: fakeFetch(seen),
    })
    expect(seen.headers).not.toHaveProperty('Authorization')
  })
})
