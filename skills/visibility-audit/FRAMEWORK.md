# The framework — what the 40 criteria measure

Reference while running the skill: what a criterion asks, which lane produces its data, and how
much it moves the score. All of it is encoded in `scripts/framework.mjs`, hand-ported from the
backend's `framework.constants.ts`. The test that pins them lives in the source pack, not in
this copy — see SKILL.md, *Where this came from*.

## How the score is built

- Every criterion carries a **label weight** (1 / 2 / 3) inside its factor.
- Its **global weight** = the factor's budget × (its label ÷ the sum of labels in that factor).
  The 40 global weights sum to 100, and the percentages in the tables below are those weights.
- Every score — criterion, sub-group, factor, total — is the **weighted mean over the criteria that
  were actually scored**. `na` and `gated` leave the denominator; they are not zeros. That is why a
  partial run still produces a meaningful number, and why coverage (`N/40`) has to be shown next to it.
- Bands are discrete: script scorers return 0 / 25 / 50 / 75 / 100 by rule, LLM criteria return
  0 / 50 / 100. Nothing is rounded until the report is written.

## Statuses

| Status | Means | Example |
|---|---|---|
| `scored` | measured, with evidence | `product-schema` found price + currency + availability |
| `na` | no data for this store, this run | no SerpApi key, so `reddit` was never searched |
| `gated` | deliberately not measured for this market | `trustpilot` on a non-English market |
| `inactive` | no scorer at all (never happens here — all 40 are implemented) | — |

## The lanes

| Lane | Where the data comes from |
|---|---|
| **page** | the PDP, `robots.txt`, the store pages and the product JSON — a plain fetch |
| **capture** | a rendered post-JS DOM, if one was passed in with `--rendered-html` |
| **LLM** | a band from the grading prompts (`analyze-llm.mjs`) |
| **page + LLM** | a script signal combined with a band; the script half still scores alone |
| **off-store** | SerpApi searches |
| **phase-1** | competitor prices carried over from a visibility report |

## Discoverability — 28% of the total

> The entry gate. If AI can't crawl and read this page, nothing else about your store counts.

| Criterion | Sub-group | Weight | Impact | Lane | What it asks |
|---|---|---|---|---|---|
| `ai-bots-allowed` · AI crawler access | Access & Findability | 3 (~2.8%) | Critical | page | Are AI crawlers allowed to reach this page? |
| `google-merchant-feed` · Google Shopping listing | Access & Findability | 3 (~2.8%) | Critical | off-store | Is it live and approved on Google Shopping? |
| `internal-linking` · Internal links | Access & Findability | 1 (~0.9%) | Medium | page | Is this page linked from other pages in your store? |
| `crawlable-text` · AI-readable text | Content Readability | 2 (~1.9%) | High | capture | Is your text readable by AI, not just human visitors? |
| `image-alt-text` · Image descriptions | Content Readability | 1 (~0.9%) | Medium | page | Can AI understand what's in your images? |
| `heading-hierarchy` · Heading structure | Content Readability | 1 (~0.9%) | Medium | page | Can AI follow how your page is organized? |
| `brand-in-title` · Brand in title | Content Readability | 3 (~2.8%) | Critical | page | Can AI tell which brand you sell from your title? |
| `product-schema` · Product schema | Machine Readability | 3 (~2.8%) | Critical | page | Does AI get your product's core facts? |
| `product-schema-rich` · Product identity | Machine Readability | 2 (~1.9%) | High | page | Is your exact product identifiable to AI? |
| `review-schema` · Review schema | Machine Readability | 2 (~1.9%) | High | page | Is your rating visible to AI? |
| `shipping-schema` · Shipping schema | Machine Readability | 2 (~1.9%) | High | page | Is your shipping info visible to AI? |
| `faq-schema` · FAQ schema | Machine Readability | 2 (~1.9%) | High | page | Is your FAQ readable to AI? |
| `organization-schema` · Organization schema | Machine Readability | 3 (~2.8%) | Critical | page | Is your brand information clear to AI? |
| `breadcrumb-schema` · Breadcrumb schema | Machine Readability | 1 (~0.9%) | Medium | page | Is your product's category path clear to AI? |
| `video-schema` · Video schema | Machine Readability | 1 (~0.9%) | Medium | page | Are your product videos readable to AI? |

## Content Quality — 30% of the total

> AI can only recommend what it can quote. Thin or copied content gives it nothing to pull.

| Criterion | Sub-group | Weight | Impact | Lane | What it asks |
|---|---|---|---|---|---|
| `specifications` · Product Specifications | Product facts | 3 (~3.5%) | Critical | LLM | Does your page list specific specs with real numbers and units? |
| `original-media` · Product media | Product facts | 1 (~1.2%) | Medium | page | Does your product have enough photos and a video AI can read? |
| `compatibility-sizing` · Fit & compatibility | Product facts | 2 (~2.3%) | High | LLM | Does your page show if the product fits the buyer's size or device? |
| `safety-materials` · Safety & ingredients | Product facts | 2 (~2.3%) | High | LLM | Does your page show safety certs and a full ingredient list? |
| `benefits-outcomes` · Customer benefits | Decision support | 2 (~2.3%) | High | LLM | Does your copy explain the benefits buyers get, not just features? |
| `limitations-honest` · Honest limitations | Decision support | 1 (~1.2%) | Medium | LLM | Does your page admit any honest limitations, not just all-positives? |
| `comparison-alternatives` · Product comparison | Decision support | 2 (~2.3%) | High | LLM | Does your page compare the product to other options with a clear verdict? |
| `who-is-it-for` · Ideal buyer & uses | Decision support | 2 (~2.3%) | High | LLM | Does your page name who the product is for and when to use it? |
| `faq-product` · Product FAQ | Questions answered | 3 (~3.5%) | Critical | LLM | Does your FAQ answer real buyer questions with complete answers? |
| `troubleshooting-care` · Owner's guide | Questions answered | 1 (~1.2%) | Medium | LLM | Does your page help owners care for, fix, and maintain the product? |
| `unique-description` · Content originality | AI-readiness | 3 (~3.5%) | Critical | LLM | Is your description in your own words, not copied from the manufacturer? |
| `freshness` · Content freshness | AI-readiness | 1 (~1.2%) | Medium | page | Does your page show AI a recent update date it can read? |
| `answer-formatting` · AI-ready formatting | AI-readiness | 3 (~3.5%) | Critical | page + LLM | Is your content broken into short chunks and tables AI can lift? |

## Entity & Trust — 30% of the total

> AI won't vouch for a store it can't verify. Reviews and mentions are the proof it checks.

| Criterion | Sub-group | Weight | Impact | Lane | What it asks |
|---|---|---|---|---|---|
| `about-page` · Brand story | Business credibility | 1 (~1.6%) | Medium | LLM | Does your About page tell AI a real story of who you are, your mission, and the people behind the store? |
| `contact-info` · Contact details | Business credibility | 2 (~3.2%) | High | page | Can AI confirm your store is a real, reachable business with genuine contact details? |
| `policies-quality` · Store policies | Business credibility | 2 (~3.2%) | High | page + LLM | Can AI find clear, specific policies for returns, shipping, and refunds on your store? |
| `onsite-reviews` · Customer proof | Business credibility | 1 (~1.6%) | Medium | page + LLM | Does your store show real customer reviews and named testimonials AI can read on the page? |
| `google-reviews` · Google reviews | Reviews & buzz | 2 (~3.2%) | High | off-store | Does your store have a Google Business Profile with strong, recent reviews AI can cite? |
| `trustpilot` · Trustpilot rating | Reviews & buzz | 2 (~3.2%) | High | off-store | Does your store have a Trustpilot profile with a healthy score AI can cite? |
| `reddit` · Reddit mentions | Reviews & buzz | 3 (~4.7%) | Critical | off-store | Is your brand talked about across Reddit threads that AI reads? |
| `social-video-mentions` · Video mentions | Reviews & buzz | 2 (~3.2%) | High | off-store | Are other people posting videos about your brand on YouTube, TikTok, and Instagram? |
| `press-and-lists` · Press & best-of coverage | Authority & recognition | 3 (~4.7%) | Critical | off-store | Do trusted publications and 'best of' lists feature your store where AI can find them? |
| `entity-databases` · Trusted databases | Authority & recognition | 1 (~1.6%) | Medium | off-store | Do authoritative databases like Wikipedia, Wikidata, and Crunchbase recognize your brand as a real entity? |

## Merchant — 12% of the total

> Shoppers ask AI for the best deal. Lagging on price or shipping gives it a reason to skip you.

| Criterion | Sub-group | Weight | Impact | Lane | What it asks |
|---|---|---|---|---|---|
| `price-competitive` · Price competitiveness | Reseller levers | 2 (~8%) | High | phase-1 | Is your price in line with rivals selling the same product? |
| `shipping-competitive` · Shipping competitiveness | Reseller levers | 1 (~4%) | Medium | LLM | Do you offer competitive or free shipping buyers can see? |


---

## What the content batch actually reads

The 11 LLM criteria above grade **three labelled sections**, not one description field: `## PRODUCT
TEXT` (what the merchant wrote — `meta.json` first, then the storefront product JSON),
`## FAQ` (Q&A lifted from the page's FAQPage structured data) and `## PAGE CONTENT` (the rendered
page with header/nav/footer, Shopify `shopify-section-*` chrome and repeated theme labels stripped —
where spec tables, ingredients, how-to-use and schema-less FAQ accordions live). An empty section is
omitted entirely: printing a `(none)` placeholder taught the model to treat that section as the only
valid source and ignore the same content sitting elsewhere.

Two criteria are graded by a SEPARATE call whose prompt carries only the merchant's copy —
`unique-description` and `answer-formatting` measure the shop's own voice and formatting, which
machine-extracted page text cannot evidence. Asking the model to ignore the other sections was
tried and measured: it moved bands anyway, so the sources are withheld instead. Backend ADR:
`docs/adr/0042-audit-content-three-sources.md`.

## Deliberate deviations from the backend

The scorers are ports, not rewrites. Three things differ on purpose, and all three are visible in
the report rather than hidden in a number:

1. **`crawlable-text` is `na` without a post-JS capture.** The backend renders the page (Cloudflare,
   then Firecrawl) and compares post-JS text against pre-JS text; when its whole render chain fails
   it compares the page against itself and scores ~100. Client-side that fallback is the *common*
   case, so the same code would hand out a free pass on the one criterion that measures JS-hidden
   content. Pass a saved rendered DOM with `--rendered-html` to score it for real; this skill
   does not go and capture one, because every lane it has is an API key.
2. **Without a capture, every on-page signal is read pre-JS — not just that one.** `crawlable-text`
   is the criterion that goes `na`, but it is not the only one affected. With `renderer: plain` the
   "rendered" HTML *is* the raw HTML, so seven more criteria grade the pre-JS page where the backend
   grades the post-JS DOM: `internal-linking`, `image-alt-text`, `heading-hierarchy`, `video-schema`,
   `original-media`, `freshness`, `contact-info`. On a server-rendered Shopify theme the two are the
   same page and nothing changes. On a theme that builds its content in the browser they are not,
   and those seven can read lower here than on a backend run — a different page, not a different
   scorer. `dataSources.renderer` records which happened, and `report.md` says it in words when the
   run was un-rendered. Pass `--rendered-html` to remove the difference entirely.
3. **`price-competitive` needs prices you carry in.** The backend reads competitor prices out of the
   Phase-1 mentions table. This skill has no database, so unless `meta.json` carries
   `competitorPrices`, the criterion is `na` — never a guess from the storefront.

Everything else — the bands, the thresholds, the curves (`reddit` 12.5·√n, `press` 45·√n, `video`
7·Σ√n), the gating rules, the aggregation, the narrative guards — is the backend's logic, ported
line for line and pinned by two tests that fail for different reasons:
In the source pack, a drift test catches the framework moving (a re-weighted criterion) and a
parity test runs both implementations over the same page and catches the
scorers disagreeing about it while the weights sit still.

## Reading the evidence

Every criterion carries an `evidence` object: exactly what the scorer saw. It is what the diagnosis
must be grounded in (a number in the prose that is not derivable from the evidence is rejected and
replaced by a template sentence), and it is the first thing to read when a score surprises you —
for example `policies-quality: 0` with `placeholder: true` means the store's refund page still has
Shopify's `[bracketed]` template text in it, which is a real finding, not a bug.
