---
name: wordpress-platform-knowledge
description: >-
  What every agent working on a WordPress site should know before touching anything — the release
  model, the plugin/theme taxonomy and where each kind lives, how content and meta shape the
  database, block themes versus classic themes, and the traps that bite on real client sites.
  Reference knowledge, not a procedure. Loaded automatically for WordPress sites.
version: 1.0.0
platforms: wordpress, woocommerce
provenOn: —
---

# WordPress, for the agent who works on one

This is the platform pack (ADR 0009): knowledge shared by every WordPress site, curated once,
versioned here. Site-specific facts — this site's version, theme, installed plugins — are NOT
here; they live in the site folder (`TracyWork/agents/surface/stack.json`, `inventory.json`,
`TracyWork/agents/digest/`) and in tool answers, and only those may be quoted as facts about
the site.

## Versions

- WordPress ships continuously — majors like 6.x arrive several times a year and minors
  auto-update by default. A site pinned years behind is a choice somebody made (or a broken
  auto-update), and the reason matters before any upgrade talk.
- PHP is the floor that actually breaks things: modern WordPress wants PHP 7.4+ and runs best
  on 8.x, but old plugins are what fail on a PHP bump — not core.
- Never infer versions from looks. Read `stack.json` (the cowork plugin's `info` answer is the
  verified source) or a tool result.

## The taxonomy — one word each

- **Plugin** — functionality, in `wp-content/plugins/<slug>/`; active list is the
  `active_plugins` option. **mu-plugins** (`wp-content/mu-plugins/`) load always and have no
  activate switch — hosts hide platform glue there.
- **Theme** — the site's dress, in `wp-content/themes/<slug>/`. A **child theme** inherits a
  parent and is the safe place for edits; editing a purchased theme directly loses the work on
  its next update.
- **Block / pattern** — Gutenberg's units. Blocks live IN post content as HTML comments
  (`<!-- wp:… -->`); patterns are reusable arrangements.
- **Widget / menu / customizer setting** — classic-theme leftovers, stored in options.

`wp_` is the default table prefix; every site may have its own.

## Content model

- Nearly everything is a **post**: posts, pages, attachments, revisions, menu items, and every
  custom post type share `wp_posts`, discriminated by `post_type` and `post_status`.
- **Postmeta** (`wp_postmeta`) carries the rest — SEO fields, page-builder payloads, product
  data. The column you are looking for is very often a meta key, not a column.
- **Taxonomies** (categories, tags, and custom ones) attach via `wp_term_relationships`.
- WooCommerce products are posts (`product`) with heavy meta and their own tables in newer
  versions (HPOS orders); treat Woo data through its own vocabulary, not raw post edits.
- Dates: `post_date` + `post_date_gmt` travel as a pair; core stamps them via its APIs — which
  is why writes must go through those APIs, never raw SQL.

## Themes: block vs classic

- A **block theme** (Online-Store-2.0-era, `templates/*.html` + `theme.json`) is edited in the
  Site Editor and stores user edits IN THE DATABASE as template posts — the theme files on disk
  are only the starting point. Overwriting files does not undo a customer's Site Editor work.
- A **classic theme** uses PHP templates and the template hierarchy
  (`single.php` › `singular.php` › `index.php`); changes belong in a child theme.
- Page builders (Elementor, Divi, WPBakery) store their markup in postmeta or shortcodes —
  editing `post_content` under a builder's page can disconnect the builder. Check the builder
  before editing content raw.

## Where configuration lives

- `wp-config.php` at the webroot: database credentials, salts, table prefix, debug flags. It is
  code, owned by the site — never edit it through content tools.
- Everything else is the **options table** (`wp_options`): site URL, active theme/plugins, and
  most plugins' settings — often as **serialized PHP**. Serialized values break if edited by
  hand; only write them through the option tools, whole.

## Branding: logo and favicon

A logo is not a file you put somewhere. It is **an attachment id held in an option**, and a
**template that renders it** — and both halves have to be there.

- **The favicon** is the option `site_icon`, holding an attachment id. One write, no template
  involved. It is the cheapest of these to change, and the one to try first when proving the
  path works.
- **The site logo** on a block theme is the option `site_logo` (attachment id), rendered by a
  `wp:site-logo` block in the template. On a classic theme it is `custom_logo` inside
  `theme_mods_<stylesheet>` — a serialized option — rendered by `the_custom_logo()`.
- So changing a logo is three steps, in this order: `upload_media` to put the file in the
  library, take the **attachment id from its answer**, then `update_content` (kind `option`) to
  point `site_logo` at it. Skip the middle and you set the option to nothing.
- **A `wp:site-logo` block with no image renders NOTHING.** It does not fall back to the site
  title. Replacing a hand-written wordmark with that block before the image exists leaves the
  header blank — seen on a real site 24/08/2026, where the upload had failed and the block
  shipped anyway.
- **Many themes never use either option.** They hard-code the wordmark as markup in a template
  part, exactly as this site's did. Read the header template BEFORE assuming an option controls
  anything: if there is no `wp:site-logo` block and no `the_custom_logo()` call, setting the
  option changes nothing at all, and the change to make is to the template.
- **An SVG is text, and text does not need the media library.** Where `uploads/` refuses writes
  (a permissions problem on the host, which no tool here can fix), an SVG logo can be embedded
  straight into the template part — the whole `<svg>…</svg>` inline. It costs a few KB on every
  page and it takes the upload, the attachment and the option out of the picture entirely.
  Weigh that against a raster logo, which has no such escape.

## Rules of engagement on a Tracy site

- **Core is untouchable** (ADR 0070): `wp-admin/`, `wp-includes/`, and core files at the root
  are the updater's. Work in a child theme, a plugin, blocks, and content.
- **Writes go through the Apply tools**: `update_content` (kind `post`, `postmeta`, `option`),
  `upload_media`, and the two-step `install_plugin`/`activate_plugin` (same for themes). Every
  step logs under an `apply_id` and reverts exactly. A new post lands as a **draft** by design —
  publishing is a decision, not a side effect.
- **State facts come from the site's data**: `stack.json` and `inventory.json` first, tool
  answers second, memory never.

## Traps seen on real client sites

- **Caches stack three deep**: a page-cache plugin, an object cache, and a CDN can each show
  the old site after a successful write. Purge or wait before declaring a change failed.
- **Serialized options**: a hand-edited length prefix corrupts the whole option. Read freely,
  write only whole values through the tools.
- **wp-cron is traffic-driven** — a quiet site runs "scheduled" jobs late or never; a missing
  scheduled publish is often this, not a bug.
- **The white screen** after a plugin change is usually a fatal in one plugin; since WP 5.5 the
  site may instead auto-enter recovery mode and email the owner.
- **Sitemaps vary**: core serves `/wp-sitemap.xml`, but Yoast/RankMath replace it with
  `/sitemap_index.xml` — absence of one name proves nothing.
- **REST API exposure differs per site**: `/wp-json/` may be open, filtered, or blocked by a
  security plugin; a 401 there is configuration, not an outage.
