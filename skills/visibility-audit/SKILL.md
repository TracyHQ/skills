---
name: visibility-audit
description: Use to run an AI-visibility audit (the GEO audit of a Shopify store's product page) on the user's own API keys — BYOK, the Mention Network backend spends nothing. Fetches the PDP, robots.txt, the store pages and the product JSON; grades 40 criteria with the same framework, weights and prompts the backend uses; adds the off-store signals with the user's SerpApi key; writes the diagnosis prose with the user's own LLM key (Anthropic, OpenAI or Gemini); stores the finished audit on the Mention Network backend (`submit_byok_website_audit`, which re-computes every score with the server's own weights instead of trusting the client's) and returns the hosted PDF link, alongside the local audit.json + report.md. Every lane is an API key — there is no subscription lane and no browser lane, so a missing key is a setup step the skill walks through and stores, and a key can be checked, replaced or removed at any time. Accepts a one-line shorthand (`/visibility-audit kbeautyarabia.com product=water-bank llm=anthropic`). Missing lanes are offered as a setup step, never silently scored as zero. Use `create_website_audit` over the MCP instead when the backend should pay.
version: 1.0.0
platforms: shopify
requires-mcp: [mention-network]
provenOn: —
---

# Visibility Audit (BYOK, API keys)

Audit one product page against the Product-Visibility framework — 40 criteria, 4 factors — with
the measuring running on this machine and every paid call on the user's own API keys. Same
weights, same band prompts, same guards as the backend; the difference is who pays and who
observed the data.

**Two lanes exist. This skill is the client-side one:**

| | Backend-run (`create_website_audit` over the MCP) | **This skill (BYOK)** |
|---|---|---|
| Who fetches the page | backend (Cloudflare/Firecrawl render) | this machine (plain fetch) |
| Who pays for grading | backend's AI budget | your `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` |
| Off-store signals | backend's SerpApi key | your `SERPAPI_API_KEY` |
| Result lives in | the backend, `reportId` linked | **also the backend** (`submit_byok_website_audit`) — same `auditId`, same hosted PDF, plus the local files |

If the store already has a Phase-1 report and the backend should just do it, call
`create_website_audit({reportId, shopDomain})` and stop — that is one call, not this skill.

> Every report this skill produces carries `source: byok`, locally and on the server. The numbers
> rest on data this machine collected; the backend re-computes the weights but never observed the
> page. **Disclose that wherever the report is shown to anyone else** — the exported PDF prints a
> self-reported line for exactly this reason.

**Design contract — hold to it:**

1. **Probe before you ask.** P1 runs unattended and fills every later option with a real value.
2. **Two asking moments, no more:** Q1 confirm → Q2 gaps. Each is one `AskUserQuestion` with
   pre-filled options; typing is the fallback, not the path.
3. **A missing key is a setup task, not a zero — and never a reason to stop measuring.** A
   criterion with no data is `na` and says so. Never invent a signal, and never present a partial
   audit as a complete one. This holds the same way for every lane, **`MENTION_NETWORK_KEY`
   included**: P1 through P5 run to completion on this machine regardless of whether it exists —
   `audit.json` and `report.md` are a complete, usable deliverable on their own. What a missing
   MCP key changes is P6 only: saving the finished audit on the server and getting a hosted PDF
   link. Name what's missing, name what it costs, and offer the same choice the LLM/SerpApi lanes
   get — supply it, or proceed without it — instead of stopping the run to ask.
4. **The numbers come from the ported scorers, never from your own reading of the page.** You
   drive the scripts; you do not eyeball the HTML and decide a score.
5. **Secrets are handled, never echoed.** Every key goes through `scripts/credentials.mjs`, whose
   values are read from the environment and never from argv. Do not print a key, do not repeat one
   back, and do not paste one into a file inside the skill directory. When a key is missing, hand
   the user the command rather than asking them to type the secret into the chat — see
   *Credentials* below for the one exception and how to take it.

```
P0 parse → P1 preflight → P2 resolve → [Q1 confirm] → P3 fetch page
        → P4 off-store, then grade (LLM) → P5 score + narrate → P6 submit + PDF → [Q2 gaps]
```

Companion files — read the one the situation calls for, not all of them up front:

| File | Read it when |
|---|---|
| **`ARGUMENTS.md`** | The invocation carries arguments — grammar, aliases, route ranking, repair rules |
| **`FRAMEWORK.md`** | You need to know what a criterion measures, or which lane buys which criteria |
| **`RECOVERY.md`** | Anything fails, or the invocation says `resume` — error → fix, run dir, resume |

## What each lane buys

40 criteria. What you can score depends on which keys the user has:

| Lane | Criteria | Needs |
|---|---|---|
| **Page** (always) | 19–20: schema, robots, headings, alt text, links, media, freshness, contact info, policies presence | nothing — a plain fetch |
| **Grading LLM** | +15: the content-quality bands, About page, policy substance, testimonials, shipping offer | one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` |
| **Off-store** | +7: Reddit, Trustpilot, Google reviews, video mentions, press, entity databases, Google Shopping | `SERPAPI_API_KEY` |
| **Phase-1 prices** | +1: `price-competitive` | a visibility report's competitor prices, passed in `meta.json` |

`MENTION_NETWORK_KEY` is deliberately not a row in this table: it buys nothing here. It is not a
scoring lane, it never changes which of the 40 criteria go `na`, and its absence never reduces
`N/40` — it only decides whether P6 can save the finished audit to the server. Run
`node scripts/preflight.mjs` for the current per-lane numbers above, computed from whatever keys
are actually in the environment right now rather than hand-copied from this table.

`crawlable-text` scores **`na`** on a normal run: measuring JS-hidden content means comparing the
pre-JS HTML against a rendered DOM, and this skill only fetches the former. `fetch-pages.mjs`
accepts `--rendered-html <file>` if you already have a saved rendered DOM from somewhere, but the
skill never goes and gets one — that is a browser dependency the key-only design does not carry.

`reddit` and `trustpilot` are **gated** on non-English markets (they measure Western/English
buzz), exactly as on the backend — gated is not a failure and leaves the denominator.

## Credentials — enter once, reuse, check, replace

Same store as `create-visibility-report`: `~/.config/mention-network/credentials` (override with
`$MENTION_NETWORK_CREDENTIALS`), `chmod 600`, managed by `scripts/credentials.mjs`. Load it at the
start of every run; never re-ask for a secret that is already there; never print one.

```bash
node "$HERE/scripts/credentials.mjs" status          # masked: stored | env only | missing
node "$HERE/scripts/credentials.mjs" export          # the file as stored, values masked
node "$HERE/scripts/credentials.mjs" check           # ask each provider whether the key still works
node "$HERE/scripts/credentials.mjs" remove GEMINI_API_KEY
```

**Getting a key from the user.** Default to handing them a command they run themselves, so the
secret never enters this conversation, never reaches the model, and never lands in shell history:

```bash
read -rs SERPAPI_API_KEY && export SERPAPI_API_KEY \
  && node "$HERE/scripts/credentials.mjs" save SERPAPI_API_KEY
unset SERPAPI_API_KEY        # own line, so it runs even when the save above fails
```

`unset` is deliberately not chained onto the `&&`: if `save` errors, a chained `unset` never runs
and the key stays exported in that interactive shell for the rest of the session.

If the user would rather just paste the key to you, that is their call to make and you may take
it — say once that the key will be stored in the conversation history, then save it the same way
(value via the environment, never in argv):

```bash
SERPAPI_API_KEY='<pasted>' node "$HERE/scripts/credentials.mjs" save SERPAPI_API_KEY
```

**Replacing a key** is the same `save` — it overwrites. Reach for `remove` when the user has
stopped using a provider: a stale key sitting in the file is one a later preflight will happily
route work to.

---

## P0 — Parse the invocation

No arguments → guided run, skip to P1. Arguments present → read **`ARGUMENTS.md`** and extract
`domain`, `product`, `country`, `language`, `llm`, flags. Parsing never fails the run: an
unrecognized token becomes a note on the confirm card. `resume` → read **`RECOVERY.md`**.

## P1 — Preflight: one batch, ask nothing

```bash
HERE="$(dirname "$(readlink -f "<abs path to this SKILL.md>")")"   # this skill's folder
CREDS="${MENTION_NETWORK_CREDENTIALS:-$HOME/.config/mention-network/credentials}"
set -a; [ -f "$CREDS" ] && . "$CREDS"; set +a        # stored secrets into this shell, unechoed
node "$HERE/scripts/credentials.mjs" status          # masked: stored | env only | missing
node "$HERE/scripts/preflight.mjs"                   # per-lane: usable key? how many of the 40 na without one?
curl -s -o /dev/null -w '%{http_code}\n' "https://<shopDomain>/products.json?limit=250"
```

Run `credentials.mjs check` too when `status` shows a stored key you are about to spend on — it is
one cheap list call per provider and it turns "the grading failed after the page fetch" into "this
key was revoked, replace it before we start".

`preflight.mjs` is the run's one required, unskippable checkpoint: it answers, for the grading LLM
and off-store lanes, not just "is there a key" but "what does not having one cost" — how many of
the 40 criteria go `na`, and which of those are Critical/weight-3 (the ones that actually move the
verdict, not just the count). Read straight off the environment already sourced above, so it adds
no new probing of its own. Its output is what the Q1 confirm card's `Grading` / `Off-store` /
`Coverage` lines are built from, and it prints even under `yes` — the plan is never skipped, only
the confirm *question* is.

Alongside it, in the same batch:

- **Catalog** — `https://<shopDomain>/products.json?limit=250` gives `handle`, `title`, `vendor`,
  `product_type`, `variants[0].price`, `images[0].src` for every product. The PDP URL is
  `https://<shopDomain>/products/<handle>`. This is the reliable source; the MCP is optional here.
- **MCP** — `get_shop({shopDomain})` gives the shop name / `primaryLocale` / country for the
  confirm card, and `list_visibility_checks` tells you whether a Phase-1 report exists to pair
  with (`report=`, P6) so the audit shows on the merchant's Website Audit home. **It does not by
  itself unlock `price-competitive`** — see `ARGUMENTS.md` for why and for the one path that
  does. The MCP is also how the finished audit gets **saved on the server** and turned into a
  hosted PDF (P6) — that is the *only* thing it does; it never drives the collecting, grading or
  scoring, all of which run on this machine either way (design contract §3).

  > **A missing `MENTION_NETWORK_KEY` never stops the run.** Check it here, alongside the other
  > two lanes, so its cost is on the table at Q1 too — but if `credentials.mjs status` says
  > `MENTION_NETWORK_KEY: missing`, that is a note for the confirm card, not a reason to end the
  > turn. P2 through P5 proceed exactly as if the key existed; `$RUN/audit.json` and
  > `$RUN/report.md` are the deliverable regardless of what P6 can later do with them.
  >
  > Since 2026-08-19 the production MCP
  > (`https://shopify-mcp.mention.network/api/v1/mcp`) accepts a request with **no**
  > `Authorization` header at all and serves it as principal `anonymous`
  > (`scripts/mcp-client.mjs` already omits the header instead of sending one — see its header
  > comment) — verified on prod for `tools/list` and `describe_check_grid`. Whether
  > `submit_byok_website_audit` (a *write*, storing an audit against a shop) is served the same
  > way anonymously is what P6 finds out when it runs, not something to promise here. What stays
  > true either way: a **wrong** key still gets `401` from the server, so a stale key is worse
  > than none — if a key IS stored, run `credentials.mjs check` on it before relying on it, same
  > as the LLM/SerpApi lanes.
  >
  > If there is genuinely no key and the user wants one, hand over the setup command — same shape
  > as every other lane, so the secret never enters this conversation:
  > ```bash
  > read -rs MENTION_NETWORK_KEY && export MENTION_NETWORK_KEY \
  >   && node "$HERE/scripts/credentials.mjs" save MENTION_NETWORK_KEY   # unset it when done
  > claude mcp add mention-network --transport http \
  >   https://shopify-mcp.mention.network/api/v1/mcp \
  >   --header "Authorization: Bearer ${MENTION_NETWORK_KEY}"     # then reload the session
  > ```
  >
  > That URL is **production** — the one this skill ships pointed at, and the one a
  > production `MENTION_NETWORK_KEY` is issued for. A developer working against a non-prod
  > backend sets `MENTION_NETWORK_MCP_URL` to the `-dev` host themselves (`scripts/mcp-client.mjs`
  > reads it) rather than editing this command; a key from one environment is **rejected** by the
  > other with `401 "Invalid internal API key"`, not silently accepted, so mixing them up
  > fails loud at the next call rather than producing a wrong audit.
  >
  > **Say this out loud when you hand over that second command:** unlike everything else here, it
  > puts the live key in a command-line argument, where another local user can read it out of
  > `ps` while it runs, and `claude mcp add` then writes it into its own config file. That is
  > `claude mcp add --header`'s interface, not a choice this skill makes — but design contract 5
  > promises keys never go through argv, and this is the one place that promise does not hold.
  >
  > A **stored key on its own is enough** to finish the run — `scripts/mcp-client.mjs` speaks the
  > same MCP over plain HTTP, so the host tools are a convenience, not a requirement.
  >
  > **Proceeding without a key is the user's choice, said out loud, not a fallback taken for
  > them** — but it no longer has to be said *before* anything else. It fits naturally at Q1
  > alongside the LLM/SerpApi keys (missing → note it on the card) or at Q2 if it is still missing
  > once the run is done (offer to set one up and submit now, or accept the local files as the
  > final result, same as `no-save`).

## P2 — Resolve the plan

- **Product** — the parsed `product=` matched against the catalog (handle or title substring), else
  the store's first/flagship product, offered as options at Q1. **Never audit a guessed URL** —
  confirm the PDP returns 200 in P3 before scoring.
- **Market + language** — parsed values, else inferred from the domain and `primaryLocale`. Language
  matters: it gates `reddit` / `trustpilot` and it is recorded in the report.
- **Grading route** — the first key the user actually has, in the order `anthropic` → `openai` →
  `gemini` (`pickRoute` in `scripts/llm.mjs` applies exactly this order). Grading needs no web
  search, so all three are fidelity-equivalent; the order is a tie-break, not a quality ranking,
  and the user overrides it with `llm=`.
- **Off-store route** — SerpApi when `SERPAPI_API_KEY` is stored, else none (and Q2 asks for one).
  There is no second route: SerpApi is the same source the backend uses, so the numbers line up,
  and it queries server-side with no account and no personalization.
- **Estimate** — count the criteria each available lane unlocks, the wall-clock (page fetch ~10s,
  grading 2 calls, off-store ~9 SerpApi searches), and the cost (a few cents of LLM tokens;
  SerpApi's free tier is ~100 searches/month, so one audit ≈ 9% of it).

## Q1 — The confirm card *(asking moment 1 of 2)*

One `AskUserQuestion`. Show the resolved plan as a compact block first, then the options.

```
Shop      kbeautyarabia.com  ·  AE  ·  Arabic
Product   Water Bank Aqua Facial 30ml   (/products/water-bank-aqua-facial-30ml)
Grading   Anthropic  ****a91f  (checked ok)   15 criteria
Off-store SerpApi    ****075c  (checked ok)   ~9 searches of your free 100
Save      Mention Network  ****9c2e  (checked ok)   auditId + hosted PDF
Page      plain fetch                         crawlable-text will be n/a
Coverage  36/40 scored · 2 n/a, 2 gated (Arabic) · ~2 min · ~$0.05 + 9 SerpApi searches
```

When a lane's key is missing, its row names what that lane is worth instead of the checked-ok
line — this is `preflight.mjs`'s output verbatim, not a paraphrase:

```
Grading   no key — 15 criteria go na (~38% of weight), incl. 4 Critical: specifications,
          faq-product, unique-description, answer-formatting
Save      no key — audit still runs; without one, submitting it at the end may be
          declined (or may not — the server now accepts unauthenticated calls; P6 finds out)
```

Compose the questions in this order, dropping from the bottom if you run out of room (max 4):

1. **Confirm** — *Run it (Recommended)* · *Change product* · *Change market or language*.
2. **Keys** — whenever at least one key is stored (LLM, SerpApi, **or `MENTION_NETWORK_KEY`**),
   show each one masked and offer *Keep these (Recommended)* · *Replace one* · *Remove one*. A key
   the user forgot they stored is a key that quietly decides which provider their money goes to,
   or where their audit ends up saved; showing it is cheaper than explaining it afterwards. Skip
   this question only when nothing is stored — then it is Q2's job.
3. **Grading route** — ask when more than one LLM key is available and the arguments did not pin
   one; show which is pre-selected and why.

Never choose a route silently for the user when a choice exists. The order in P2 decides what is
**pre-selected**, never what is used without asking. `auto` in the arguments is the only
instruction to take the pick unasked; `yes` skips the card but still prints the plan.

*`dry-run` stops here.*

## P3 — Fetch the page

Open the run directory first — every later step writes into `$RUN`, and an unset `$RUN` does not
stop anything, it writes the audit to `/` and fails with a confusing error much later:

```bash
RUN="$(node "$HERE/scripts/run-dir.mjs" --domain "<shopDomain>" --handle "<handle>")"
# add --resume to reuse the newest existing run for this store+product (see RECOVERY.md)
```

```bash
node "$HERE/scripts/fetch-pages.mjs" \
  --pdp-url "https://<shopDomain>/products/<handle>" --out "$RUN/pages.json"
```

It collects, in parallel: the pre-JS PDP HTML, `robots.txt` (+ `X-Robots-Tag`), the Shopify product
JSON (`<pdp>.json` → title, vendor, `body_html`, type, price, images), and the store-level pages
(About, Contact, refund/shipping/privacy/terms, with link discovery from the PDP footer). It prints
what it found — check `pageOk: true` before going on; a 404 means the handle is wrong (`RECOVERY.md`).

The run records `renderer: 'plain'` and `crawlable-text` scores **`na`** — deliberately, because
comparing the page against itself would hand out a free 100 on the one criterion that measures
JS-hidden content. If a rendered DOM already exists on disk, `--rendered-html "$RUN/rendered.html"`
will use it; do not go and capture one.

## P4 — Collect off-store, then grade

These two are **ordered, not parallel**. P4b's press filter reads
`offstore.press.candidates`, so P4a (off-store) has to have written `$RUN/offstore.json` — even
an all-`na` one, when there's no SerpApi key — before P4b (LLM grading) runs. Running them the
other way used to crash P4b with a bare `ENOENT` on a file P4a hadn't written yet; `analyze-llm.mjs`
now degrades a genuinely-missing offstore/meta file to "that lane did not run" instead of throwing,
but there is still no reason to race them — off-store has no dependency on the LLM step, so it
always goes first.

**P4a — the 7 off-store criteria:**

```bash
node "$HERE/scripts/collect-offstore.mjs" --brand "<shop name>" --domain "<shopDomain>" \
  --language <lang> --country <CC> --city "<city>" --product-title "<title>" \
  --product-type "<type>" --pages "$RUN/pages.json" --out "$RUN/offstore.json"
```

**Pass `--pages`.** It is how the store's own social profiles — harvested off the product page by
`fetch-pages.mjs` — reach the video count, so the brand's own YouTube channel is not counted as
third-party coverage. Leaving it off does not fail: it silently scores the store's own marketing
as earned mentions and `social-video-mentions` reads higher than the truth. `--own-social` still
takes a comma-separated list on top, for a profile the product page does not link to.

Anything the searches did not return stays `null` → that criterion is `na`. **Never fill a signal
that was not measured.** (Wikidata and Wikipedia are free APIs and need no key.) Read the printed
`collected: {...}` line, and the `failures` array `offstore.json` now carries alongside it: a
signal reading `false` because a search **errored** (bad key, timeout, quota) is a different
finding from one that ran and legitimately found nothing — `failures` names only the first kind.
Neither line was surfaced before this was fixed (a run whose searches all failed used to look
exactly like "this brand has no buzz"); `report.md` now prints a warning too when either is
non-empty.

**P4b — the 15 LLM-graded criteria** (four calls in parallel — content, voice, credibility and the
FAQ analysis — plus the press filter over P4a's candidates, when there are any):

```bash
node "$HERE/scripts/analyze-llm.mjs" --pages "$RUN/pages.json" --meta "$RUN/meta.json" \
  --offstore "$RUN/offstore.json" --route anthropic --out "$RUN/llm.json"
```

Omit `--route` to let `pickRoute` take the first key that is present. `--offstore` is optional
here the same way `--meta` is: a run with no SerpApi key never wrote one, and a missing file at
that path is now treated exactly like an omitted flag — the press filter just doesn't run, and
`press-and-lists` stays whatever P4a already left it (`na`, no key). The prompts are ported
verbatim from the backend; the bands are discrete (0/50/100/na) so two different models still land
on comparable numbers. **Do not grade the page yourself and hand-write `llm.json`** — that is the
one shortcut that silently decalibrates the whole report. A malformed band is dropped, not
coerced: that criterion goes `na`. `llm.json` carries a `failedBatches` array too — any of
`content` / `voice` / `credibility` / `faq` / `press` that threw and got caught rather than graded
— for the same reason as P4a's `failures`: read it before treating a thin-looking report as a
finding about the store rather than about the run.

## P5 — Score and write the prose

```bash
node "$HERE/scripts/score.mjs" --pages "$RUN/pages.json" --meta "$RUN/meta.json" \
  --llm "$RUN/llm.json" --offstore "$RUN/offstore.json" --narrative-route anthropic \
  --out "$RUN/audit.json" --md "$RUN/report.md"
```

Runs all 40 scorers, aggregates by global weight, then writes one diagnosis per criterion, one
takeaway per sub-group, one summary per factor and the closing verdict. Every line must survive the
deterministic guards (numbers traceable to the evidence, no fix-prescriptions on a failing
criterion, no numbers at all in the verdict) or it falls back to a template sentence — so a
hallucinating model degrades the copy, never the numbers. `--narrative-route none` skips the LLM
entirely and uses templates throughout; omitting it picks the first available key.

`meta.json` carries what the storefront cannot tell you. Write it before P4 — `analyze-llm.mjs`
reads it too:

```bash
cat > "$RUN/meta.json" <<'JSON'
{
  "shop": { "name": "K-Beauty Arabia", "primaryDomain": "kbeautyarabia.com", "storeUrl": "kbeautyarabia.com" },
  "product": { "currency": "AED" },
  "language": "ar",
  "location": { "country": "AE", "city": "Dubai" },
  "competitorPrices": []
}
JSON
```

Omitting it entirely does not fail the run and does not change a single score — but the shop's
display name comes from here, so the report heads a nameless store and every brand match in the
off-store lane works off whatever you typed into `--brand` instead.

Only what the storefront cannot tell you belongs here: the shop's display name (it drives every
brand match — Reddit, Trustpilot, Google, `brand-in-title`), the currency, the market, and —
**hand-entered, if a Phase-1 report exists** — `competitorPrices: [{ "amount": 24.5, "currency":
"AED" }, …]` read off its same-product mentions. This is the only way `price-competitive` scores
instead of going `na`, and there is no script that fetches or parses it for you: see `ARGUMENTS.md`
(`report=<reportId>`) for exactly why that field has to be typed in rather than pulled
automatically.

## P6 — Save it on the server and export the PDF

This step is the one place the run touches the network for anything other than reading — and the
only one a missing key can affect. Everything through P5 already produced a complete, scored,
readable audit on disk (`$RUN/audit.json`, `$RUN/report.md`); P6 tries to also put a copy on the
server, which is what gives you an `auditId`, a hosted PDF URL, and a report anyone with the link
can open. It still costs the backend nothing: it runs **no** scorer and **no** LLM, it only
validates, **re-computes every score with its own weights**, and re-runs the narrative guards over
the prose you supplied.

Run it whether or not `MENTION_NETWORK_KEY` is set — `submit-audit.mjs` calls out through
`mcp-client.mjs`, which omits the `Authorization` header when there is no key rather than refusing
to call at all (see the P1 MCP note). The server decides what an unauthenticated
`submit_byok_website_audit` gets: it may succeed as `anonymous`, or it may not — either outcome is
a normal result of this step, not a failure of the run. If it is declined, say so plainly and hand
over the local files; do not retry with a fabricated key, and do not treat the decline as reason to
throw away `audit.json`/`report.md`.

```bash
node "$HERE/scripts/submit-audit.mjs" --audit "$RUN/audit.json" --meta "$RUN/meta.json" \
  --out "$RUN/submitted.json"          # → { auditId, score, coverage, pdfUrl, narrativesReplaced }
```

It always dry-runs `validate_byok_website_audit` first (same rule set as the submit), so a bad
payload costs one round trip instead of a rejected submit. Then `submit_byok_website_audit`, then
`export_website_audit_pdf({auditId})` → the hosted URL. Options:

- `--validate-only` — check the payload without storing anything.
- `--report-id <uuid>` — pair the audit with a Phase-1 report (it then appears on the merchant's
  Website Audit home and reuses that report's subject). Without it the audit stands alone with the
  subject snapshot from `meta.json` — that is the normal case for a store that never ran Phase 1.
- `--no-pdf` — store it, skip the export.
- Re-running with the same `idempotencyKey` returns the first audit instead of creating a second.

**Two numbers to read out of the response.** `score` is the SERVER's re-computation: if it differs
from your local `audit.json`, this skill's framework has drifted from the backend's and the submit
is refused, not silently overwritten. `narrativesReplaced` counts the sentences the server's guards
threw away and replaced with a grounded template line — a couple is normal, a large number means
the narrative model is inventing numbers.

**Return the PDF URL and the headline immediately**: score, verdict tier, coverage (`N/40 scored`),
`measuredWeightPct`, and the top 3 priorities with their one-line diagnosis. Then say plainly what
was **not** measured and why — that list is part of the deliverable, not a footnote. The report
carries `source: byok` and the PDF prints a self-reported line; say so when you hand over the link.

**There is no local PDF.** The hosted export is the only renderer this skill has: the branded
template, its fonts and its logos live on the backend, not in this directory. A run that cannot
submit produces `audit.json` and `report.md` and nothing else — say that plainly rather than
implying a document is coming. A local `auditId: local-…` is the tell that the audit never reached
the server.

## Q2 — Close the gaps *(asking moment 2 of 2)*

Only if a key was missing — any of the three, including `MENTION_NETWORK_KEY`. State the coverage
you got, name what each missing key would add, and offer:

1. **Set it up now (Recommended)** — the cheapest concrete path: a free SerpApi key (~100
   searches/month, covers ~10 audits) for off-store; any one of the three LLM keys for grading; a
   `MENTION_NETWORK_KEY` to save the finished audit and get a hosted PDF link. Hand over the
   `read -rs …` one-liner from *Credentials*, then re-run only the missing step — off-store or
   grading re-run and re-score (the page fetch is already on disk); a late `MENTION_NETWORK_KEY`
   just means running P6 now, on the `audit.json` that already exists.
2. **Replace a rejected key** — when `credentials.mjs check` came back `REJECTED`, this is the fix,
   and it is a different situation from having no key at all. Say which provider refused it.
3. **Ship as is** — allowed as an explicit, informed choice, and the two gaps are not the same
   thing: a missing LLM/SerpApi key means the report says `N/40 scored` and lists every skipped
   criterion with its reason (fewer criteria measured); a missing `MENTION_NETWORK_KEY` means the
   audit was fully measured and scored but stays local-only — no `auditId`, no shareable link. Say
   which one applies, not just "N/40" for both.

After any setup, re-run the step and re-state coverage (or re-run P6) before delivering again.

## Gate

- [ ] P1 ran **before** any question: credential store loaded, keys probed (all three —
      LLM/SerpApi/`MENTION_NETWORK_KEY`), `preflight.mjs` run for the lane-impact numbers, catalog
      fetched.
- [ ] The user was asked **at most twice** (Q1 / Q2), each with pre-filled options.
- [ ] The **confirm card was shown** with shop, product + PDP path, market, language, the grading
      route, the off-store key, the save/MCP key, and the coverage/time/cost estimate — unless the
      invocation carried `yes`.
- [ ] Stored keys were shown masked at Q1 with keep / replace / remove offered.
- [ ] **No missing key stopped P2 through P5.** A missing `MENTION_NETWORK_KEY` changed nothing
      about the run itself — it is not a gate before collection, grading or scoring.
- [ ] The PDP fetch returned `pageOk: true`; nothing was scored against a 404 or a guessed URL.
- [ ] Bands came from `analyze-llm.mjs`; no score, band or off-store signal was hand-written.
- [ ] Every criterion with no data is `na`/`gated` **with a reason** — none was scored 0 to fill a gap.
- [ ] The delivered headline states coverage (`N/40`) and names what was not measured — and names
      it separately from whether the audit was saved (missing LLM/SerpApi ≠ missing
      `MENTION_NETWORK_KEY`; see Q2).
- [ ] P6 (`submit-audit.mjs`) **ran regardless of whether `MENTION_NETWORK_KEY` was present** — a
      missing key changes what the server does with the call, not whether this skill makes it, unless
      the user chose `no-save`.
- [ ] If the audit was **submitted**: `submitted.json` exists, the server's re-computed score
      matched the local one, and the **hosted PDF URL** was returned.
- [ ] If it was **not** submitted (declined by the server, or `no-save`), `audit.json` and
      `report.md` were still delivered as a complete result, and the handover says plainly that the
      result is local-only and has no shareable link — never a silent, unexplained gap.
- [ ] `source: byok` was disclosed alongside the PDF (when there is one) — the numbers are
      self-reported.
- [ ] No secret was echoed, repeated back, or written inside this skill directory; any new one was
      saved through `credentials.mjs`.

## Where this came from

Ported on 2026-08-14 from the Mention Network agent pack, which lives in a **private** repo —
deliberately not named here, along with its paths and commit: this repository is public, and a
public repo naming a private one's internals discloses them to everyone who can install the
skill. Whoever maintains the pack knows which copy this is; the coordinates are recorded in the
pull request that added it.

The pack's copy is the one kept in step with the backend scorers by that repo's own parity and
drift tests. **This copy is not covered by those tests**, so a scorer changed there does not fail
anything here.

Two differences are deliberate, not drift:

- **Key-only.** The subscription lanes (Claude Agent SDK, `claude -p`, `codex exec`) and the
  signed-out Playwright lanes were dropped, and an `anthropic` API route was added in their place.
- **No local renderer.** The bundled Chrome/Mustache PDF renderer was dropped; the hosted export
  is the only one.

A third difference is local: the store's own social profiles are discovered from the product page
rather than typed in (see P4a), because forgetting them inflates `social-video-mentions`.

Anything else that differs from the source is a bug in this copy. When re-porting, take the
scorers, `framework.mjs` and the prompt text verbatim — the wording *is* the calibration, and the
server re-computes every score against its own weights, so a drifted scorer here shows up as a
refused submit rather than a wrong number.

## Fix bugs in this copy

This skill was vendored from an internal repository and has since diverged from it, in both
directions. Work has landed here that exists nowhere else — `d7b6a79` changed the client to stop
refusing a call the MCP server is willing to serve — so re-vendoring from upstream would silently
drop it.

The registry record points at this repository, so the published index and every CI gate read THIS
copy. A fix landed upstream changes nothing here until somebody carries it across by hand, and a
fix landed here never travels back on its own.

Fix bugs here. The exception is anything the backend itself owns — server-side strings, guards,
API behaviour — which lives upstream and reaches this skill only as text quoting it.
