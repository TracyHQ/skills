# Shorthand arguments — grammar, aliases, and repair

One line, any order, everything optional except the domain. Parsing **never fails the run**: an
unrecognized token becomes a note on the confirm card, not an error.

```
/create-visibility-report kbeautyarabia.com country=SA lang=ar product="Water Bank"
/create-visibility-report gymshark.com byok intents=where_to_buy,cheapest yes
/create-visibility-report acme.com backend audit=yes
/create-visibility-report resume
```

## There are no route tokens any more

Earlier versions let you pin a collection route per engine — `llm=cli`, `chatgpt=agent-sdk`,
`ai-mode=playwright`, `route(engine, …)`. Those decisions no longer exist: **each engine has exactly
one route, and it is an API key.**

| Engine | Route | Key |
|---|---|---|
| `chatgpt` | Responses API + `web_search` | `OPENAI_API_KEY` |
| `claude` | Messages API + server-side `web_search` | `ANTHROPIC_API_KEY` |
| `gemini` | `generateContent` + `google_search` | `GEMINI_API_KEY` |
| `google_ai_mode` | SerpApi — no model API exists | `SERPAPI_API_KEY` |

So the only question left about an engine is whether its key is present and working, which
`credentials.mjs check` answers in P1 without asking the user anything.

**Old route tokens still parse.** They are repaired, with a line on the confirm card, rather than
rejected — someone with a saved invocation should get a run, not a syntax error:

| Token in the invocation | Repaired to | Say on the card |
|---|---|---|
| `llm=cli`, `llm=agent-sdk`, `chatgpt=codex`, `claude=agent-sdk`, `agent(…)`, `cli(…)` | the API key for those engines | "no subscription lane any more — using your API keys" |
| `ai-mode=playwright`, `google_ai_mode=browser`, `pw`, `playwright(…)` | `serpapi` | "no browser lane any more — Google AI Mode goes through SerpApi" |
| `claude=api` | `anthropic` (which now exists) | "claude has an API route now — using ANTHROPIC_API_KEY" |
| `claude-in-chrome`, `chrome`, `cic`, `ui` | the engine's key route | "logged-in chat memory contaminates the answer" |
| `auto` | nothing to resolve — it is already unambiguous | (no line needed) |
| `partial-ok` | ignored | "the backend rejects a partial grid — an engine without a key is fixed, or the run goes backend-run" |

## Tokens

| Token | Accepted forms | Notes |
|---|---|---|
| **domain** | `kbeautyarabia.com`, `store.myshopify.com`, `https://kbeautyarabia.com/` | Any position. Strip scheme, path, trailing slash, `www.`. This one string threads through every later call — see *Snapshots* in SKILL.md. |
| **lane** | `byok` (default) · `backend` \| `server` \| `lane-a` | `backend` skips P3–P5 entirely. |
| **key=value** | `country=` `lang=` `city=` `product=` `intents=` `audit=` `model=` `skip=` | See *Key-value* below. |
| **flags** | `yes` · `resume` · `dry-run` | Bare words, no value. |

Engine names are still recognized where one is needed (`model=`): `chatgpt` \| `gpt` \| `openai` ·
`claude` \| `anthropic` · `gemini` · `google-ai-mode` \| `google_ai_mode` \| `ai-mode` \| `aimode`.

### Key-value

| Key | Value | **When absent** |
|---|---|---|
| `country=` | ISO-2, e.g. `SA` | **Asked at Q1**, together with `lang=`. A domain-based guess (`…arabia.com` → SA) only orders the options — it never stands in for the answer. |
| `lang=` | ISO code, e.g. `ar` | **Asked at Q1** — never assumed. The market's local language leads the options (a non-English market measured in English ranks differently), then English. `get_shop.primaryLocale` only hints at the ordering, and is often `null`. |
| `city=` | free text, e.g. `Riyadh` | **Never asked as its own question.** Omitted → defaults to country-level (no city) on the confirm card. In a guided run it can still be set without shorthand — it rides inside the Market + language question at Q1 as a free-text narrowing answer. |
| `product=` | quoted title, or an `externalProductId` | **Asked at Q1** — 3–4 real titles from the catalog as options. Never invented, and never silently taken from position 1 (`/products.json` is collection-sorted, not sales-sorted). |
| `intents=` | comma list of intent slugs | Whatever `describe_check_grid`'s `intents` field returns as the default set. **Every declared intent must then be collected on every declared platform** — the backend rejects a hole (`INCOMPLETE_INTENT_GRID`), so this narrows the *question set*, never which platforms get asked. `where_to_buy` is always kept. |
| `audit=` | `yes` \| `no` | Ask at Q3. `audit=yes` runs it without asking; `audit=no` skips Q3. |
| `model=` | `<engine>:<id>`, comma-separated — `model=gemini:gemini-2.5-pro` | The live grid's `apiModelId` for each engine. See below — this is a narrower tool than it used to be. |
| `skip=` | comma list of engine names, e.g. `skip=chatgpt,google_ai_mode` | Pre-declares the Q1 skip decision for those engines, the same way `product=` pre-answers the product question — Q1 shows them as ⚠ skipped rather than asking. Skipping is always the user's call (`engine-preflight.mjs`'s `resolveDeclaredPlatforms` honors `decisions[engine]='skip'` even on an engine whose key is `ok`), but naming a **working** engine here is unusual, so say so loudly on the confirm card rather than folding it in silently. `skip=` never narrows an *intent* — it removes the whole engine from `declaredPlatforms`, so no cell is ever built or collected for it (design contract 5). |

**`model=` is now a last resort, not a routine override.** Every cell is an `api` cell, and on the
API route the grid dictates `servedModel` (`describe_check_grid`), so overriding the model raises
`SERVED_MODEL_MISMATCH` at submit. That is a *warning* since ADR-0036 and the submit still succeeds
— but the report then shows the model you forced, not the one the grid expected, and that is a real
difference in what the report claims to have measured.

Reach for it when a provider's grid model is genuinely unavailable (capacity exhaustion, a model
retired mid-migration) and the alternative is no cell at all. Pass it through as `--model <id>` for
that engine's cells only; engines you didn't name keep the grid value. An unknown engine name is a
note on the card, never an error.

### Flags

| Flag | Effect |
|---|---|
| `yes` | Skip the Q1 confirm card and start collecting. Still print the resolved plan and every repair line first, so the record exists. |
| `resume` | Reuse the newest run directory for this domain instead of starting one (see RECOVERY.md). |
| `dry-run` | Stop after the confirm card. Nothing is collected, nothing is submitted, no quota spent. |
| ~~`partial-ok`~~ | **Still not a token — use `skip=<engine,...>` instead.** `partial-ok` never said *which* engines to drop, so honoring it meant guessing; `skip=` says exactly which, so the declared/undeclared split stays explicit. If `partial-ok` appears in an invocation, ignore it and say why: name the gap and offer `skip=` for it, or add the key. This is a real fix now, not a dead end — before `skip=`/Q1's skip option existed, the only recovery was "add the key or move to backend," which is why this flag used to be flatly refused. |

---

## Repair — how a plan gets resolved

Repair is for things that cannot be done as asked. State each one; never fail the run over it, and
never silently do something different.

| Situation | Repair | Say on the card |
|---|---|---|
| An old route token (see the table above) | the engine's key route | one line naming the retired lane |
| An engine whose key is **missing**, not named in `skip=` | surfaced at Q1 as a gap — supply or skip, never assumed | "gemini: no GEMINI_API_KEY. Supply it now (free key, ~1 min) or skip gemini for this run" |
| An engine whose key is **REJECTED** by `check`, not named in `skip=` | surfaced at Q1 the same way, worded as rejected not absent | "chatgpt: your OpenAI key came back 401 — replace it, or skip chatgpt for this run" |
| An engine whose key is **unreachable** | retry before saying anything about the key — not yet a gap | "couldn't reach Google to check that key — retrying" |
| An engine named in `skip=` | declared skip, no question asked about it | "google_ai_mode: skipped per `skip=google_ai_mode`" |
| No `MENTION_NETWORK_KEY` | **not a repair at P1 anymore** — continue; it only matters at P6 (SKILL.md *Local-first*) | (nothing said until P6, where it becomes: "I can't store the report yet — add the key, or keep the local report as-is") |
| `intents=` naming a slug the grid doesn't have | drop the unknown slug, keep the rest | "no such intent `<slug>` — using the rest" |
| `intents=` without `where_to_buy` | add it back | "`where_to_buy` is always included" |
| `model=` for an engine that isn't running | ignore it | "`model=` for an engine not in this run" |
| `skip=` naming an engine that isn't one of the four | drop the unknown name, keep the rest | "no such engine `<name>` in `skip=` — using the rest" |

One repair line per changed value, on the confirm card. A repair is never silent.

**No repair ever silently shrinks the grid — but a declared decision can, on purpose.** There is no
combination of arguments that silently produces a smaller run: an engine without a working key
always surfaces as a gap, asked or pre-answered by `skip=`, never assumed. What changed is that
"smaller, on purpose" is now a real, named outcome (`skip=`, or the Q1 skip answer) rather than a
dead end — the backend still rejects a hole in whatever IS declared (SKILL.md design contract 5),
so the one thing no repair or argument can ever produce is a platform that's declared but
incomplete.

## Worked examples

### Everything supplied

```
/create-visibility-report kbeautyarabia.com byok country=SA lang=ar product="Water Bank Aqua Facial" yes
```

Nothing is asked. The plan block prints, `credentials.mjs check` still runs (a stored key can still
be dead), and any key gap becomes a setup step before collection starts — `yes` skips the *question*,
it does not skip the *check*.

### An old invocation someone had saved

```
/create-visibility-report acme.com byok llm=cli ai-mode=playwright
```

Both route tokens are retired. The run proceeds on keys, with two repair lines: *"no subscription
lane any more — using your API keys"* and *"no browser lane any more — Google AI Mode goes through
SerpApi"*. If a key behind any engine is missing, that is the Q1 gap — supply it or skip it.

### Declaring fewer engines up front

```
/create-visibility-report kbeautyarabia.com byok skip=chatgpt,google_ai_mode yes
```

Neither engine's key is even checked for readiness before being asked about — `skip=` already
answered that. `declaredPlatforms` is `["claude", "gemini"]` from the start; `grid.json` never
carries a `chatgpt`/`google_ai_mode` entry; the local report's coverage line reads "Measured 2 of 4
engines: claude, gemini." throughout. `yes` still prints the plan (with both skips marked) before
collecting.

### Minimal

```
/create-visibility-report kbeautyarabia.com
```

Domain only. Q1 asks product, market + language, and — if any key is missing — how to cover it.

### Backend-run, no keys at all

```
/create-visibility-report acme.com backend
```

The backend queries all four engines on its own keys. P3–P5 don't run and no provider key is needed;
`MENTION_NETWORK_KEY` still is.

### Plan only, spend nothing

```
/create-visibility-report acme.com dry-run
```

Stops at the confirm card with a real coverage/cost estimate, including which keys are missing.

### Continue an interrupted run

```
/create-visibility-report resume
```

See RECOVERY.md — the newest run directory is reused and only the missing cells are collected.

## What is never inferred

- **The product.** Offered from the catalog, never picked silently from position 1.
- **The market or language.** Guessed only to *order* the options.
- **A key.** Never read from anywhere but the credential store and the environment, never invented,
  never assumed to work because it is present.
- **Coverage.** An engine is only ready when `check` said so this run.
- **A skip decision.** A gap key never becomes "skipped" on its own — only `skip=` in the
  invocation or an explicit Q1 answer moves an engine out of `declaredPlatforms`. A `missing` or
  `rejected` state with no decision attached is `blocked` (`engine-preflight.mjs`), not skipped.
