---
name: content-strategist
description: >-
  Draft the missing meta descriptions, page titles, or rewrite thin and duplicated copy for this
  site. Use when the task asks to write or improve wording that visitors and search engines
  read: meta descriptions, page titles, intros, product blurbs, or headings that repeat each
  other.
version: 1.0.0
provenOn: —
---

# Content Strategist

You are the site agent wearing the Content Strategist hat. One agent, one workspace — this skill
is a procedure, not a persona.

**Hard rules, before anything:**
- `surface/` and `digest/` are a read-only mirror of the live site. NEVER write into them.
- Every output goes under `deliverables/`. It is a draft for a human to review and apply.
- Every number you state must come from a file you read in THIS run. If a file is missing, say
  "scan needed" and stop — never reuse remembered numbers, never invent.

## Platform first — before any task

Read `digest/SITE-BRIEF.md` and note the site's platform. Procedures below marked **(Shopify)**
lean on Shopify's public catalog (`surface/products/catalog.json`, `/products/` URLs,
`/collections/`). On **WordPress** or **Joomla**:

- Page-level tasks (meta descriptions, titles, alt text, headings, broken links, FAQ,
  organization identity) work unchanged — they read `surface/pages/*.json`, which every
  platform has.
- Catalog-level tasks (product schema, identifiers, reviews, shipping, breadcrumbs-by-collection)
  assume a commerce catalog the crawl has NOT harvested for these platforms yet. Say exactly
  that — "this task needs the WooCommerce/VirtueMart catalog, which this scan does not read
  yet" — and stop. A guessed procedure for the wrong CMS is worse than no deliverable.

## Task: draft the missing meta descriptions

1. Read `digest/SITE-BRIEF.md` for what the shop sells. Two sentences of context is enough.

2. List EVERY page missing a meta description — the findings file caps its URL samples at 20, so
   derive the full list yourself:

   ```bash
   node -e '
   const fs=require("fs");const d="surface/pages/";
   for(const f of fs.readdirSync(d)){const p=JSON.parse(fs.readFileSync(d+f));
   if(!p.metaDescription&&!p.redirectStub)console.log(JSON.stringify({url:p.url,title:p.title||"",sample:(p.textSample||"").slice(0,300)}))}'
   ```

3. Draft one meta description per page. Rules for each line:
   - ≤ 155 characters, complete sentence, fact first, marketing last.
   - Built ONLY from that page's own `title` and `sample`. No claims, prices or superlatives
     that are not in the sample.
   - Unique across the set — no template with the name swapped.
   - Brand name at most once.

4. Write `deliverables/meta-descriptions.csv` with header `url,page_title,draft_meta_description`.
   Quote every field with `"`. One row per page from step 2 — no more, no fewer.

5. Verify and report: `wc -l` on the CSV minus header MUST equal the count from step 2. End your
   report by naming the file on its own line, exactly as a relative path —
   `deliverables/meta-descriptions.csv` — the Files pane reveals whatever deliverable you name.
   Then: "N drafted from N pages missing one. Review, then import — applying stays in your hands."

## Task: draft the missing page titles

Same procedure; filter `!p.title` in step 2; output `deliverables/page-titles.csv` with header
`url,draft_title`; each title ≤ 60 chars, names what the page sells, brand suffix optional.

## Task: describe images to AI (alt-text)

1. From `surface/pages/*.json`, collect images whose `alt` is empty, a filename, shorter than
   4 words, longer than 125 chars, or duplicated on its page.
2. Draft alt text FROM THE PAGE'S OWN CONTENT (title, h1, product name) — describe what the image
   shows for that product, 4–15 words. Write `deliverables/alt-text.csv` (`page,src,current_alt,drafted_alt`).

## Task: quotable answers (faq-content)

1. From `surface/pages/*.json`, pick `/products/` pages lacking `FAQPage` in `schemaTypes`.
2. Draft 3–5 Q&A per template FROM facts in the page's `textSample` and `digest/` only.
3. Write `deliverables/faq/` — one `faq-markup.json` (JSON-LD FAQPage template) plus `questions.md`.

## Task: brand in titles (brand-titles) **(Shopify)**

1. From `surface/pages/*.json`, list `/products/` pages whose `title` does not contain the brand.
2. Write `deliverables/brand-titles.csv` (`url,current_title,drafted_title`) — keep the original
   wording, append/prefix the brand naturally, ≤60 chars where possible.

## Task: straighten the outline (heading-structure)

1. From `surface/pages/*.json`, list pages with `h1` count ≠ 1 or a heading level jump > 1
   (read the `headings` array in order).
2. Write `deliverables/heading-fixes.csv` (`url,problem,suggested_fix`) — the fix names which
   heading to change to what level, drawn from the page's own headings.

## WordPress adaptations

The crawl reads the open WP REST API into `surface/content.json` — one entry per post/page with
`kind`, `url`, `title`, `excerpt`, `modified`. Use it:

- **Meta descriptions**: draft from the item's own `excerpt` (it is the author's own summary);
  fall back to the page's `textSample`. Match finding URLs to items by `url`.
- **Page titles**: the item's `title` is the CMS-side name — a page missing a `<title>` usually
  has one here; propose it instead of inventing.
- FAQ, alt text, headings: unchanged — they read `surface/pages/*.json`.

## Joomla adaptations

No structured content feed is harvested yet — every draft comes from `surface/pages/*.json`
(`textSample`, `headings`). Say so in the deliverable when the sample is too thin to draft from
honestly.
