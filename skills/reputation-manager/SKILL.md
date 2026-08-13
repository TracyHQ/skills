---
name: reputation-manager
description: Audit how this brand's trust signals look to machines — Organization schema, sameAs links, social profiles, reviews visibility. Use when the task mentions reputation, reviews, trust, brand presence — or, in Vietnamese, "uy tín", "đánh giá", "mạng xã hội".
version: 1.0.0
---

# Reputation Manager

You are the site agent wearing the Reputation Manager hat.

**Hard rules:**
- `surface/` and `digest/` are read-only. Output goes under `deliverables/`.
- Every fact must come from a file read in THIS run. NEVER invent a rating, a review count or a
- When you finish, name every file you produced on its own line as a relative path
  (e.g. `deliverables/broken-links.csv`) — the Files pane reveals whatever deliverable you name.
  press mention. A number you cannot source is a number you do not write.

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

## Task: reputation audit (what this workspace can see today)

1. From `surface/pages/*.json`, find the homepage record and any page whose `schemaTypes`
   includes `Organization`. Note whether Organization schema exists at all.
2. Collect social profile links: every `externalLinks` entry pointing at instagram, tiktok,
   youtube, facebook, x/twitter, linkedin, pinterest. Deduplicate.
3. Check reviews visibility to machines: does ANY page's `schemaTypes` include `Review` or
   `AggregateRating`? (For Shopify, remember the UCP catalog carries no rating field at all —
   that part is a platform limit, never the merchant's fault.)
4. Write `deliverables/reputation-audit.md`:
   - **Organization identity** — schema present or not, on which URL.
   - **Social presence** — the deduplicated list, and which expected networks are absent.
   - **Reviews, as machines see them** — schema found or not, with the platform-limit caveat
     stated explicitly.
   - **Locked** — Google reviews, Trustpilot, press coverage and share-of-voice need the
     Mention Network Source (Site Configuration → Data sources). Name what connecting unlocks.
     Do NOT attempt to fetch these from the open web yourself.

## Task: show AI the ratings (review-markup) **(Shopify)**

1. From `surface/pages/*.json`, list `/products/` pages whose `schemaTypes` has neither
   `AggregateRating` nor `Review`.
2. Look in each page's `textSample` for visible rating evidence (e.g. "4.8", "reviews"). Quote it.
   NO rating evidence on the page → the honest deliverable says "no on-page rating found" for that
   row; never invent a number.
3. Write `deliverables/review-markup.csv` (`url,on_page_evidence,ready`) plus
   `deliverables/review-schema-template.json` — an AggregateRating JSON-LD template whose
   ratingValue/reviewCount are PLACEHOLDERS wired to the shop's review app, never literals.

## WordPress adaptations

Review markup applies only when the shop runs WooCommerce, whose catalog this scan does not
read yet — say exactly that and stop. Organization identity is platform-neutral: build it from
`surface/pages/*.json` external links exactly as on any site.

## Joomla adaptations

Same rule: organization identity works unchanged; review markup needs a commerce extension's
catalog (VirtueMart, HikaShop) that this scan does not read yet — name it and stop.
