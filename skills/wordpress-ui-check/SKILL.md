---
name: wordpress-ui-check
description: Look at a WordPress site the way a visitor does and report what looks unfinished, inconsistent or missing — empty sections, a contact page with no address, filler text still live, the theme's demo pages still published, buttons that lead nowhere, mismatched phone numbers, text spilling out of buttons, a phone layout nothing fits in. Renders each page in a real browser, judges the screenshot alongside the measurements, and writes an HTML report where every finding is boxed on the picture. Use this whenever someone asks how their WordPress site looks, whether it looks finished or professional, wants a design or UX or content review, is about to hand a site to a client, or says something like "check my site", "review my homepage", "does this look done", "soi giao diện", "review giao diện website" — even when they do not say the word WordPress. For robots.txt, sitemaps and structured data use site-scan instead; for pages that are outright broken use design-qa.
version: 0.1.0
platforms: wordpress
provenOn: juneflower.vn (Flatsome + WooCommerce, 1,001 urls, 11 templates — five pages reviewed, and the theme's own /price-table/ demo was still live)
---

# WordPress UI check

Two other skills already inspect a website and both are blind to the same thing. `design-qa` asks
whether a page is **broken**. `site-scan` asks whether a machine can **read** it. Neither notices a
page that is whole, legible, and plainly unfinished — a contact page with three social links and no
address, a green band where a section should be, the theme's price-table demo still live at
`/price-table/`.

This skill asks the third question: **does this look finished?** The boundary is the eye. If an
ordinary reader would see it, it belongs here.

That boundary is why the skill renders pages instead of parsing them, and why you judge from a
screenshot rather than from HTML. A model reading markup can tell that a section has few words. It
cannot tell that the section reads as a hole in the page.

## What the run looks like

Four steps. Steps 1, 2 and 4 are scripts; step 3 is you, looking.

```
survey.mjs   →  is it WordPress, and which pages are worth opening
capture.mjs  →  render each page, screenshot it, measure it
   you       →  look at each page and answer the fixed checks
report.mjs   →  an HTML report with every finding boxed on the picture
```

### 1. Survey

```
node scripts/survey.mjs --site <url> --out <work>/survey.json
```

It answers two things. First, whether this is WordPress at all — if it is not, stop and say so
plainly, and point at `site-scan` if they still want the machine-readability side. Everything
below depends on WordPress templates, and running anyway would be guessing.

Second, which pages to open. A thousand-page site is not a thousand designs; it is seven or eight
templates with different words poured in, plus the pages somebody arranged individually. The survey
takes one page per template and every page-shaped page, which lands around fifteen to twenty for a
site of any size. It reports `droppedFromReview` when it had to cut — carry that number into the
report rather than quietly reviewing a slice.

**Tell the person what you found before spending their time**: the platform, how many templates,
how many pages you are about to open, roughly how long. Then go.

### 2. Capture

```
node scripts/capture.mjs --pages <work>/survey.json --out <work>/capture --viewports desktop,mobile
```

Renders each page in headless Chromium, scrolls it so lazy sections load, screenshots it full
page, and writes what it measured: every section with its rectangle and word count, every image
with its natural size against its displayed size, every button and link with its text and
destination, font sizes, text that overflows its box, console errors, and the page's visible text.

Add `tablet` when the site's layout looks like it has a middle breakpoint worth checking. Two
viewports is the sensible default — desktop and mobile disagree the most, and each extra viewport
is another page to look at.

Playwright is the one thing this skill needs that does not ship with it. The script looks for it
beside itself, in the directory the person is standing in, and in a global install — and if none of
those answer it prints the two commands that fix it and stops. Pass those on and stop too; a review
assembled from raw HTML is not the review this skill promises.

The install is one-time and takes a couple of minutes:

```
npm install playwright
npx playwright install chromium
```

The first is the library, the second the browser it drives.

### 3. Look

This is the part only you can do. For each page in `capture/index.json`:

1. Read `capture/pages/<slug>.json` — the measurements for that page.
2. Look at `capture/shots/<slug>--desktop.png`, then the mobile one.
3. Work through the fixed checks in `references/checks.md`, which carries the id, the signal in the
   numbers, the signal in the picture, and — the part worth reading — when **not** to raise each
   one.
4. Add anything else you saw that the fixed checks have no name for.

Three habits keep the report trustworthy:

**Quote the numbers, do not estimate them.** The measurements are there so you never have to write
"about 250 pixels". Saying "298px tall, 55 words" costs nothing and is checkable.

**Name the block, do not describe the position.** Every measured element has an id like `b12`. Put
those ids in `blockIds` and everything downstream is derived for you: the report draws the box from
the rectangle it recorded, and each block also carries a css path so the same element can be found
again on the live page later. Never write coordinates or selectors yourself — a box in roughly the
right place is worse than none, and a hand-written selector is a guess about a DOM you did not
measure.

**Say which viewport you were looking at.** A finding that only exists at 390px wide is a different
finding from one that exists everywhere.

The cross-page checks — mismatched phone numbers, a brand name written three ways, buttons that do
the same job with different labels — can only be answered once every page is captured. Do them
last, in one pass over all the pages' `visibleText`.

### 4. Report

Write `findings.json`, then:

```
node scripts/report.mjs --capture <work>/capture --findings <work>/findings.json
```

It writes two files. `report.html` is for people. `findings.resolved.json` is the same review with
every block already turned into an address, a rectangle and a screenshot — so a later session, or
an editor that wants to highlight these elements on the live page, reads one file instead of
redoing the lookup against every page's measurements.

```json
{
  "site": "https://example.com",
  "reviewedAt": "2026-08-21",
  "language": "vi",
  "summary": "One paragraph for the owner: what a visitor runs into first, and what it costs.",
  "findings": [
    {
      "id": "empty-block",
      "kind": "fixed",
      "severity": "high",
      "page": "https://example.com/contact/",
      "viewport": "desktop",
      "forOwner": "What a visitor experiences, and why it matters. No css classes here.",
      "forBuilder": "The block, the numbers, the viewport. As technical as it needs to be.",
      "blockIds": ["b12"]
    }
  ]
}
```

`kind` is `fixed` for anything in `references/checks.md` and `free` for what you noticed yourself.
The distinction is not bureaucracy: the fixed checks have stable ids, so a second run can be
compared against the first and an owner can tell a fix from a mood. Free observations cannot, so
the report shows them apart and leaves them out of the tally.

Free observations are also how the skill grows. One that keeps recurring across sites has earned a
place in `references/checks.md` with an id of its own.

`language` sets the report's `lang` attribute. Write `forOwner`, `forBuilder` and `summary` in
whatever language the person is speaking to you in — the report's own furniture is English, the
findings are theirs.

## Severity

Rank by what it costs a visitor, not by how wrong it is technically.

- **high** — a visitor cannot do what they came for, or leaves believing the business is not real.
  A contact page with no way to make contact. Filler text on the home page. A phone layout with the
  buy button covered.
- **medium** — noticeably unfinished, but the visitor gets through. An empty section, a demo page
  still live, text too small on a phone.
- **low** — a reader would not name it but would feel it. Inconsistent button labels, pictures in a
  row that do not share a shape.

## What not to do

**Do not repeat `design-qa`.** If a page is broken — horizontal overflow, overlapping navigation,
JavaScript errors, dead links — that skill owns it and says it better. This one is about a page
that works and still looks unfinished. When you see something genuinely broken, mention it once and
point at `design-qa` rather than writing it up here.

**Do not fix anything.** This skill diagnoses. The repair skills are `content-strategist` for copy,
`discoverability-engineer` for markup, `merchant-optimizer` for catalogue gaps. Name the one that
fits when it is obvious; do not start editing.

**Leave the review where the next person will find it.** Inside a Tracy workspace that means
`deliverables/ui-check/<date>/` — `deliverables/` is the folder for outputs meant for people, and
nothing there is ever deployed. Never `surface/` or `digest/`: every Sync overwrites those.
Standalone, the same shape goes in `./wordpress-ui-check/<date>/` where the person is working. A
review nobody wrote down leaves the next session believing the site was never looked at.

**Do not review pages you did not open.** Everything you write comes from a screenshot you looked
at. If the survey dropped pages, say how many rather than implying the whole site was seen.

**Do not accuse on a guess.** Every check in `references/checks.md` carries a "leave it alone when"
clause, and they are there because each one has already produced a false positive on a real site.
A stock photo you are not sure about, a button that opens a menu rather than travelling, a caption
that is meant to be small — saying nothing costs less than being wrong in front of someone's
client.
