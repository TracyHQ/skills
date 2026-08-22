# Content mapping: Blog September

> Reviewed by a person before anything was built. A job that does not name this file is refused.
> Derived from the mirror at commit `a1b2c3d` (Sync 2026-09-01). Written 2026-09-02.

## Where the batch lands

| | Value | Read from |
|---|---|---|
| Category | `Insights`, catid 42 | `digest/content-map.md`, category list |
| Menu | nothing new; `Insights` is already in mainmenu | content map, menu tree |
| Language | `de-DE` | brand brief |
| Signing account | `redaktion`, user id 12 | brand brief |

No new category, no menu change, no template change. A content batch only adds articles.

## What the topic list was derived from

`surface/crawl-report.json` for this Sync: 214 urls discovered, 214 html fetched, `cappedHtml` 0.
The site was read in full, so "the site has no article about X" is a claim about the whole site
and not about a sample.

## The articles

| # | Job | Title | The gap it fills | Page that proves the gap |
|---|---|---|---|---|
| 01 | `01-job.json` | Checkliste für einen Website-Relaunch | Three service pages describe relaunch work; nothing links into them | `surface/pages/leistungen-relaunch.json` |
| 02 | `02-job.json` | Woran es liegt, wenn die Seite langsam lädt | The same question appears on four FAQ pages, answered four different ways | `surface/pages/faq-technik.json` |
| 03 | `03-job.json` | Joomla 3 auf Joomla 5: was sich ändert | Their about page says they migrate sites; no page says what a migration changes | `surface/pages/ueber-uns.json` |
| 04 | `04-job.json` | Barrierefreiheit: die drei Punkte | A service page names the BFSG without explaining it | `surface/pages/leistungen-barrierefreiheit.json` |

## Decided against, and why

- **"Warum Joomla besser ist als WordPress"** — the site takes no position on this anywhere, so
  the article would be inventing an opinion for them.
- **"Unsere Preise erklärt"** — the brand brief forbids prices, and the site publishes none.
- **A case study of a client project** — they deliberately have no reference page.
