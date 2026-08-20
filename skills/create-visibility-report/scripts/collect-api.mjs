// Collect ONE BYOK cell via a provider API (web-search on), normalized to the
// shape `submit_byok_check` expects for a cell's `response`. No SDK / no npm
// install — plain global fetch (Node ≥18), same ethos as ../render.mjs.
//
// Every engine that has a first-class web-search API lives here: `anthropic` (claude), `openai`
// (chatgpt) and `gemini`. The fourth engine, `google_ai_mode`, has no model API at all and is
// collected through SerpApi by ../collect-serpapi.mjs — which is also an API key, so the whole
// four-engine grid is reachable without a subscription or a browser.
//
// The backend validator (byok-validate.util.ts) is strict, so this script's job
// is to return a response that passes it:
//   - servedModel MUST equal the grid's apiModelId for the platform  → we echo
//     back the exact `--model` we were told to use.
//   - webSearchUsed MUST be true                                     → we force
//     the web-search tool on and detect that a search actually happened; if it
//     did not, we throw instead of submitting a cell that would be rejected.
//
// Usage:
//   node collect-api.mjs --provider anthropic --model <servedModel> \
//        --prompt-file prompt.txt --out cell-response.json [--timeout-ms 120000]
// Prompt may also come from --prompt "<text>" or stdin. Output is written to
// --out (and echoed to stdout); it is the `response` object for one cell.
// --timeout-ms bounds EACH HTTP attempt with a real AbortSignal (default 120000 = 2 minutes, see
// DEFAULT_TIMEOUT_MS below) — a provider that accepts the connection and never answers now fails
// the cell instead of hanging the whole run. Raise it if a genuinely slow route keeps tripping it.

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// `import.meta.url === pathToFileURL(process.argv[1]).href` breaks silently — no error, exit 0,
// `main()` never runs — when the script is reached through a symlink: `.claude/skills/*` here is
// a symlink into `agent-pack/skills/*`, and Node's ESM loader resolves import.meta.url through
// the symlink target while process.argv[1] keeps the path actually invoked. realpath both sides.
// Exported so the sibling collector (collect-serpapi.mjs), which already imports from this
// file, shares this implementation instead of re-copying it. It is the only sibling that ships
// here — the subscription-lane collectors (collect-cli / collect-agent-sdk) belonged to the
// agent pack this skill was ported from and were dropped, see SKILL.md "Where this came from".
export function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl)
  } catch {
    return false
  }
}

export function parseArgs(argv) {
  const out = { provider: null, model: null, prompt: null, promptFile: null, out: null, intent: null, platform: null, timeoutMs: null }
  const keys = { provider: 'provider', model: 'model', prompt: 'prompt', 'prompt-file': 'promptFile', out: 'out', intent: 'intent', platform: 'platform', 'timeout-ms': 'timeoutMs' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    const rawKey = eq === -1 ? a.slice(2) : a.slice(2, eq)
    const key = keys[rawKey]
    if (!key) continue
    let val
    if (eq !== -1) val = a.slice(eq + 1)
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) val = argv[++i]
    if (val !== undefined) out[key] = val
  }
  return out
}

// data:… and relative junk are not real citations; keep only http(s).
export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}
export function toCitation(url, title) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null
  const domain = domainOf(url)
  const c = { url }
  if (domain) c.domain = domain
  if (title) c.title = title
  return c
}
export function dedupeCitations(list) {
  const seen = new Set()
  const out = []
  for (const c of list) {
    if (!c || seen.has(c.url)) continue
    seen.add(c.url)
    out.push(c)
  }
  return out
}

// Provider APIs throw transient 429/5xx (measured: Gemini returns 503 "high demand"
// mid-batch). Retry those with exponential backoff so one hiccup doesn't sink a cell.
// A retryable status is 429 or ≥500; anything else (incl. 4xx auth errors) returns as-is
// for the caller to surface. Honors Retry-After when the server sends it.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// No request here ever carried an AbortSignal before this existed, so a provider that accepts
// the connection and then never answers hung the cell forever — indistinguishable, from the
// caller's side, from a slow but working request. 2 minutes is generous for a single web-search-
// augmented turn (measured Anthropic/OpenAI/Gemini calls land well under 30s) while still being
// a real bound; `--timeout-ms` on every collector overrides it per run.
export const DEFAULT_TIMEOUT_MS = 120_000

export async function fetchWithRetry(
  url,
  init,
  { retries = 3, baseDelayMs = 800, fetchImpl = fetch, sleepImpl = sleep, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  let lastErr
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController()
    const timer = timeoutMs
      ? setTimeout(() => ctl.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs)
      : null
    let res
    try {
      res = await fetchImpl(url, { ...init, signal: ctl.signal })
    } catch (e) {
      lastErr = ctl.signal.aborted ? new Error(`request timed out after ${timeoutMs}ms`) : e
      if (attempt >= retries) throw lastErr
      await sleepImpl(baseDelayMs * 2 ** attempt)
      continue
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (res.status !== 429 && res.status < 500) return res
    if (attempt >= retries) return res // exhausted: let caller read the error body
    const ra = Number(res.headers?.get?.('retry-after'))
    await sleepImpl(Number.isFinite(ra) && ra > 0 ? ra * 1000 : baseDelayMs * 2 ** attempt)
  }
  // eslint-disable-next-line no-unreachable
  throw lastErr
}

// A submit_byok_check cell is `{ intentSlug, platformSlug, promptText, collectionMethod,
// response }`. Collectors return only the `response`; callers used to wrap it by hand.
// When a script is told its `--intent`/`--platform`, it can emit the whole cell so the
// output drops straight into a cells/ dir that submit.mjs reads without any wrapping.
export function toCell({ intentSlug, platformSlug, promptText, collectionMethod, response }) {
  return { intentSlug, platformSlug, promptText, collectionMethod, response }
}

// Write `--out` (full cell when intent+platform are known, else the bare response for
// back-compat) and return whatever was written. Central so every collector behaves alike.
export function writeOutput({ out, response, intent, platform, prompt, collectionMethod }) {
  const payload =
    intent && platform
      ? toCell({ intentSlug: intent, platformSlug: platform, promptText: prompt, collectionMethod, response })
      : response
  if (out) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(payload, null, 2))
  }
  return payload
}

// ---- OpenAI Responses API (web_search tool) --------------------------------
// https://api.openai.com/v1/responses — output[] holds web_search_call items +
// a message whose content carries url_citation annotations.
export function parseOpenAI(body, requestedModel) {
  const output = Array.isArray(body.output) ? body.output : []
  const searchCalls = output.filter((o) => o.type === 'web_search_call')
  // A `web_search_call` item proves the model ASKED for a search; only `status: 'completed'`
  // proves one actually came back (the Responses API also emits 'searching' / 'in_progress' /
  // 'failed'). Counting every call regardless of status would mark a search that failed or never
  // finished as web-grounded — the same class of bug the Anthropic route already guards against
  // (see `searchesReturned` below) — so `webSearchUsed` must require completed evidence here too.
  const completedSearches = searchCalls.filter((s) => s.status === 'completed')
  const citations = []
  let rawText = ''
  for (const item of output) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (typeof part.text === 'string') rawText += part.text
      for (const ann of part.annotations || []) {
        if (ann.type === 'url_citation') {
          const c = toCitation(ann.url, ann.title)
          if (c) citations.push(c)
        }
      }
    }
  }
  if (!rawText && typeof body.output_text === 'string') rawText = body.output_text
  const searchQueries = searchCalls
    .map((s) => s.action?.query)
    .filter((q) => typeof q === 'string' && q.length)
  const webSearchUsed = completedSearches.length > 0 || citations.length > 0
  const u = body.usage || {}
  return {
    rawText: rawText.trim(),
    servedModel: requestedModel, // must match grid apiModelId, not body.model
    externalResponseId: body.id ?? null,
    webSearchUsed,
    citations: dedupeCitations(citations),
    searchQueries: searchQueries.length ? searchQueries : null,
    searchRequestCount: searchCalls.length || null,
    usage: {
      inputTokens: u.input_tokens ?? null,
      outputTokens: u.output_tokens ?? null,
      cachedInputTokens: u.input_tokens_details?.cached_tokens ?? null,
      reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? null,
    },
    costUsd: null, // client's own key; backend does not read this into llm_calls
    providerMeta: { apiModel: body.model ?? null },
    requestParams: { model: requestedModel, tool: 'web_search' },
  }
}

export async function collectOpenAI({ model, prompt, apiKey, fetchImpl = fetch, timeoutMs }) {
  const res = await fetchWithRetry('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: prompt, tools: [{ type: 'web_search' }] }),
  }, { fetchImpl, timeoutMs })
  const text = await res.text()
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text.slice(0, 500)}`)
  return parseOpenAI(JSON.parse(text), model)
}

// ---- Gemini generateContent (google_search grounding) ----------------------
export function parseGemini(body, requestedModel) {
  const cand = body.candidates?.[0] || {}
  const parts = cand.content?.parts || []
  const rawText = parts.map((p) => p.text).filter((t) => typeof t === 'string').join('').trim()
  const gm = cand.groundingMetadata || {}
  const chunks = gm.groundingChunks || []
  const citations = []
  for (const ch of chunks) {
    const c = toCitation(ch.web?.uri, ch.web?.title)
    if (c) citations.push(c)
  }
  const searchQueries = Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries.filter(Boolean) : []
  // `webSearchQueries` proves Gemini ISSUED a search; only `groundingChunks` proves one actually
  // came back with results to ground the answer in. A query with zero chunks (e.g. the search
  // returned nothing usable) is not the same event as a search that returned — counting the
  // query alone would let a cell claim grounding it never got, same bug class as OpenAI/
  // Anthropic above.
  const webSearchUsed = chunks.length > 0
  const u = body.usageMetadata || {}
  return {
    rawText,
    servedModel: requestedModel,
    externalResponseId: body.responseId ?? null,
    webSearchUsed,
    citations: dedupeCitations(citations),
    searchQueries: searchQueries.length ? searchQueries : null,
    searchRequestCount: searchQueries.length || null,
    usage: {
      inputTokens: u.promptTokenCount ?? null,
      outputTokens: u.candidatesTokenCount ?? null,
      cachedInputTokens: u.cachedContentTokenCount ?? null,
      reasoningTokens: u.thoughtsTokenCount ?? null,
    },
    costUsd: null,
    providerMeta: { apiModel: body.modelVersion ?? null },
    requestParams: { model: requestedModel, tool: 'google_search' },
  }
}

export async function collectGemini({ model, prompt, apiKey, fetchImpl = fetch, timeoutMs }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
    }),
  }, { fetchImpl, timeoutMs })
  const text = await res.text()
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${text.slice(0, 500)}`)
  return parseGemini(JSON.parse(text), model)
}

// ---- Anthropic Messages API (server-side web_search tool) ------------------
//
// This is what makes a 4-engine grid completable on API keys alone. Before it, `claude` had no
// keyed route at all — it was collected on a subscription CLI or read out of a browser — and the
// backend refuses a short grid (`INCOMPLETE_PLATFORM_GRID`), so "skip the engine we cannot reach"
// was never the cheap option it looks like: it spends the full quota and then fails validation.
//
// The search runs on Anthropic's side: `web_search_20260209` is a server tool, so one request
// comes back with the searches already performed and cited. That matters for `webSearchUsed`,
// which the backend requires to be true — a real shopper asking an assistant has search on, and a
// cell collected without it is measuring a different question.
/**
 * `trim: false` is used when this turn may be continued (see `collectAnthropic`). Trimming each
 * half before joining eats the whitespace at the seam, and a pause that lands mid-sentence then
 * fuses the last word to the first — `Acme` + `Widget` becoming `AcmeWidget` in the very text
 * the detection step scans for the brand.
 */
export function parseAnthropic(body, requestedModel, { trim = true } = {}) {
  const content = Array.isArray(body.content) ? body.content : []
  const citations = []
  const searchQueries = []
  let rawText = ''
  let searchCalls = 0
  let searchesReturned = 0
  const searchErrors = []

  for (const block of content) {
    if (block.type === 'text') {
      if (typeof block.text === 'string') rawText += block.text
      for (const cit of block.citations || []) {
        const c = toCitation(cit.url, cit.title)
        if (c) citations.push(c)
      }
    } else if (block.type === 'server_tool_use' && block.name === 'web_search') {
      searchCalls++
      if (typeof block.input?.query === 'string' && block.input.query) {
        searchQueries.push(block.input.query)
      }
    } else if (block.type === 'web_search_tool_result') {
      // A failed server-side search returns HTTP 200 with `content` as a single error OBJECT
      // where a success is an ARRAY of results. Indexing without checking turns a search that
      // never ran into a cell that claims it did.
      const inner = block.content
      if (Array.isArray(inner)) {
        searchesReturned++ // an empty array is still a search that ran
        for (const r of inner) {
          const c = toCitation(r.url, r.title)
          if (c) citations.push(c)
        }
      } else if (inner && typeof inner === 'object') {
        searchErrors.push(inner.error_code ?? 'unknown')
      }
    }
  }

  const u = body.usage || {}
  return {
    rawText: trim ? rawText.trim() : rawText,
    servedModel: requestedModel, // must match grid apiModelId, not body.model
    externalResponseId: body.id ?? null,
    // The number of searches that RETURNED, not the number requested. A `server_tool_use` block
    // proves the model asked; only a result block proves it was answered. Counting the request
    // would mark a run that exhausted `max_uses` as web-grounded and submit an answer written
    // from memory as though a shopper had been told it.
    webSearchUsed: searchesReturned > 0 || citations.length > 0,
    citations: dedupeCitations(citations),
    searchQueries: searchQueries.length ? searchQueries : null,
    searchRequestCount: searchCalls || null,
    usage: {
      inputTokens: u.input_tokens ?? null,
      outputTokens: u.output_tokens ?? null,
      cachedInputTokens: u.cache_read_input_tokens ?? null,
      reasoningTokens: null,
    },
    costUsd: null,
    providerMeta: {
      apiModel: body.model ?? null,
      stopReason: body.stop_reason ?? null,
      searchErrors: searchErrors.length ? searchErrors : null,
    },
    requestParams: { model: requestedModel, tool: 'web_search_20260209' },
  }
}

/**
 * A server-tool turn can come back `stop_reason: 'pause_turn'` — the model paused mid-search and
 * expects the turn to be handed straight back so it can carry on. Returning that as a finished
 * answer submits whatever half-sentence it had reached, so continue up to `maxTurns` and merge.
 */
export async function collectAnthropic({ model, prompt, apiKey, fetchImpl = fetch, maxTurns = 4, timeoutMs }) {
  const messages = [{ role: 'user', content: prompt }]
  let merged = null

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        messages,
        tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      }),
    }, { fetchImpl, timeoutMs })
    const text = await res.text()
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${text.slice(0, 500)}`)
    const body = JSON.parse(text)

    // Checked before the content is read: a refusal is HTTP 200 with content that does not answer
    // the question, and submitting it would record a classifier's decline as what a shopper is told.
    if (body.stop_reason === 'refusal') {
      const category = body.stop_details?.category ?? 'unspecified'
      throw new Error(`Anthropic declined this prompt (refusal category: ${category})`)
    }

    const parsed = parseAnthropic(body, model, { trim: false })
    merged = merged ? mergeAnthropicTurns(merged, parsed) : parsed

    if (body.stop_reason !== 'pause_turn') return { ...merged, rawText: merged.rawText.trim() }
    // Hand the turn back verbatim — the paused search lives in these blocks.
    messages.push({ role: 'assistant', content: body.content })
  }
  throw new Error(`Anthropic kept pausing after ${maxTurns} turns — no complete answer to submit`)
}

/** Join two halves of one paused answer without double-counting the searches behind it. */
export function mergeAnthropicTurns(a, b) {
  return {
    ...b,
    rawText: `${a.rawText}${b.rawText}`, // seam preserved; trimmed once by the caller at the end
    webSearchUsed: a.webSearchUsed || b.webSearchUsed,
    citations: dedupeCitations([...a.citations, ...b.citations]),
    searchQueries: [...(a.searchQueries ?? []), ...(b.searchQueries ?? [])].length
      ? [...new Set([...(a.searchQueries ?? []), ...(b.searchQueries ?? [])])]
      : null,
    searchRequestCount: (a.searchRequestCount ?? 0) + (b.searchRequestCount ?? 0) || null,
    usage: {
      inputTokens: (a.usage.inputTokens ?? 0) + (b.usage.inputTokens ?? 0) || null,
      outputTokens: (a.usage.outputTokens ?? 0) + (b.usage.outputTokens ?? 0) || null,
      cachedInputTokens: (a.usage.cachedInputTokens ?? 0) + (b.usage.cachedInputTokens ?? 0) || null,
      reasoningTokens: null,
    },
  }
}

const PROVIDERS = {
  anthropic: { collect: collectAnthropic, keyEnv: 'ANTHROPIC_API_KEY', platform: 'claude' },
  openai: { collect: collectOpenAI, keyEnv: 'OPENAI_API_KEY', platform: 'chatgpt' },
  gemini: { collect: collectGemini, keyEnv: 'GEMINI_API_KEY', platform: 'gemini' },
}

export async function main(argv, env = process.env) {
  const a = parseArgs(argv)
  const provider = PROVIDERS[a.provider]
  if (!provider) throw new Error(`--provider must be one of: ${Object.keys(PROVIDERS).join(', ')}`)
  if (!a.model) throw new Error('--model <servedModel> is required (use the grid apiModelId for this platform)')
  const apiKey = env[provider.keyEnv]
  if (!apiKey) throw new Error(`missing ${provider.keyEnv} in the environment`)
  const prompt = a.prompt ?? (a.promptFile ? readFileSync(a.promptFile, 'utf8') : readFileSync(0, 'utf8'))
  if (!prompt.trim()) throw new Error('empty prompt (pass --prompt, --prompt-file, or pipe via stdin)')
  let timeoutMs = DEFAULT_TIMEOUT_MS
  if (a.timeoutMs != null) {
    timeoutMs = Number(a.timeoutMs)
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive number of milliseconds')
  }

  const response = await provider.collect({ model: a.model, prompt, apiKey, timeoutMs })
  if (!response.rawText) throw new Error('provider returned no text')
  if (!response.webSearchUsed) {
    // There is no browser lane in this skill (SKILL.md "Clean-room collection") — don't tell the
    // operator to fall back to one that was deliberately removed. RECOVERY.md's "Web search
    // didn't run" row is the actual escalation path.
    throw new Error('web search did not run — backend rejects webSearchUsed=false. Retry the cell (see RECOVERY.md, "Web search didn\'t run").')
  }
  // anthropic → claude, openai → chatgpt, gemini → gemini. All are `api` cells.
  const platform = a.platform ?? provider.platform
  return writeOutput({ out: a.out, response, intent: a.intent, platform, prompt, collectionMethod: 'api' })
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error(e.message); process.exit(1) })
}
