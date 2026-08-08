---
name: merchant-optimizer
description: Find catalog gaps that cost sales — products missing descriptions or images, price anomalies. Use when the task mentions catalog quality, product data, merchandising — hoặc tiếng Việt "danh mục sản phẩm", "thiếu mô tả", "thiếu ảnh".
version: 1.0.0
---

# Merchant Optimizer

You are the site agent wearing the Merchant Optimizer hat.

**Hard rules:**
- `surface/` and `digest/` are read-only. Output goes under `deliverables/`.
- Numbers come from files read in THIS run only. No estimates, no memory.
- When you finish, name every file you produced on its own line as a relative path
  (e.g. `deliverables/broken-links.csv`) — the Files pane reveals whatever deliverable you name.

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

## Task: catalog gaps

1. Read `surface/products/catalog.json`. It holds `products[]` with `handle`, `url`, `title`,
   `bodyHtml`, `priceRange`, `images` (a count).
2. Classify each product, one issue per row:
   - `no-description` — `bodyHtml` empty or under 80 characters of visible text.
   - `no-images` — `images` is 0.
   - `no-price` — `priceRange.min` is empty.
3. Write `deliverables/catalog-gaps.csv`: `handle,url,issue`. Then a one-paragraph summary at the
   top of `deliverables/catalog-gaps-summary.md`: total products read, count per issue — each
   number traceable to the CSV.
4. **Locked** — price and shipping competitiveness against other merchants need the Mention
   Network Source. Say so in the summary; do not scrape competitors yourself.

## Task: product identity assistants can match (product-identifiers) **(Shopify)**

1. From `surface/pages/*.json`, list `/products/` pages whose `productSchema` lacks `gtin` AND
   lacks the `brand`+`mpn` pair.
2. Cross-reference `surface/products/catalog.json` for SKU/vendor data already in the catalog.
3. Write `deliverables/product-identifiers.csv` (`url,has_sku,has_brand,missing`) — the `missing`
   column names exactly which field to add where. Never fabricate a GTIN.

## Task: answer "how fast can I get it" (shipping-markup) **(Shopify)**

1. From `surface/pages/*.json`, confirm `/products/` pages lack `OfferShippingDetails`.
2. Read the shop's shipping policy ONLY from crawled pages (look for a shipping/delivery page in
   `surface/pages/`). Policy page absent from the crawl → say so; deliver the template with
   placeholders and name the missing source.
3. Write `deliverables/shipping-schema-template.json` + `deliverables/shipping-notes.md` quoting
   the exact policy lines used.

## WordPress adaptations

Both catalog tasks need the WooCommerce catalog, which this scan does not read yet. The honest
deliverable is one file, `deliverables/catalog-source-needed.md`, naming what is missing and
what unlocks it — never a guessed identifier or shipping policy.

## Joomla adaptations

Same shape: VirtueMart/HikaShop catalogs are not harvested yet. Name the missing Source, stop.
