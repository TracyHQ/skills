# Arguments — `/visibility-audit`

One line, any order, everything optional except the domain. Parsing **never fails the run**: an
unrecognized token becomes a note on the confirm card, not an error.

```
/visibility-audit kbeautyarabia.com product=water-bank llm=anthropic country=AE lang=ar
/visibility-audit https://gymshark.com/products/vital-seamless-leggings llm=auto yes
/visibility-audit acme.com llm=gemini audit-only
/visibility-audit resume
```

## Grammar

| Token | Means | Default |
|---|---|---|
| `<domain>` or a full PDP URL | the store, or the exact page to audit | required |
| `product=<handle\|title fragment>` | which product; matched against `/products.json` | store's first product, offered at Q1 |
| `country=<ISO-2>` | market for off-store searches and the report header | inferred from the domain, else asked |
| `lang=<ISO-639-1>` | market language; **gates `reddit` + `trustpilot` when not `en`** | `get_shop.primaryLocale`, else `en` |
| `city=<name>` | sharpens the press/"best of" search | none |
| `offstore=<route>` | `serpapi` \| `none` — SerpApi is the only route there is | `serpapi` when a key is stored, else `none` |
| `llm=<route>` | `anthropic` \| `openai` \| `gemini` \| `none` | the first key that is stored, then asked |
| `model=<id>` | pin the grading/narrative model | route default |
| `report=<reportId>` | a Phase-1 report to pair with: the stored audit shows on the merchant's Website Audit home instead of standing alone. **Does not unlock `price-competitive`** — see the note below | none (standalone audit) |

> **Why `report=<reportId>` doesn't unlock `price-competitive` (audit incident D).** This
> argument only reaches `submit-audit.mjs --report-id`, which pairs the *finished* audit with
> that report for display — it never feeds prices back into scoring, and no script here reads
> the report's mentions. `get_visibility_report({checkRunId, shopDomain})` does carry a
> per-merchant `marketPosition.competitors[].priceDisplay`, but that field is the price
> **exactly as the AI answer wrote it** ("AED 135", "228,89 €"), never a structured
> `{ amount, currency }` pair — the backend's own `price-competitive` scorer reads a column no
> MCP tool exposes. Parsing `priceDisplay` here would mean re-solving "which locale wrote this
> money" client-side, which is a real, previously-shipped source of wrong-but-plausible numbers
> (mis-parsed thresholds, wrong currency splits) — so this skill does not attempt it instead of
> risking the same class of bug. The only supported path to a scored `price-competitive` is
> hand-entering `competitorPrices: [{ amount, currency }, …]` into `meta.json` yourself, read off
> a Phase-1 report you already have open (see `SKILL.md`, P5) — until then the criterion stays
> `na`, which is the honest answer, not a missing feature.

## Flags

| Flag | Effect |
|---|---|
| `yes` | skip the confirm card (still print the plan and every repair line) |
| `dry-run` | stop after the plan; collect nothing |
| `audit-only` | do not offer to pair with a visibility report |
| `no-save` | do NOT submit to the server; local files only (no `auditId`, no PDF at all) |
| `no-pdf` | store the audit but skip the PDF export |
| `fresh` | ignore an existing run dir for this store+product and start clean |
| `resume` | pick up the newest run dir instead (see `RECOVERY.md`) |

## Aliases

`offstore=serp` → `serpapi` · `llm=claude` → `anthropic` · `llm=gpt` / `llm=chatgpt` → `openai` ·
`llm=google` → `gemini` · `lang=arabic` → `ar` · `country=uae` → `AE`.

Route names that belonged to lanes this skill no longer has still parse, so an old invocation is
repaired rather than rejected: `llm=agent-sdk` / `llm=claude-cli` → `anthropic`, `llm=codex-cli` →
`openai`, and `offstore=browser` / `playwright` / `pw` / `chrome` → `serpapi`. Each one gets a
repair line — the user asked for a subscription or a browser and is getting a metered key, which
they are entitled to know before the run spends anything.

## Route order (what gets pre-selected)

**Grading LLM:** `anthropic` → `openai` → `gemini`, filtered to the keys actually stored
(`pickRoute` in `scripts/llm.mjs` is the implementation, and it is the one place this order lives).
Grading needs no web search, so all three are fidelity-equivalent — the order is a tie-break for
picking a default, not a statement that one grades better.

**Off-store:** `serpapi` when `SERPAPI_API_KEY` is stored, else `none` and Q2 asks for a key.

`auto` in place of any route value means "take the pick without asking me". Nothing else does — a
route the arguments did not pin gets a question at Q1 when there is more than one option.

## Repairs (state them, don't fail)

| Impossible combination | Repair | Say on the card |
|---|---|---|
| `offstore=serpapi` with no `SERPAPI_API_KEY` | → `none`; Q2 asks for a key. Run does **not** wait — off-store just never runs | "no SerpApi key stored — 7 criteria go n/a, incl. Critical `reddit` and `press-and-lists` (~23% of total weight); supply one or proceed without this lane" |
| `offstore=browser` / `playwright` / `chrome` | → `serpapi` if a key is stored, else `none` | "there is no browser route: every lane here is an API key" |
| `llm=agent-sdk` / `claude-cli` | → `anthropic` if that key is stored, else the next stored key | "no subscription lane — using your Anthropic key" |
| `llm=<provider>` with no key for it | → the next stored key, else Q2 asks | "no `<PROVIDER>_API_KEY` stored" |
| No LLM key at all | grading is skipped, 15 criteria go `na`; Q2 asks. Run proceeds — P3 through P5 do not wait for this | "no LLM key: 15 criteria go n/a, incl. 4 Critical (`specifications`, `faq-product`, `unique-description`, `answer-formatting`, ~38% of total weight); supply one or proceed without this lane" |
| A key the store holds but the provider rejected | → the next stored key; name the provider that refused | "your `<PROVIDER>` key came back 401 — replace or remove it" |
| `report=<id>` but the MCP is absent | drop the pairing, keep the audit | "no MCP: the audit stands alone, no link to that report; `price-competitive` was already `na` regardless (see the note above)" |
| No `MENTION_NETWORK_KEY` | Note it, same as the other two lanes, and **keep going** — P2 through P5 never wait on this. Only P6 (save) is affected, and even then the server may still serve an unauthenticated `submit_byok_website_audit` (see SKILL.md P1) | "no MCP key: the audit will still be measured and scored on this machine; without a key, saving it at the end may be declined — supply one now, or proceed and see what P6 finds out" |
| A PDP URL and `product=` that disagree | the explicit URL wins | "using the URL you gave" |

One repair line per changed value, on the confirm card. A repair is never silent.
