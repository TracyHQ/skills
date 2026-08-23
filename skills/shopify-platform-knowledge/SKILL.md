---
name: shopify-platform-knowledge
description: >-
  What every agent working on a Shopify store should know before touching anything — what being
  SaaS changes (no server, no core files, no PHP), the theme/app/metafield taxonomy, how products
  and collections actually work, Online Store 2.0 sections and templates, and the traps that bite
  on real merchant stores. Reference knowledge, not a procedure. Loaded automatically for Shopify
  sites.
version: 1.0.0
platforms: shopify
provenOn: —
---

# Shopify, for the agent who works on one

This is the platform pack (ADR 0009): knowledge shared by every Shopify store, curated once,
versioned here. Store-specific facts — this store's theme, apps, catalog size — are NOT here;
they live in the site folder (`TracyWork/agents/surface/stack.json`, `inventory.json`,
`surface/products/catalog.json`, `TracyWork/agents/digest/`) and in tool answers, and only
those may be quoted as facts about the store.

## SaaS changes the ground rules

- There is **no server to reason about**: no PHP version, no webroot, no `.htaccess`, no file
  system beyond the theme. Shopify runs the platform; the merchant rents it.
- The public storefront is rendered from **Liquid** templates; interactivity increasingly comes
  from app embeds and the merchant's theme settings, not custom server code.
- Checkout is Shopify's own — not themeable except on Plus, and never editable from outside.
  A "change the checkout" request on a non-Plus store is a settings/app conversation.
- **Tracy's write half for Shopify is not built yet**: the Apply door answers
  `PLATFORM_WRITE_NOT_BUILT`. Work in reads, analysis, and Deliverables a person applies by
  hand in the admin — never promise a direct write.

## The taxonomy — one word each

- **Theme** — the store's dress, one **published** at a time plus unpublished copies. Edits go
  to a duplicate first; publishing swaps atomically.
- **App** — installed functionality. Front-of-store presence comes as **app embeds** (toggled in
  theme settings), **app blocks** (placed in sections), or **script tags** (legacy, slow). An
  uninstalled app can leave dead code the theme still references.
- **Metafield / metaobject** — structured custom data on products, variants, collections, pages
  and the shop itself, namespaced (`app--<id>--…` for apps). This is where "extra fields" live.
- **Section / block / template** — Online Store 2.0's units, below.

## Catalog model

- **Product → variants**: up to three option axes combine into variants; each variant owns its
  own price, SKU and inventory. "Change the price" is a variant question, not a product one.
- **Collections**: **smart** (rule-driven — membership changes by itself when products change)
  vs **manual** (curated). Editing a smart collection means editing its rules.
- Inventory is per **location**; a quantity without a location is ambiguous.
- Content beyond the catalog: **pages**, **blogs/articles**, and **navigation** menus — all
  admin-owned, all reachable read-only from outside via the storefront.

## Online Store 2.0 themes

- A page is a **JSON template** naming **sections**; sections hold **blocks**; the merchant
  arranges all of it in the theme editor, and those arrangements save into the theme's JSON
  (`templates/*.json`, `config/settings_data.json`) — not into code files.
- Consequence: two copies of "the same theme" differ by their JSON. Replacing theme files while
  keeping a merchant's customizations means carrying `settings_data.json` and the JSON
  templates forward deliberately.
- Liquid sections live in `sections/`, snippets in `snippets/`; `theme.liquid` is the layout
  shell every page passes through.

## Where configuration lives

- Everything is **admin settings**: store details, payments, shipping, markets, taxes. There is
  no config file to read — the only outside views are what the storefront serves and what an
  API scope grants.
- Storefront reads used by the crawl: `/products.json`, `/collections.json`, sitemap — public,
  capped, and the basis of `surface/products/catalog.json`.

## Rules of engagement on a Tracy store

- **Reads are the work today**: catalog analysis, SEO findings, content drafts, theme
  recommendations — shaped as Deliverables under `TracyWork/deliverables/`, applied by a person
  in the admin. Say so plainly when a task expects a direct write.
- **State facts come from the store's data**: `stack.json`, `inventory.json`,
  `catalog.json` first, tool answers second, memory never.

## Traps seen on real merchant stores

- **Theme updates do not merge**: a theme vendor's new version is a NEW theme; the merchant's
  section arrangements and settings must be redone or migrated. Never assume an update is safe.
- **App residue**: uninstalling an app does not clean the theme — leftover snippets and script
  tags keep loading or break silently. The inventory's app list vs the theme's references is
  the audit.
- **Smart collections shift underfoot**: a product edit can silently move products between
  collections and change what a page shows; "the page changed by itself" often traces here.
- **Markets and currencies**: one store can present many prices; a price quoted without a
  market/currency is not a fact.
- **Draft vs published**: products, pages and themes all have unpublished states — the admin
  view and the storefront view legitimately disagree.
- **Storefront rate limits**: the public JSON endpoints are capped and paginated (250/page);
  partial reads must say they are partial.
