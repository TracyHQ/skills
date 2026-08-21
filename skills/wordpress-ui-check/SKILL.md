---
name: wordpress-ui-check
description: Look at a WordPress site the way a visitor does and report what is unfinished or missing. Empty sections, filler text, demo pages, dead buttons, text spilling out of its box. Renders each page in a real browser, walks the findings one at a time, and remembers each decision. Use whenever someone asks how their site looks, whether it looks finished or unprofessional, wants a design or UX or layout review, or is about to hand a site to a client, in whatever language they ask. Use site-scan instead for robots.txt and sitemaps, design-qa for pages that are outright broken.
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

So the run does not always start at the beginning. **Look for `review.json` before anything else**
— the shape and the merge rules are in [`references/review-file.md`](references/review-file.md) —
and take whichever of these three it turns out to be.

Look for it by listing the folder, and open the file only once you know it is there. Reading a path
that does not exist is not free here: the desk opens whatever file you read in the pane beside the
chat, so a first run greets somebody with `File unavailable` before it has said anything at all.

| What you find | What to do |
|---|---|
| No review file | A full run: survey, capture, look, build, then go through it. |
| Findings still `new` or `seen` | **Carry on from there.** Do not scan again — go straight to *Going through it*. |
| Everything decided | Ask what changed: `scan.mjs --since`. Nothing changed means nothing to do unless they say otherwise. |

The middle row is the one that is easy to get wrong, and getting it wrong costs the person their
own work: re-scanning resurrects every fault they already waved away.

Inside Tracy Desk the Launchpad tile has already read the same file and says which of the three it
is, so the request arrives carrying it:

| Request | Means |
|---|---|
| `/wordpress-ui-check` | Nothing here yet, or they asked from scratch. Full run. |
| `/wordpress-ui-check --continue` | Carry on with what is undecided. **Do not scan.** |
| `/wordpress-ui-check --recheck` | Everything was decided; re-read the pages and see what moved. Start at `scan.mjs --since`. |

Read the file anyway. The word is a hint from a tile that was drawn a moment ago, and the file is
the truth — if they disagree, believe the file and say so.

## The run

```
scan.mjs     →  which Preview, is it WordPress, which pages — then render and measure them
   you       →  look at each page and answer the fixed checks
review.mjs   →  merge what you saw into what was already known
   you       →  go through it with the person, one finding at a time
```

**Say what a command is for, in words the shop's owner would use.** The sentence you attach to a
command is the sentence they read on the approval card — it is what they decide on. "Look at 20
pages of juneflower.vn and photograph each one" is a decision somebody can make. "Run survey and
capture" is a job title, and the raw command underneath it is a wall of paths.

**Every command you run costs the person an approval dialog.** Tracy asks before each one, which is
right — a shell runs anything — but it charges per command rather than per risk. So the work is
shaped to spend as few as it honestly can: the survey and the capture are one call, and answers are
written a group at a time. Inspecting costs nothing at all, so look at files with your own reading
tools rather than through the shell. An `ls` you could have done with a file listing is a dialog
somebody has to read, and a dialog that appears eleven times is one nobody reads by the fourth.

### 1. Scan

```
node scripts/scan.mjs --site <url> --work <work> --target auto --viewports desktop,mobile
```

**This is the first command you run. Nothing goes before it** — no checking whether Playwright is
installed, no listing the skill's own folder, no `--version` on anything. Each of those costs the
person an approval dialog in order to learn something this command reports a second later, and the
dialogs are the scarce thing here. If Playwright is missing, this says so and stops, with the two
commands that fix it.

One call, two steps: the survey decides what is worth opening, the capture opens it. They are one
decision — nobody surveys a site and then declines to look at it — so they cost one dialog. A survey
that says no (not WordPress, no answer, a Preview serving its wrapper) stops there and says so
rather than spending minutes proving it.

`survey.mjs` and `capture.mjs` still run on their own when you want one without the other.

The survey half answers three things.

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
node scripts/scan.mjs --site <url> --work <work> --since <work>/review.json
```

This stops asking which pages exist and asks which of the pages already reviewed have changed: one
plain fetch each, a few seconds against the minutes a capture costs. Only the changed ones go
through to capture. Say the numbers out loud — *"three of nineteen pages changed"* — because
"nothing changed" is a real answer and a useful one.

### 2. What the capture half does

Renders each page in headless Chromium, scrolls it so lazy sections load, screenshots it full
page, and writes what it measured: every section with its rectangle and word count, every image
with its natural size against its displayed size, every button and link with its text and
destination, font sizes, text that overflows its box, console errors, and the page's visible text.

Add `tablet` to `--viewports` when the site's layout looks like it has a middle breakpoint worth
checking. Two
viewports is the sensible default — desktop and mobile disagree the most, and each extra viewport
is another page to look at.

Playwright is the one thing this skill needs that does not ship with it.

The script looks in the three places somebody might have installed it — beside the skill, in the
directory they are standing in, and globally — so there is nothing to check beforehand and the scan
above says not to.

**Believe the script over your own check, and never install anything yourself.** Its lookup is not
the obvious one: a plain `require('playwright')` from the skill's folder fails while the script
finds it installed globally and runs perfectly. An improvised check therefore reports "missing" on
a machine where everything works, and the repair for that non-problem writes a package into a
folder nobody asked you to touch. Measured on 21/08, from exactly that sequence.

When the script itself reports Playwright missing, pass its two commands to the person and stop —
they run them, not you. A review assembled from raw HTML is not the review this skill promises.

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

### Which language the review is written in

**The site's own language, not the language the request arrived in.** `survey.json` carries
`language`, read from the `lang` attribute the site writes on `<html>`; use it for `forOwner`,
`forBuilder`, `summary`, and everything you say while walking through the findings. Record it in
`language`.

The reason is who the review is for. A finding is about words on somebody's shop, quoted back to
them, and it is read by whoever fixes the shop — often not the person who pressed the button. A
review of a Vietnamese florist written in English because the request was typed in English makes
every quoted heading a translation of itself, and the person holding the review has to translate it
back before they can find anything.

This is about what you SAY. Anything a machine reads stays English regardless: commands, file
paths, the `echo` inside a shell line, the ids in `review.json`. A command is not a place to speak
to somebody, and a shell line half in one language reads as a mistake in both.

Two exceptions, in this order:

1. **The person asks for another language.** Then use that one, for everything, until they say
   otherwise. An explicit request always wins.
2. **The site says nothing** — no `lang`, or a value that is not a language. Then follow the
   language the person is speaking to you in, and say which you chose so they can correct it in one
   word.

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

| Choice | What it means |
|---|---|
| **See it on the page** | The `show_on_preview` tool, then **ask this same question again**. |
| **Save it to fix** | Note it as `saved` and move to the next finding. |
| **Skip it** | Note it as `ignored` and move to the next finding. |
| **Tell me more** | Explain, then ask the same question again. `seen` if they leave it there. |

**Hold the answers, then write a group at a time.**

```
node scripts/review.mjs decide --review <path> --saved f1,f4 --ignored f2 --seen f3
```

Ask one finding at a time — that is the product, and eleven findings deserve eleven questions. What
must not also be eleven is the number of approval dialogs stacked on top of them, and writing each
answer the moment it is given is what caused that. So carry the answers through the group and write
them in one call: **after the serious ones, after the middling ones, after the small ones, and
always before your turn ends.**

The cost is bounded and worth saying out loud rather than hiding: a session that dies mid-group
loses the answers given since the last write, which means a question asked twice. Nothing is lost
that cannot be answered again in a second.

`decide` hands back the next finding in the same breath, so a flush and the next question are one
command.

**See it on the page** exists only inside Tracy Desk, where the site is open in the pane beside the
chat. Pass the finding's `page` and the first entry of its `selectors`, plus a short `label` — the
pane goes to that page, dims it, and lights the block up. Never write the selector yourself: the
one in the review was recorded by the browser that measured the page, and one you invent is a guess
about a DOM you never saw. If the block has since been edited away the pane says so on screen and
marks nothing.

Two things not to do with it. Do not offer it when `scannedAgainst.kind` is `live` — the pane shows
the Preview, so the button would point at a page the review did not read. And do not treat it as an
answer: looking is not deciding, so after the pane lights up, ask the same question again.

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
