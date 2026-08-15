# Fixture mapping v1 — joomlart.com × ja_stratum

The pipeline's first mapping table, built on the fixture on 2026-08-11. It served as a real table
for review, and it doubles as the **exemplar**: this is what a correct mapping table looks like.

- Sources: `stratum-pattern-library.json` · `joomlart-content-inventory.json` ·
  `extension-diff.json` (`out/` on the fleet host), plus the six hand-looked-up facts recorded in
  traps 16–19 of `spec.md`.
- Status: **AWAITING APPROVAL** — only ticked rows get built.
- Ground rules: real copy stays verbatim; branding has no placeholder tier; a link is looked up,
  never invented.

## A. Global decisions (the reviewer ticks)

| # | Decision | Proposal |
|---|---|---|
| A1 | Palette | ☐ Keep the Stratum palette (default) · ☐ tint the primary to JoomlArt's `#007AFF` |
| A2 | Scope of this run | Chrome + Home + Pricing (built) + the two pages ticked in section C |
| A3 | The way back | `undress`: delete rows with id > 1000, default style back to ja_v5, re-pin as the content inventory recorded |

## B. Chrome (once for the whole site)

### B1. Header

| Thing | Currently (demo) | Mapping (real) |
|---|---|---|
| Brand word | "JoomlArt" (already picked up the sitename) | Keep. Logo file: choose from the 10 candidates in the content inventory — the reviewer must name the primary and the dark variant |
| CTA "Sign in" | `/login` (a demo route) | The client's real login link — **look it up on the origin, do not guess** |
| CTA "Start free" | `/register` (does not exist) | Relabel to "Pricing" → `/pricing-stratum` |
| Off-canvas (module 1206) | a copy of the demo's | Apply both decisions above identically (it is the twin) |

### B2. Footer (3 columns + legal + newsletter)

| Demo column | Demo binding | Mapping (real) |
|---|---|---|
| Product | `footer-product` (all `#`) | The real `quick-navigation`: Pricing · Demo · Forums · Documentation · Download |
| Developers | `footer-developers` (all `#`) | The Support branch of mainmenu: Documentation · Video Tutorials · Glossary · Support Policy |
| Company | `footer-company` | The real `footer-menu`: Terms · Privacy · Refund · Licenses · Contact |
| Legal row (module 184, hard-coded IDs 95/96/97 → 404) | The demo's Privacy/Terms/Cookies | Privacy = article **121** · Terms = **120** · Cookies **has no real page** → use Refund Policy = **122** instead (do not invent a page) |
| Copyright | "© Stratum" | "© JoomlArt.com" |
| Newsletter form | posts to `#` | Do not keep a fake form: replace it with a link to the real Newsletter Signup page (menu item 757) |
| `footer-brand[logo]` | the Stratum logo (current debt) | The JoomlArt logo (per B1) |

## C. 1:1 mapping — real page ↔ mold pattern

| Real page | Pattern | Content source per block | Status |
|---|---|---|---|
| Home (435) | `home`, 15 blocks | hero ✅ real copy; stats → real numbers (19 years, 300+ templates, 60+…); features grid → the three products (Templates / T4 Builder / Extensions); pricing teaser → the four real tiers; FAQ → the Joomla FAQs category (9 articles); clients + testimonials → **no real source → flag as placeholder** | Hero done, the rest still demo text |
| Pricing (915) | `pricing-page` | The four real tiers from article 2629 | ✅ Built |
| Blog (629, cat 96 = 87 articles) | `blog` (featured + search + CTA) | mod_articles_news flows by itself; com_finder enabled, masthead is real copy | ✅ Built 2026-08-12 |
| Joomla MCP (913) | `features-page`, 5 of 7 blocks (stats and testimonial dropped: no source) | Real copy taken from the real landing page | ✅ Built 2026-08-12 |
| T4 Framework (793) / T4 Page Builder (766) | `solutions-page` / `features-page` | cat 163 (23 articles) / cat 162 (37 articles) | Next round |
| Geo Report (893) | `features-page` + stats | cat GEO 177 (5 articles) | Next round |
| Support → Documentation / Video | **not built** | The mine is EMPTY (cat 113, 109 = 0 articles — the content lives in an external system) | Goes to section G |

## D. Extension actions (from the diff; tick to let `sync-extensions` run)

- ☑ enable `com_finder` + the `finder` content plugin — the Blog pattern's Search block needs it
- ☑ reinstall `mod_ja_acm` 2.5.1 **through the installer** — the files are already 2.5.1 while the
  database manifest still says 2.0.6 (a debt from the manual run; the database must match the files)
- ☐ skip: akwarn, stats, actionlogs, confirmconsent, emailcloak, contact — they serve no pattern
- ⚠ `tracyaccess` is disabled — **out of scope for a reskin**; it belongs to the auto-login lane

## E. Link resolution — the method decision

Diagnosing 44 route-missing cases inverted the assumption: the database path
(`/support/documentation`) **404s on the origin itself** — it was never a public URL. The real URL
is produced at render time by the router plus the alias stratum (on the origin, `/documentation`
returns 301). Decisions:

1. Every link placed into a block or menu comes from the **href of a rendered page** (the real nav)
   or from an origin lookup — a database path is only a hint. The client's routing is not modified
   during a dressing run.
2. `sh404sef_aliases` (78 rows) can be read for lookups; `sh404sef_pageids` holds
   **853k rows — never load the whole table**.

## F. Proposed new pages (approved 2026-08-12: all three built — `/extensions-catalog`, `/solutions`, `/faq`)

| ☐ | New page | Pattern | Real source | Why |
|---|---|---|---|---|
| ☐ | Solutions: for Agencies / Freelancers / Hobby | `solutions-page`, 4 blocks | Membership content + pricing article 2629 | Segmentation is the client's real sales axis |
| ☐ | Extensions catalog | `integrations-page`, 3 blocks | The Joomla Extensions categories (110 + 54 articles) | A rich mine with no proper directory page |
| ☐ | Changelog | `changelog-page`, 2 blocks | The Updates category (122 articles) | Evidence of a 19-year release rhythm |
| ☐ | FAQ | `faq-page` (accordion) | Joomla FAQs (9) + Glossary (93) | The source exists and the pattern ships the JS |
| ☐ | About / 19 Years | `about-page`, 6 blocks | The anniversary/birthday articles | The brand story — the reviewer must confirm the source is rich enough |

## G. Customer report — the parts outside the Joomla install

- **Forums** (a separate application on the origin domain) — links stay absolute to the origin.
- **The Documentation/Video system** — the menu points at empty categories; the content lives in an
  external system.
- **Download portal, demo system, job applications** — the same kind; a working copy does not
  reproduce them.

## H. Placeholder flags still carrying demo words or images (after the ticked work is built)

Client logos (the clients block), testimonial quotes and avatars, feature illustration images. Clear
a flag whenever real material replaces it; QA counts these flags and they are never allowed to rise.
