---
name: joomla-platform-knowledge
description: >-
  What every agent working on a Joomla site should know before touching anything — versions and
  their support state, the extension taxonomy and where each kind lives, how content and menus
  shape URLs, how templates and overrides work, and the traps that bite on real client sites.
  Reference knowledge, not a procedure. Loaded automatically for Joomla sites.
version: 1.0.0
platforms: joomla
provenOn: —
---

# Joomla, for the agent who works on one

This is the platform pack (ADR 0009): knowledge shared by every Joomla site, curated once,
versioned here. Site-specific facts — this site's version, template, installed extensions — are
NOT here; they live in the site folder (`TracyWork/digest/`, `TracyWork/surface/`) and in tool
answers, and only those may be quoted as facts about the site.

## Versions

- **Joomla 3.x** is end-of-life (August 2023). A site still on it needs migration before most
  other work is worth doing; 3.x APIs, plugins and templates are largely incompatible with 4+.
- **Joomla 4 / 5 / 6** are the modern line: Bootstrap 5 admin, web asset manager, child
  templates (4.1+), and a PHP floor that rises each major (5.x wants PHP 8.1+). Upgrades along
  this line are in-place but extension compatibility decides the real difficulty.
- Never infer the version from looks. Read it from the site's own data or a tool result
  (the cowork component's `info` action answers it exactly).

## The extension taxonomy — one word each

- **Component** (`com_*`) — a full application owning a URL space and usually database tables.
  Site half in `components/com_x/`, admin half in `administrator/components/com_x/`.
- **Module** (`mod_*`) — a box rendered at a template position (menus, banners, custom HTML).
  Lives in `modules/`; instances and their positions are rows in `#__modules`.
- **Plugin** (`plg_<group>_*`) — an event hook, grouped by when it fires (`system`, `content`,
  `authentication`…). Lives in `plugins/<group>/<name>/`.
- **Template** (`tpl_*`) — the site's dress, in `templates/<name>/`. A **template style** is a
  configured instance of one (a `#__template_styles` row); menus can assign styles per page.
- **Library / Package / Language** — shared code, a bundle of the above, translations.

`#__` is the table prefix placeholder; every site has its own real prefix.

## Content model

- An **article** lives in `#__content`, its body split into `introtext` and `fulltext` at the
  read-more mark. `created` and `modified` are NOT NULL datetimes. State: published (1),
  unpublished (0), archived (2), trashed (-2).
- Articles hang under one **category** each; **tags** are many-to-many and attach via
  `#__contentitem_tag_map`, matched by title, never invented from typos.
- **Menus drive everything**: a menu item (`Itemid`) decides the URL, the active template
  style, and module assignment. A category with no menu item gets ugly fallback routes — that
  is why "why is this URL weird" is usually a menu question, not an article question.
- SEF URLs are a Global Configuration switch (plus `.htaccess` rewriting); with it off, routes
  read `index.php?option=com_content&view=article&id=…`.

## Templates and overrides

- Change how core output looks by **overriding**, never by editing core: copy the layout into
  `templates/<tpl>/html/<extension>/<view>/` and edit the copy. Core updates then cannot erase
  the work.
- Framework families you will meet on client sites: **T3/T4** (JoomlArt), **Helix**
  (JoomShaper), **Gantry**, and plain **Cassiopeia** (the 4+ default). Framework templates keep
  their own settings blobs and compiled-asset caches.
- Module **positions** are declared per template (`templateDetails.xml`); the same position
  name can render very differently across templates.

## Where configuration lives

- `configuration.php` at the webroot holds database credentials, `$secret`, mail and cache
  settings. It is code, owned by the site — never edit it through content tools.
- Per-extension settings are `params` JSON on the `#__extensions` row; template style settings
  are `params` on `#__template_styles`.

## Rules of engagement on a Tracy site

- **Core is untouchable** (ADR 0070): Joomla's own files are managed by its updater. Work in
  overrides, extensions, and content. The webroot copy in `.webroot/` is read-only reference.
- **Writes go through the Apply tools** (`update_content`, `upload_media`, `install_extension`)
  — they stamp timestamps, log every step under an `apply_id`, and can revert exactly. Direct
  DB or file writes have no undo trail and are not yours to make.
- **State facts come from the site's data**: version, template, extension list belong to
  `TracyWork/surface/` and tool answers, not to memory or guesswork.

## Traps seen on real client sites

- **Caches eat your change**: Joomla's page cache, a framework's compiled assets (T3/T4
  `t3-assets/`), and CDN layers can all show the old site after a successful write. Purge or
  wait before declaring a change failed.
- **A client's own `.gitignore` can swallow deploy files** — nested ignore rules have eaten
  `.htaccess` and `t3-assets` on real sites; a "missing" file may be ignored, not absent.
- **`0000-00-00` datetimes** from old MySQL data break strict-mode inserts and sorting; treat a
  zero date as absent, not as 1999.
- **The admin door is `/administrator`** and often protected by an extra server-level password
  on production sites; its absence from a crawl is normal, not an outage.
- **Extension updates are per-extension**: a site can run a current Joomla with years-old
  plugins. The extension list with versions is the health signal, not the CMS version alone.
