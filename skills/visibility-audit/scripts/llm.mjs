// One LLM call, on whichever API key the user has. Every route here is a raw API key the
// user supplies — there is no subscription lane and no browser lane:
//
//   anthropic   ANTHROPIC_API_KEY, /v1/messages
//   openai      OPENAI_API_KEY, /v1/responses
//   gemini      GEMINI_API_KEY, generateContent (JSON mime)
//
// Why key-only. A subscription lane (the Claude Agent SDK, `claude -p`, `codex exec`) is free
// for whoever already pays for the plan, but it cannot be reached from a skill installed out of
// the registry: it needs a vendor CLI installed and logged in on the machine, and it puts the
// run's identity on a personal account. This skill is distributed to people who install it and
// supply a key, so the ladder that used to rank "subscription first, key last" has no rungs
// left above the key.
//
// Raw fetch, not an SDK, for all three. The whole bundle is zero-dependency by design — a
// registry install copies a directory and runs it, with no npm install step — so a route that
// needed `@anthropic-ai/sdk` on disk would be a route that never runs.
//
// Grading a page needs NO web search (unlike visibility collection, where the point is what a
// shopper is told): every judgement must come from the page text already in the prompt. So no
// route here declares a search tool, and a route that silently added one would be scoring a
// different page than the one that was fetched.
//
// Every caller wants JSON back, so the routes only differ in transport — `parseJsonObject`
// tolerates the code fences and prose the chat-shaped routes like to wrap around it.

export const ROUTES = ['anthropic', 'openai', 'gemini']

/** The environment variable each route reads. Also what `credentials.mjs` stores. */
export const ROUTE_KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

const JSON_ONLY = 'Reply with ONE JSON object and nothing else. No prose, no code fences.'

// These are DEFAULTS, not pinned facts, and every provider retires ids on its own schedule —
// `gemini-2.5-flash` stopped answering for new callers mid-2026 with a 404 "no longer
// available to new users", the exact failure mode this file now detects below and turns into
// an actionable message rather than a bare status code (audit incident I). Reviewed
// 2026-08-19: check each provider's current model list before assuming one of these still
// exists, especially on a stale-audit report. `--model <id>` always overrides a default for
// one run without editing this file.
const DEFAULT_MODELS = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-5.5-mini',
  gemini: 'gemini-3.5-flash',
}

// A retired/unknown model id reads as an ordinary HTTP error unless it's called out: providers
// use different status codes and wordings for it (Anthropic/OpenAI: 404; Gemini: 404 or a 400
// whose body says "not found"), so match on the body text too rather than trusting one status.
function modelMissingHint(route, id, status, body) {
  const looksMissing = status === 404 || /not[\s_-]?found|no longer available|deprecated/i.test(body)
  if (!looksMissing) return ''
  return (
    ` — model id '${id}' looks retired or unknown to ${route}. This is a stale DEFAULT, not a ` +
    `bad key: pass --model <an id current in ${route}'s docs> to override for this run, and ` +
    `update DEFAULT_MODELS.${route} in scripts/llm.mjs so the next run doesn't hit the same wall.`
  )
}

/**
 * The first route whose key is present, or null when the user has none.
 *
 * Returning null rather than throwing is deliberate: "no key yet" is a setup step the skill
 * walks the user through (P1 asks for one and stores it), not a crash. A route the caller
 * named explicitly is never overridden here — this only answers "pick one for me".
 */
export function pickRoute(env = process.env) {
  return ROUTES.find((route) => (env[ROUTE_KEY_ENV[route]] ?? '').trim() !== '') ?? null
}

// Pull the first balanced {...} out of a model reply (fences, preamble and all).
export function parseJsonObject(text) {
  const s = String(text ?? '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)
  const body = fenced ? fenced[1] : s
  const start = body.indexOf('{')
  if (start === -1) throw new Error(`model reply had no JSON object: ${s.slice(0, 200)}`)
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < body.length; i++) {
    const ch = body[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return JSON.parse(body.slice(start, i + 1))
  }
  throw new Error(`model reply had an unterminated JSON object: ${s.slice(0, 200)}`)
}

async function runAnthropic(prompt, { model, apiKey, timeoutMs, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const id = model || DEFAULT_MODELS.anthropic
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: id,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `Anthropic ${res.status}: ${text.slice(0, 300)}${modelMissingHint('anthropic', id, res.status, text)}`,
    )
  }
  const body = JSON.parse(text)

  // A refusal arrives as HTTP 200 with `stop_reason: 'refusal'` and content that does not answer
  // the question. Reading `content` without checking first is how a refusal becomes a score:
  // `parseJsonObject` would throw somewhere further down with a message about JSON, and the real
  // cause — a classifier declined this page — would never reach the run log.
  if (body.stop_reason === 'refusal') {
    const category = body.stop_details?.category ?? 'unspecified'
    throw new Error(`Anthropic declined to answer (refusal category: ${category})`)
  }

  const out = (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
  if (!out.trim()) throw new Error('Anthropic returned no text')
  return out
}

async function runOpenAI(prompt, { model, apiKey, timeoutMs, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
  const id = model || DEFAULT_MODELS.openai
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: id, input: prompt }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `OpenAI ${res.status}: ${text.slice(0, 300)}${modelMissingHint('openai', id, res.status, text)}`,
    )
  }
  const body = JSON.parse(text)
  if (typeof body.output_text === 'string' && body.output_text.trim()) return body.output_text
  let out = ''
  for (const item of body.output ?? []) {
    for (const part of item.content ?? []) if (typeof part.text === 'string') out += part.text
  }
  if (!out.trim()) throw new Error('OpenAI returned no text')
  return out
}

async function runGemini(prompt, { model, apiKey, timeoutMs, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  const id = model || DEFAULT_MODELS.gemini
  const res = await fetchImpl(
    // The key travels in `x-goog-api-key`, not `?key=`. Query-string secrets are written to every
    // proxy and edge access log on the path, TLS or not — and the raw key was being interpolated
    // into the URL unescaped, so a key containing `&` or `#` would have silently truncated.
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  )
  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `Gemini ${res.status}: ${text.slice(0, 300)}${modelMissingHint('gemini', id, res.status, text)}`,
    )
  }
  const parts = JSON.parse(text).candidates?.[0]?.content?.parts ?? []
  const out = parts
    .map((p) => p.text)
    .filter(Boolean)
    .join('')
  if (!out.trim()) throw new Error('Gemini returned no text')
  return out
}

export async function runPrompt(
  prompt,
  { route = null, model = null, timeoutMs = 180000, env = process.env } = {},
) {
  const full = `${prompt}\n\n${JSON_ONLY}`
  const chosen = route ?? pickRoute(env)
  if (!chosen) {
    throw new Error(
      'no LLM API key found — set one of ' +
        ROUTES.map((r) => ROUTE_KEY_ENV[r]).join(' / ') +
        ' and save it with scripts/credentials.mjs',
    )
  }
  switch (chosen) {
    case 'anthropic':
      return runAnthropic(full, { model, apiKey: env.ANTHROPIC_API_KEY, timeoutMs })
    case 'openai':
      return runOpenAI(full, { model, apiKey: env.OPENAI_API_KEY, timeoutMs })
    case 'gemini':
      return runGemini(full, { model, apiKey: env.GEMINI_API_KEY, timeoutMs })
    default:
      throw new Error(`unknown --route '${chosen}' (one of: ${ROUTES.join(', ')})`)
  }
}

// One retry, because a single malformed reply should not cost the whole batch.
export async function runJson(prompt, opts = {}) {
  try {
    return parseJsonObject(await runPrompt(prompt, opts))
  } catch (first) {
    process.stderr.write(`warning: LLM call failed (${first.message}) — retrying once\n`)
    return parseJsonObject(await runPrompt(prompt, opts))
  }
}
