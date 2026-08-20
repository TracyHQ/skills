# Recovery — the run directory, `resume`, and every error → its fix

Read this when something fails, or when the invocation carries `resume`. The rule that governs the
whole file:

> **Auto-fix up to two rounds, then ask.** A retryable failure is yours to handle silently. A
> failure that survives two honest attempts becomes one `AskUserQuestion` with concrete options —
> never a wall of stack trace, never a silent drop, never a fabricated value.

---

## The run directory

Every BYOK run gets a directory so an interrupted session loses nothing. Create it at the start of
P3 (SKILL.md) — before Q2 needs it for `prompts.md` — in the user's working directory, with
`scripts/run-dir.mjs`, and keep the result in `$RUN` for every path from here on:

```bash
RUN="$(node "$HERE/scripts/run-dir.mjs" --domain "<shopDomain>")"     # fresh run
echo "$RUN"     # confirm it's a real path before writing anything into "$RUN/…"
```

**An unset `$RUN` does not stop anything — it silently writes into `/` and fails with a confusing
error much later**, the same trap the sibling `visibility-audit` skill documents for its own `$RUN`.
Get the directory from `run-dir.mjs` in both directions (fresh and `--resume`, below) — it slugs the
domain (`kbeautyarabia.com` → `kbeautyarabia-com`), so a hand-typed `.mn-runs/<domain>/…` path looks
plausible and is not the directory `--resume` will ever find.

```
.mn-runs/<slugged shopDomain>/<YYYY-MM-DDTHHMM>/
├── state.json      the resolved plan + per-cell status  (you maintain this)
├── prompts.md      the approved prompt table from Q2    (the record of what was asked)
├── grid.json       the job array collect-pool.mjs --grid reads — one entry per cell, you write it
│                   (only for declaredPlatforms — a skipped engine has NO entries here at all)
├── meta.json       submit payload metadata — OUTSIDE cells/
├── spec.json       get_detect_extraction_spec, as fetched (P4.5 renders the analysis from it)
├── analysis/       one <cell>.prompt.md per cell + manifest.json — the analyzers' brief
├── cells/          one <intent>.<platform>.json per cell — nothing else in here
├── logs/           collect-pool.mjs's per-cell stdout+stderr (<file>.log) — pool retry output,
│                   not a cell; SKILL.md P4 "Collect" says why it can't live in cells/
├── report.md       local-report.mjs's output (SKILL.md P5) — written on EVERY run, with or
│                   without a MENTION_NETWORK_KEY; this is the deliverable if the run stops before P6
└── out/            exported or locally rendered PDFs
```

`submit.mjs` reads **every** `*.json` in `cells/` as a cell — keep `meta.json` and `state.json` out
of it or the submit fails.

`state.json`:

```json
{
  "shopDomain": "kbeautyarabia.com",
  "lane": "byok",
  "meta": { "locationCountry": "SA", "language": "ar", "product": "…" },
  "declaredPlatforms": ["claude", "gemini"],
  "skippedEngines": [
    { "engine": "chatgpt", "key": "OPENAI_API_KEY", "state": "missing", "reason": "no OPENAI_API_KEY — skipped by the user at Q1" },
    { "engine": "google_ai_mode", "key": "SERPAPI_API_KEY", "state": "rejected", "reason": "SERPAPI_API_KEY rejected — skipped by the user at Q1" }
  ],
  "catalogFallback": null,
  "routes": { "chatgpt": "api:openai", "claude": "api:anthropic", "gemini": "api:gemini", "google_ai_mode": "serpapi" },
  "grid": [{ "intent": "where_to_buy", "platform": "claude", "status": "done" }],
  "checkRunId": null,
  "reportId": null
}
```

`declaredPlatforms` and `skippedEngines` are written once, right after Q1 resolves (SKILL.md P3,
before `grid.json` is built) — they are the single source every later step reads instead of
re-deriving the declared set from whatever cells happen to be on disk. `engine-preflight.mjs`'s
`resolveDeclaredPlatforms()` produces both directly. `catalogFallback` is `null` when every P3 fetch
reached the live MCP; when one degraded to `catalog-cache.mjs load`, record
`{ "name": "describe_check_grid", "fetchedAt": "…", "age": "fetched 3 days ago" }` per catalog that
fell back, so `local-report.mjs` and anyone reading `state.json` later can see exactly what might be
stale.

`status` per cell: `pending` → `running` → `done` | `failed:<reason>`. Write it after each cell
finishes, not at the end — that's the whole point.

> **Write `state.json` even when the run is going well.** It is tempting to skip it while cells are
> landing cleanly and "add it at the end" — measured 2026-07, a full run finished with no
> `state.json` at all, which would have made an interruption at minute 18 unrecoverable. The file
> costs one write per cell; the whole point is that you cannot know in advance which run gets cut
> off. Write `checkRunId` and `reportId` the moment each exists, too.

## `resume`

1. `RUN="$(node "$HERE/scripts/run-dir.mjs" --domain "<shopDomain>" --resume)"` — the newest
   directory under `.mn-runs/<slugged shopDomain>/`. It exits 1 with "no existing run directory
   under …" when there is none; don't hand-construct the path (see *The run directory* above for
   why the slug makes that unreliable). Say which run this is, and how old it is.
2. Read `"$RUN/state.json"`. If `reportId` is set → jump straight to **P7** (export and show the link).
   If `checkRunId` is set → jump to the **P6 poll**. Otherwise continue collecting.
3. Re-collect only cells that aren't `done`. Cells already on disk are reused as-is — the prompt
   text is fixed in `prompts.md`, so a mixed-age cell set is still consistent.
4. Skip Q1 and Q2 — they were already answered, including any skip decisions: reuse
   `declaredPlatforms`/`skippedEngines` from `state.json` as-is, never re-ask about an engine the
   original run already resolved. **A run directory from before this field existed** has neither —
   `local-report.mjs` falls back to inferring `declaredPlatforms` from whatever platforms actually
   appear in `cells/`, which is correct for a resume (nothing was ever collected for a platform not
   on disk) but worth a one-line note that the inference happened, same spirit as any other fallback.
5. Show a one-line summary of what's being resumed and what's left instead, including the declared
   coverage ("resuming kbeautyarabia.com, 2/4 engines declared, 6 of 10 cells done").
6. **No run directory found?** Say so plainly and start a fresh guided run.

---

## Preflight and access errors

| Symptom | Fix |
|---|---|
| MCP tools not present in the session | Not a blocker by itself — `mcp-client.mjs` speaks the same MCP over plain HTTP, anonymously if needed (SKILL.md P1). If the user separately wants it registered as a host tool, give the `claude mcp add` one-liner; adding an MCP needs a session reload before the tools appear — say that, but don't wait on it to keep going. |
| **`MENTION_NETWORK_KEY: missing`** — at P1 | **Not a stop condition anymore.** It gates storage only (P6). Continue P1–P5 on the anonymous MCP path (or the catalog-cache fallback if that's also unreachable — see the next row). Only surface this as something to fix once the run actually reaches P6 and has something to store — offer `MENTION_NETWORK_KEY='<pasted>' node "$HERE/scripts/credentials.mjs" save MENTION_NETWORK_KEY` there, not before. |
| **Live catalog fetch fails and nothing is cached** (`catalog-cache.mjs load <name>` throws) | The one case with no local path: a brand-new machine whose very first MCP call also fails. Say so plainly — there is nothing stale to fall back to yet — and offer `dry-run` (wait for the MCP) or retry shortly. This is different from "no key": the MCP being reachable at all is what's missing here, not authorization. |
| **Live catalog fetch fails but a cache exists** | Not a stop condition — `catalog-cache.mjs load <name>` returns `{fetchedAt, age, data}`. Use it, and say so with its age everywhere that catalog would otherwise show up (confirm card, `state.json.catalogFallback`, the local report) — SKILL.md "Live data comes from the MCP" says exactly what goes stale (intents, `apiModelId`s) and why a stale `apiModelId` is a warning (`SERVED_MODEL_MISMATCH`), not a block. Re-run once the MCP is reachable to refresh it. |
| MCP call returns **401 / invalid key** | The key is wrong or expired, not missing — and worse than sending none at all (a wrong key still 401s; an absent one now gets served anonymously). Ask for a fresh one from mention.network and offer to `save` it. Don't retry the same key, and don't keep sending a key that `credentials.mjs check` already flagged as `REJECTED`. A **dev-issued key against the production host** lands here too (`401 "Internal API key không hợp lệ"`) — that isn't a revoked key, it's the wrong host/key pairing; see SKILL.md P1 on `MENTION_NETWORK_MCP_URL`. |
| `missing MENTION_NETWORK_KEY in the environment` from `submit.mjs` at **P6** | Almost always an unsourced shell, not a missing key — **shell state does not persist between tool calls**, so the `set -a; . "$CREDS"; set +a` block has to run again immediately before every `submit.mjs`/`check-detections.mjs --meta`/direct `mcp-client.mjs` call, not just once back at P4. If it's still missing after sourcing, there is genuinely no key — this is the point where that finally matters (P6, not before); ask for one (`credentials.mjs save MENTION_NETWORK_KEY`) or stop with the local report as the deliverable. |
| MCP call **times out / network error** | Retry once. Still failing → fall back to the catalog cache for anything P3 needs (row above); for P6 specifically, report it as an outage and offer `dry-run`/"stop with the local report" so the user's answers aren't wasted. |
| `ERR_AMBIGUOUS_MODULE_SYNTAX` from a `node --input-type=module -e` snippet | You mixed `require()` into a snippet that already uses top-level `await`. The `mcp-client.mjs` snippets are ESM — use `import { readFileSync } from 'node:fs'` at the top, never `require`. |
| `SHOP_NOT_FOUND` from `get_shop` | **Not an error.** The store has never been checked. Build the snapshots from what the user gives. |
| `list_shop_products` returns 0–1 products | Normal — it only shows what the backend already upserted (measured: 1 product for a store with a full catalog). Fall through to the storefront catalog. |
| `GET /<domain>/products.json` → 404 or non-JSON | The storefront disabled it. Fall back to `list_shop_products`, then to a typed title. |
| `products.json` → **503 / throttled** | Back off once and retry. Still throttled → same fallback chain; don't hammer it. |
| Domain unreachable at all | Likely a typo. Say what you tried, suggest the correction, and ask — don't proceed against a guess. |

---

## Collection failures

Handle per cell. One bad cell must never sink the batch — collect the rest, then come back.

| Symptom | Round 1 | Round 2 | Then ask |
|---|---|---|---|
| `429` / quota | Back off (respect `Retry-After`) and retry that cell | Lower `--concurrency` for that provider and retry | Wait for the quota window; move the whole run to the backend lane; or revise the declared set — drop the **whole engine** from `declaredPlatforms` (never just the one failing cell), rebuild `grid.json` without it, and say so on the report. **Never** drop only the failing cell while leaving its engine declared — that's the hole `INCOMPLETE_PLATFORM_GRID` exists to catch |
| `503` / `5xx` | Retry with backoff — the collectors already do this (measured: Gemini `503`) | Retry once more | Report the cell as failed and stop; there is no second route for an engine |
| **Your own orchestrating call got killed before the collector finished** — e.g. you ran `collect-pool.mjs` as a plain foreground shell call and it hit *your tool's* default execution timeout | Not a route failure and not the collector timing out. Re-run with an explicit long timeout, or in the background with polling | Check `"$RUN/cells/"` first — cells that completed are on disk and must not be re-collected | — |
| The collector itself reports timing out (`--timeout-ms` fired) | Raise `--timeout-ms` once and re-run that cell | — | An Anthropic cell that keeps pausing mid-search fails with "kept pausing after N turns"; re-run it before concluding anything about the key |
| Web search didn't run | Re-run the cell; every collector requests search, so this is usually transient. On the Anthropic route check `providerMeta.searchErrors` — `max_uses_exceeded` there means the search was refused, not that the collector misread it | Re-run once more | **Never set `webSearchUsed: true` by hand.** The backend requires it because a cell without search measures a different question |
| The user asks for a logged-in browser route | Explain the memory contamination (SKILL.md *Clean-room collection*) and offer the key setup | If they insist, it is their call | Disclose in the handover that those cells came from a personalized account |

---

## Validator errors → fix

`node "$HERE/scripts/submit.mjs" --cells "$RUN/cells/" --validate-only` prints these (source the
credential store again first — see *Preflight and access errors* above). Fix and re-run until
clean; only involve the user if the same code survives two rounds.

**These codes cover the cells only.** `validate_byok_submission` never reads `meta.json`, so a clean
`ok: true, validatedCells: N` still leaves the shop/product snapshot unchecked — that is enforced by
`submit_byok_check`'s own input schema, which fails with a raw zod error instead of a code. See
*Submit, poll, export* below.

| Code | What it means | Fix without asking |
|---|---|---|
| `INCOMPLETE_PLATFORM_GRID` | A platform present in the submission is missing at least one declared intent's cell | **This is a hole in a platform you DID declare — not the same thing as an engine you chose to skip.** A skipped engine has ZERO cells and never trips this code at all (SKILL.md design contract 5); if you see it, either collect the missing cell for that platform, or take the platform out entirely — remove **every** cell for it, update `state.json`'s `declaredPlatforms`/`skippedEngines`, and resubmit as a smaller-but-complete grid. Never leave a partial column standing. Run `assertRectangularGrid` locally (SKILL.md P5) before submit to catch this before spending the round-trip |
| `INCOMPLETE_INTENT_GRID` | A declared intent is missing on some declared platform | Same shape as above — collect the missing cells, or drop the intent from every platform consistently. Every intent you declare must exist on **every platform you declared** — not on all 4 unconditionally anymore |
| `MISSING_CELL` | A declared (platform × intent) has no cell | Re-collect exactly that cell. **Narrowing the grid one cell at a time is not a fix** — dropping only that cell while its platform stays declared just trades this for `INCOMPLETE_PLATFORM_GRID`; if the platform genuinely can't be completed, remove it entirely instead |
| `MISSING_WHERE_TO_BUY` | The mandatory intent was edited out | Restore it and re-render the prompt set |
| `INCONSISTENT_PROMPT_TEXT` | The same intent has different text across platforms | Re-render every cell of that intent from `prompts.md` — one prompt per intent, identical across platforms |
| `WEB_SEARCH_REQUIRED` | A cell claims no web search | Re-collect with search on. Citations are **not** required (the free Gemini UI often returns none) |
| `UNEXPECTED_SERVED_MODEL` | A `browser` cell carries a `servedModel` | Strip it. Browser cells have an empty `servedModel` for **every** engine — the validator wins |
| `SERVED_MODEL_MISMATCH` | An `api` cell's model isn't the grid's `apiModelId` | Take the exact `apiModelId` from `describe_check_grid` and re-collect. Never hardcode a model id |

### When you analyzed the answers yourself (P4.5)

These appear only if cells carry a `detection` field. Every one is fixable by editing the
`detection` — never by re-collecting the answer, which costs quota for nothing.
`node "$HERE/scripts/check-detections.mjs" --cells "$RUN/cells/" --fix` catches most of these locally
before you spend a `validate_byok_submission` round-trip on them (`--fix` mechanically corrects
`position` in place, see the `DETECTION_BAD_POSITIONS` row below).

| Code | What it means | Fix without asking |
|---|---|---|
| `DETECTION_PARTIAL` | Some cells have `detection`, others don't | Analyze the remaining cells, or strip the field from all of them. A mixed grid is one report built by two extractors |
| `DETECTION_UNSUPPORTED_MERCHANT` | A merchant has no evidence in that cell — the backend would drop it silently | Re-read that cell: use the name the answer actually wrote, add the domain if it's among the citations, or make `evidence` a real verbatim quote containing the name. If the merchant genuinely isn't in the answer, remove it. **Never** invent a name the answer didn't write just to pass. (Non-Latin script names — Arabic, Japanese, Korean, … — match normally; the backend's support check and this file's `isSupported` both fold diacritics and keep every script's own letters/numbers, fixed backend-side in `c3781fb6`, 2026-07-29.) |
| `DETECTION_MULTIPLE_TARGETS` | More than one merchant flagged `isTargetShop` | Merge into one entry — the target appearing under two names or domains is still one shop |
| `DETECTION_BAD_POSITIONS` | `position` isn't `1..n` distinct, **or** it IS a valid `1..n` set but out of first-appearance order in `rawText` (#287 upgrade, hardened further in ADR-0040) | Run `check-detections.mjs --fix` — it recomputes the correct order itself (fold-matching a diacritic or markdown-escaped name like `Yahoo\!ショッピング`, falling back to the evidence quote's own offset) and **rewrites `position` in the cell file for you**, printing `FIX <file>: "<name>" position <old> → <new>` per merchant it touched. Only a cell where some merchant can't be located at all (citation-only, no textual presence) is left for you to check by hand. This drives `bestRank` on the customer's report — real incident: an analyzer sorted by "recommendation strength" instead of appearance, printing the wrong #1 |
| `DETECTION_MISSING_SOURCE` | A merchant has no `mentionSources` | `text` if named in prose, `citation` if it appears via a cited URL, both if both |
| `DETECTION_EMPTY_NAME` | A merchant has a blank name | Use the site/brand name — never a product-page title |
| `DETECTION_INVALID_SHIPPING_POLICY` | A number sits under a `shippingPolicy.kind` that doesn't explain it — almost always a free-over **threshold** filed as a **fee** | Move it: `"free over $40"` is `kind: "free_over_threshold"` + `freeOverAmount: 40`. `feeAmount` is for `kind: "paid"` only. This one is an error rather than a warning because the two read as opposites on the customer's report while both look plausible |

**Warnings, not errors.** `validate_byok_submission` returns these in a separate `warnings` array
(`submit.mjs` prints them as `WARN …`). They never block submit and the report stays correct on
rank, score and coverage — but each one you ignore is a column of `N/A` on the page the customer
reads.

**They report a fact, not a cause.** The fact is "no valid value was extracted here". `N/A` in those
columns has had three different causes: the answer genuinely naming no figure, retrieval handing
back a different answer, and a normalizer at the read layer discarding values the database held
correctly. Two of the three were once "fixed" at the wrong layer because the symptom got read as a
diagnosis. Audit the cell, then decide — leaving it null is the right answer when the answer really
attaches no figure to that merchant.

| Code | What it means | What to do |
|---|---|---|
| `WARN_NO_PRICE_EXTRACTED` | Either no merchant in the whole grid carries a price, or one `cheapest` cell whose answer quotes money produced none | Check whether the figure is actually tied to a merchant — a product-level price ("it retails around €30") belongs to no one and stays null. If it is tied, fill `priceRaw` **verbatim** (`"AED 135"`, `"228,89 €"` — never reformat) plus `price` when the currency is unambiguous. Never copy one merchant's figure onto another |
| `WARN_NO_SHIPPING_EXTRACTED` | Same, for `shipping` on the `free_shipping` intent | Fill it only with a real shipping condition — `"Free"`, `"Free over $40"`, `"AED 20"`. `"free returns"` and `"delivery 2–3 days"` are **not** shipping cost, and a free-over threshold must never be reduced to its bare number (`"Envío gratis desde AED 199"` once surfaced as a 199 shipping fee — the opposite of what it says) |

### Local-only warnings — the ones a per-cell analyzer cannot see

`check-detections.mjs --cells "$RUN/cells/" --meta "$RUN/meta.json"` adds these; the backend has no code for
them. They exist because P4.5 is fanned out one analyzer per cell, so nothing inside the analysis
can notice that *this* cell disagrees with the other nineteen. Without `--meta` they are silently
skipped (the tool prints a note saying so on its last line).

| Code | What it means | What to do |
|---|---|---|
| `WARN_TARGET_MISSED` | The answer names the target shop (its domain, or its name) but no merchant in that cell carries `isTargetShop` | Re-read the cell. Named as a place to buy → it belongs in `merchants`, flagged. Only the product or the brand discussed → the warning is correct to ignore, that is exactly the "a product mention is not a merchant mention" rule |
| `WARN_TARGET_NOT_FLAGGED` | The target shop **is** in `merchants`, just not flagged | Set `isTargetShop: true` on it. The report's own-shop rank reads from this flag alone, so an unflagged cell silently drops the shop out of its own report |
| `WARN_TARGET_MISLABELED` | `isTargetShop` sits on a merchant matching neither the shop name/aliases nor its domain | Move the flag. A marketplace that happens to sell the product is never the target |
| `WARN_TARGET_SHOP_SPLIT` | The target shop appears under two domains across cells (`glowtheory.com` in 12 cells, `glowtheory.co.za` in 5 — measured on a shipped run) | Reconcile to the shop's real domain **where the cell supports it**. Dedup is on domain, so a split ships the shop as two rows and halves its own rank. If one engine genuinely only ever cited the other domain, keep it and say so — but never leave the domain null to dodge the choice |
| `WARN_MERCHANT_NAME_CONFLICT` | One domain named several ways (`"iHerb"` vs `"iHerb South Africa"`) | Pick one spelling — the one the answers use most — and rewrite the others. Whichever wins becomes the label on the report row |
| `WARN_MERCHANT_DOMAIN_CONFLICT` | One name split across domains (`sephora.me` vs `sephora.sa`) | Legitimate when each cell really cited its own domain (`ANALYSIS.md` accepts that split). Not legitimate when one of them was inferred — fix the inferred one |
| `WARN_MERCHANT_NORMALIZED_DUP` (#287, R4) | Two spellings fold to the same store once whitespace / `の`・`・`・`ー` / a `本店`・`支店`・`店` branch suffix are stripped, yet carry different name **and** different (or null) domain — the case `WARN_MERCHANT_NAME_CONFLICT`/`WARN_MERCHANT_DOMAIN_CONFLICT` both miss because neither the name nor the domain matches exactly. Real incident: `"熊野筆の北斗園"` (domain `store.shopping.yahoo.co.jp`) vs `"熊野筆 北斗園"` (domain empty) — one store, split into two 10% report rows instead of one 20% row | Reconcile to one name and one domain across the cells that mention it — same fix shape as the two codes above, just caught by a looser key |
| `WARN_MERCHANT_MISSED_IN_CELL` (#287, R1) | A merchant name extracted in ANOTHER cell of this grid appears verbatim in THIS cell's own `rawText` too, but this cell's `detection` doesn't carry it | Re-read this cell (or re-dispatch it): if the name really is a merchant mention here, add it. Measured on the source incident: 11 merchants missed this way across the grid, one cell alone missing 3 of 13 (~23%). Only catches names extracted *somewhere* in the grid — a name never extracted anywhere (e.g. buried in one shared sentence with two others, only one of which got picked up) still has to be found by eye |

**Guard against agent-lane leakage — not detection-gated, always runs:**

| Code | What it means | What to do |
|---|---|---|
| `AGENT_LANE_CONTAMINATION` (#287, R5) | `rawText` matches a tool-permission refusal / meta-commentary pattern about the collection run itself — not a shopper's answer. Tool names (`WebFetch`, `web_search`), the Japanese refusal phrase, `search results only`, or `permission`/`access`/`denied` **in tool-refusal context** ("permission denied", "denied access", "permission to browse/fetch/access/open/visit"), but *not* those two words on their own — ordinary commerce prose ("Returns may be denied without a receipt.") used to hard-fail here and was fixed. Runs on every cell regardless of whether it carries `detection`, and is byte-identical to the pattern `validate_byok_submission` enforces server-side (`byok-validate.util.ts`) — the two are kept in sync deliberately | Re-collect that cell. The classic cause is gone with the subscription lane — an agent CLI asking for a tool permission mid-answer — but the server-side check remains, and any answer that talks about its own collection run rather than the shop still trips it. Real incident from the CLI era: a `cheapest × claude` cell opened with *"WebFetch was denied, so I couldn't open product pages for live prices — the answer below is from search results only"* and closed in Japanese asking to be granted `WebFetch` — an agent-CLI tool-permission message, scored and printed in the Appendix as if it were the AI's answer |

**Fix these by re-dispatching the affected cell, not by hand-editing it** (`ANALYSIS.md`,
"Delegating it"). A grid extracted by one analyzer plus your corrections is a grid extracted by two.

---

## Submit, poll, export

| Symptom | Fix |
|---|---|
| `Input validation error: Invalid arguments for tool submit_byok_check` | The **meta**, not the cells — a raw zod error naming the bad path. Read `path` and fix `meta.json`; the validator will never flag it. Measured: `["product","price"]` *expected number, received string*, because the storefront catalog gives `"109.00"`. Coerce with `Number(...)`, or drop the optional field. |
| `submit` returns `deduped: true` | An earlier run with that `idempotencyKey` was returned — **no new report**. Explain it, then offer a fresh run (`submit.mjs` generates a new key each call; a key in `meta.json` overrides that — remove it). |
| Poll never reaches `stage: done` | Read the **top-level** `stage`/`status`, not the per-engine states: an engine you didn't submit stays `queued` forever. |
| Poll exceeds ~3 minutes (15 × 12s) | Don't hang. Print the `checkRunId`, save it to `state.json`, and give the user the `resume` line. |
| Run finishes `failed` | Report it as failed with whatever reason the status carries. **Never present a partial or failed run as done.** |
| Run finishes `failed`, `error_message` contains `ai_responses status=success` (#373) | **Backend-side guard, not your payload.** It means the run collected **zero** working answers from any engine (every cell timed out/errored server-side) — before #373 this same run would have silently reached `stage: done` with a fake `score: 0, verdict: not_visible` report instead. There is nothing in `meta.json`/cells to fix; don't spend a repair round on it. Tell the user plainly that collection failed and offer a fresh run (new `checkRunId` — a retry may hit different provider capacity). This guard applies to **all** lanes, including backend-run (Lane A). |
| Lane A (backend-run) reaches `stage: done` — is the score trustworthy? | **Only partly.** `get_visibility_check_status`'s `engines[].state` is `queued`/`checking`/`done` — `done` means every cell went **terminal**, not that it **succeeded**; a platform whose every cell failed still reports `done` once #373's guard passes (which only requires ≥1 success **run-wide**, not per platform). So a `done` Lane A report can still under-count if some cells failed while others didn't — the API gives no way to tell from the outside. Don't present the score as unquestionably complete; if the run took unusually long or you have other reason to suspect provider trouble during the window, say so in the handover. (Known gap, not yet fixed — see #373's follow-up discussion.) |
| `export_visibility_report_pdf` fails | Retry once, then wait and retry again | — | The report exists and has a `reportId`; hand that over and say the PDF export is what is failing. There is no local renderer to fall back to |
| `export_visibility_report_pdf` → an internal-error message from the tool | A server-side 500, not your payload — the `reportId` is fine and the report exists. Don't re-submit the run (spends quota for nothing, and dedupes anyway). **It is often transient: the same `reportId` that failed twice succeeded ~15 min later with `cached: false`** (i.e. it generated fresh), measured 2026-07-28. So: retry, wait, retry again before declaring it down, and say plainly that the report exists and only its PDF export is failing. |
| Diagnosing that 500 — **do not compare against a cached report** | The response carries a **`cached`** flag, and a `cached: true` call never touches the generation path at all. Comparing a cached report against uncached ones makes any difference between them (language, lane, age) look causal when the only real variable was cache-hit. Measured 2026-07-28: `ar` reports failed while an `en` one "worked" — but the `en` one was `cached: true`, and every `ar` report exported fine once generation recovered. **Control for it:** pick a report that has never been exported, or read `cached` on every call before drawing a conclusion. |
| Audit polling stalls | Same rule as the visibility poll: print the `auditId` and stop. The visibility PDF from P7 is already delivered and stands on its own. |
