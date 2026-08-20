// Server quyết định có cần key hay không, không phải client. MCP nhận request
// không Bearer (MCP_OPTIONAL_API_KEY, mặc định bật) và gán principal anonymous;
// xác minh trên prod 19/08/2026: không Bearer → 200, tools/list trả đủ 22 tool.
// Client từng throw sẵn, nghĩa là skill tự từ chối cuộc gọi mà server sẵn sàng
// phục vụ — deploy mở khoá xong mà skill vẫn chết, và thông điệp lỗi đổ tại
// "thiếu key" nên không ai nghĩ tới chỗ này.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain ESM, không có type declaration (xem header mcp-client.mjs)
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
  it('không có key → KHÔNG gửi Authorization, và không throw', async () => {
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

  it('có key → vẫn gửi Bearer như cũ', async () => {
    const seen: { headers?: Record<string, string> } = {}
    await rpc('tools/list', {}, {
      url: 'https://example.invalid',
      key: 'mn_mcp_abc',
      fetchImpl: fakeFetch(seen),
    })
    expect(seen.headers?.Authorization).toBe('Bearer mn_mcp_abc')
  })

  // Key SAI vẫn 401 ở server, nên gửi kèm key hỏng TỆ HƠN không gửi gì —
  // đó là lý do bỏ header hẳn chứ không gửi chuỗi rỗng.
  it('key rỗng → bỏ header hẳn, không gửi "Bearer "', async () => {
    const seen: { headers?: Record<string, string> } = {}
    await rpc('tools/list', {}, {
      url: 'https://example.invalid',
      key: '',
      fetchImpl: fakeFetch(seen),
    })
    expect(seen.headers).not.toHaveProperty('Authorization')
  })
})
