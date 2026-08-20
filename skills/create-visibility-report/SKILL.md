---
name: create-visibility-report
description: 'Use to create an AI Visibility Report for a Shopify store, measured entirely on the user''s own machine and the user''s own API keys. Collection, detection and analysis all run locally; the Mention Network MCP is used for two things only — fetching the live catalog (intents, prompt templates, model ids) when reachable, and storing/exporting the finished report at the end. Probes everything first — stored keys, which of the four engines are reachable, the storefront catalog, any recent run — then asks the user at most three times, each a click on pre-filled options: one confirm card (shop, product, market, language, city (optional, defaults to country-level), the key behind each AI engine, cells/time/cost), one prompt approval, one optional website audit. Every engine is an API key and nothing else: chatgpt on OPENAI_API_KEY, claude on ANTHROPIC_API_KEY, gemini on GEMINI_API_KEY, and google_ai_mode — which has no model API and no alternative route — on SERPAPI_API_KEY. A missing or rejected key is never a dead end: the skill names the engine, then offers two real choices — supply the key now, or skip that engine for this run — and the declared platform set threads through the grid, the submission and the local report so a skipped engine is never a silent hole or a false zero. Accepts a one-line shorthand (`/create-visibility-report kbeautyarabia.com byok country=SA`) with tokens in any order and misspellings corrected silently. A logged-in consumer chat UI is never used: its memory and custom instructions personalize the answer and the report would no longer measure what a neutral shopper sees. Collects, analyzes the answers client-side by default, and writes a local report before touching the network again — submitting to Mention Network for storage and the hosted PDF is a separate, optional last step that can fail or be declined without losing the run.'
version: 1.0.0
platforms: shopify
requires-mcp: [mention-network]
provenOn: —
---

# Create Visibility Report

Produce an AI Visibility Report for a Shopify store. Two lanes: **BYOK** (default — the user's own
API keys collect the answers) and **backend-run** (the backend spends its own AI budget).

**This document is the playbook.** Read it together with `ARGUMENTS.md`, `SETUP-ROUTES.md`,
`RECOVERY.md` and `ANALYSIS.md` — there is no other document that tells you how to run this skill.
The MCP calls this skill makes (`describe_check_grid`, `get_prompt_templates`,
`get_product_name_rules`, `get_template_localization_rules`, `get_detect_extraction_spec`) return
**data** from the backend's own tables — intent slugs, model ids, prompt templates, localization and
extraction rules — never **method**. They change what this run measures; they never change what to
do next.

**Design contract for this skill — hold to it:**

1. **Probe before you ask.** P1 runs unattended and fills every later option with a real value.
2. **Three asking moments, no more:** Q1 confirm → Q2 prompts → Q3 audit. Each is one
   `AskUserQuestion` with concrete pre-filled options; typing is the fallback, not the path.
3. **The confirm card always shows** — even when the shorthand supplied everything. Only the `yes`
   flag skips it.
4. **A gap is a decision, not a verdict.** Never end a turn with "only 1 of 4 engines is possible"
   as if that settled it. Say, per engine, whether a usable key exists, and then give the user the
   two real choices: supply the key now, or skip that engine for this run. Never silently skip
   (a hole nobody agreed to), never silently fail (a missing key is not a reason to stop measuring
   the other three).
5. **A declared platform has no holes; an undeclared one is never in the grid at all.** The backend
   rejects a submission with a hole in a platform it WAS declared for (`INCOMPLETE_PLATFORM_GRID` /
   `INCOMPLETE_INTENT_GRID`) — but declaring fewer than 4 platforms is a legitimate outcome now:
   skipping an engine means never declaring it, never collecting a cell for it, and never
   submitting one for it. It never means declaring the engine and leaving its cells empty, and a
   skipped engine's cells must never reappear later as an empty row or a false zero.
   `scripts/engine-preflight.mjs` turns the Q1 answer into the declared/skipped/blocked split every
   later step (`grid.json`, the submission, the local report) reads — see *Credentials* below.
6. **The run is local-first.** Collection (P4), detection (P4.5) and validation (P5) all complete
   on this machine and produce a local report before the MCP is touched again for anything but the
   live catalog. Submitting the finished run to Mention Network (P6) is a separate, final, optional
   step — it can fail, be declined, or wait on a key without erasing what was already measured.
   `MENTION_NETWORK_KEY` missing means "cannot store yet," never "cannot measure."
7. **Secrets are handled, never echoed.** Every key goes through `scripts/credentials.mjs`, which
   reads values from the environment and never from argv. Do not print a key, do not repeat one
   back, and do not write one into a file inside this skill directory.

```
P0 parse → P1 preflight → P2 resolve → [Q1 confirm: engines + gaps] → P3 prompts → [Q2 approve]
        → P4 collect → P4.5 analyze → P5 validate + local report
        → P6 submit (optional, needs MENTION_NETWORK_KEY) + poll → P7 export → [Q3 audit]
```

Companion files — read the one the situation calls for, not all of them up front:

| File | Read it when |
|---|---|
| **`ARGUMENTS.md`** | The invocation carries arguments — grammar, aliases, route ranking, repair rules |
| **`SETUP-ROUTES.md`** | A route is missing and needs installing/keying/logging in |
| **`RECOVERY.md`** | Anything fails, or the invocation says `resume` — error → fix, run dir, resume |
| **`ANALYSIS.md`** | You've reached P4.5 (right after collection) — the full client-side detection playbook |

> A BYOK run's report carries `source: byok` — the numbers rest on data the submitter supplied and
> the backend never observed. **Disclose that wherever the report is shown to anyone else.**

## Clean-room collection — never a logged-in chat UI

The report answers one question: **what does a real shopper, with no history, see when they ask?**
A logged-in consumer chat UI cannot answer it. ChatGPT, Claude and Gemini all personalize from
saved memory, custom instructions and prior chats in that account — so the same prompt in the
user's own browser returns *their* answer, not the market's. Measured: this is what pushed the
`claude-in-chrome` route out of this skill entirely.

**Every route here is an API key, and that is the same rule stated positively.** An API request
carries no account history, no saved memory and no custom instructions — it is a clean room by
construction, not by careful configuration:

| Engine | Key | Endpoint |
|---|---|---|
| `chatgpt` | `OPENAI_API_KEY` | Responses API, `web_search` tool |
| `claude` | `ANTHROPIC_API_KEY` | Messages API, server-side `web_search` tool |
| `gemini` | `GEMINI_API_KEY` | `generateContent`, `google_search` grounding |
| `google_ai_mode` | `SERPAPI_API_KEY` | SerpApi — this engine has no model API at all |

There is no subscription lane and no browser lane. Both existed once: a headless CLI on the user's
own plan was free, and a signed-out Playwright profile was a genuine clean room. Neither survives
being installed from a registry — one needs a vendor CLI installed and logged in on the machine,
the other needs a browser MCP in the session and a profile nobody can verify from here.

If a route would require signing in to a consumer chat account, it is not a route — offer to set up
the key instead (`SETUP-ROUTES.md`).

## Live data comes from the MCP, never from memory — with a documented fallback when it's unreachable

The intent slugs, the platform list, the prompt templates, and the exact `servedModel` /
`apiModelId` each platform requires are **live catalog** from the backend's own tables — they have
already changed by migration more than once (`gpt-4o`→`gpt-5.5`, `gemini-2.5-pro`→`gemini-3.5-flash`,
and 2026-07-29 `gemini-3.5-flash`→`gemini-3.6-flash`, with `3.5-flash` kept as the managed lane's
in-platform fallback — see the fallback ADR, and 2026-08 `fastest_shipping`→`free_shipping`). Never
hardcode, recall, or invent them — that history is exactly why. Fetch every run:
`describe_check_grid` (its response already carries the full `intents` list — no separate
`list_intents` call needed), `get_prompt_templates`, `get_product_name_rules`,
`get_template_localization_rules`, and — for the client-side analysis at P4.5, which runs **by
default** — `get_detect_extraction_spec`. The validator that rejects your payload reads the same
catalog — the MCP is the only source that can't drift.

**The MCP now answers these anonymously** (verified 2026-08-19: prod accepts a request with no
Bearer at all, principal `anonymous`, and `tools/list`/`describe_check_grid` both return real data —
`scripts/mcp-client.mjs` already omits the header rather than sending a stale one, which is worse
than none because a *wrong* key still 401s). So a missing `MENTION_NETWORK_KEY` is not a reason
this fetch should fail — only real unreachability (network outage, MCP genuinely down) is.

**When the fetch itself fails, degrade to the local fallback — never stop the run and never invent
a value.** `scripts/catalog-cache.mjs` keeps a dated copy of the last catalog each name
successfully returned, in the same config directory as the credential store (outside this bundle,
never in git):

```bash
# after every successful fetch this run:
node "$HERE/scripts/catalog-cache.mjs" save describe_check_grid /path/to/the/response.json

# when the live fetch fails:
node "$HERE/scripts/catalog-cache.mjs" load describe_check_grid   # {fetchedAt, age, data} or throws
```

If nothing is cached yet (a brand-new machine's first run, and the MCP happens to be down), there
is genuinely no local path — say so, and offer `dry-run` or waiting rather than guessing a value.
If something is cached, use it, but **say so out loud, with its age, everywhere the run would
otherwise have shown live data**: on the confirm card ("catalog: local fallback, fetched 3 days
ago — intents/model ids may be stale"), in `state.json`, and in the local report P5 writes. What
goes stale fastest is exactly the two things that migrate — the intent list and each platform's
`apiModelId` — so a stale `apiModelId` is not fatal (ADR-0036: a mismatch is a warning, not a
block, see P4's collector table) but it does mean the report may show a different model than the
one actually serving that engine today. Re-run once the MCP is reachable to refresh the cache.

## Credentials — enter once, reuse, never echo

Secrets live in a dotenv file **outside this bundle**: `~/.config/mention-network/credentials`
(override with `$MENTION_NETWORK_CREDENTIALS`), `chmod 600`, managed by `scripts/credentials.mjs`.
It never enters the bundle, the `.tgz`, or git.

- Load it at the start of every run (P1) and never re-ask for a secret that's already there.
- When a key is missing, hand the user a command they run themselves, so the secret never enters
  this conversation and never lands in shell history:
  ```bash
  read -rs OPENAI_API_KEY && export OPENAI_API_KEY \
    && node "$HERE/scripts/credentials.mjs" save OPENAI_API_KEY
  unset OPENAI_API_KEY        # own line, so it runs even when the save above fails
  ```
  If they would rather paste it to you, that is their call — say once that it will be stored in the
  conversation history, then save it with the value in the environment, never in argv:
  `OPENAI_API_KEY='<pasted>' node "$HERE/scripts/credentials.mjs" save OPENAI_API_KEY`.
- `credentials.mjs check` asks each provider whether a stored key still works — one cheap list call
  each. Run it before a grid, not after: a revoked key found at cell 9 has already spent cells 1-8.
- `credentials.mjs remove <NAME>` drops one; saving again replaces it.
- `MENTION_NETWORK_KEY` can be stored, but the MCP is launched by the Claude host — what actually
  persists the connection is `claude mcp add` / the host config / the shell profile. It gates
  **storage** only (P6) — see *Local-first* below for why its absence never stops P1–P5.
- **Never print a secret.** `status` masks to the last 4; consume values only by sourcing the file.

### A missing key is a conversation, not a dead end

Four keys are engines (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `SERPAPI_API_KEY`);
`MENTION_NETWORK_KEY` is storage, handled separately below. For the four engine keys, run
`credentials.mjs check` (P1) and feed its lines to `scripts/engine-preflight.mjs`'s
`engineStatuses()` — it classifies each engine into the same six states `check` prints (`missing` /
`ok` / `rejected` / `inconclusive` / `unreachable` / `not-probed`), then `classifyGaps()` separates
the two that need a **retry, not a conversation** (`inconclusive` — usually a `429`, and
`unreachable` — a network blip; neither is a verdict on the key) from the two that do
(`missing`, `rejected`).

For every engine still in a gap state after a retry, say so plainly and offer **exactly two real
choices** — never a silent skip, never a silent fail:

1. **Supply it now** — hand over the `read -rs` one-liner (below) so the value never enters this
   conversation. Re-run `check` once they say it's done.
2. **Skip this engine for this run** — a legitimate, first-class outcome now, not a failure mode.
   The engine is left out of the declared platform set entirely (see design contract 5): no cell is
   collected for it, none is submitted, and the local report states the real denominator — "2 of 4
   engines measured" — with the reason next to the engine that's missing, not as a footnote.

`scripts/engine-preflight.mjs`'s `resolveDeclaredPlatforms({ statuses, decisions })` is where this
turns into data: an `ok` engine declares itself with no decision needed; a gap engine with **no**
decision yet is `blocked` — neither declared nor skipped, because Q1 hasn't actually asked yet;
`decisions[engine] = 'skip'` moves it to `skipped` with a `reason` string the local report prints
verbatim; `decisions[engine] = 'include'` on an engine that is **not** `ok` is refused into
`blocked` rather than honored — forcing an unready engine into the grid is exactly the silent hole
this exists to prevent.

**`SERPAPI_API_KEY` is not one of several options — it is the only route to `google_ai_mode`.**
There is no fallback engine, no alternative provider, nothing else that answers "what does Google
AI Mode say" (SETUP-ROUTES.md). Say that explicitly when this key is the gap, so the user
understands skipping it means the report has nothing at all for that engine, not a lesser version
of it.

---

## P0 — Parse the invocation

No arguments → guided run, skip to P1. Arguments present → read **`ARGUMENTS.md`** and extract
`domain`, `lane`, key-values, flags. Every token is **order-free** (the domain too — find it by
shape), and obvious misspellings are corrected silently. Route tokens from when this skill had more
than one route per engine (`llm=cli`, `ai-mode=playwright`, `chatgpt=agent-sdk`) still parse and are
repaired to the key route with a note — see `ARGUMENTS.md`. Parsing never fails the run: an
unrecognized token becomes a note on the confirm card.

`resume` present → read **`RECOVERY.md`** and pick up the existing run directory instead.

## P1 — Preflight: one batch, ask nothing

Everything here runs before the user is asked anything, so every option in Q1 is backed by a real
value. Run it as one batch and read the results together.

> **Nothing in P1 stops the run anymore.** The old rule here — no `MENTION_NETWORK_KEY` and no host
> MCP tool answering ends the run before any question — is gone (design contract 6, *Local-first*).
> `MENTION_NETWORK_KEY` gates **storage** (P6) only, and the MCP now answers the catalog calls
> anonymously (below), so its absence rarely blocks anything at all. What *does* still shape Q1 is
> the **per-engine** key state (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` /
> `SERPAPI_API_KEY`) — that's a real gap, handled as the conversation in *Credentials* above, never
> a stop condition either. The batch below is only half of P1 — the bulleted probes after it carry
> the rules that decide what Q1 actually offers.

```bash
HERE="$(dirname "$(readlink -f "<abs path to this SKILL.md>")")"   # this skill's folder
CREDS="${MENTION_NETWORK_CREDENTIALS:-$HOME/.config/mention-network/credentials}"
set -a; [ -f "$CREDS" ] && . "$CREDS"; set +a        # stored secrets into this shell, unechoed
node "$HERE/scripts/credentials.mjs" status          # masked: stored | env only | missing
node "$HERE/scripts/credentials.mjs" check           # does each stored key still work?
curl -s -o /dev/null -w '%{http_code}' "https://<shopDomain>/products.json?limit=250"
```

Alongside it, in the same batch:

- **MCP alive?** One cheap call (`get_shop({shopDomain})`), tried **without** a key first — since
  2026-08-19 prod answers anonymously (*Live data comes from the MCP*, above). This is a catalog
  freshness probe now, not an access gate: it succeeds for almost everyone, key or no key.
  **No `mention-network` tools in the session is *not* a blocker.** `scripts/mcp-client.mjs` speaks
  the same MCP over plain HTTP, so it works whether or not a `MENTION_NETWORK_KEY` is stored
  (measured 2026-07: a full 20-cell run completed in a session where the host had no
  `mention-network` tools at all). Try that path before asking the user for anything:
  ```bash
  node --input-type=module -e "
  const { callTool } = await import('$HERE/scripts/mcp-client.mjs')
  console.log(JSON.stringify(await callTool('get_shop',{shopDomain:'<domain>'})))"
  ```
  Use `callTool` for every MCP call in that case — the tool names and arguments are identical.
  Only when **both** the host tools are absent **and** that anonymous HTTP call fails is the MCP
  genuinely unreachable this run. That is no longer a stop condition (*Local-first*): fall back to
  `scripts/catalog-cache.mjs load <name>` for whatever catalog calls P3 needs, note the fallback and
  its age on the confirm card, and carry on — see *Live data comes from the MCP* above for exactly
  what goes stale and how it's disclosed. If the user separately wants the MCP registered as a host
  tool, or wants to store this run at the end, that is what a `MENTION_NETWORK_KEY` is for:
  ```bash
  export MENTION_NETWORK_KEY=<their-key>       # from mention.network — never invent one
  claude mcp add mention-network --transport http \
    https://shopify-mcp.mention.network/api/v1/mcp \
    --header "Authorization: Bearer ${MENTION_NETWORK_KEY}"
  ```
  (Running this bundle *as* a plugin? The shipped `.mcp.json` already declares it — they only need
  `export MENTION_NETWORK_KEY=...` and a reload.) A **401** is a wrong key, not a missing one — see
  `RECOVERY.md`; a wrong key is worse than none (*Live data comes from the MCP*, above), so don't
  send a stored key you have not verified with `check`. `mcp-client.mjs`'s own default points at
  this same production host; override with `MENTION_NETWORK_MCP_URL` only to point at the `-dev`
  host for development — and note that a **dev-issued key is rejected by prod** (measured: prod
  answers it with `401 "Internal API key không hợp lệ"`), so switching hosts back to production
  needs a production key, not just a URL change.
- **A key per engine** — `ANTHROPIC_API_KEY` covers `claude`, `OPENAI_API_KEY` covers `chatgpt`,
  `GEMINI_API_KEY` covers `gemini`, `SERPAPI_API_KEY` covers `google_ai_mode`. That mapping is the
  whole routing problem: there is one route per engine, so P1 is not choosing between routes, it is
  establishing which of the four keys exist and still work — see *Credentials → A missing key is a
  conversation, not a dead end* above for the full six-state read and what Q1 does with a gap.

  **A key in the store is not proof it works**, so `credentials.mjs check` is part of the batch
  above rather than an optional extra. It is one list call per provider and it costs nothing;
  discovering a revoked key at cell 9 of a declared 20 has already spent cells 1-8 and still fails
  the grid, because a hole in a *declared* platform is rejected outright (design contract 5) — the
  fix for a bad key is to add a working one or to declare fewer platforms, decided **before**
  collecting, never discovered mid-grid.
- **Store + catalog** — `get_shop` (reuse `primaryLocale` as the language hint; `SHOP_NOT_FOUND`
  just means never-checked) and `list_shop_products`. The backend's product view is often sparse
  (measured: **1** product for a store whose storefront listed a full catalog), so also read
  **`https://<shopDomain>/products.json`** — Shopify exposes it publicly (`?limit=250&page=N`), and
  each product carries `id`, `title`, `handle`, `vendor`, `product_type`, `variants[0].price`, and
  **`images[0].src`** — everything the Snapshots shape needs, image included. `list_shop_products` /
  `get_shop` often return `imageUrl: null` (the backend's own sync doesn't populate it yet), so the
  storefront JSON is the reliable source for the product image.
- **Recent run** — `list_visibility_checks({shopDomain})`. A `status: completed` item with
  `finishedAt` inside 7 days is worth offering before spending anything.

Map the probe to **engines, not routes** — coverage is what the user cares about.

## P2 — Resolve the plan *(this produces pre-selections, not decisions)*

Combine what was parsed (P0), what was probed (P1), and the defaults, and produce a plan with no
blanks. **Every value here that the invocation did not supply is a candidate — the first option in
its Q1 question, not the answer.** Read the whole of this section that way; "resolve" below always
means "work out the best option to offer", never "settle it". Values the invocation *did* supply are
settled, and are not asked about again.

That distinction is the single easiest thing to get wrong in this skill: measured 2026-07, a full
run went out with all four routes chosen silently, and the user only found out by reading the plan
block afterwards.

- **Lane** — `byok` unless the user said `backend`.
- **Market** — the parsed `country=`, else inferred from the domain (a store named `…arabia.com` →
  SA / AE / EG). **An inference is the first option in Q1, not the answer** — if `country=` wasn't
  supplied, it gets asked.
- **Language** — the market's **local** language leads (the MCP's own instruction: a non-English
  market measured in English gives a different ranking), with English as the alternative. Again: if
  `lang=` wasn't supplied this is **asked**, never assumed. `get_shop.primaryLocale` is a hint for
  ordering the options; it is frequently `null`, and it describes the *website*, not the shopper.
- **City** — optional (`locationCity` is nullable on every downstream call), and that's what makes it
  different from Market/Language: leaving it blank is itself a perfectly good answer, not a decision
  dodged. So it does **not** get asked, and it does **not** get its own question — it rides inside
  the Market + language question at Q1 as a third, always-present default: *(Recommended)*
  country-level (no city), narrowed only if the user types one into that question's free-text answer
  (e.g. `SA · Arabic · Riyadh`) or the invocation supplied `city=`. Never guess a city from the
  domain or the shop address — an unsolicited city is a claim about a narrower market than anyone
  asked for.
- **Product** — from the storefront catalog, else `list_shop_products`, else seed one or two
  plausible flagship titles for the user to pick. **Never invent one silently.**
  `/products.json` is ordered by the store's own collection sort, **not** by sales — so position 1
  is not a bestseller and must never be presented as one. When it is your only source, **offer 3–4
  titles as the Q1 product options** rather than silently pre-picking the first, and say which
  signal you used (recognizable brand, price band, the market's category). Pre-selecting one is
  fine; passing off an arbitrary pick as "the flagship" is not.
- **Key per engine** — one route each, so there is nothing to rank. What P2 resolves instead is
  which engines are *ready*: a key that is stored and passed `check`. Feed `credentials.mjs check`'s
  lines through `engine-preflight.mjs`'s `engineStatuses()` to get that per-engine state. An engine
  whose key is missing or rejected is **not yet declared** — it carries a gap line onto the confirm
  card with the two real choices (*Credentials*, above): add the key, or skip it for this run. P2
  does not decide which; it only makes sure every gap is visible so Q1 can ask.
- **Estimate** — cell count (platforms × intents), rough minutes, and cost. API cells are separate
  processes and **fan out** (`collect-pool.mjs` runs 4 per provider by default), so the three model
  engines finish in roughly the time of the slowest single cell. Name the metered ones explicitly:
  OpenAI and Anthropic bill per token, Gemini spends AI Studio free-tier quota, and SerpApi is one
  search per cell out of the free ~100/month.

## Q1 — The confirm card *(asking moment 1 of 3)*

One `AskUserQuestion`. Show the resolved plan first as a compact block, then offer the options.

```
Shop      kbeautyarabia.com  ·  SA  ·  Arabic
City      country-level (no city set — optional, say one to narrow the market)
Product   COSRX Advanced Snail 96 Mucin Power Essence
Lane      BYOK (your own API keys — the backend spends nothing)
Keys      chatgpt         OPENAI_API_KEY     ****a91f   ✓ checked
          claude          ANTHROPIC_API_KEY  ****0c47   ✓ checked
          gemini          GEMINI_API_KEY     ****FHEQ   ✓ checked
          google_ai_mode  SERPAPI_API_KEY    ****075c   ✓ checked · ~4 of your free 100
Coverage  4/4 engines · 20 cells · ~8 min · ~$0.40 · clean room (no logged-in chat UI)
```

A gap looks like this instead — the card still shows, the estimate is still real, it's just built
from the declared set rather than assuming all four (and note there is no `google_ai_mode` row
pretending to be checked when it isn't — a skipped engine gets one clear ⚠ line, never a silent
absence):

```
Shop      kbeautyarabia.com  ·  SA  ·  Arabic
City      country-level (no city set — optional, say one to narrow the market)
Product   COSRX Advanced Snail 96 Mucin Power Essence
Lane      BYOK (your own API keys — the backend spends nothing)
Keys      chatgpt         OPENAI_API_KEY     ⚠ missing — no key stored
          claude          ANTHROPIC_API_KEY  ****0c47   ✓ checked
          gemini          GEMINI_API_KEY     ****FHEQ   ✓ checked
          google_ai_mode  SERPAPI_API_KEY    ⚠ REJECTED 401 — key is wrong, revoked or out of quota
Coverage  2/4 engines ready (claude, gemini) · 2 need a decision (chatgpt, google_ai_mode)
          10 cells · ~4 min · ~$0.20 if run at 2/4 · clean room (no logged-in chat UI)
```

### What goes in the Q1 call

`AskUserQuestion` takes **at most 4 questions**. **One rule generates the list: anything the
invocation did not supply gets asked; anything it did supply is not.** Compose in this order:

1. **Product** — ask unless `product=` was supplied. Offer 3–4 real titles from the catalog.
2. **Market + language** — ask unless **both** `country=` and `lang=` were supplied. One question:
   the market and the language it will be asked in are a single decision. **City rides along in this
   same question and never gets one of its own** — it's optional, so the *(Recommended)* option is
   always country-level (no city); a user who wants to narrow it types it into the free-text "Other"
   answer (e.g. `SA · Arabic · Riyadh`). If `city=` was supplied, print it on the card and don't ask
   about it — same rule as `country=`/`lang=`.
3. **Routes for the model engines** (`chatgpt` / `claude` / `gemini`) — ask unless the arguments
   pinned them (`engine=route`, `llm=cli`, `route(engine)`). They can mix.
4. **Route for `google_ai_mode`** — ask unless pinned. Its own question, always.

**The rule runs both ways — never re-ask what the shorthand already answered.** A user who typed
`product="Water Bank" country=SA lang=ar llm=cli ai-mode=serpapi` has made every decision there is;
asking them again is noise that makes the shorthand pointless. Show those values on the card so they
can still be corrected, and ask nothing about them.

**When everything was supplied**, none of the four fire — then ask the single confirm question
(*Run it (Recommended)* · *Change product* · *Change market or language*) so the card still gets an
answer. Design contract 3: the card always shows.

**A missing key usually needs no question of its own.** When another question is firing, the gap
rides along inside it as a ⚠ row on the affected engine, worded with both real choices
(`engine-preflight.mjs`'s `gapLine()` — *"gemini: no GEMINI_API_KEY. Supply it now (free AI Studio
key, ~1 min) or skip gemini for this run."*) — the user picks either in the same click.

It becomes a **separate question only when there is nothing else to attach it to**. In that case
ask it directly rather than folding it into an unrelated question — *Access gap*, below, is that
question's exact shape. Adding a key needs a round trip anyway (the user runs the `read -rs` line,
you re-check), so it was never going to fit in the same breath either way.

> ### Never decide the product or the language for the user
>
> Same rule as routes, and it is broken the same way: P2 resolves a sensible default, Q1 shows one
> *"Run it (Recommended)"*, the user clicks it, and a product and a language they never chose are
> now on a customer-facing report.
>
> **An inferred value is a pre-selected option, never a decision.** `…arabia.com` → SA is a good
> guess for the *first option*, not a licence to skip the question. The same goes for taking the
> market's local language, and for picking a product out of the catalog.
>
> These two are not cosmetic:
> - **Language changes the answer, not the wording.** The MCP's own instruction says so: the same
>   question asked in English versus in the local language produces **materially different
>   rankings**. Choosing it silently picks which market's reality gets reported.
> - **The product is the entire subject.** `/products.json` is ordered by the store's collection
>   sort, not by sales, so "the first one" is arbitrary — and a report about the wrong product is
>   simply the wrong report, at full quota cost.
>
> Only `product=` / `country=` + `lang=` in the arguments, or `yes` (which skips the whole card),
> authorise proceeding unasked. Under `yes`, print both values in the plan block marked `(auto)`.
>
> **City is the one exception to this rule, on purpose.** Its default — no city, country-level — is
> not a stand-in for a decision the user should have made; it's a legitimate answer on its own, so
> defaulting to it silently costs nothing. That's why it never gets asked outright, only offered as
> the narrowing option inside the Market + language question above.

> ### Never choose a route for the user on your own
>
> **The ranking decides what is *pre-selected*, never what is silently used.** An engine whose route
> the arguments did not pin gets a question — every run, even when the ranking's answer is obvious
> and even when only one route works. Resolving routes in P2 and skipping straight to *Run it* is
> the single easiest way to get this skill wrong: measured 2026-07, a full run went out with all
> four routes chosen silently and the user only found out by reading the plan block.
>
> Skip a route question **only** for engines the arguments already pinned (`ARGUMENTS.md`) — by
> `route(engine)`, `engine=route`, or a group like `llm=cli` — and even then show the resolved route
> per engine on the card, so a group's expansion and any repair stay visible. A group that pinned
> three engines still owes the user those three lines; never collapse it back to "llm: cli".
>
> Exactly two tokens authorise taking the ranking's pick unasked, and nothing else does: **`auto`**,
> and **`yes`** (which skips the whole card, so no question survives to ask). Under either, print
> every auto-chosen route in the plan block marked `(auto)` — the user still gets to see what was
> decided for them, just after the fact instead of before.

### One route per engine, and the rule that governs the options

Each engine has exactly **one** collection route, so there is no route to choose. Every question
about collection is really a question about whether a key exists:

| Engine | Route | Key | Cost |
|---|---|---|---|
| `chatgpt` | Responses API + `web_search` | `OPENAI_API_KEY` | metered per token |
| `claude` | Messages API + server-side `web_search` | `ANTHROPIC_API_KEY` | metered per token |
| `gemini` | `generateContent` + `google_search` | `GEMINI_API_KEY` | AI Studio free tier |
| `google_ai_mode` | SerpApi (no model API exists) | `SERPAPI_API_KEY` | ~1 search per cell of a free ~100/month |

> ## Skipping an engine is a real option — but a declared one, never a silent one.
>
> **There is no "leave it out and say nothing" option, and no "declare it anyway and hope."** Those
> are the two things that actually cannot work: a submission with a hole in a platform it declared
> is rejected (`INCOMPLETE_PLATFORM_GRID` / `INCOMPLETE_INTENT_GRID`), and a report that quietly
> drops an engine's row without saying so misrepresents what was measured. **Skipping the engine
> outright is fine** — the owner's own framing for this skill: a missing key gets a plain statement
> of the gap and two real choices, supply it or skip it. "Skip" means the engine is never declared:
> no cell collected, no cell submitted, and the local report's coverage line names it and why
> (design contract 5, *Credentials* above). Measured 2026-07-28, before this rule existed: a real
> run was offered a THIRD thing — collect fewer engines while still declaring all four — which is
> the one shape that is never legitimate, because that is exactly the hole `INCOMPLETE_PLATFORM_GRID`
> exists to catch.
>
> The three real answers to "this engine has no working key" are **add the key**, **skip the
> engine for this run** (declare fewer, still get a full report on the rest), or **switch the whole
> run to the backend lane** if the user wants all four without creating any keys at all.

Build the card from what `credentials.mjs check` actually reported (P1), run through
`engine-preflight.mjs`'s `engineStatuses()`, and label every engine with its key state. A real
question from a machine with two keys missing:

```
Two engines have no key yet — how do you want to cover them?
  ▸ Add both keys now (Recommended)   I print one command per key; the value never enters this chat
                                      gemini:         free AI Studio key      (~1 min, no cost)
                                      google_ai_mode: free SerpApi key        (~1 min, ~100/month) —
                                                       the ONLY route to this engine, no fallback
  ▸ Skip both for this run            report covers chatgpt + claude only; the other two are named,
                                      with why, on the confirm card and in the local report — not
                                      silently absent
  ▸ Backend-run instead               the backend queries all four on its own keys — no longer BYOK
```

Note what the ⚠ rows say and don't: they never demote the engine to a lesser cell, and a "skip"
pick is recorded with its reason, not just dropped. After the user picks, either walk
`SETUP-ROUTES.md` for exactly the engines being added and re-run `credentials.mjs check`, or record
the skip via `resolveDeclaredPlatforms({ statuses, decisions })` and move on — either way, re-state
coverage from the result before spending anything.

Never fold `google_ai_mode` into a question about the model engines: it is a different provider with
a different key, and a missing cell fails the submit with `MISSING_CELL`.

**Every route is a clean room, and that is not negotiable.** There is no "collect it in my browser"
option — don't invent one, and if the user asks for it, explain the memory contamination and offer
the key setup instead. If the user insists after hearing that, it is their call: say plainly in the
plan block and in the handover that those cells came from a personalized account, so the report
measures that account rather than the market.

**Access gap** — if an engine has no working key yet, the question names the gap and offers all
three real answers:

1. **Add the key now (Recommended)** — walk `SETUP-ROUTES.md` for exactly the engines that need it,
   with the concrete command and its real cost (*"a free AI Studio key covers gemini and a free
   SerpApi key covers Google AI Mode — about two minutes, no cost"*). Then re-check and re-state
   coverage before spending anything.
2. **Skip it for this run** — the engine is never declared (design contract 5). Say what the run
   will cover instead ("2 of 4 engines: claude, gemini") and carry the reason onto the confirm card
   and the local report — never a bare "N/4" with no explanation attached.
3. **Backend-run instead** — the backend queries all four on its own keys. The right call when the
   user wants full coverage without creating any keys; it costs the backend's AI budget and the run
   is no longer BYOK.

**The one thing never to do is a fourth option: declare an engine and collect fewer than its full
intent set anyway.** "Declare all four, but only actually collect 3" is not a lighter version of
skipping — it is the exact hole `INCOMPLETE_PLATFORM_GRID` rejects, after the quota for those cells
is already spent. If the user asks for that shape, say plainly that a declared platform must be
complete, and offer skip-it-outright instead.

Getting a key is the user's to do — hand them the `read -rs` one-liner rather than asking them to
paste the secret to you, and **wait for them to say it's done before re-checking**. Do the parts
that don't need a human yourself.

*`dry-run` stops here. `yes` skips this card but still prints the plan and every repair line.*

**Lane = backend → jump to Lane A.** Lane = byok → continue.

## P3 — Build the prompts

**Establish `$RUN` here, before anything gets written — Q2 needs it for `prompts.md`.** An unset
`$RUN` does not stop anything — it silently turns `"$RUN/prompts.md"` into `"/prompts.md"` and
fails much later with a confusing permissions error, the same trap the sibling `visibility-audit`
skill documents for its own `$RUN`. `scripts/run-dir.mjs` creates and prints the run directory
RECOVERY.md documents (`.mn-runs/<slugged shopDomain>/<timestamp>/`) — always get the path from it,
never by hand-typing `.mn-runs/<domain>/…` (it slugs the domain, e.g. `kbeautyarabia.com` →
`kbeautyarabia-com`, so a hand-typed path looks plausible and is wrong):

```bash
HERE="$(dirname "$(readlink -f "<abs path to this SKILL.md>")")"
RUN="$(node "$HERE/scripts/run-dir.mjs" --domain "<shopDomain>")"
echo "$RUN"   # confirm this is a real path before writing anything into "$RUN/…"
```

**Write `state.json` now, with the Q1 decision already in it** — `declaredPlatforms` (the engines
this run measures) and `skippedEngines` (the ones it doesn't, each with the reason from
`resolveDeclaredPlatforms`). RECOVERY.md documents the full shape. Every later step — the grid file
below, the collectors, P5's local report, P6's submission — reads `declaredPlatforms` from here
rather than re-deriving it, so there is exactly one place the declared set is decided.

Fetch the live catalog: `describe_check_grid` (its `intents` field IS the `list_intents` data —
don't call it twice), `get_prompt_templates({language})`, `get_product_name_rules`,
`get_template_localization_rules`.
On success, cache each with `catalog-cache.mjs save <name> <file>` (*Live data comes from the MCP*,
above) so a future run's fetch failure has something dated to fall back to. On failure, load the
cache instead, print its age, and carry the same "local fallback, fetched N days ago" note into
`state.json` and onto the confirm-card-equivalent summary you show before P4.

- **Decide the grid** — `declaredPlatforms` (from `state.json`) × intents. `where_to_buy` is
  **mandatory** on every declared platform; every declared cell must be collected, and no cell is
  ever built for a platform NOT in `declaredPlatforms` (design contract 5).
- **Render the actual prompt per intent** — apply the template with the normalized product name, in
  the prompt's language (localization rules).
  **`{location}` is a natural place name, never the bare `country=` code.** A live template reads
  `"where to buy {product} in {location}"`; filling it with `GB` or `SA` produces broken English
  (or broken Arabic) that reads as a typo to the engine being asked, not as a place. Render it as
  the market's natural place name, in the prompt's own language (`get_template_localization_rules`
  is the source for that name — never hand-translate a country code yourself). When Q1 narrowed to
  a city, `{location}` is `"<city>, <country name>"` (e.g. `"Riyadh, Saudi Arabia"`); at the
  country-level default it's the country name alone (`"Saudi Arabia"`), never the city without its
  country and never the ISO code standing in for either.

## Q2 — Approve the prompts *(asking moment 2 of 3)*

Render a table (intent → the exact prompt) plus the normalized product name and market/language,
then ask: **Approve and run (Recommended)** / **Edit a prompt**. Don't force wording work on a user
who's happy with it.

If they edit, preserve two invariants or the submit is rejected:
- **one prompt per intent, identical across platforms** (`INCONSISTENT_PROMPT_TEXT`);
- `where_to_buy` stays in the set (`MISSING_WHERE_TO_BUY`).

Write the approved table to `"$RUN/prompts.md"` — it's the record of what was asked.

## P4 — Collect

`$RUN` is already set (established at the start of P3, above) — use it for every path from here on;
this is a new tool call, so **source the credential store again** as well, so the collectors see the
stored keys (shell state does not persist between tool calls):

```bash
HERE="$(dirname "$(readlink -f "<abs path to this SKILL.md>")")"
CREDS="${MENTION_NETWORK_CREDENTIALS:-$HOME/.config/mention-network/credentials}"
set -a; [ -f "$CREDS" ] && . "$CREDS"; set +a
mkdir -p "$RUN/cells"
```

**Web search must actually run for every cell** (`WEB_SEARCH_REQUIRED`). Every collector requests
it in the request itself — OpenAI's `web_search` tool, Anthropic's server-side `web_search_20260209`,
Gemini's `google_search` grounding, and SerpApi, which *is* the search. Set `webSearchUsed: true`
only when a search genuinely returned: each collector reads that off the response, and
`collect-api.mjs` **throws rather than submit a cell that claims it**. That distinction is load-
bearing on the Anthropic route in particular — a search the model asked for and the server refused
(`max_uses_exceeded`) still leaves a `server_tool_use` block behind, so the collector counts the
results that came back, not the requests that went out. Citations are *not* required. **Never fake
the flag** — re-run the cell.

**Collect in parallel — this is where the wall-clock time goes.** Each collector is an independent
process writing its own `"$RUN/cells/<intent>.<platform>.json"`, so cells share no state. Group by
route and run each group as a pool:

- **All four engines** — safe to run concurrently; cap ~4–6 in flight **per provider key**, which
  is what `collect-pool.mjs` does by default. Pooling per provider rather than globally matters:
  one provider's rate limit then stalls only its own cells instead of the whole grid.
- On `429`/quota (and Gemini's frequent `503`), back off and retry that one cell — a single failure
  shouldn't sink the batch. The collectors already retry once on those statuses.
- Anthropic cells can take a little longer than the others when the model runs several searches, and
  a long one may return `stop_reason: 'pause_turn'`; `collect-api.mjs` continues the turn itself and
  merges the halves, so this costs wall-clock rather than a failed cell.

**Use `scripts/collect-pool.mjs`.** `--grid <file>` is **required** — the script throws
`--grid <file> is required` with no file, and there is no default or discovery. Build it yourself,
after Q2, from the approved prompts and the live grid, and write it to `"$RUN/grid.json"`:

```json
[
  { "route": "api", "provider": "anthropic", "model": "<apiModelId from describe_check_grid>",
    "platform": "claude", "intent": "where_to_buy", "prompt": "<the approved prompt text>",
    "out": "$RUN/cells/where_to_buy.claude.json" },
  { "route": "api", "provider": "openai", "model": "<apiModelId>", "platform": "chatgpt",
    "intent": "where_to_buy", "prompt": "<...>", "out": "$RUN/cells/where_to_buy.chatgpt.json" },
  { "route": "api", "provider": "gemini", "model": "<apiModelId>", "platform": "gemini",
    "intent": "where_to_buy", "prompt": "<...>", "out": "$RUN/cells/where_to_buy.gemini.json" },
  { "route": "serpapi", "hl": "<lang>", "gl": "<country>", "location": "<city, optional>",
    "platform": "google_ai_mode", "intent": "where_to_buy", "prompt": "<...>",
    "out": "$RUN/cells/where_to_buy.google_ai_mode.json" }
]
```

One entry per cell of the **declared** grid (`declaredPlatforms` × intents from `state.json`), same
shape repeated for every intent — a skipped engine gets **no entry at all**, not an entry with an
empty prompt or a placeholder response; that is what keeps it from ever reappearing as a false zero
downstream. Before running the pool, `engine-preflight.mjs`'s `assertRectangularGrid(jobs.map(j =>
({platformSlug: j.platform, intentSlug: j.intent})), {declaredPlatforms, declaredIntents})` is a
cheap local check that the file you're about to run has no hole and no stray platform — worth
running on `grid.json` itself, before spending a single request, not only on the cells afterward.
`location` is optional and threads straight to `collect-serpapi.mjs --location` — this is where the
Q1 city answer actually reaches an engine; omit it for the country-level default. Every job may
also carry `timeoutMs`, passed through as that collector's `--timeout-ms` (see *The collectors*
below for the default). Then:

```bash
node "$HERE/scripts/collect-pool.mjs" --grid "$RUN/grid.json" [--concurrency api=4,serpapi=4]
```

It pools the whole grid, capped at 4 per provider by default and overridable with `--concurrency`,
with one outer retry per cell. Every route now has a collector script, so the pool covers the
entire grid — there is nothing left to run by hand alongside it. Measured 2026-07-28: a hand-rolled
fan-out drifted serial and collection alone took 5m41s of an 8m54s run, which is what this script
exists to prevent. Per-cell stdout+stderr lands in `"$RUN/logs/<cell file>.log"` — a sibling of
`cells/`, never inside it (RECOVERY.md: `cells/` holds cell files and nothing else).

If you do fan out by hand instead, wait for **all** cells (fail none silently) and update
`state.json` as each finishes.

> **Give the call itself enough wall-clock room — a killed wrapper is not a route failure.**
> However you invoke `collect-pool.mjs`, if you're calling it through a tool with its own default
> execution timeout (a plain foreground shell call, for instance), that default is very likely
> shorter than a full grid needs. Pass an
> explicit long timeout or run it truly in the background and poll; don't let the wrapper get
> killed mid-flight and then read that as the collector or the route being broken. Measured
> 2026-08-01: exactly this mistake burned ~10 minutes retrying the same 3 cells before switching to
> a longer timeout fixed it in one pass. See `RECOVERY.md`'s *Timeout* rows for the full escalation
> (this case vs. the collector's own `--timeout-ms` genuinely firing).

> **Put P4.5 on the task list now, while you're building it.** The collection tasks and
> *"validate, submit, poll, export"* are the obvious two, and a plan that contains only those two
> will skip client analysis every time — measured twice. The list needs **three** items:
> `collect cells` → **`analyze cells → detection`** → `validate, submit, poll, export`.
> When the analysis is fanned out, that middle item is itself three: *render the per-cell prompts →
> dispatch one analyzer per cell → reconcile the set with `check-detections --meta`*. The
> reconcile step is the one that gets dropped, and it is the only one that can see the whole grid.

### The collectors

Every `collect-*.mjs` takes `--intent <slug>` (and optional `--platform`); with it, `--out` is
written as the whole `byokCellShape` — `{ intentSlug, platformSlug, promptText, collectionMethod:
'api'|'browser', response: {…} }` — so a `cells/` dir drops straight into `submit.mjs` with no
hand-wrapping. Without `--intent` you get the bare `response` and must wrap it yourself. This table
is for collecting one cell by hand (debugging a single failure, say); `collect-pool.mjs` above is
what actually runs the grid.

Every collector also takes `--timeout-ms <ms>` — a real `AbortSignal` bound to each HTTP attempt,
default **120000** (2 minutes; `collect-api.mjs`'s `DEFAULT_TIMEOUT_MS`). A provider that accepts
the connection and never answers now fails the cell instead of hanging the run forever; raise it
only if a genuinely slow route keeps tripping it (see RECOVERY.md's *Timeout* rows).

| Engine | Command |
|---|---|
| `claude` | `printf '%s' "<prompt>" \| node "$HERE/scripts/collect-api.mjs" --provider anthropic --model "<apiModelId>" --intent where_to_buy --out "$RUN/cells/where_to_buy.claude.json"` |
| `chatgpt` | `printf '%s' "<prompt>" \| node "$HERE/scripts/collect-api.mjs" --provider openai --model "<apiModelId>" --intent where_to_buy --out "$RUN/cells/where_to_buy.chatgpt.json"` |
| `gemini` | `printf '%s' "<prompt>" \| node "$HERE/scripts/collect-api.mjs" --provider gemini --model "<apiModelId>" --intent where_to_buy --out "$RUN/cells/where_to_buy.gemini.json"` |
| `google_ai_mode` | `printf '%s' "<prompt>" \| node "$HERE/scripts/collect-serpapi.mjs" --hl <lang> --gl <country> [--location <city>] --intent where_to_buy --out "$RUN/cells/where_to_buy.google_ai_mode.json"` |

`--location` is optional (the Q1 city answer, SKILL.md P2 "City") — omit it for the country-level
default. It's the only way that answer reaches this engine at all; `--hl`/`--gl` alone never
narrows past the country.

- **API key** (`anthropic` / `openai` / `gemini`) — a genuine `api` cell: `collectionMethod:'api'`,
  `servedModel` = the `apiModelId` from the live grid, echoed back exactly as passed in `--model`
  rather than read off the response body. A mismatch against `requiredServedModel` is a **warning**
  (`SERVED_MODEL_MISMATCH`, ADR-0036), not a rejection — and whatever you declare is what gets
  stored and shown on the report, not the catalog value. **Always pass `--model` with the value
  `describe_check_grid` gave you this run**, never a remembered one: the catalog has moved more than
  once (`gpt-4o`→`gpt-5.5`, `gemini-2.5-pro`→`gemini-3.5-flash`, and 2026-07-29
  `gemini-3.5-flash`→`gemini-3.6-flash`), and a hardcoded id submits successfully while showing the
  wrong model on the report. Transient `429`/`5xx` are retried with backoff (measured: Gemini `503`).
- **`--provider anthropic`** additionally handles two things the other providers do not surface.
  A `stop_reason: 'refusal'` is raised as an error before the content is read, so a classifier's
  decline can never be recorded as what a shopper was told. And a `pause_turn` — the model pausing
  mid-search — is continued automatically and the halves merged, rather than submitting the fragment
  it had reached.
- **SerpApi** (`google_ai_mode`) — the real AI-Mode answer + source links. `collectionMethod:'browser'`,
  `servedModel` **empty**, `webSearchUsed: true`. Throws without `SERPAPI_API_KEY`. `'browser'` here
  is the wire value the backend expects for an engine that never states which model answered — it
  does not mean a browser was driven. Any `servedModel` on such a cell is
  `UNEXPECTED_SERVED_MODEL` — the validator wins over any table value.

> **How a cell maps to `collectionMethod`.** The wire enum is `'api' | 'cli' | 'browser'`. This
> skill only ever writes two of them: the three model engines are `'api'` (the model is known,
> because you passed it in `--model`), and `google_ai_mode` is `'browser'` with an empty
> `servedModel`. `'cli'` belonged to the subscription lane and is never written here — it stays in
> the enum because the backend still accepts payloads that use it.
>
> **Since ADR-0036: the model check on `'api'` no longer blocks.** A mismatch against
> `requiredServedModel` produces `SERVED_MODEL_MISMATCH` as a **warning** in
> `validate_byok_submission` / `submit_byok_check` — the submit still succeeds. What is still
> guaranteed: the `servedModel` you declare is stored as-is (`ai_responses.served_model`) and is
> what the report shows, not silently coerced to the catalog value. Declare it honestly regardless —
> a catalog mismatch is now recoverable, a false declaration is not.
> `google_ai_mode` and `'browser'` are **unaffected** — a declared `servedModel` there is still a
> hard-blocking `UNEXPECTED_SERVED_MODEL`, because that is a place where a model cannot honestly be
> observed at all, not a catalog-drift case.

## P4.5 — Analyze the answers yourself · **default ON, not an optional extra**

**This step runs on every BYOK run unless the user says otherwise.** Put it on the P4 todo list as
its own task now (*"Analyze 20 cells → detection"*), before you go read the details — measured
2026-07-28: two real runs went straight from *"collect cells"* to *"validate, submit, poll,
export"* because the todo list never contained this step, and if it isn't on the list it doesn't
happen.

Read **`ANALYSIS.md`** now for the full playbook: fetching `get_detect_extraction_spec`, rendering
one prompt per cell, delegating to one sub-agent per cell safely, the price/shipping and non-Latin
merchant guards, the self-check command, and the three legitimate reasons to skip it.

## P5 — Validate, then write the local report — this is where "local-first" pays off

Everything in this step is designed to succeed even when `MENTION_NETWORK_KEY` is absent — only P6
(actual storage) hard-requires it. Do the local checks first, in this order, because each is
cheaper than the one after it:

1. **The declared grid has no holes and no strays — checked locally, for free.**
   ```bash
   node --input-type=module -e "
   import { readdirSync, readFileSync, statSync } from 'node:fs'
   import { assertRectangularGrid } from '$HERE/scripts/engine-preflight.mjs'
   const state = JSON.parse(readFileSync('$RUN/state.json', 'utf8'))
   const cells = readdirSync('$RUN/cells').filter(f => f.endsWith('.json'))
     .map(f => JSON.parse(readFileSync('$RUN/cells/' + f, 'utf8')))
   console.log(JSON.stringify(assertRectangularGrid(cells, {
     declaredPlatforms: state.declaredPlatforms, declaredIntents: [...new Set(cells.map(c => c.intentSlug))]
   })))"
   ```
   `holes` means a declared platform × intent never got collected — go collect it. `extraPlatforms`
   means a cell exists for an engine that was never declared (a skipped engine that reappeared, or
   a leftover from a resumed run whose declared set changed) — delete that cell file, it must not
   ship. Fix both before spending anything else.
2. **The P4.5 guards** — `check-detections.mjs --cells "$RUN/cells/" --meta "$RUN/meta.json" --fix`
   (ANALYSIS.md).
3. **`validate_byok_submission` against the MCP, best-effort.** Try it, but don't treat a failure to
   reach the MCP here as fatal. This tool **does** accept an unauthenticated call — verified against
   production on 2026-08-20: with no `Authorization` header at all it answers with a schema error
   for the missing `cells` argument, not a `401`, which is only reachable past the auth guard. So a
   validate is available even to someone who has never had a key. Still source the credential store
   first when a `MENTION_NETWORK_KEY` exists, so the validate runs under the same principal the
   submit will use:
   ```bash
   CREDS="${MENTION_NETWORK_CREDENTIALS:-$HOME/.config/mention-network/credentials}"
   set -a; [ -f "$CREDS" ] && . "$CREDS"; set +a
   node "$HERE/scripts/submit.mjs" --cells "$RUN/cells/" --validate-only
   ```
   Runs `validate_byok_submission` over the whole dir and prints each error. **Don't inline the
   cells array into the MCP tool call by hand** — a full grid is tens of KB of answer text (15
   Arabic cells measured at ~66 KB), slow to reproduce and easy to mis-escape. Fix and re-run until
   clean; `RECOVERY.md` maps every error code to its fix, auto-repair up to two rounds before
   involving the user. Keep only cell files in `"$RUN/cells/"` — `submit.mjs` reads every `*.json`
   there as a cell, so `meta.json` and `state.json` live in `$RUN` directly, outside it. If the call
   itself can't be reached at all (no key, and the MCP is down), that is not a stop condition either
   — say so, rely on steps 1–2 above, and let P6 retry validation as part of the real submit once
   the MCP is reachable.

   `submit.mjs` prints a `detection` coverage note every time it runs (validate-only or full
   submit): silent when every cell carries one, a warning when 0 do (P4.5 didn't run — the backend
   will analyze every cell itself) or when it's partial (`DETECTION_PARTIAL`, which the validator
   also rejects). That note is there so a skipped P4.5 shows up in the tool output itself, not only
   in a todo list an agent can forget to write — measured twice before this existed.

   > **A clean validate does not mean the submit will pass.** `validate_byok_submission` reads the
   > **cells only** — it never looks at `meta.json`. The shop/product snapshot is checked by
   > `submit_byok_check`'s own input schema, which rejects with a raw zod error, not a validator
   > code. So **check the meta shape yourself before submitting** (*Snapshots*, below, for the
   > types that bite).
4. **Write the local report — always, regardless of whether step 3 reached the MCP.** This is the
   local artifact design contract 6 requires: a full record of what was measured, with no MCP
   round-trip needed to read it.
   ```bash
   node "$HERE/scripts/local-report.mjs" --cells "$RUN/cells/" --meta "$RUN/meta.json" \
     --state "$RUN/state.json" --out "$RUN/report.md"
   ```
   It reads `declaredPlatforms`/`skippedEngines` straight from `state.json`, states the real
   denominator ("Measured 2 of 4 engines...") in the body — never a footnote — and reports each
   cell's target-shop position as a plain readout of `detection`, never a computed score (that
   number belongs to the backend's own formula, fetched only once P6 actually submits — see
   *ANALYSIS.md → From detection to a local verdict*). **Show this file's path to the user now,
   before P6** — if the run stops here (no `MENTION_NETWORK_KEY`, the user declines to submit, the
   MCP is down), this is still the deliverable, not a half-finished run.

## P6 — Submit (optional, final) and poll

**This is the one step that genuinely needs `MENTION_NETWORK_KEY`** — everything up to and
including the local report (P5) already happened without it. If it's missing, this is the right
moment to have that conversation, not before: offer to add it now (`credentials.mjs save
MENTION_NETWORK_KEY`, RECOVERY.md), or stop here — `"$RUN/report.md"` from P5 is a real, complete
deliverable, and say so plainly rather than implying the run failed. A user who declines is not
losing anything they already had; they're only deferring storage and the hosted PDF.

1. Write `"$RUN/meta.json"` (`{ shop, product, locationCountry, locationCity?, language }` — see
   **Snapshots**) **outside** `"$RUN/cells/"`, then **source the credential store again** — this is
   a new tool call, same reason as P5 — and submit:
   ```bash
   CREDS="${MENTION_NETWORK_CREDENTIALS:-$HOME/.config/mention-network/credentials}"
   set -a; [ -f "$CREDS" ] && . "$CREDS"; set +a
   node "$HERE/scripts/submit.mjs" --cells "$RUN/cells/" --meta "$RUN/meta.json"   # → { checkRunId, deduped }
   ```
   It generates a **fresh `idempotencyKey`** each call; reusing one returns the prior run
   (`deduped: true`) and produces no new report. The cells submitted here are exactly the ones
   `state.json`'s `declaredPlatforms` names — nothing narrower, nothing wider — so the backend's own
   `INCOMPLETE_PLATFORM_GRID` check is validating the same declared set P5 already checked locally.
2. Poll `get_visibility_check_status({checkRunId, shopDomain})` (≤15× / 12s) to **top-level
   `stage: done` / `status: completed`** — read those, *not* the per-engine states: an engine you
   didn't submit stays `queued` forever. Save `checkRunId` to `state.json` as soon as you have it.
3. `get_visibility_report({checkRunId, shopDomain})` → the report + its `reportId`. Re-run
   `local-report.mjs` (P5, step 4) once more with these now in `state.json` — the local file then
   links to the hosted one instead of saying "not submitted yet."

## P7 — Export and show the link immediately

As soon as the report exists, `export_visibility_report_pdf({reportId})` → a hosted PDF **URL**.

> **A 500 here is often transient, and it is not the run failing.** The report already exists — only
> the PDF render broke. Retry, wait, retry again before calling it down (measured 2026-07-28: a
> `reportId` that failed twice exported fine ~15 min later). The response's **`cached`** flag says
> whether you actually exercised generation at all — see `RECOVERY.md` before concluding *anything*
> about why it failed. Meanwhile, say plainly that the report exists and only its PDF is pending:
> there is no local renderer to fall back to.

**Show the user the link now**, with a one-line verdict (score / visible state). Don't make them
wait on anything else.

## Q3 — Website audit? *(asking moment 3 of 3)*

The audit is extra work and extra wait, so it's **optional, never automatic**. Skip this question if
the invocation carried `audit=yes` or `audit=no`.

- **Yes:** `create_website_audit({reportId, shopDomain})` → poll `get_website_audit_status({auditId,
  shopDomain})` (≤15× / 12s) to `completed` → `get_website_audit_report({auditId, shopDomain})` →
  `export_website_audit_pdf({auditId})`, and **show that link too**.
- **No:** stop — the visibility PDF is the finished deliverable.

**This `Yes` always spends the backend's own AI budget** — `create_website_audit` has no BYOK
option in this skill. If the user would rather pay for the audit's grading with their own key too
(the same shape as this report — API-key-only, no subscription or browser lane), point them at the
sibling `visibility-audit` skill instead of answering "yes" here: it shares this skill's credential
store (`~/.config/mention-network/credentials`) and `SETUP-ROUTES.md` keys, and produces the same
hosted PDF via `submit_byok_website_audit`. Worth naming this option whenever the user is
keeping the run BYOK for cost reasons in the first place — a backend-paid audit at Q3 would
otherwise quietly reintroduce the spend they avoided at Q1.

**Return** the PDF link(s), the lane and routes actually used, whether the run was reused or fresh,
and — for BYOK — the `source: byok` disclosure.

**There is no local PDF, but there is a local report.** The hosted export is the only *branded*
renderer this skill has — its template, fonts and logos live on the backend, not in this directory
— but P5 already wrote `"$RUN/report.md"` before P6 ever ran, and that file does not depend on the
PDF export succeeding. A run whose export keeps failing has a finished hosted report (`reportId`)
**and** a finished local one; hand over both rather than implying nothing is ready.

---

## Lane A — backend-run

The backend queries the providers on *its* keys; the user supplies nothing but
`MENTION_NETWORK_KEY`. P3–P5 don't run **because the backend does that collection/detection work
itself, server-side** — a different reason than *Local-first* (design contract 6), which is about
BYOK never needing `MENTION_NETWORK_KEY` for *its own* P3–P5. Lane A is the one path that always
needs `MENTION_NETWORK_KEY`, from the first call: there is no local fallback for a lane whose whole
point is "the backend does it," so if this key is genuinely missing, Lane A itself is the blocked
option — offer BYOK instead, where P1–P5 run regardless.

1. **Reuse or fresh.** P1 already fetched `list_visibility_checks({shopDomain})` — each item has
   `id` (= **checkRunId**) and `reportId`. A `status: completed` item finished within 7 days was
   offered at Q1. Otherwise `create_visibility_check({shop, product, locationCountry, locationCity,
   language})` (upserts shop+product, returns `checkRunId`) and poll to `stage: done`.
2. `get_visibility_report({checkRunId, shopDomain})` → report + `reportId`.
3. Continue at **P7**.

> **Poll can also land on `status: failed`, not just `done`** — the backend guards against a run
> that collected zero working answers (#373: report it as failed, don't retry payload-side) — and
> a `done` run's score still isn't guaranteed complete (partial per-cell collection failures aren't
> exposed by the status API). See RECOVERY.md → *Submit, poll, export* before presenting the score
> as final.

## Snapshots (both lanes)

`shop`: `{ platform:'shopify', externalId, storeUrl, name, primaryDomain?, countryCode?, currency?,
timezone? }`. `product`: `{ externalProductId, title, handle?, vendor?, productType?, price?,
currency?, imageUrl?, description? }` — send `description` when the catalog gives it; the audit can
fetch it live from `/products/<handle>.js` if you skip it, but the stored snapshot is what the
Recent-checks list shows. Prefer values from `get_shop` / `list_shop_products` / the storefront
catalog; if the store was never checked, build them from what the user gives — a stable `externalId` /
`externalProductId` suffices for the upsert.

**`imageUrl` is no longer yours to remember.** `submit.mjs` resolves it itself — meta value first,
then `/products/<handle>.js`, then `/products.json` — and **refuses to submit** when it finds
nothing. Setting it in `meta.json` is still the fastest path (one fewer network hop), but forgetting
it can no longer ship a product with a permanently blank thumbnail: the backend writes
`products.image_url` only at trigger time, and both Recent checks and Website Audit read from there.

> **`product.price` must be a `number`.** The storefront catalog and `list_shop_products` both give
> it as a **string** (`"109.00"`), so copying either straight into `meta.json` fails the submit with
> a raw zod error — `expected number, received string` — that no validator round will catch.
> Coerce it: `price: Number(p.variants[0].price)`. Drop the field entirely rather than passing `""`
> or `null` when there's no price.

**When you don't know the `.myshopify.com` domain** (users usually give the storefront domain like
`kbeautyarabia.com`), use that storefront domain as **both** `storeUrl` and the `shopDomain` you
pass to every later call — the important thing is that the **same** string threads through
`submit` → `get_visibility_check_status` → `get_visibility_report` → the audit calls, which all
scope by it.

## Gate

- [ ] P1 ran **before** any question: MCP probed anonymously (or from cache — *Live data comes from
      the MCP*), credential store loaded, every stored key checked, catalog and recent runs
      fetched. The user was asked only for what genuinely couldn't be resolved.
- [ ] **`MENTION_NETWORK_KEY` missing never stopped P1–P5.** BYOK collection, analysis, validation
      and the local report all completed without it; only P6 (submit/store) asked for it, and only
      once the run had something ready to store.
- [ ] Every key on the confirm card was **verified, not assumed** — `credentials.mjs check` ran, so
      no engine was presented as ready on the strength of a key merely being present in the file.
- [ ] The user was asked **at most three times** (Q1 / Q2 / Q3), each with pre-filled options.
- [ ] The **confirm card was shown** with shop, product, market, language, lane, the masked key
      behind each engine and its check result, every repair line, and cells/time/cost — unless the
      invocation carried `yes`.
- [ ] **Product and language were *asked* unless the invocation supplied them** (`product=`,
      `lang=`+`country=`, or `yes`). An inferred market, a local-language default, and a catalog
      pick only ever pre-selected an option — none of them stood in for the user's answer.
- [ ] **City was shown on the confirm card either way** — supplied via `city=`, typed as the
      narrowing answer inside the Market + language question, or left at its `(Recommended)`
      country-level default. It never needed its own question, and it was never guessed from the
      domain or shop address.
- [ ] **Every engine with a missing or rejected key was surfaced at Q1 with the two real choices** —
      supply it now, or skip it for this run — never silently skipped and never silently failed.
- [ ] **Clean room held:** every cell came from an API request, so none carried an account's memory
      or custom instructions. If the user overrode this after being told why, the personalization
      was disclosed in the handover.
- [ ] **The declared grid has no holes and no strays** (design contract 5) —
      `assertRectangularGrid` came back clean before P6: every declared platform × declared intent
      has a cell, and no cell exists for an engine the user chose to skip. A skipped engine is named
      by `state.json`'s `skippedEngines`, with its reason, and never appears in the grid at all.
- [ ] Prompts were shown and confirmed (Q2); any edits kept one-prompt-per-intent + `where_to_buy`.
- [ ] No secret was invented, echoed, repeated back, or written inside this skill directory; any
      new one was saved through `credentials.mjs`, with its value taken from the environment.
- [ ] **The local report (`"$RUN/report.md"`) was written at P5**, before P6 ran — its coverage
      line states the real "measured N of 4" denominator in the body, never a footnote, and it
      names every skipped engine with its reason. It was shown to the user even if P6 never ran.
- [ ] BYOK only: `validate_byok_submission` returned **no errors** before submit; a **fresh**
      `idempotencyKey` was used; `webSearchUsed` reflects a search that actually **returned**, not
      one that was merely requested.
- [ ] **P4.5 ran** — it is the default. Every cell carries a `detection`, the spec came from
      `get_detect_extraction_spec` (never invented), and `source: byok_client_analysis` was
      disclosed: the submitter supplied the interpretation, not just the data.
      **If it did not run, the handover names which of the three allowed reasons applied** — the
      user declined, the guards couldn't be met honestly, or two `DETECTION_*` repair rounds
      failed. Silence is not one of them, and neither is "it was quicker".
- [ ] **The analysis was extracted to one standard.** If it was fanned out: every analyzer was
      briefed with its own `analysis/<cell>.prompt.md` rendered from the live spec (not a
      paraphrase), wrote `detection` into its own cell file, and the whole set was reconciled with
      `check-detections.mjs --cells cells/ --meta meta.json --fix`. No cell was re-extracted by
      hand on the strength of a disagreement that carried no code — the one exception is
      `position`, which `--fix` corrects mechanically (ADR-0040), not by re-dispatching.
- [ ] A visibility report reached `stage: done` (never present a partial or failed run as done).
- [ ] The **PDF link** (or local path) was returned; for BYOK, `source: byok` was disclosed.

## Where this came from

Ported on 2026-08-14 from the Mention Network agent pack, which lives in a **private** repo —
deliberately not named here, along with its paths and commit: this repository is public, and a
public repo naming a private one's internals discloses them to everyone who can install the skill.
The coordinates are recorded in the pull request that added it.

Three differences from the pack are deliberate:

- **Key-only.** The subscription lanes (Claude Agent SDK, `claude -p`, `codex exec`) and the
  signed-out Playwright lane were dropped, and an `anthropic` provider was added to
  `collect-api.mjs` in their place — which is what makes the four-engine grid completable on keys
  alone, since `claude` previously had no keyed route at all.
- **No local renderer.** The bundled Chrome/Mustache PDF renderer was dropped; the backend's hosted
  export is the only one.
- **Hardened credential store.** `credentials.mjs` here is the sibling skill's version: it gains
  `check`, `remove` and `export`, creates the store at 0600 rather than chmodding it afterwards,
  and refuses to write through a symlink.
- **Local-first, and a missing key is a conversation.** The pack's original design treated a full
  4-engine grid as the only legitimate BYOK run and a missing `MENTION_NETWORK_KEY` as a hard stop
  before Q1. This copy diverges on both, following this repo's own owner decision: skipping an
  engine is now a declared, first-class outcome (`scripts/engine-preflight.mjs`), and BYOK's P1–P5
  never need `MENTION_NETWORK_KEY` at all — only P6 (storage) does, and P5 always writes a local
  report (`scripts/local-report.mjs`) so a run that never reaches P6 still has a real deliverable.

Anything else that differs from the pack is a bug in this copy. When re-porting, take the detection
spec handling and the prompt text verbatim — the wording is the calibration, and the backend
validates against the same live catalog either way.
