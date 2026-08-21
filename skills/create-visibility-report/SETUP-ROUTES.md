# Setting up keys — how to reach **full engine coverage**, and what to do instead of that

Read this when an engine has no working key. Every gap here is a setup step measured in minutes —
worth doing, because more coverage is a better report. But it is no longer the *only* legitimate
answer: skipping the engine for this run is a real, declared option too (SKILL.md *Credentials → A
missing key is a conversation, not a dead end*). This file is about getting the key when you want
full coverage; the skip path is documented there, not here.

## Why a declared engine must be complete, even though you don't have to declare all four

The backend rejects a **hole** in a platform the submission declares (`INCOMPLETE_PLATFORM_GRID` /
`INCOMPLETE_INTENT_GRID`). So "collect three cells for chatgpt and none for the fourth intent" is
never the cheaper option it looks like — it spends part of the quota and then fails at submit. What
IS a legitimate, cheaper option: never declare chatgpt at all. Declaring fewer than 4 engines and
submitting a complete grid over the ones you did declare is accepted; declaring 4 and delivering
fewer is not. The distinction is entirely in `state.json`'s `declaredPlatforms` — set it, and every
later step (`grid.json`, the collectors, the submission, the local report) stays consistent with it.

## One key per engine

There is no ranking and nothing to choose between. Each engine has exactly one route:

| Engine | Key | Where it comes from | Cost |
|---|---|---|---|
| `claude` | `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | metered per token |
| `chatgpt` | `OPENAI_API_KEY` | platform.openai.com → API keys | metered per token |
| `gemini` | `GEMINI_API_KEY` | aistudio.google.com → Get API key | free tier |
| `google_ai_mode` | `SERPAPI_API_KEY` | serpapi.com → Dashboard | free ~100 searches/month |

Plus `MENTION_NETWORK_KEY` (mention.network), which is not an engine — it is how the finished
report is stored and exported. **Without it the run does not stop.** It gates P6 (storage) only;
P1–P5 measure, analyze and write a local report regardless (SKILL.md *Local-first*).

**Get the free ones first.** `GEMINI_API_KEY` and `SERPAPI_API_KEY` cost nothing and cover two of
the four engines, so a user with no keys at all is two free signups away from half the grid.

## Every route here is a clean room

An API request carries no account history, no saved memory and no custom instructions. That is the
whole reason the skill is key-only: the report answers *"what does a shopper with no history see?"*,
and a logged-in consumer chat UI cannot answer it — ChatGPT, Claude and Gemini all personalize from
that account's memory and prior chats.

So there is nothing to configure to make a route clean. If a user asks to collect from their own
browser session instead, explain the contamination and offer the key. If they insist after hearing
it, that is their call — but say in the handover that the report measures that account, not the
market.

## Saving a key without it entering the conversation

Hand the user this, one key at a time. The value never reaches the model, never lands in shell
history, and never appears in `ps`:

```bash
HERE="<this skill's folder>"
read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY \
  && node "$HERE/scripts/credentials.mjs" save ANTHROPIC_API_KEY
unset ANTHROPIC_API_KEY        # own line, so it runs even when the save above fails
```

`read -rs` echoes nothing as they type. Substitute the name for whichever key is missing.

If the user would rather paste the key to you directly, that is allowed — say once that it will be
stored in the conversation history, then save it with the value in the environment, never in argv:

```bash
ANTHROPIC_API_KEY='<pasted>' node "$HERE/scripts/credentials.mjs" save ANTHROPIC_API_KEY
```

## Per-key notes

### `ANTHROPIC_API_KEY` → covers `claude`

Created at console.anthropic.com under API keys; needs billing set up on the workspace. The
collector uses the Messages API with the **server-side `web_search` tool**, so the search runs on
Anthropic's infrastructure and comes back cited in the same response — nothing extra to enable, but
the key's workspace must not have the tool disabled by policy.

Web search is billed on top of tokens. A 5-intent grid is 5 cells on this engine, each one request
plus its searches.

### `OPENAI_API_KEY` → covers `chatgpt`

Created at platform.openai.com under API keys; needs a funded account — there is no free tier. The
collector uses the Responses API with the `web_search` tool.

### `GEMINI_API_KEY` → covers `gemini` (**free tier — get this one first**)

Created at aistudio.google.com → *Get API key*. The free tier is enough for a grid, and the
collector uses `generateContent` with `google_search` grounding.

Gemini returns `503` more often than the others under load. The collector retries with backoff; a
cell that still fails is retried on its own rather than re-running the grid.

### `SERPAPI_API_KEY` → covers `google_ai_mode`

Created at serpapi.com; the free plan is ~100 searches/month. This engine has **no model API at
all** — Google AI Mode is not exposed as one — so SerpApi is not a fallback here, it is the route.

One search per cell, so a 5-intent grid is ~5 of the free 100. That is the number to quote when
asking the user to approve a run.

### `MENTION_NETWORK_KEY` → not an engine, and not required to measure anything

Log in at mention.network for a key. Two things want it: `scripts/mcp-client.mjs`, which speaks to
the MCP over plain HTTP (and now works anonymously for the catalog reads, unauthenticated, since
2026-08-19), and the Claude host if the MCP is registered as a host tool. Storing the key unlocks
**P6** — submitting the finished run for storage and the hosted PDF — it does not unlock the run
itself; P1–P5 already worked without it. Get this key when the user wants the run stored and
exported, not as a precondition for starting.

Registering it with the host as well:

```bash
claude mcp add mention-network --transport http \
  https://shopify-mcp.mention.network/api/v1/mcp \
  --header "Authorization: Bearer ${MENTION_NETWORK_KEY}"     # then reload the session
```

That's the production host — the one to use. `MENTION_NETWORK_MCP_URL` overrides it for
development against `https://shopify-mcp-dev.mention.network/api/v1/mcp`, but **the two hosts do
not share keys**: a dev-issued key is rejected by prod (measured: a 401 invalid-key error). If a
user's key stops working right after you point them back at production, this is why —
they need a production key, not just the production URL.

**Say this out loud when you hand that over:** unlike everything else here, it puts the live key in
a command-line argument, where another local user can read it out of `ps` while it runs, and
`claude mcp add` then writes it into its own config file. That is that command's interface, not a
choice this skill makes — but design contract 6 promises keys never go through argv, and this is the
one place that promise does not hold.

## After any setup step

Re-run the check and say what changed before spending anything:

```bash
node "$HERE/scripts/credentials.mjs" check
```

Read it as **six** distinct states, because the fix differs (`scripts/credentials.mjs:253-258`):

- **`missing`** — no key. Offer to add one.
- **`ok`** — the provider accepted it. Nothing to do.
- **`REJECTED`** — the provider answered `401`/`403`: a key that is wrong or revoked, **and only
  on those two statuses**. Offer to replace it, and name the provider that refused it. This is a
  different conversation from having no key.
- **`inconclusive — provider answered <status>`** — any other non-2xx status, most often `429`.
  **This, not `REJECTED`, is where "out of quota" actually lands** — a rate limit is not proof the
  key is bad. Retry before saying anything about the key.
- **`unreachable`** — a network problem, not a verdict on the key. Retry before telling the user
  anything about it.
- **`not probed here`** — `MENTION_NETWORK_KEY` only; this tool has no cheap probe for it, P1's own
  MCP call is the real check.

Then re-state coverage (`N/4 engines`) and only then collect.
