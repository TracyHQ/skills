// Minimal MCP streamable-HTTP client for the mention-network server. Lets a script call an
// MCP tool with a big `arguments` payload read from disk — instead of the agent inlining the
// whole cells array (tens of KB of answer text) into a tool call by hand, which is slow,
// token-heavy, and easy to mis-escape. Stateless server: no session id, one POST per call.
//
// Endpoint + key come from the env (the same ones the Claude host uses):
//   MENTION_NETWORK_MCP_URL   default https://shopify-mcp.mention.network/api/v1/mcp (production)
//   MENTION_NETWORK_KEY       required (Bearer)
//
// This skill ships pointed at PRODUCTION. Developers working against a non-prod backend set
// MENTION_NETWORK_MCP_URL to the `-dev` host themselves — do not hardcode it here, and do not
// assume a dev key works against prod or vice versa: a dev-issued key is REJECTED by prod with
// `401 "Invalid internal API key"` (and a prod key is rejected by dev the same way), so a
// stale key from the other environment fails loud, not quiet.
//
// Exports rpc() / callTool() for submit-audit.mjs and any other script; no npm deps (Node ≥18 fetch).

const DEFAULT_URL = 'https://shopify-mcp.mention.network/api/v1/mcp'

// The server answers as SSE (`event: message\ndata: {json}`); collect the data payloads.
export function parseSSE(text) {
  const msgs = []
  for (const line of String(text).split('\n')) {
    const m = line.match(/^data:\s?(.*)$/)
    if (m) {
      try { msgs.push(JSON.parse(m[1])) } catch { /* keep-alive / partial line */ }
    }
  }
  return msgs
}

export async function rpc(method, params, { url, key, fetchImpl = fetch } = {}) {
  const endpoint = url ?? process.env.MENTION_NETWORK_MCP_URL ?? DEFAULT_URL
  const bearer = key ?? process.env.MENTION_NETWORK_KEY
  // With NO key, send no Authorization header at all rather than refusing here.
  //
  // That is the server's call, not the client's: since 2026-08-19 MCP accepts a
  // request carrying no Bearer (MCP_OPTIONAL_API_KEY, on by default) and assigns
  // the `anonymous` principal. Throwing in the client means the skill refuses a
  // call the server is willing to serve — verified on prod: no Bearer → 200, and
  // tools/list returns all 22 tools.
  //
  // A WRONG key still 401s (the server holds that line), so sending a broken key
  // is WORSE than sending none. That is why this drops the header entirely
  // instead of sending an empty string.
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  })
  const ct = res.headers.get?.('content-type') || ''
  const body = await res.text()
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${body.slice(0, 400)}`)
  const payloads = ct.includes('text/event-stream') ? parseSSE(body) : [safeJson(body)]
  const msg = payloads.find((p) => p && (p.result || p.error)) || payloads[payloads.length - 1]
  if (!msg) throw new Error('MCP: empty response')
  return msg
}

function safeJson(s) {
  try { return JSON.parse(s) } catch { return null }
}

// Call one MCP tool. Returns the tool's structured result: if the tool emits a single text
// content block of JSON (the mention-network convention), it's parsed; otherwise the raw
// content array. Throws on JSON-RPC errors and on `isError` tool results.
export async function callTool(name, args, opts = {}) {
  const out = await rpc('tools/call', { name, arguments: args }, opts)
  if (out.error) throw new Error(`MCP tool ${name} error: ${JSON.stringify(out.error)}`)
  const content = out.result?.content || []
  const textParts = content.filter((c) => c?.type === 'text').map((c) => c.text)
  const parsed = textParts.length === 1 ? safeJson(textParts[0]) : null
  const value = parsed ?? (textParts.length ? textParts.join('\n') : content)
  if (out.result?.isError) {
    throw new Error(`MCP tool ${name} returned isError: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
  }
  return value
}
