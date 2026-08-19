---
name: create-visibility-report
description: 'Use to create an AI Visibility Report for a Shopify store, end to end, on the user''s own API keys. Probes everything first — the Mention Network MCP, stored keys, which of the four engines are reachable, the storefront catalog, any recent run — then asks the user at most three times, each a click on pre-filled options: one confirm card (shop, product, market, language, city (optional, defaults to country-level), the key behind each AI engine, cells/time/cost), one prompt approval, one optional website audit. Every engine is collected with an API key and nothing else: chatgpt on OPENAI_API_KEY, claude on ANTHROPIC_API_KEY, gemini on GEMINI_API_KEY, and google_ai_mode — which has no model API — on SERPAPI_API_KEY. There is no subscription lane and no browser lane, so a missing key is a setup step the skill walks through and stores, and a key can be checked, replaced or removed at any time. Accepts a one-line shorthand (`/create-visibility-report kbeautyarabia.com byok country=SA`) with tokens in any order and misspellings corrected silently. A logged-in consumer chat UI is never used: its memory and custom instructions personalize the answer and the report would no longer measure what a neutral shopper sees. Collects, analyzes the answers client-side by default (the backend then spends nothing and the report is ready on the first poll), validates, submits, exports the PDF, and hands back the link.'
version: 1.0.0
platforms: shopify
requires-mcp: [mention-network]
provenOn: —
---

# Create Visibility Report

Produce an AI Visibility Report for a Shopify store. Two lanes: **BYOK** (default — the user's own
API keys collect the answers) and **backend-run** (the backend spends its own AI budget).

**Design contract for this skill — hold to it:**

1. **Probe before you ask.** P1 runs unattended and fills every later option with a real value.
2. **Three asking moments, no more:** Q1 confirm → Q2 prompts → Q3 audit. Each is one
   `AskUserQuestion` with concrete pre-filled options; typing is the fallback, not the path.
3. **The confirm card always shows** — even when the shorthand supplied everything. Only the `yes`
   flag skips it.
4. **A gap is a setup task, not a verdict.** Never end a turn with "only 1 of 4 engines is possible"
   as if that settled it.
5. **The grid is all 4 engines × every declared intent — there is no partial BYOK run.** The backend
   rejects a short submission (`INCOMPLETE_PLATFORM_GRID` / `INCOMPLETE_INTENT_GRID`), so "drop the
   engine we can't reach" is not a lighter option, it is a run that spends the full quota and then
   fails. A missing key is added (P1 walks the user through it) or the run moves to the backend lane.
6. **Secrets are handled, never echoed.** Every key goes through `scripts/credentials.mjs`, which
   reads values from the environment and never from argv. Do not print a key, do not repeat one
   back, and do not write one into a file inside this skill directory.

```
P0 parse → P1 preflight → P2 resolve → [Q1 confirm] → P3 prompts → [Q2 approve]
        → P4 collect → P4.5 analyze → P5 validate → P6 submit+poll → P7 export → [Q3 audit]
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

## Live data comes from the MCP, never from memory

The intent slugs, the platform list, the prompt templates, and the exact `servedModel` /
`apiModelId` each platform requires are **live catalog** from the backend's own tables — they have
already changed by migration more than once (`gpt-4o`→`gpt-5.5`, `gemini-2.5-pro`→`gemini-3.5-flash`,
and 2026-07-29 `gemini-3.5-flash`→`gemini-3.6-flash`, with `3.5-flash` kept as the managed lane's
in-platform fallback — see the fallback ADR). Never hardcode, recall, or invent them — that history is
exactly why. Fetch every run: `get_byok_skill`, `describe_check_grid` (its response already carries
the full `intents` list — no separate `list_intents` call needed), `get_prompt_templates`,
`get_product_name_rules`, `get_template_localization_rules`, and — for the client-side analysis at
P4.5, which runs **by default** — `get_detect_extraction_spec`.
The validator that rejects your payload reads the same catalog — the MCP is the only source that
can't drift.

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
  persists the connection is `claude mcp add` / the host config / the shell profile.
- **Never print a secret.** `status` masks to the last 4; consume values only by sourcing the file.

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

> **One stop condition fires inside P1, before any question:** `MENTION_NETWORK_KEY` missing **and**
> no host MCP tool answering ends the run right here with a request for the key — see *No key stored
> at all* below. It **outranks `dry-run`**, which stops at the confirm card; when both apply, the
> key blocker wins because there is no plan to confirm. The batch below is only half of P1 — the
> bulleted probes after it carry the rules that decide whether the run can proceed at all.

```bash
HERE="$(dirname "$(readlink -f "<abs path to this SKILL.md>")")"   # this skill's folder
CREDS="${MENTION_NETWORK_CREDENTIALS:-$HOME/.config/mention-network/credentials}"
set -a; [ -f "$CREDS" ] && . "$CREDS"; set +a        # stored secrets into this shell, unechoed
node "$HERE/scripts/credentials.mjs" status          # masked: stored | env only | missing
node "$HERE/scripts/credentials.mjs" check           # does each stored key still work?
curl -s -o /dev/null -w '%{http_code}' "https://<shopDomain>/products.json?limit=250"
```

Alongside it, in the same batch:

- **MCP alive?** One cheap call (`get_shop({shopDomain})`).
  **No `mention-network` tools in the session is *not* a blocker.** `scripts/mcp-client.mjs` speaks
  the same MCP over plain HTTP using `MENTION_NETWORK_KEY`, so a stored key is enough to run the
  whole skill (measured 2026-07: a full 20-cell run completed in a session where the host had no
  `mention-network` tools at all). Try that path before asking the user for anything:
  ```bash
  node --input-type=module -e "
  const { callTool } = await import('$HERE/scripts/mcp-client.mjs')
  console.log(JSON.stringify(await callTool('get_shop',{shopDomain:'<domain>'})))"
  ```
  Use `callTool` for every MCP call in that case — the tool names and arguments are identical.
  Only when **both** the host tools are absent **and** that HTTP call fails is the MCP genuinely not
  set up. Then, and only then:
  ```bash
  export MENTION_NETWORK_KEY=<their-key>       # from mention.network — never invent one
  claude mcp add mention-network --transport http \
    https://shopify-mcp-dev.mention.network/api/v1/mcp \
    --header "Authorization: Bearer ${MENTION_NETWORK_KEY}"
  ```
  (Running this bundle *as* a plugin? The shipped `.mcp.json` already declares it — they only need
  `export MENTION_NETWORK_KEY=...` and a reload.) A **401** is a wrong key, not a missing one — see
  `RECOVERY.md`.

  > **No key stored at all is the first-run blocker — handle it before Q1, not after.** This is the
  > most common way a brand-new user lands here, and there is no way to work around it: the MCP is
  > where the prompt templates, the intent list, the grid and the validator live, so **every lane
  > needs it**. Without it you cannot render a prompt (P3), cannot validate (P5), cannot submit
  > (P6), and cannot state a real cell count on the confirm card.
  >
  > So when `credentials.mjs status` says `MENTION_NETWORK_KEY: missing` **and** no host tool
  > answers, **stop before the confirm card** and say plainly: the run needs a key, here is where to
  > get one (log in at mention.network), and here is how to store it —
  > ```bash
  > MENTION_NETWORK_KEY='<pasted>' node "$HERE/scripts/credentials.mjs" save MENTION_NETWORK_KEY
  > ```
  > Then re-probe and continue the run. **Do not build a speculative confirm card with UNKNOWN in
  > the coverage line** to look like progress — an estimate you can't compute is not a plan, and the
  > user would be approving a run that cannot start. Asking for the key *is* the useful next step.
- **A key per engine** — `ANTHROPIC_API_KEY` covers `claude`, `OPENAI_API_KEY` covers `chatgpt`,
  `GEMINI_API_KEY` covers `gemini`, `SERPAPI_API_KEY` covers `google_ai_mode`. That mapping is the
  whole routing problem: there is one route per engine, so P1 is not choosing between routes, it is
  establishing which of the four keys exist and still work.

  **A key in the store is not proof it works**, so `credentials.mjs check` is part of the batch
  above rather than an optional extra. It is one list call per provider and it costs nothing;
  discovering a revoked key at cell 9 of 20 has already spent cells 1-8 and still fails the grid,
  because a short submission is rejected outright (design contract 5).

  Read its output as three distinct states, because the fix differs: `missing` (no key — offer to
  add one), `REJECTED` (a key that is wrong, revoked or out of quota — offer to replace it, and say
  which provider refused it), `unreachable` (a network problem, not a verdict on the key — retry
  before telling the user anything about their key).
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
  which engines are *ready*: a key that is stored and passed `check`. An engine whose key is
  missing or rejected is a **setup task carried onto the confirm card**, never a reason to drop the
  engine — a 3-of-4 grid is rejected by the backend after spending the full quota (design
  contract 5). Record one repair line per engine whose key is not ready.
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
rides along inside it as a ⚠ row on the affected engine (*"gemini: no GEMINI_API_KEY → free key,
~1 min"*) — the user accepts the setup step in the same click.

It becomes a **separate question only when there is nothing else to attach it to**. In that case
**don't drop one of the four to fit it** — ask the four, then handle the gap in the next turn:
saving a key needs a round trip anyway (the user runs the `read -rs` line, you re-check), so it was
never going to fit in the same breath.

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
> - **Language changes the answer, not the wording.** The MCP says so itself and `get_byok_skill` §1
>   backs it with a measurement: the same question in English and in the local language produces
>   **materially different rankings**. Choosing it silently picks which market's reality gets
>   reported.
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

> ## Never offer to drop an engine.
>
> **There is no "skip it" / "drop that engine" / "run without it" option.** Not because it is impure
> — because it **cannot work**: the backend requires the full platform × intent grid and rejects a
> short submission with `INCOMPLETE_PLATFORM_GRID` / `INCOMPLETE_INTENT_GRID` (`get_byok_skill` §0:
> *"If you cannot reach one engine, fix the access rather than dropping the engine."*). Offering a
> partial BYOK run spends the user's whole quota and then fails at submit. Measured 2026-07-28: a
> real run was offered exactly that option before this rule existed.
>
> The only legitimate answers to "this engine has no working key" are **add the key** or **switch
> the whole run to the backend lane** — never a smaller grid.

Build the card from what `credentials.mjs check` actually reported (P1), and label every engine with
its key state. A real question from a machine with two keys missing:

```
Two engines have no key yet — how do you want to cover them?
  ▸ Add both keys now (Recommended)   I print one command per key; the value never enters this chat
                                      gemini:         free AI Studio key      (~1 min, no cost)
                                      google_ai_mode: free SerpApi key        (~1 min, ~100/month)
  ▸ Add the free ones, skip the run   save the keys now, collect later
  ▸ Backend-run instead               the backend queries all four on its own keys — no longer BYOK
```

Note what the ⚠ rows do **not** say: they don't demote the engine and they don't propose leaving it
out. They state the gap and the one command that closes it. After the user picks, walk
`SETUP-ROUTES.md` for exactly those engines, re-run `credentials.mjs check`, and confirm coverage
before collecting.

Never fold `google_ai_mode` into a question about the model engines: it is a different provider with
a different key, and a missing cell fails the submit with `MISSING_CELL`.

**Every route is a clean room, and that is not negotiable.** There is no "collect it in my browser"
option — don't invent one, and if the user asks for it, explain the memory contamination and offer
the key setup instead. If the user insists after hearing that, it is their call: say plainly in the
plan block and in the handover that those cells came from a personalized account, so the report
measures that account rather than the market.

**Access gap** — if an engine has no working key yet, the question is **how to get one**, never
whether to live without it. There are exactly two answers, because a short grid is rejected:

1. **Add the key now (Recommended)** — walk `SETUP-ROUTES.md` for exactly the engines that need it,
   with the concrete command and its real cost (*"a free AI Studio key covers gemini and a free
   SerpApi key covers Google AI Mode — about two minutes, no cost"*). Then re-check and re-state
   coverage before spending anything.
2. **Backend-run instead** — the backend queries all four on its own keys. The right call when the
   user does not want to create keys; it costs the backend's AI budget and the run is no longer BYOK.

**Do not add a third option.** "Run it with 3 engines", "skip gemini for now", "we can add chatgpt
later" — all of these end in `INCOMPLETE_PLATFORM_GRID` after the quota is spent. If the user asks
for one anyway, say plainly that the backend rejects partial grids, and offer these same two.

Getting a key is the user's to do — hand them the `read -rs` one-liner rather than asking them to
paste the secret to you, and **wait for them to say it's done before re-checking**. Do the parts
that don't need a human yourself.

*`dry-run` stops here. `yes` skips this card but still prints the plan and every repair line.*

**Lane = backend → jump to Lane A.** Lane = byok → continue.

## P3 — Build the prompts

Fetch the live catalog: `get_byok_skill` (the authoritative playbook — follow it), then
`describe_check_grid` (its `intents` field IS the `list_intents` data — don't call it twice),
`get_prompt_templates({language})`, `get_product_name_rules`, `get_template_localization_rules`.

- **Decide the grid** — platforms × intents. `where_to_buy` is **mandatory**; every declared cell
  must be collected.
- **Render the actual prompt per intent** — apply the template with the normalized product name, in
  the prompt's language (localization rules).

## Q2 — Approve the prompts *(asking moment 2 of 3)*

Render a table (intent → the exact prompt) plus the normalized product name and market/language,
then ask: **Approve and run (Recommended)** / **Edit a prompt**. Don't force wording work on a user
who's happy with it.

If they edit, preserve two invariants or the submit is rejected:
- **one prompt per intent, identical across platforms** (`INCONSISTENT_PROMPT_TEXT`);
- `where_to_buy` stays in the set (`MISSING_WHERE_TO_BUY`).

Write the approved table to `prompts.md` in the run directory — it's the record of what was asked.

## P4 — Collect

Create the run directory (`RECOVERY.md`) and collect **every declared cell** with the approved
prompt. Source the credential store first so the collectors see the stored keys:

```bash
HERE="$(dirname "$(readlink -f "<abs path to this SKILL.md>")")"
CREDS="${MENTION_NETWORK_CREDENTIALS:-$HOME/.config/mention-network/credentials}"
set -a; [ -f "$CREDS" ] && . "$CREDS"; set +a
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
process writing its own `cells/<intent>.<platform>.json`, so cells share no state. Group by route
and run each group as a pool:

- **All four engines** — safe to run concurrently; cap ~4–6 in flight **per provider key**, which
  is what `collect-pool.mjs` does by default. Pooling per provider rather than globally matters:
  one provider's rate limit then stalls only its own cells instead of the whole grid.
- On `429`/quota (and Gemini's frequent `503`), back off and retry that one cell — a single failure
  shouldn't sink the batch. The collectors already retry once on those statuses.
- Anthropic cells can take a little longer than the others when the model runs several searches, and
  a long one may return `stop_reason: 'pause_turn'`; `collect-api.mjs` continues the turn itself and
  merges the halves, so this costs wall-clock rather than a failed cell.

**Use `scripts/collect-pool.mjs`.** It pools the whole grid from a grid file (one job per cell:
`{route, provider|hl/gl, model, intent, platform, prompt, out}`), capped at 4 per provider by
default and overridable with `--concurrency`, with one outer retry per cell. Every route now has a
collector script, so the pool covers the entire grid — there is nothing left to run by hand
alongside it. Measured 2026-07-28: a hand-rolled fan-out drifted serial and collection alone took
5m41s of an 8m54s run, which is what this script exists to prevent.

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
hand-wrapping. Without `--intent` you get the bare `response` and must wrap it yourself.

| Engine | Command |
|---|---|
| `claude` | `printf '%s' "<prompt>" \| node "$HERE/scripts/collect-api.mjs" --provider anthropic --model "<apiModelId>" --intent where_to_buy --out cells/where_to_buy.claude.json` |
| `chatgpt` | `printf '%s' "<prompt>" \| node "$HERE/scripts/collect-api.mjs" --provider openai --model "<apiModelId>" --intent where_to_buy --out cells/where_to_buy.chatgpt.json` |
| `gemini` | `printf '%s' "<prompt>" \| node "$HERE/scripts/collect-api.mjs" --provider gemini --model "<apiModelId>" --intent where_to_buy --out cells/where_to_buy.gemini.json` |
| `google_ai_mode` | `printf '%s' "<prompt>" \| node "$HERE/scripts/collect-serpapi.mjs" --hl <lang> --gl <country> --intent where_to_buy --out cells/where_to_buy.google_ai_mode.json` |

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
  `UNEXPECTED_SERVED_MODEL` — `get_byok_skill`'s own `google_ai_mode` section says the same thing:
  the validator wins over any table value.

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

## P5 — Validate

```bash
node "$HERE/scripts/submit.mjs" --cells cells/ --validate-only
```

Runs `validate_byok_submission` over the whole dir and prints each error. **Don't inline the cells
array into the MCP tool call by hand** — a full grid is tens of KB of answer text (15 Arabic cells
measured at ~66 KB), slow to reproduce and easy to mis-escape.

Fix and re-run until clean. `RECOVERY.md` maps every error code to its fix; auto-repair up to two
rounds before involving the user. Keep only cell files in `cells/` — `submit.mjs` reads every
`*.json` there as a cell, so `meta.json` and `state.json` live outside it.

`submit.mjs` prints a `detection` coverage note every time it runs (validate-only or full submit):
silent when every cell carries one, a warning when 0 do (P4.5 didn't run — the backend will
analyze every cell itself) or when it's partial (`DETECTION_PARTIAL`, which the validator also
rejects). That note is there so a skipped P4.5 shows up in the tool output itself, not only in a
todo list an agent can forget to write — measured twice before this existed.

> **A clean validate does not mean the submit will pass.** `validate_byok_submission` reads the
> **cells only** — it never looks at `meta.json`. The shop/product snapshot is checked by
> `submit_byok_check`'s own input schema, which rejects with a raw zod error, not a validator code.
> So **check the meta shape yourself before submitting** (see *Snapshots* for the types that bite).

## P6 — Submit and poll

1. Write `meta.json` (`{ shop, product, locationCountry, locationCity?, language }` — see
   **Snapshots**) **outside** `cells/`, then:
   ```bash
   node "$HERE/scripts/submit.mjs" --cells cells/ --meta meta.json     # → { checkRunId, deduped }
   ```
   It generates a **fresh `idempotencyKey`** each call; reusing one returns the prior run
   (`deduped: true`) and produces no new report.
2. Poll `get_visibility_check_status({checkRunId, shopDomain})` (≤15× / 12s) to **top-level
   `stage: done` / `status: completed`** — read those, *not* the per-engine states: an engine you
   didn't submit stays `queued` forever. Save `checkRunId` to `state.json` as soon as you have it.
3. `get_visibility_report({checkRunId, shopDomain})` → the report + its `reportId`.

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

**Return** the PDF link(s), the lane and routes actually used, whether the run was reused or fresh,
and — for BYOK — the `source: byok` disclosure.

**There is no local PDF.** The hosted export is the only renderer this skill has — the branded
template, its fonts and its logos live on the backend, not in this directory. A run whose export
keeps failing has a finished report and a `reportId`; hand those over rather than implying a
document is on its way.

---

## Lane A — backend-run

The backend queries the providers on *its* keys; the user supplies nothing but
`MENTION_NETWORK_KEY`. P3–P5 don't run.

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

- [ ] P1 ran **before** any question: MCP answered, credential store loaded, every stored key
      checked, catalog and recent runs fetched. The user was asked only for what genuinely
      couldn't be resolved.
- [ ] **No `MENTION_NETWORK_KEY` at all → the run stopped at the key request**, not at a confirm card
      with an uncomputable estimate on it.
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
- [ ] **Every engine with a missing or rejected key was surfaced at Q1 as a setup step**, with the
      command that closes it — never as a demotion, and never as a reason to leave the engine out.
- [ ] **Clean room held:** every cell came from an API request, so none carried an account's memory
      or custom instructions. If the user overrode this after being told why, the personalization
      was disclosed in the handover.
- [ ] **No engine dropped, no grid shrunk** (design contract 5) — the submitted grid was the full 4 × N.
- [ ] Prompts were shown and confirmed (Q2); any edits kept one-prompt-per-intent + `where_to_buy`.
- [ ] No secret was invented, echoed, repeated back, or written inside this skill directory; any
      new one was saved through `credentials.mjs`, with its value taken from the environment.
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

Anything else that differs from the pack is a bug in this copy. When re-porting, take the detection
spec handling and the prompt text verbatim — the wording is the calibration, and the backend
validates against the same live catalog either way.
