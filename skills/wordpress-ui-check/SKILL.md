---
name: wordpress-ui-check
description: Look at a WordPress site the way a visitor does and report what looks unfinished, inconsistent or missing. Empty sections, a contact page with no address, filler text and theme demo pages still live, buttons that lead nowhere. Judges each page from a real browser screenshot and its measurements, then walks the findings one at a time and remembers every decision, so a second run carries on where it stopped. Use when someone asks how their WordPress site looks, whether it looks finished, wants a design or UX review, or says "check my site", "does this look done", "soi giao dien". Use site-scan for robots.txt and sitemaps, design-qa for broken pages.
version: 0.2.0
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

## The review is a document, not a report

What this produces is `review.json`, and it accumulates. It holds every finding, what the person
decided about each one, and what each reviewed page said at the time. That last part is what makes
a second look cheap: pages whose words have not changed are not opened again, and every decision
already made about them stands.

So the run does not always start at the beginning. **Read `review.json` first** — the shape and the
merge rules are in [`references/review-file.md`](references/review-file.md) — and take whichever of
these three it turns out to be:

| What you find | What to do |
|---|---|
| No review file | A full run: survey, capture, look, build, then go through it. |
| Findings still `new` or `seen` | **Carry on from there.** Do not scan again — go straight to *Going through it*. |
| Everything decided | Ask what changed: `survey.mjs --since`. Nothing changed means nothing to do unless they say otherwise. |

The middle row is the one that is easy to get wrong, and getting it wrong costs the person their
own work: re-scanning resurrects every fault they already waved away.

## The run

```
survey.mjs   →  which Preview, is it WordPress, and which pages are worth opening
capture.mjs  →  render each page, screenshot it, measure it
   you       →  look at each page and answer the fixed checks
review.mjs   →  merge what you saw into what was already known
   you       →  go through it with the person, one finding at a time
```

### 1. Survey

```
node scripts/survey.mjs --site <url> --target auto --out <work>/survey.json
```

It answers three things.

**Which Preview to read.** A site managed by Tracy exists twice: the live domain, and a Preview
at `<label>.tracy.ai` — which is what the preview pane beside the chat is showing, so it is the
version the person is looking at while they read the review. `--target auto` prefers that copy and
falls back to the live site when none answers. Use `--target live` to force the public site,
`--target preview` to insist on the Preview and fail rather than quietly review the wrong one, or pass
an address for a Preview somewhere else.

**Whether this is WordPress at all** — if it is not, stop and say so plainly, and point at
`site-scan` if they still want the machine-readability side. Everything below depends on WordPress
templates, and running anyway would be guessing.

**Which pages to open.** A thousand-page site is not a thousand designs; it is seven or eight
templates with different words poured in, plus the pages somebody arranged individually. The survey
takes one page per template and every page-shaped page, which lands around fifteen to twenty for a
site of any size. It reports `droppedFromReview` when it had to cut — carry that number into the
review rather than quietly reviewing a slice.

**Tell the person what you found before spending their time**: which Preview, the platform, how many
templates, how many pages you are about to open, roughly how long. Then go.

#### Looking again, later

```
node scripts/survey.mjs --site <url> --since <work>/review.json --out <work>/survey.json
```

This stops asking which pages exist and asks which of the pages already reviewed have changed: one
plain fetch each, a few seconds against the minutes a capture costs. Only the changed ones go
through to capture. Say the numbers out loud — *"three of nineteen pages changed"* — because
"nothing changed" is a real answer and a useful one.

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
3. Work through the fixed checks in [`references/checks.md`](references/checks.md), which carries
   the id, the signal in the numbers, the signal in the picture, and — the part worth reading —
   when **not** to raise each one.
4. Add anything else you saw that the fixed checks have no name for.

Three habits keep the review trustworthy:

**Quote the numbers, do not estimate them.** The measurements are there so you never have to write
"about 250 pixels". Saying "298px tall, 55 words" costs nothing and is checkable.

**Name the block, do not describe the position.** Every measured element has an id like `b12`. Put
those ids in `blockIds` and everything downstream is derived for you: the css address, the
rectangle, and the fingerprint that lets the next run recognise this same finding. Never write
coordinates or selectors yourself — a hand-written selector is a guess about a DOM you did not
measure.

**Say which viewport you were looking at.** A finding that only exists at 390px wide is a different
finding from one that exists everywhere — and the review files it as one.

The cross-page checks — mismatched phone numbers, a brand name written three ways, buttons that do
the same job with different labels — can only be answered once every page is captured. Do them
last, in one pass over all the pages' `visibleText`.

### 4. Build the review

Write `findings.json`, then merge it into whatever was already known:

```
node scripts/review.mjs build --review <work>/review.json \
  --capture <work>/capture --survey <work>/survey.json --findings <work>/findings.json
```

```json
{
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

`id` here is the check's id; the review gives each finding a stable `f1`, `f2` of its own and keeps
it across runs. `kind` is `fixed` for anything in `references/checks.md` and `free` for what you
noticed yourself. The distinction is not bureaucracy: the fixed checks have stable ids, so a second
run can be compared against the first and an owner can tell a fix from a mood.

Free observations are also how the skill grows. One that keeps recurring across sites has earned a
place in `references/checks.md` with an id of its own.

Write `forOwner`, `forBuilder` and `summary` in whatever language the person is speaking to you in;
`language` records which that was.

The command reports what the merge did — how many findings are new since last time, how many were
carried over untouched, how many were proved fixed. Those numbers are worth repeating to the
person.

### 5. Going through it

Not a file you hand over. A conversation, and `review.mjs` gives you one command per turn.

**Open with the numbers, not with a question.**

```
node scripts/review.mjs overview --review <work>/review.json
```

Say them plainly: how many findings, how they split by severity, how many were set aside on an
earlier pass, which Preview this was read against and when. Then offer to start.

**Then one at a time.**

```
node scripts/review.mjs next --review <work>/review.json
```

For each one, say what it is, which page, the measurement, and one sentence on why it costs
something. Then offer exactly three choices, as an `AskUserQuestion` so they are buttons rather
than typing:

| Choice | What you run |
|---|---|
| **Save it to fix** | `review.mjs decide --review <path> --id f7 --state saved` |
| **Skip it** | `review.mjs decide --review <path> --id f7 --state ignored` |
| **Tell me more** | Explain, then ask the same question again. Record it with `--state seen` if they leave it there. |

`decide` hands back the next finding in the same breath, so a turn is one command and not three.

There is deliberately no "fix it now". Repair is long work, and starting it mid-review loses the
thread and leaves every remaining finding hanging. Fixing happens afterwards, from the saved list.

**The small ones arrive together.** Once only `low` findings are left, `next` returns them as a
batch — ask once, *"four small things: look at each, keep them all, or skip them all?"* Four
questions to settle four things nobody would have named unprompted is where a person stops
answering.

**Close it.** When nothing is open, say what was saved and what was set aside, name `review.md` as
the written record, and say what happens next time: an untouched site will not be re-scanned, and a
changed one gets only its changed pages read again.

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

**Do not edit `review.json` by hand.** Every change goes through `review.mjs`, which keeps
`review.md` in step and keeps the fingerprints intact. A hand-edited review is one that stops
recognising itself on the next run, and nothing will tell you it has happened.

**Leave the review where the next person will find it.** Inside a Tracy site folder that means
`TracyWork/deliverables/ui-check/` — one open review per site, not a folder per day, because a
folder per day cannot answer "carry on where I left off". Never `TracyWork/surface/` or
`TracyWork/digest/`: every Sync overwrites those. Standalone, the same shape goes in
`./wordpress-ui-check/` where the person is working.

**Do not review pages you did not open.** Everything you write comes from a screenshot you looked
at. If the survey dropped pages, say how many rather than implying the whole site was seen. If a
second run read only three pages, say that too — the other findings are carried, not re-checked.

**Do not accuse on a guess.** Every check in `references/checks.md` carries a "leave it alone when"
clause, and they are there because each one has already produced a false positive on a real site.
A stock photo you are not sure about, a button that opens a menu rather than travelling, a caption
that is meant to be small — saying nothing costs less than being wrong in front of someone's
client.
