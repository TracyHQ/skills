# Recovery — run dir, resume, error → fix

## The run directory

One directory per audit, under the working directory, so a failed step is re-runnable without
re-fetching anything:

```
.mn-audits/<shopDomain>-<handle>-<YYYY-MM-DD-HHmm>/
├── state.json            what has completed (write it after every step)
├── meta.json             shop/product/market you confirmed at Q1 (hand-written)
├── pages.json            P3 — PDP + robots + store pages + product JSON
├── rendered.html         P3 — an already-saved post-JS DOM, only if you passed one in
├── offstore.json         P4a — normalized off-store signals, plus a `failures` array
├── llm.json              P4b — the 15 bands + the press count, plus a `failedBatches` array
├── audit.json            P5 — the report
├── report.md             P5 — the readable version
└── submitted.json        P6 — { auditId, pdfUrl, score, narrativesReplaced } from the server
```

`state.json` is a flat record, e.g.
`{ "step": "scored", "pdpUrl": "…", "routes": { "llm": "anthropic", "offstore": "serpapi" }, "coverage": { "scored": 38 } }`.

## Resume

`resume` → take the newest `.mn-audits/*` for this store (or the one the user names), read
`state.json`, and continue from the first missing artifact. Nothing that exists is re-fetched;
`fresh` forces a new directory.

Each step is independently re-runnable, and re-scoring is always safe and always cheap — the one
ordering that matters is P4a (off-store) before P4b (LLM grading), see SKILL.md P4: P4b's press
filter reads `offstore.json`, so re-run P4a first if it doesn't exist yet, even to produce an
all-`na` one.

```bash
node scripts/score.mjs --pages "$RUN/pages.json" --meta "$RUN/meta.json" \
  --llm "$RUN/llm.json" --offstore "$RUN/offstore.json" --narrative-route none \
  --out "$RUN/audit.json" --md "$RUN/report.md"
```

## Errors → fixes

### Fetching the page

| Symptom | Cause | Fix |
|---|---|---|
| `pageOk: false`, `status: 404` | wrong handle | re-read `/products.json?limit=250`, match the handle exactly; ask the user which product if it is ambiguous |
| `status: 403` / `429` | the storefront is rate-limiting or bot-blocking a plain fetch | wait a minute and retry. There is no browser lane to fall back to; if it keeps failing, say the page could not be read rather than scoring it |
| `productJson: false` | not Shopify, or the JSON endpoint is disabled | fill `product` in `meta.json` by hand (title, vendor, `description`, `productType`, `price`, `currency`) — `resolveSubject` prefers meta over the fetched copy |
| every `storePages` is `false` | non-standard theme paths | check the footer links; `fetch-pages.mjs` already tries `/pages/about*`, `/pages/contact*`, `/policies/*` plus any discovered `about`/`contact` href |
| `renderer: "plain"` (not an error) | no rendered DOM was passed in | expected on every normal run; `crawlable-text` is `na` and seven more criteria grade the pre-JS page. `FRAMEWORK.md` explains which and why |

### Grading (`analyze-llm.mjs`)

| Symptom | Cause | Fix |
|---|---|---|
| `no LLM API key found` | nothing stored for any of the three providers | Q2's setup path — save one key, then re-run this step alone |
| `Anthropic 401` / `OpenAI 401` / `Gemini 400 API key not valid` | wrong or revoked key | `credentials.mjs check` names which provider refused; re-save that one, or `remove` it and use another. A 401 is a wrong key, not a missing one |
| `Anthropic declined to answer (refusal category: …)` | a safety classifier refused this page | rare on storefront copy. Re-run once; if it repeats, switch `--route` to another provider and say which criterion was graded elsewhere |
| `429` / `503` | provider throttling | `runJson` already retries once; wait and re-run the step — the page fetch is on disk |
| `model reply had no JSON object` twice | the route is chatty or the model is small | pin a bigger `--model`, or switch routes |
| `missing: [...]` lists keys | those bands were malformed and dropped | re-run the step; if a key keeps failing, ship it as `na` rather than hand-writing a band |
| `... 404 ...` or `... looks retired or unknown to <route> ...` | the hardcoded default model id (`DEFAULT_MODELS` in `scripts/llm.mjs`) was retired by the provider — this is not a key problem | pass `--model <a current id from the provider's docs>` for this run, and update `DEFAULT_MODELS` in `scripts/llm.mjs` so the next run doesn't hit the same wall |
| `llm.json`'s `failedBatches` is non-empty (also in the CLI's own JSON output) | one or more of `content` / `voice` / `credibility` / `faq` / `press` threw and got caught | those criteria are `na`, not "the page is thin" — re-run `analyze-llm.mjs` alone before trusting a low content/credibility score. `report.md` prints a warning line when this is non-empty |

### Off-store (`collect-offstore.mjs`)

| Symptom | Cause | Fix |
|---|---|---|
| `SERPAPI_API_KEY is not set` | no key stored | save one (see SKILL.md *Credentials*), or accept that the 7 off-store criteria go `na` |
| `SerpAPI: Invalid API key` | bad key | re-enter; do not fall back to inventing signals |
| `SerpAPI: run out of searches` | free tier exhausted (~100/month) | ship with those criteria `na`, or wait for the quota to reset — there is no free browser route to switch to |
| `warning: off-store <signal> failed` | one search failed | that signal stays `null` → `na`. Re-run to retry just it; the others are already written |
| Trustpilot returns nothing | Cloudflare blocked the direct read | the collector already falls back to a `site:` search; a blocked read plus no SERP hit is legitimately "no data" (`na`), not "no profile" (0) |
| `offstore.json`'s `failures` is non-empty (also in the CLI's own JSON output, as `failures`) | one or more searches threw rather than finding nothing | different from a gated signal (non-English `reddit`/`trustpilot`, which is `null` on purpose) — `failures` names only the kind that errored. Re-run to retry just those; `report.md` prints a warning line when this is non-empty |

### Submitting to the server (`submit-audit.mjs`)

| Symptom | Cause | Fix |
|---|---|---|
| `missing MENTION_NETWORK_KEY in the environment` | credential store not sourced, or no key | First `set -a; . "$CREDS"; set +a` — usually just an unsourced shell. If there is genuinely no key, **ask for one** (`credentials.mjs save MENTION_NETWORK_KEY`); only continue local-only if the user chose it. A silent local-only run hands back a local file with no `auditId`, no link, and no PDF at all |
| `payload rejected by the server: [MISSING_CRITERION]` | a criterion never reached the wire | re-run `score.mjs` (it always emits all 40) — do not hand-edit `audit.json` to add one |
| `[MISSING_REASON]` | an `na`/`gated` criterion has no reason | the scorer always sets one; a hand-edited `audit.json` is the usual cause |
| `[AGGREGATE_MISMATCH]` | the server's re-computed score differs from ours by more than 1 | **this skill's framework has drifted from the backend's.** Do not force it through — re-port `framework.mjs` from the backend and re-score. The drift and parity tests that would have caught this live in the source pack, not in this copy (see SKILL.md, *Where this came from*), so there is no local test to run. Note the server check only catches *weight* drift: a scorer that grades the same page differently submits cleanly and silently |
| `[COVERAGE_MISMATCH]` | same cause, seen through the counts | as above |
| `[NOTHING_SCORED]` | zero criteria scored | the page fetch failed — fix P3, do not submit an empty audit |
| `[EVIDENCE_TOO_LARGE]` | an evidence blob > 4 KB | a scorer captured a whole page into evidence; report it, trim that field, re-submit |
| `PHASE1_NOT_DONE` | `--report-id` points at a missing report or another shop's | drop `--report-id` (standalone audit) or use the right one from `list_visibility_checks` |
| `narrativesReplaced` is high (most lines) | the narrative model invented numbers or wrote prescriptions | the numbers are unaffected; re-run P5 with `--narrative-route none` for clean template prose, or a different route |
| Submit succeeded, `export_website_audit_pdf` failed | R2/render hiccup on the server | the audit IS saved — say so and hand over the `auditId`. Retry the export; there is no local renderer to fall back to |
| Re-ran and got the same `auditId` back (`deduped: true`) | same `idempotencyKey` | intended. Pass `--idempotency-key <new>` to store a genuinely new audit |

### Scoring and rendering

| Symptom | Cause | Fix |
|---|---|---|
| `coverage.scored` far below what the lanes promised | an input flag was omitted, or its path is wrong (audit incident E) | omitting `--llm` / `--offstore` is always silent, in both `score.mjs` and `analyze-llm.mjs` — treated as "that lane did not run". A **wrong path** behaves the same way in `analyze-llm.mjs` as of the fix for incident A (it catches ENOENT and warns to stderr instead of crashing), but `score.mjs` still throws a bare `ENOENT` and exits 1 on a typo'd path — that difference was NOT closed here. So: a low coverage from `score.mjs` with no crash means an omitted flag; a crash means a wrong path. Check the paths are exactly right before assuming a file was optional |
| Every diagnosis is `source: template` | the narrative route failed | read the warnings on stderr; a guard rejection is intentional (ungrounded number / prescription) and is not a bug |
| `impactRank` all zero | nothing scored | the store returned an empty page — fix P3 first; a report with `total: null` should not be delivered. Its `verdict` is `null` too (not `"weak"` — audit incident C), so a downstream reader that expects a tier string needs to handle that case explicitly |

## When to stop and ask

- The PDP cannot be fetched at all after two attempts → ask the user for the exact product URL.
- Grading and off-store are both unavailable → say so, offer the setup paths (Q2), and do not
  deliver a 20/40-coverage report as if it were the audit.
- The user asks for a number the run did not measure → say it was not measured and which lane
  would measure it. Never estimate a criterion.
