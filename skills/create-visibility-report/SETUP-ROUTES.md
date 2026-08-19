# Setting up keys — how to reach **full engine coverage**

Read this when an engine has no working key. Every gap here is a setup step measured in minutes;
none of them is a reason to run a smaller grid.

## Why coverage is all-or-nothing

The backend requires the full platform × intent grid and rejects a short submission
(`INCOMPLETE_PLATFORM_GRID` / `INCOMPLETE_INTENT_GRID`). So "collect the three we can reach and
skip the fourth" is not the cheaper option it looks like — it spends the whole quota and then fails
at submit. Either every engine has a key, or the run moves to the backend lane.

## One key per engine

There is no ranking and nothing to choose between. Each engine has exactly one route:

| Engine | Key | Where it comes from | Cost |
|---|---|---|---|
| `claude` | `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | metered per token |
| `chatgpt` | `OPENAI_API_KEY` | platform.openai.com → API keys | metered per token |
| `gemini` | `GEMINI_API_KEY` | aistudio.google.com → Get API key | free tier |
| `google_ai_mode` | `SERPAPI_API_KEY` | serpapi.com → Dashboard | free ~100 searches/month |

Plus `MENTION_NETWORK_KEY` (mention.network), which is not an engine — it is how the finished
report is stored and exported. Without it the run stops at P1.

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

### `MENTION_NETWORK_KEY` → not an engine

Log in at mention.network for a key. Two things want it: `scripts/mcp-client.mjs`, which speaks to
the MCP over plain HTTP, and the Claude host if the MCP is registered as a host tool. Storing the
key is enough for the former, which is enough to finish a run.

Registering it with the host as well:

```bash
claude mcp add mention-network --transport http \
  https://shopify-mcp-dev.mention.network/api/v1/mcp \
  --header "Authorization: Bearer ${MENTION_NETWORK_KEY}"     # then reload the session
```

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

Read the three states separately, because the fix differs:

- **`missing`** — no key. Offer to add one.
- **`REJECTED`** — a key that is wrong, revoked, or out of quota. Offer to replace it, and name the
  provider that refused it. This is a different conversation from having no key.
- **`unreachable`** — a network problem, not a verdict on the key. Retry before telling the user
  anything about it.

Then re-state coverage (`N/4 engines`) and only then collect.
