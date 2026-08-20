# Reskin — "Real copy, demo layout"

Dress the working copy of a client site in a demo template's interface while **keeping every word
of the real content**. This is not "installing a template" — a tradesperson does that in an
afternoon. It is: read both worlds completely, match page to page, fit real copy into every field
of every block, install exactly the extensions the demo's blocks need, and accept the result by
machine.

Proven 2026-08-11: joomlart.com (working copy, 19 years of real content) wearing JA Stratum in
full — a 15-block ACM home plus a Pricing page carrying four real membership tiers — built by hand
in about 30 minutes, and paying for the ten traps written up at the end of this document.

## Contents

- [Terminology](#terminology)
- [Architecture](#architecture-deterministic-scripts--agent-judgement)
- [The toolkit](#the-toolkit) — scan group · the mapping gate · build group
- [Chrome & brand](#chrome--brand-header--menu--footer--branding) — header · menu · footer · branding
- [Images & icons](#images--icons)
- [Link scan & link mapping](#link-scan--link-mapping)
- [Advanced scan](#advanced-scan)
- [Accessibility scan](#accessibility-scan)
- [The verification fixture](#the-verification-fixture)
- [The traps](#the-traps) — 1–51, each one a rule
- [Responsive QA](#responsive-qa--judging-differentially-against-the-demo)
- [Acceptance criteria](#acceptance-criteria)
- [Out of scope](#out-of-scope-deliberately)
- [Open questions](#open-questions)

---

## Terminology

Industry design vocabulary, settled 2026-08-11.

| Term | Code name | Meaning |
|---|---|---|
| Mold | **Demo** (`demo`) | A template's quickstart demo: arrangement, ACM blocks, styles, bundled extensions. It lends *shape*, never *words*. |
| Mold book | **Pattern library** | Result of scanning the demo: which page holds which blocks, each block's JSON shape, styles, dependencies with versions, asset list, CSS libraries. |
| Target site | **Client site** | The working copy of the real site — what gets dressed, and the source of the content. |
| Content | **Real copy** | The real thing: menus, articles, products, prices. Inviolable, kept verbatim. |
| Content book | **Content inventory** | Result of scanning the client site. |
| Match table | **Content mapping** | Real page ↔ demo pattern; for every field of every block, where its words and images come from. The agent's own work product, **reviewed by a person before anything is built**. |
| Dressing run | **Reskin run** | Building to the mapping, plus QA per page. |
| Acceptance | **Design QA** | Machine checks: render, markers, links, images. |

The mantra: **"Real copy, demo layout"** — the mold does not bring its words across, and the
content is not rewritten.

## Architecture: deterministic scripts × agent judgement

The division of labour comes from the failures of the manual run: **every trap that bit was a
mechanical trap** (escaping, nested sets, timezones, paired styles, layout-inside-the-link). Not
one was "the AI being weak". Therefore:

- **Deterministic scripts** own everything that touches the database or the filesystem. The agent
  does not write SQL for those areas.
- **The agent** keeps the two jobs no script can do: **building the content mapping** (from the
  books) and **writing real copy into a block's JSON shape**.
- **One review gate**: the mapping table. Nothing is built before it is approved.

```
scan-demo ─┐                              ┌→ install-demo-frame
           ├→ [agent] mapping ──approved──┼→ sync-extensions
scan-client┘         ↑                    ├→ port-assets
           scan-extensions                ├→ fill-block (per block)
                                          └→ design-qa (per page) → undress (the way back)
```

## The toolkit

### Scan group (read-only, changes nothing)

**1. `scan-demo.sh <demo-db> <demo-web>` → pattern library (JSON)**

- The demo's page tree: menu item → shell article → position → the ACM blocks (id, type
  `ja_stratum:hero`…, title).
- Each block type's JSON shape: fields, parallel arrays, `rows`/`cols` — so `fill-block` can
  validate before writing.
- Style structure: which style is the default (has a mainbody), which is the home style (positions
  only), which pages pin which style, whether the layout lives in the link or in params.
  *(traps 7, 10)*
- Extensions the demo uses, with versions from `manifest_cache`.
- **Asset list**: every `images/…` path referenced by params, grouped by namespace.
- **CSS libraries**: read `joomla.asset.json` + `templateDetails.xml` → which Bootstrap generation,
  which FontAwesome generation, which fonts.
- The four mandatory chrome & brand chapters — see below.

**2. `scan-client-site.sh <client-db> <client-web>` → content inventory (JSON)**

- The real menu tree, **every** menutype (joomlart: mainmenu 24 items, mainmenu-legacy 29,
  footer-menu 6, other-menu 28, quick-navigation 5, top 3, t4 5) plus the landmark pages: home,
  pricing, about, products, blog.
- Content mines: category × article count; article landing (`view=featured`); special articles
  (joomlart's real Pricing page is article 2629).
- Styles currently pinned per menu item — the keep/unpin list. *(trap 2)*
- Extensions present, with version and enabled state.
- **Class vocabulary** of the real copy that will reach a page: classes inside the introtext and
  fulltext of mapped articles, `fa fa-*` icons, and any `<style>` blocks the articles carry
  themselves.
- Configuration that affects rendering: `sef_rewrite` (↔ `.htaccess`), page cache, `force_ssl`,
  database timezone. *(traps 3, 6, 9)*
- **The canonical URL map** plus the SEO/router stack — see the link scan chapter.
- The four chrome & brand chapters from the client side: the real logo, real CTAs, real legal
  pages, real newsletter, real social accounts, the branding set.

**3. `scan-extensions.sh <pattern-library> <content-inventory>` → extension diff (3 columns)**

Compares only **UI-relevant** extensions, measured by query rather than guessed:

1. A component with a front-end menu item pointing at it (`menu.link LIKE '%option=com_x%'`).
2. A module placed into a position (`client_id=0`, published).
3. Render-group plugins: the `content` / `system` / `fields` folders (without `loadmodule`,
   `{loadposition}` renders as literal text on the page — this has happened).
4. Template plus framework chain (T4), **comparing versions, not just presence** — presence-only is
   blind to `mod_ja_acm` 2.0.9 rendering zero blocks. *(trap 1)*

Three result columns: `missing` / `present but older` / `present but disabled` — each row carrying
its UI reason ("`mod_finder` — the Blog pattern's sidebar needs it"). Why the filter matters: a raw
diff returns both `com_akeebabackup` (backup, nothing to do with rendering — drop) and `com_finder`
(the Search block needs it — keep). The other direction, what the client has and the demo does not,
is recorded but never acted on: we are dressing the client site, not fixing the demo.

### [AGENT] Content mapping — the one review gate

From the three books, the agent builds a table, one row per page:

- Real page ↔ demo pattern (e.g. the real Pricing → the `pricing-page` pattern; a Blog with 87
  articles → the Blog pattern plus `com_finder`; Documentation/Glossary → the FAQ/Changelog
  patterns).
- **Every field of every block**: where it comes from — `real` (verbatim, source named) |
  `placeholder` (kept from the demo, flagged for the customer) | left empty. Image fields too
  (`footer-brand[logo]` → the real logo is one path line).
- Extensions to install (from the diff), class/icon mismatches to rewrite (from the CSS scan),
  which real menutype the demo's footer menu maps onto, what to do with items carrying the old
  template's layout.
- The branding block: where the logo/favicon/og:image/schema set comes from, plus the **palette**
  tick — keep the demo palette (default) or tint the primary to the client's brand colour.
- The **"Proposed new pages"** section from the advanced scan: each new page ticked individually,
  none ticked by default.

Rules for the agent: real copy stays verbatim, no invented figures, and a field with no source is
flagged rather than quietly left wearing demo text.

### Build group (runs only after approval; idempotent)

**4. `install-demo-frame.sh`** — install the template zip; install/discover T4; **upgrade ACM to
the demo's version**; provide `.htaccess` when `sef_rewrite` is on; create **two styles** (a
default with a mainbody, a home with positions only) and pin them correctly; unpin old styles per
the mapping; disable page cache; emit the new style ids for the scripts that follow.

**5. `sync-extensions.sh`** — install what is missing on the client site per the diff, in source
order: (a) copy files plus `extension:discover:install` from the demo container — exact version,
proven with T4 and ACM; (b) the JoomlArt Download Center over MCP; (c) out of sources → report,
never invent a third one.

**6. `port-assets.sh`** — copy the demo's image namespace (e.g. `images/demo/`, 17MB, 23 references
from params) per the asset list; always `--skip-old-files`: **never overwrite a client image**. The
client's real images are already where they belong and are not ported; a template's own images and
SVGs travel with the template and are not ported.

**7. `fill-block.sh <mapping-row>`** — the workhorse, and it carries every mechanical trap:

- Takes clean JSON params from the agent → validates against the shape in the pattern library
  (right fields, parallel arrays of equal length, `rows` matching) → **writes through base64**
  (`FROM_BASE64`), never hand-escaped. *(trap 8)*
- A fixed ID offset (+1000) for modules/articles/menu items — never touching old data, and making
  `undress` easy.
- Shell articles (`{loadposition <position>}`): `publish_up NULL` *(trap 9)*, correct catid and
  created_by.
- New menu items: inserted with **proper nested-set arithmetic** (widen the root's rgt, do not
  rebuild); `layout=fullwidth` goes **in the link**, not in params. *(trap 10)*
- `modules_menu` assigned the right Itemid; Joomla cache cleared after every write.

**8. Machine acceptance, per page** — one gate became two when the two kinds of judgment were
separated. What is broken on any site went to `design-qa`; what THIS dressing promised went to
`reskin-qa`. Both take `--host/--port/--pages` (or `--expect`), not the old positional pair.

- `design-qa.sh --host <h> --port <n> --pages "/a,/b" [--variant <slug>]` — HTTP 200, no literal
  `{loadposition}`, no leaked PHP errors, and every internal link and image answers < 400.
- `reskin-verify.sh --host <h> --port <n> --expect expect-pages.json [--variant <slug>]` — the
  expected markers present ("JA Template", "$149"…), forbidden demo strings absent, and the
  **branding deny-list** nowhere a reader can reach it: visible text plus `alt`, `title`,
  `aria-label`, `placeholder` and meta `content`.
- **Accessibility**: axe/pa11y against the demo's baseline — no worse, and no new faults from the
  real copy; render both schemes when the demo has dark mode.
- **Whole-site link crawl**: every routable internal link answers 200; a failure returns to the
  agent in a mandatory loop; internal-but-not-this-CMS links leave as a customer report.
- Chrome & brand QA runs **once for the whole site**, not per page.
- A failing page prints the expected/actual diff and **fixes nothing** — it goes back to the agent.

**9. `undress.sh`** — the way back, nearly free thanks to the architecture: delete every row with
an ID above the offset; flip the default style back to the old template; re-pin menu items as the
content inventory recorded them. The client site returns to its previous state in one command.

## Chrome & brand: header · menu · footer · branding

The skeleton appears on **every** page — one mistake is a site-wide mistake, and it is where a demo
buries the most dead links. These four are mandatory sections in both books, four separate decision
blocks in the mapping, and four separate tests in QA.

### Header scan

- **From the demo:** what the header is built from — the template's PHP block (brand SVG plus brand
  text from style params), which module sits in which position (Stratum: the "Sign in / Start free"
  CTA is an ACM module at `header-r`), topbar, sticky behaviour. **And the twin everyone forgets:
  off-canvas** — Stratum has a separate CTA module for mobile (position `off-canvas`); fixing the
  header and forgetting it means desktop says one thing and mobile another.
- **From the client:** the real logo (file, dark variant), the real CTAs (Sign in → the real login,
  buy → pricing), the real topbar.
- **The mapping decides:** demo logo → real logo; **each CTA button**: label plus real destination
  ("Start free" → "Pricing") — the words on a button are real copy, not chrome; apply the same
  decision to off-canvas.
- **QA:** the header renders on N sample pages; every header link 200; the logo file exists;
  desktop and off-canvas agree.

### Menu scan

- **From the demo:** which menutype feeds which position; **T4's megamenu configuration lives in
  style params** (columns, submenus, highlights) — not in the menu table, and easily missed; child
  items that are **`#` placeholders** (Stratum: the whole Bare metal / Postgres / Redis cluster is
  `#`).
- **From the client:** all the real menutypes; external links and special tokens (`#esurl#`); tree
  depth; and the replatform-specific trap: **items carrying the old template's layout**
  (`layout=ja_v5:xblog`, `ja_v5:doc`…) — the new template has no such layout, Joomla falls back to
  the default: the page works but looks wrong, and every such item must be flagged.
- **The mapping decides:** which real menutype fills which slot; the demo's `#` cluster → real
  children or cut; the megamenu rebuilt from the real tree; old-layout items → their replacement.
- **QA:** crawl every nav link for 200; no `#` left outside the approved list; correct active state.

### Footer scan

- **From the demo:** what module each footer column is and which menutype it binds (Stratum:
  footer-product/company/developers, mostly `#`); brand and social; **which endpoint the newsletter
  posts to** (usually nowhere); the copyright module — **every hard-coded ID in params must be
  dragged out**. Live evidence: Stratum's copyright module links Privacy/Terms/Cookies by hard-coded
  article IDs 95/96/97 — those three articles **do not exist** on the client site, so three dead
  links sit on every page.
- **From the client:** the real footer-menu; which articles the real legal pages are; real social
  accounts; what engine the real newsletter runs; the real copyright line.
- **The mapping decides:** each column → a real menutype or a new list; legal → the real articles;
  newsletter → a real endpoint, or flag it and disable the form; copyright → the real words
  (© JoomlArt, not © Stratum).
- **QA:** every footer link 200 (legal included); no form posting into the void; no demo brand left.

### Branding scan

One rule sets this chapter apart from the other three: **branding has no placeholder tier.** A
demo's testimonial photo may be kept temporarily; a demo's *brand* surviving anywhere is a defect
there. Missing means empty or hidden — never "kept for now".

- **From the demo — the deny-list:** every brand token of the demo: the name ("Stratum"), the
  tagline, **the demo domain** (something like "stratum.app" buried inside feature copy), logo
  files, the default og:image. Emitted as a **forbidden list**: strings and files that must not
  appear on the client site after the run.
- **From the client — the set to fit:**
  1. A full logo set: primary, dark mode, compact/mobile, footer — note any variant that is missing
     (do not let a dark header show a logo drawn for white).
  2. Favicon and app icons: `favicon.ico`, apple-touch-icon, the icons in the PWA manifest.
  3. Site name and tagline: `sitename` in `configuration.php`, `og:site_name`.
  4. The brand palette: the real primary/accent (joomlart: `#007AFF`, visible in the real pricing
     page's CSS).
  5. Brand typography, if the client has its own fonts.
  6. The default og:image / share card.
  7. Organization schema (ld+json): name, logo URL, `sameAs` — currently correct because the
     client's own SEO extension generates it, but it must be checked rather than assumed.
  8. Real social profile URLs.
  9. Copyright and legal entity (company name, address if the footer carries one).
  10. Email identity (the from-address on newsletter and forms) — flag it, handle it in the footer
      chapter.
- **The mapping decides — exactly one design decision: the palette.** Logo, name and schema are not
  up for debate (always the client's). Colour is a real fork: (a) **keep the demo palette** — that
  is the "new outfit" the customer asked to see, and the default; (b) **tint the primary to the
  client's brand colour** — T4 style params support it. One line for a person to tick.
- **QA:** grep the **deny-list** across every rendered sample page: zero hits outside flagged areas
  (this immediately catches the fixture's standing debt: `footer-brand[logo]` is still the Stratum
  logo); favicon and og:image answer 200 and **do not hash-match the demo's files**; the
  Organization schema carries the client's name; the title tag has no demo name in it.

## Images & icons

Three streams, three treatments:

1. **Demo images referenced by ACM blocks** (paths inside params JSON, in their own namespace such
   as `images/demo/`): `scan-demo` extracts the list → `port-assets` copies the whole namespace with
   `--skip-old-files`. An image field is a mapping decision: replace with a real image where one
   exists (the logo!), otherwise keep the demo's and flag it `placeholder`.
2. **The client's real images**: already home (the shared `images/`), already referenced by the real
   copy — do nothing.
3. **Template images and icons** (brand SVGs, decorations inside PHP/CSS): they travel with the
   template on install — not in the database, not ported.

Icons: Stratum's ACM params use only four FA classes (the template loads FA itself); icons inside
real articles belong to the CSS scan, checked against the FA4→FA6 rename table.

## Link scan & link mapping

Mandatory in the pipeline. A real failure from the manual run: three legal links 404ing because
they went by hard-coded article ID, and a hero button pointing at `/joomla/templates/` from memory
of the origin site's URL — that it answered 200 was **luck, not process** (`/pricing/`, built the
same way, returned 301). A link is never allowed to be lucky; it must be *looked up*, and it needs
two gates: one in the pipeline (mapping) and one at QA.

### From the client side: who is holding the URL

- **The SEO/router stack** — a long-lived site is a stratigraphy: joomlart runs forSEO + forSEF
  (4SEO by Weeblr) *and* iJoomla SEO, with sh404sef **switched off but its `sh404sef_aliases` table
  intact** (old URLs may still be indexed and still have to survive by redirect). Plus core `sef`
  and custom rewrite rules in `.htaccess`.
- **The canonical URL map**: content ID ↔ real public URL, built from three sources checked against
  each other — the origin site's sitemap, the SEO plugin's alias table, and the working copy's own
  router (probed with curl). This is one of `scan-client-site.sh`'s outputs.
- Internal links living **inside the real copy** (hrefs in article bodies) — inventoried so QA can
  crawl them.

### Three kinds of internal link

1. **Joomla-routable** — resolvable in the URL map → use it, and QA must see 200.
2. **Internal but not Joomla** — forums (another application), the download area, a subdomain, a
   Magento section… The working copy cannot reproduce these: **not a QA failure**, but a
   **customer report list** ("this part sits outside the Joomla install, so it is beyond what Tracy
   can serve on a working copy"). The mapping decides per link: point absolutely at the live origin
   site, or leave it and note it. That list is a formal deliverable of the run.
3. **External** (another domain) — kept verbatim.

### Mapping rules (the first gate)

- Every link the agent puts into a block, menu or CTA must be written as the **canonical URL looked
  up from the map** — no invented paths, no demo paths kept (`/features`), no raw
  `index.php?id=…` leaking out.
- A link that cannot be looked up → flagged in the mapping table for the reviewer, never guessed.

### QA rules (the second gate — a full re-crawl, with a loop)

- Crawl **the whole dressed site**: every kind-1 internal link (nav, blocks, footer, in-article)
  must answer 200 — including the ones that are "obviously fine".
- Check back against the origin's sitemap: the URL of real content on the dressed copy equals its
  URL on the origin, so SEO is not broken.
- **Any broken link goes back to the agent, mandatorily** — a QA failure blocks completion; it is
  not a warning line. The loop runs until the crawl is clean.
- Kind-2 links are emitted as the customer report list, never mixed into the failures.

## Advanced scan

The highest judgement tier of the scan set. It runs after the three raw scans and feeds straight
into the mapping table. This is where AI beats the tradesperson: a tradesperson maps the pages that
**exist**; this tier finds the pages that **should exist** — built from the mold's pattern
inventory, using the client's own real content.

(Not to be confused with a *template recommendation* engine — that is a separate system, parked with
a note. This chapter works **inside an already-chosen mold**.)

### Beat 1 — business profile

The model reads the content inventory like a person, not like a counter: what the client sells,
which segment, what the USP is, which content mines are rich. On the fixture: JoomlArt sells 300+
templates plus extensions plus T4 Page Builder plus four membership tiers plus GeoReport; segments
run from hobbyist to agency; rich mines are News 317 articles, Templates ~650, Extensions 164,
Glossary 93, questions 145+.

### Beat 2 — read the mold's page inventory

Check the pattern library: which of the mold's patterns are **unused** by the 1:1 mapping → the
opportunity list. Most patterns have several layout styles, so one opportunity can be built two or
three ways.

### Beat 3 — propose new pages

Every proposal carries four parts: **the pattern used** · **the specific real-copy source**
(which category, which articles) · **two or three presentation options** · **the business reason**.
On the fixture, all of these are pages the origin site never had:

- **Solutions** (the solutions-page pattern, 4 blocks) → "JoomlArt for Agencies / Freelancers /
  Hobby", from real membership content and real use cases.
- **Integrations grid** (3 blocks) → an extensions directory from 164 real articles.
- **Changelog** (2 blocks) → a release timeline from the 122-article Updates category.
- **FAQ** (faq + accordion patterns) → from Club Info & FAQ's, 145+ question articles, and the
  Glossary.
- **About/Team** (6 blocks) → the 19-year story, from the anniversary articles.

The hard rule, the same family as the mapping rules: **only the client's real content** — no
invented figures, no new prose beyond editing real sources; if a source is not rich enough for a
pattern, **do not propose that pattern** rather than proposing it with filler.

### Position in the pipeline

The output is the **"Proposed new pages"** section of the mapping table; the reviewer ticks pages
individually, none ticked by default. A selected page then goes through exactly the same line as
every other page: fill-block → link mapping → design-qa. No shortcuts.

## Accessibility scan

A quality dimension that cuts across like the CSS scan, but with one big advantage: **most of it is
machine-measurable** (axe-core / pa11y running headless on the fleet host). Two passes:

1. **Baseline on the demo**: run axe/pa11y over the demo pages → the accessibility debt the *mold
   already carries*. We do not fix the template, but we must know the number and tell the customer.
2. **QA on the dressed pages**, with the rule: **no worse than baseline, and no new faults from the
   real copy.** A pre-existing template fault is recorded; a fault this run caused (missing alt,
   hard-coded colour, duplicate h1) must be fixed.

What to inventory, on both sides:

- **Colour scheme (dark/light)**: does the demo support it (Stratum ships `darkmode.css`), by toggle
  or by `prefers-color-scheme`? **A trap already hit**: real copy carrying hard-coded CSS colours —
  a real pricing page embedding a `<style>` with fixed hex on an assumed white background, so dark
  mode swallows the text. The scan flags every inline colour in mapped real copy. Branding follows:
  a logo needs both scheme variants.
- **Alt text**: do images in the real copy have alt (long-lived articles usually do not); does the
  block's image field even offer a place to declare it; the mapping fills alt from real context,
  never "image1".
- **Heading hierarchy** — a reskin-specific trap: each block carries its own heading level, so
  assembling several easily yields two h1s or an h2→h4 jump; and real copy poured into a block
  sometimes brings its own h1 in the HTML.
- **Landmarks and skip link**: header/nav/main/footer in their proper roles, skip-to-content —
  template tier, checked once.
- **Keyboard and focus**: the megamenu operable by keyboard, focus visible, and **the off-canvas
  needs a focus trap** (the mobile twin, appearing here for the third time in this document — it
  has earned it).
- **ARIA on interactive blocks**: FAQ accordion, integrations filter, slideshow — `aria-expanded`,
  carousel controls, a button to pause auto-play.
- **Forms**: labels for newsletter and search, error states a screen reader can reach.
- **Motion**: `prefers-reduced-motion` against the demo blocks' counters, parallax and animation.
- **`lang` attribute**: the html lang matches the language of the real content (a Vietnamese site
  wearing an English mold takes its lang from the content, not the mold).
- **Links and touch targets**: repeated undifferentiated "Read more", icon-only buttons missing
  `aria-label`, mobile touch targets under size.

Where it lives: an accessibility section in both books (demo: scheme support plus baseline; client:
the state of the real copy), the alt/heading columns in the mapping, and `design-qa` running
axe/pa11y against the baseline plus rendering **both schemes** when the demo has dark mode.

## The verification fixture

The pair **joomlart.com × ja_stratum**, frozen on 2026-08-11, is the exam: running the whole 1→8
line must produce the same home (15 ACM blocks, hero real copy "19 YEARS · 60+ JOOMLA TEMPLATES")
plus the `/pricing-stratum` page (four real tiers: JA Extensions $59 / JA Starter $99 / JA Template
$149 featured / JA Developer $199), and `design-qa` must come back green.

## The traps

Each trap is one rule. Drawn from real runs; every one of them only appears when you actually do
the work.

### Traps 1–10 — from the manual run (2026-08-11)

1. **The mold needs its whole frame, compared by version**: the template zip is not enough — T4
   framework plus `mod_ja_acm` of the right generation (the client's 2.0.9 rendered zero blocks,
   silently). → `scan-extensions` compares `manifest_cache`, `install-demo-frame` upgrades.
2. **A menu item pinning the old style overrides the default**: the client's Home pinned ja_v5, so
   flipping the default achieved nothing. → the content book lists every pin, `install-demo-frame`
   unpins per the mapping.
3. **Page cache hides every change**: what looked like a failure was a cached page. → disable cache
   on the working copy, clear it after every write.
4. **An arrangement is four things**: modules (+params) · modules_menu · style params · demo
   images; ported with an ID offset. → `fill-block` + `port-assets`.
5. **Real menus and articles flow into the mold by themselves** through mod_menu/mod_articles — only
   static ACM blocks need content fitted. → the mapping only deals with ACM.
6. **`sef_rewrite` on means `.htaccess` must be provided** (provision forgot to rename
   `htaccess.txt`, so every SEF URL 404'd rawly). → `install-demo-frame`; worth patching into
   `provision.sh` directly.
7. **A template has two styles**: default (with a mainbody) ≠ home (positions only). Pinning the
   home style to an inner page yields a page with no body. → `scan-demo` classifies them,
   `install-demo-frame` builds the pair.
8. **ACM params are JSON nested inside JSON**: hand-escaping is fatal (one stray backslash and
   MySQL swallows the lot). → write through `FROM_BASE64`, always.
9. **A database timezone offset from UTC**: `publish_up = NOW()` lands in the future → the article
   is hidden with no explanation. → `publish_up NULL` for every shell article.
10. **A fullwidth layout lives in the menu item's link**, not in params — without `&layout=fullwidth`
    the page falls back to the default layout (printing raw introtext). → `fill-block` builds the
    link.

Plus three chrome findings: legal links by hard-coded article ID (404 on the client), a demo CTA
pointing at a `/register` SaaS route that does not exist, and off-canvas being a twin that has to be
fixed alongside the header.

### Traps 11–15 — from the v1 scan runs on the fixture (2026-08-11)

11. **Menu items come in five kinds** (`component/alias/heading/url/separator`) plus a `home` flag.
    A link check that does not classify by `menu.type` manufactures false 404s (curling the path of
    a heading or separator); the `home` item routes to `/`, and the path stored in the database is
    only an internal alias. → `type` and `home` columns are mandatory in the content book.
12. **A link failure has two layers: content and route.** Probe as a pair: non-SEF
    (`index.php?option…`) 200 plus SEF path 404 = *a missing route/alias* (the SEO stratum's job);
    non-SEF also 404 = *genuinely missing content*. The URL map stores **both** so QA can tell the
    two apart. (Fixture: 7 mainmenu URLs 404'd while all their content answered 200 via non-SEF.)
13. **Reading has to guard against escaping too, not just writing.** JSON stores `\/` and `&amp;` —
    a regex hunting hard-coded article IDs missed `article\/95` for exactly one run. Normalise
    before matching.
14. **The content book inventories EVERYTHING; a label is not a filter.** The first version listed
    only UI-relevant extensions, so the diff could not tell "absent" from "present but not listed",
    and reported `com_config` as missing. The inventory lists everything that exists; `reason` is a
    label. Same family: the `home` column of `template_styles` means *default style* — rename the
    output field to `default`, because this pipeline also has a real home-style concept.
15. **HTTP 200 is not proof you got what you asked for.** The copy's `/sitemap.xml` returned 200
    with an ordinary HTML body and zero `<loc>` elements — the router's fallback swallowed an
    unknown path. Every source feeding the URL map must **parse and verify content**, never trust a
    status code. Two more samples from the same run: the client's custom 404 page returning 404 is
    *correct* (the link check must recognise the error-page item and not count it), and the demo's
    Organization schema carries the demo's name ("Stratum") — a branding deny-list source that only
    a rendered page reveals.

### Traps 16–19 — from building the first mapping table (see `fixtures.md`)

16. **A database path is not a public URL — not even on the origin site.** The origin also 404s on
    `/support/documentation` (and `/documentation` → 301): the real URL is produced **at render
    time** by the router plus the alias stratum. This inverts the method for scan v2: the link check
    crawls **hrefs from rendered pages** (the real nav), and database paths are only a hint.
17. **A content mine can be empty even when a menu points straight at it.** Documentation (cat 113)
    and Video (cat 109) on the fixture hold zero articles — the content lives in an external system.
    The mapping must not propose a pattern for an empty mine. Scan improvement: the content book
    counts articles for **each menu item's destination** (category link → article count), not just
    per category overall.
18. **A shape without example values makes the mapping write blind.** `block_shapes` carried only
    field names; whoever writes the real copy needs to see the demo's words (length, tone) to write
    to the right size. Scan improvement: every field carries a truncated **example value** from the
    demo.
19. **A client footer usually already has a proper legal set.** The fixture's `footer-menu`: Terms /
    Privacy / Refund / Licenses / Contact — exactly what the chrome needs. Scan improvement: detect
    a **legal menu** automatically (a menutype holding ≥2 legal names) so the chrome mapping can
    match it instead of hunting by hand. With a size warning attached: the fixture's
    `sh404sef_pageids` holds **853k rows** — every alias-table query must LIMIT, never load the whole
    table.

### Traps 20–21 — from the first chrome build (2026-08-12)

20. **A link in demo params may never have routed at all — not even on the demo.** The
    `/component/content/article/ID-alias` pattern hard-coded into the copyright block 404s on both
    sites: modern routers serve an article at `/<category-path>/<alias>` (fixture:
    `/joomlart/privacy`). The rule for `fill-block` and QA: **curl-probe every link before writing
    it** — including links copied verbatim from the demo, because demos ship dead links.
21. **An installer can refuse without a reason inside a container** — `extension:install --path`
    failed even with `-u www-data -vvv`; `sync-extensions` needs a fallback (sync `manifest_cache`
    from the real files), and finding out why is its own backlog item. Also: this generation of T4
    **does not load `custom.css` by itself** — a colour tint has to be appended to the css file that
    is genuinely loaded last (darkmode.css), and the scan should record the *real css load order*
    from a rendered page.

### Traps 22–25 — from the page builds (Blog, MCP, three new pages, 2026-08-12)

22. **forSEF is a cache layer with a will of its own.** Three bites in one session: (a) after
    changing a menu link it still routed by the **old nonsef** entry in `forsef_urls` — /blog/ 500'd
    because it was pushed into the old template's `ja_v5:xblog` layout; changing a link means purging
    the related sef rows. (b) it derives the SEF from the **article's alias, not the menu path**, so
    a replace-in-place page needs its shell alias to match the public URL (/joomla-mcp) or the page
    moves to a new one. (c) it only **relearns a URL when another page builds that link** — a new
    page has to be in the nav (or warmed deliberately), or SEF 404s while the content answers 200.
23. **A dump carries the source environment's domain.** `/blog` 301'd to `beta.joomlart.com` —
    staging's absolute URLs sitting in the dump's SEO cache. Provision must purge or rewrite the
    router cache tables for the new domain.
24. **ACM chokes on `\uXXXX`.** Writing params back with `json.dumps` defaults (ensure_ascii) makes
    the item vanish without a word — the inner JSON must serialize as **raw UTF-8**
    (`ensure_ascii=False`), exactly as the demo stores it. `fill-block` writes this way, always.
25. **Demo words also sit hard-coded in layout CODE, not only in the database.** The blog masthead
    had a `?: 'Deep dives on infrastructure…'` fallback inside the PHP — visible only on a rendered
    page, and the right fix is to fill the proper field (the menu item's `page_heading_desc`), not to
    patch code. A deny-list scan must therefore **exempt two layers**: strings inside script/code,
    and the client's real content legitimately mentioning the same name (JA Stratum is a real
    JoomlArt product — not residue).

Process note from the same session: two bugs (forgetting to write params back, and an item vanishing
to unicode) were both **caught by design-qa immediately after the write**, thanks to the rule "write,
then grep the render" — keep that rule in the skill. Blog search needed `finder:index` to run after
enabling com_finder — added to `sync-extensions` as a post-install step for extensions that index.

### Visual QA — the machine-eye tier (script 10, 2026-08-12)

Grepping HTML cannot see a broken menu. The visual tier splits in two, running on the fleet host in
**headless Playwright inside Docker** — the client's site installs nothing, and it depends on no AI
vendor of theirs:

1. **Deterministic geometry** (built — `visual-qa.sh`, now a wrapper over `browser-qa.mjs`):
   render each page at desktop/tablet/mobile and assert from the DOM: horizontal overflow
   (`scrollWidth > clientWidth`), **nav-overlap** (header link bounding boxes intersecting, 4px
   tolerance), edge bleed, clipped labels, images with `naturalWidth = 0`, and any asset this
   site's own server answers 4xx/5xx for — a CSS `background-image` that 404s was invisible to
   every gate until the browser's response stream became the witness. Screenshots are kept as the
   record. The exit code is the gate.
2. **Deterministic pictures** (built 2026-08-19 — `pixel-diff.sh`, `skin-diff.sh`): what a rule
   written in advance cannot catch, because the point of a regression is that nobody predicted it.
   `pixel-diff` compares a page against its own last accepted render and marks in red what moved.
   `skin-diff` compares a dressed page against the demo — not pixel for pixel, which is worthless
   when the two share a template and nothing else, but on what the demo DEFINES and content cannot
   change: palette by painted area, typeface, container bands. It also writes the contact sheet
   the "your own eyes" step never had a command for.
3. **Vision LLM** (still not built, still optional): hand the screenshots to *Tracy's* vision model
   (Settings → AI Scan) to judge what even a picture diff cannot measure — rhythm, contrast,
   aesthetics. Only when the tiers above are green, and only on representative pages. "Claude in
   Chrome" is not relevant here: that is an extension for a browser with a person sitting at it,
   and this pipeline needs headless on a server.

First outing: it caught exactly the broken menu a person could see —
`nav-overlap Solutions×Sign in (39px), FAQ×Pricing (41px)` across all 7 desktop pages; after the
fix, 21/21 passed.

26. **Navigation has a width budget.** Cramming four new items into a 24-item main menu overlaps the
    CTA — a new page must have its **place decided by the mapping** (which dropdown, the footer, or
    not in the nav), never level-1 by default. The fix used: three new pages into the Products
    dropdown; the public URL did not change because forSEF follows the alias (trap 22b, working in
    our favour this time). Plus an infrastructure constraint: on a 1GB droplet the QA container needs
    `--memory 512m --shm-size 256m` and pages processed one at a time.
27. **The inventory taken BEFORE the run is the restore point — freeze it.** `undress` restores from
    the inventory; the fixture was re-scanned mid-run (to test scan v1.1), so a dry-run "restore"
    would have returned it to a half-dressed state. The pipeline order (scan → mapping → build)
    guarantees this by itself — do not break it with one convenient re-scan; if you want a fresh
    scan, write it to a different file. Known limits of `undress` (documented in the script header):
    menu params (page_heading) and the provision-level `.htaccess` are kept — harmless to the old
    interface.

### Traps 28–33 — finishing Home, and the agent's eye (2026-08-12)

28. **Two templates from the same framework share position names — old modules bleed into the new
    skin.** ja_v5 and Stratum are both T4: four of the client's old footer modules (footnav-1/3/4/5)
    rendered in among the new footer — a stray menu over the logo, a "Money Back" block adrift. The
    content book must list client modules by position; the mapping decides keep or unpublish;
    `fill-block` has an `unpublish` action. Both the text and the geometry machines passed it —
    only **the agent's eye on a fullPage screenshot** caught it, and the same look also caught a
    pricing teaser still wearing demo content. The vision tier is not decoration: it is the tier
    that catches "arranged validly but wrong".
29. **The old template's layout is pinned at FOUR layers**: the menu link (`&layout=ja_v5:x`) ·
    **menu params** (`article_layout`) · **each article's attribs** · the style pin. After clearing
    layer 1, single articles still 500'd (`T3_TEMPLATE_PATH` — an ja_v5 override calling a constant
    that only exists while that template is active).
    `regexp_replace(ja_v5:[A-Za-z0-9_-]+ → _:default)` across both menu params and content attribs.
    The scan must cover all four layers.
30. **`error.log` inside the Apache container is a symlink to `/dev/stderr`** — tailing or grepping
    it hangs forever (size 11 bytes = the length of the string "/dev/stderr"). The real log is read
    with `docker logs`. And Joomla swallows fatals into a pretty error page: to get the real message,
    turn `error_reporting` to maximum temporarily, then put it back.
31. **A discovered extension sits at `state=-1` — enabling it alone does nothing.** Fixture 2: t4 had
    `enabled=1` while the template still reported "T4 Framework Plugin is not enabled"; it needs
    `extension:discover:install --eid` first, then enable. `install-demo-frame` now does this. Also:
    discover-installing a template creates an extra default style — `undress` caught it by comparing
    against the book.
32. **Flipping the default style dresses EVERY unpinned page — the mapping must draw the hybrid
    border explicitly.** `/joomla/templates/` (unmapped) inherited the Stratum default: new chrome
    around raw com_content table output, visibly broken to a person — while all 10 scripts and both
    QA gates passed it, because QA only render-gates the pages that were MAPPED, and links outside
    that list are merely status-probed (200 = pass). New rule: the content book lists every unpinned
    item; the mapping decides each page — dress it, or **pin it back to the old style** (a page that
    was never mapped must never be half-dressed); and QA must render-check the pages that inherit
    the default, not only the mapped ones. Two satellites from the same run: (a) **a verify marker
    must be a string unique to the exact element just written** — a "real" footer column once passed
    verify on text that belonged to an old, not-yet-unpublished module, while the real write had
    never reached the database; (b) **hard-coded hrefs rot when routing changes** — three legal links
    404'd after a forSEF purge; chrome should use mod_menu so the router builds and re-teaches its
    own cache, and hard links should be reserved for destinations outside the site.
33. **Broken layout is first of all broken SIZE — it needs its own box-model tier (`layout-qa`,
    script 11).** A real-copy intro image that is a 4674px-tall screenshot swallowed a whole blog
    listing — design-qa (text) and visual-qa (nav) were both blind to it. `layout-qa.sh` measures:
    vertical section overlap, horizontal parent escape, a section collapsed with content still in it,
    oversized media (taller than the viewport / wider than the page / upscaled beyond 2.5× natural),
    suspiciously short pages (< min-height = an empty shell), and **drift from a baseline** (height
    ±25%, section count changed). A `--crawl N` mode measures pages outside the mapping list
    (report-only, patching trap 32's coverage hole). The fix used for the tall image:
    `max-height` + `object-fit: cover` inside the tint block (undress still strips it) — the client's
    image file is untouched, only its PRESENTATION is bounded.

### Responsive QA — judging differentially against the demo (script 12, 2026-08-12)

**The principle: the demo is the living definition of correct responsive behaviour for its own
template.** Same template, same block type, same viewport → the dressed copy must stack the way the
demo does. So `responsive-qa.sh` runs twice: `--mode reference` on the **demo** (recording a
responsive signature per `acm-*` across four viewports 375/768/1024/1440: column count, heading
size, the block's own horizontal overflow, nav folded or not, footer column count), then
`--mode compare` on the **client copy**, judged against that. Odd behaviour the demo also has is a
**property of the mold**, not a penalty.

34. **An absolute column count is data, not responsiveness — compare the FOLD RHYTHM.** The first
    run produced 16 FAILs, all false positives: `acm-pricing-cards 4 columns vs demo 3`, purely
    because the client has four tiers. What must match is *how it folds relative to its own
    desktop*: if the demo goes 3→1, the client going 4→1 is correct. Switching to a collapse ratio
    took 16 FAILs down to 4.
35. **"Column" has to be defined strictly, or the DOM lies to you.** The remaining 4 FAILs were
    still false: an accordion's label plus its chevron icon, and two adjacent buttons, were each
    being counted as "2 columns". A real column = a child **≥25% of its parent's width AND ≥80px
    tall**. After those two tightenings: **0 FAILs**.
36. **A gate that has never caught a real fault is not yet trusted — run the negative test.**
    Injecting CSS to force `.acm-features-grid` to keep 3 columns below 900px made the tool report
    exactly two lines (`still 3 columns at tablet; demo collapses 3→2` and `mobile 3→1`); removing
    the CSS returned 0 failures. Every new gate must pass this before anyone relies on it.

Verdict levels: **FAIL** = does not fold while the demo folds, or the block overflows horizontally
where the demo does not, or the nav does not collapse to a toggler as the demo's does, or
`<meta viewport>` is missing. **warn** = folds more than the demo, or a heading differs by >25%
(fluid type). **info** = a block absent from the reference (new block, no standard yet).

### Traps 37–42 — from the hybrid run and the interaction gates

37. **A template override only lives while THAT template is active — so clearing layouts must be
    per-page, not global.** The `T3_TEMPLATE_PATH` fatal (trap 29) happened because an article
    rendered under *Stratum* while still being forced to use *ja_v5*'s layout; an override file
    loaded outside its own template's environment finds the constant missing. Clearing `ja_v5:*`
    globally ended the fatals but **cost the pages that kept the old skin their container layout**:
    blog articles laid out at 100% width (the origin uses 48%). Rule: a page moving to the new mold
    loses its old override; a page keeping the old mold **keeps** it. The fix: `article_layout`
    restored to `ja_v5:blog` for the 16 items still pinned to an ja_v5 style → 693px/48%, matching
    the origin to the pixel.
38. **Overflow and "not inside a container" are TWO different faults, and every overflow measure is
    blind to the second.** A page whose text runs full-bleed does not overflow at all
    (`scrollWidth` = viewport), so page-width, edge-bleed and parent-escape all pass — while a
    person sees it instantly. Add a **content-measure** to `layout-qa`: the longest in-flow
    paragraph or heading (≥40 characters) as a percentage of the viewport at ≥1024px — ≥92% is a
    FAIL, "text is not inside any container". Negative test: remove the layout → it reports
    `content-measure=100% (1440px)`; restore it → clean.
39. **A page's style carries its layout FAMILY — restoring a layout must follow the family, not one
    type for all.** After trap 37 the fix restored `ja_v5:blog` to all 16 items → the template
    product pages (`/joomla/templates/ja-lens`) wore the blog layout instead of the portfolio one
    and still ran 100% wide. The style *name* is **the only surviving record** of that intent:
    `ja_v5 - Portfolio` → `ja_v5:portfolio`, `- Docs` → `documentation`, `- T4 Builder` →
    `t4-blocks`, everything else → `blog`. Applied by family: the markup matched the origin
    (`pd-item-article`), width **1336px/93% — pixel-identical to the origin**.
40. **Calibrate a gate's threshold against the REAL site, never against a feeling.** The
    content-measure threshold first set at 92% would have failed the origin itself: the real
    portfolio page runs at 93% **deliberately**. Raised to 97% — only genuinely unbounded text
    fails. The general rule: measure the origin before fixing a threshold; **a gate the real site
    fails is a gate nobody trusts.** A second consequence: **the gated list contains only the pages
    this run OWNS**; pages keeping the old skin go into the crawl as report-only — two old pages
    forced into the gate immediately "failed" on an 11px overflow from the ja_v5 header, while
    **the origin overflows 15px** at the same viewport. That is a customer-report finding, not a
    defect of the run.
41. **A page standing still hides behavioural faults — the gate has to PRESS it.** The first four
    gates only measured the page at load: a menu that does not open, an accordion that does not
    expand, JavaScript throwing — all **invisible**. `visual-qa` gained two more measures:
    (a) **interaction** — at 375px, press the toggler and count visible links again; a control
    carrying `aria-expanded` must flip (judged only where the template declares that contract
    itself); (b) **js-error** — the page's own `pageerror` plus console errors, **exempting
    third-party CORS/CDN noise** (a dressing run can neither cause nor cure a font host refusing
    cross-origin). Architectural conclusion: **do not use Claude-in-Chrome** for this — it needs a
    person at a machine, locks in a vendor, and is not deterministic; headless Playwright on the
    fleet host does both jobs, repeatably, and the client's machine installs nothing.
42. **A selector that guesses a container name is a false-positive factory.** The first interaction
    check counted links inside `.off-canvas` — Teline calls its panel `.t3-off-canvas`, so it
    reported "the menu did not open" while it opened perfectly (0 → 177 links, with the class
    `off-canvas-open` added). The fix: **count every visible link on the page**, do not guess the
    frame. The negative test proved both directions: hiding `.t3-off-canvas` → FAIL
    "toggler opens nothing (153/153)"; injecting a `throw` into the template's JS → FAIL on all
    three viewports; restoring both → 3/3 clean.

### Fixture 2 graduation (2026-08-12)

The pair **ja-teline-v (client) × ja_stratum (mold)** ran the whole line: frozen scan → diff →
a REAL `install-demo-frame` (template + t4 + the style pair + home pin) → `sync-extensions` (ACM) →
`port-assets` (23/23) → `fill-block` on a hero carrying a real teline news article → a REAL
`undress` → teline back to its exact previous state (default style 9, home rendering Teline V, zero
reskin modules, pins restored from the book). Recorded limit: the extension row the dressing added
(t4) is not deleted — harmless, since it is disabled and no style points at it, but a debt if an
absolute undress is ever needed.

### Traps 43–51 — from joomlart.com × ja_teline_v (2026-08-12, the third full dressing)

43. **The old template family's layout is pinned in menu `params` too — and it only detonates when
    routed under the new skin.** After dressing with Teline, every article page 500'd with
    `Class "JAHelper" not found`: articles route through a menu item carrying
    `article_layout=ja_v5:blog` → the ja_v5 override loads → it calls a helper that only exists
    while ja_v5 is active. Pages pinned BACK to ja_v5 keep theirs (they need that layout — traps
    29/39 from the Stratum run); pages newly dressed or inheriting the new default must have
    `article_layout` reset to `_:default`. This run: 16 menu items, fixed via fill-block's
    `page.menu params`.
44. **Two dressing runs stacked on each other left an old snapshot pointing at a style the later run
    had deleted — undress produced a site-wide 500** (a non-existent default style, so
    SiteApplication could not resolve a template). The fix is folded into `undress.sh`: a dead pin →
    0, a dead default → a deterministic fallback (the "- Default" style of the enabled template most
    pinned in the snapshot).
45. **A mold's layout may call an API the client's Joomla has dropped.** `ja_teline_v:xblog` died on
    `Pagination::get()` on the client's newer Joomla while running fine on the demo (older Joomla).
    Before mapping one of the mold's layouts, **probe it on the client copy itself** (non-SEF plus
    Itemid); if it breaks, use the portable pattern `blank + load_position + ACM block` — the
    mapping's content does not change.
46. **Teline's ACM `show_front` is a GLOBAL featured filter that overrides catid.** `show`/`only`
    pull featured articles from every category, so a block for "catid 96" shows articles from
    elsewhere. To respect the mapped mine, use `hide`. Satellite: for the same shape, one module
    stores the key as `catid` and another as `catid[]` — an override must match the source module's
    ACTUAL key, never trust the field name in the shape.
47. **T3 bundles CSS into `t3-assets` — a tint has to live in a SOURCE file that is in the bundle**
    (template.css), and `t3-assets/css/*` plus the cache must be cleared after every edit. `undress`
    now strips the marker from every template CSS file and cleans the bundle.
48. **A link probe must not follow redirects.** A 301's Location is an absolute public URL —
    following it leaves the loopback, hits the CDN edge, and collects a bogus 403. Fixed in
    `design-qa`: 2xx/3xx = alive, no following. Plus a `link_allow` list for links that are
    genuinely dead on the origin too (inherited content) — they go into the customer report, they do
    not block the gate.
49. **`scrollWidth > clientWidth` does not always mean text is being cut.** Teline's breadcrumb
    chevrons have generous padding and `overflow: visible`, and nothing is lost. `visual-qa` only
    counts a clip when the element is a genuine clipping context (overflow ≠ visible).
50. **A Bootstrap-3 float grid is invisible to a colsOf built for flex/grid/`.row`** — the wrapper is
    `display: block` and carries no `row` class, so column counting is wrong in both directions
    (the glossary "failed" for not folding). The fix is to recognise a container by having ≥2
    children carrying `col-*` classes, and to compute the desktop baseline PER PAGE (the same block
    type has different column variants on different pages). After changing the ruler, both
    reference and compare must be re-measured, and the negative test re-run (force 3 columns at
    mobile → correct FAIL → remove → clean).

    **Landed here 2026-08-19**, and worth recording how late. This entry read "`responsive-qa`
    now recognises…" for months while the git history said otherwise: `col-` had never appeared
    in `responsive-qa.mjs` in any commit in this repo, and the baseline was keyed `type|viewport`.
    The fix was made somewhere else and never travelled; the sentence stayed and got quoted as
    fact.

    Measured on a float grid before and after, same page, same block:

        desktop   old ruler 1 column   new ruler 3 columns
        mobile    old ruler 1 column   new ruler 1 column

    One column at every viewport reads as "collapsed" on BOTH sides of the comparison, so the
    gate could not fail — and in the other direction a grid that folded correctly was reported
    as broken. The negative test this entry asks for now passes end to end: reference records
    3→1, a clean client is green, forcing three columns at mobile fails naming the block and the
    page, removing it goes green again.

    The lesson is the entry itself, not the grid. A trap log written in the past tense is a claim
    about code. Any line here that says a script "now does X" is worth grepping for before it is
    relied on — the `--variant` contract was lost the same way, asserted in three files and
    honoured by three of five gates.
51. **An SVG logo with no declared width/height collapses to 0 in a shrink-to-fit chain**
    (inline-block + `max-width:100%` loop; a PNG escapes thanks to its intrinsic size — which is why
    the demo never showed it). Two branding satellites: the client has no white logo variant, so a
    dark footer uses `filter: brightness(0) invert(1)` inside the tint block with the image file
    untouched; and the `#esurl#` token in the client's menu is only translated by a plugin on the
    origin site — on the copy it must be replaced with a real link (looked up internally, or
    absolute to the origin for the parts outside Joomla).

## Toolkit status (2026-08-19)

Build scripts, unchanged: `scan-demo` · `scan-client-site` · `scan-extensions` ·
`install-demo-frame` · `sync-extensions` · `port-assets` · `fill-block` (takes a JSON job — the
agent writes no SQL) · `undress`.

Gates, reorganised 2026-08-19 into the two skills that own them:

- `design-qa`: `design-qa.sh` (text) · `visual-qa.sh` · `layout-qa.sh` · `pixel-diff.sh` (new).
  The three browser tiers are wrappers over one engine, `browser-qa.sh --tiers …`; naming several
  in one call renders each page once instead of once per tier (63 page loads became 28 on a
  seven-page loop).
- `reskin-qa`: `reskin-verify.sh` (expectations) · `responsive-qa.sh` · `skin-diff.sh` (new).
  Both differential gates render through `design-qa`'s engine, so that skill must be installed
  beside this one.

The joomlart × stratum fixture is fully dressed: chrome plus 7 pages, design-qa 6/7 (home waiting on
the last placeholder), visual-qa 21/21.

## Acceptance criteria

- The three scans run on the fixture and produce three books matching their schemas; the Stratum
  mold book lists exactly 8 inner-page patterns plus an asset list of 23 images plus 2 styles.
- `fill-block` refuses params of the wrong shape (missing field, mismatched array lengths)
  **before** writing to the database.
- The whole 1→8 line on the fixture reproduces the live home and pricing pages; `design-qa` green.
- `undress.sh` returns the client site to its previous state (a database diff of the relevant tables
  is empty, the style is back).
- An agent following the skill is not granted direct SQL access to the areas the scripts own.

## Out of scope (deliberately)

- **Pages of components other than com_content** (forum, shop…) — this round handles com_content
  only; a path for other components is an open question.
- **Patching words hard-coded into the template's PHP** (copyright/tagline inside tpls) — beyond the
  database; whether there should be a "patch the template" step needs its own decision.
- **WordPress** — the same philosophy, a different mechanism (theme mods/customizer instead of ACM);
  its own spec when its turn comes.
- **Pull latest / Apply-back** — a different data direction, with its own spec.
- Automatically choosing a template that suits a client site (recommendation) — after the toolkit is
  solid.

## Open questions

- (a) Mapping the demo's footer menu onto a real menutype: leave it to the agent in the mapping, or
  build a dedicated menu-building script?
- (b) A path for non-com_content pages.
- (c) Is there a "patch the template's PHP" step for words hard-coded in code?
- (d) The scripts run from `/opt/tracy-fleet/reskin` first, and become endpoints of a Super MCP on
  the working copy later — the structure stays, only the calling convention changes.
