---
name: design-qa
description: The absolute QA gates for any site change - what makes a page broken regardless of what anyone was building. Horizontal overflow, overlapping nav, elements escaping their parent, collapsed sections, giant media, broken images and dead CSS backgrounds, a mobile menu that will not open, JS errors, PHP fatals, dead links, and a pixel diff against the last known-good render. Use after ANY change to a site's pages - a reskin, a content edit, a CSS tweak, a new page.
version: 1.1.0
platforms: any
provenOn: joomlart.com (caught the trap-37 blog 500 the homepage hid)
---

# Design QA — the scale, not the expectation

These gates know nothing about what you were trying to build. They answer one question:
**is this a broken page?** — by criteria true on every site. What a specific dressing was
supposed to achieve is a different judgment: that is `reskin-qa`, and its expectations live
with each proposal.

Four gates, cheap → expensive:

1. **`design-qa.sh`** — text tier, seconds. HTTP 200, no literal `{loadposition}`, no PHP
   fatal leaking into the page, every internal link and image < 400 (code samples in
   `<pre>`/`<code>` excluded — documentation is not navigation). Pages and links are fetched
   concurrently; when the `--max-links` cap leaves links unprobed the run says so per page.
2. **`visual-qa.sh`** — geometry, behaviour and assets, headless Chromium, three viewports.
   Horizontal overflow, nav items overlapping, edge bleed, clipped labels, broken images,
   **any asset this site's own server answers 4xx/5xx for** (CSS backgrounds included), and
   uncaught JS errors — and it PRESSES the page: a mobile toggler must reveal a menu, an
   `aria-expanded` control must flip. A page standing still hides behavioural breakage.
3. **`layout-qa.sh`** — box model. Sibling sections stacking on each other, children
   escaping their parent's width, sections with content but no height, media taller than
   the viewport or upscaled far past natural resolution, text no container binds.
4. **`pixel-diff.sh`** — the same page, before and after. No browser: it compares the
   screenshots tier 2 already wrote and produces a diff image where red is what moved. A
   rule written in advance cannot catch a regression nobody predicted; last week's picture
   can.

**Every one of them takes `--variant <slug>`** to judge a proposal instead of the site — and
now every one of them actually sends the header. Two used to accept the flag nowhere and
send it never, so a proposal run silently graded the live site and passed. Each report also
records the variant it graded, because a run against the wrong database used to be
indistinguishable from a correct one afterwards.

## Running them together is the fast path

Tiers 2 and 3 are one engine, `browser-qa.sh`. Naming both in one call renders each page
once instead of once per tier:

```
browser-qa.sh --host <h> --port <n> --pages "/,/pricing" --tiers visual,layout --variant <slug>
```

A seven-page loop across all three browser tiers costs 28 page loads that way, against 63
when each tier launched its own container and its own Chromium. `visual-qa.sh` and
`layout-qa.sh` still exist, still take their old flags, and still write their old files.

The pixel tier needs a baseline before it can say anything:

```
visual-qa.sh --host <h> --port <n> --pages "/,/pricing" --out out/visual
pixel-diff.sh --before out/baseline --after out/visual --out out/pixel
# look at out/pixel/diff-*.png, then, if every change was intended:
pixel-diff.sh --before out/baseline --after out/visual --out out/pixel --accept yes
```

## Discipline that is not optional

- **A gate that has never caught a real defect is not yet trustworthy.** Prove it negative:
  inject a breaking style, watch the gate fail, remove it — see "Trusting a gate" in
  `references/qa-scans.md`. Every threshold now has a case in `__tests__/` naming the
  incident that set it, so tuning one means deleting that evidence on purpose.
- Thresholds are calibrated against the origin site itself, not against taste: a gate the real
  site fails is a gate nobody trusts.
- Full-page screenshots ship with every visual run, and `pixel-diff` turns them into a
  verdict. It still cannot see a block that is *arranged but wrong* — look every round.

**`references/qa-scans.md`** carries what each gate measures and why: the link taxonomy and probing
rules, the accessibility catalogue with its demo-baseline method, what the machine eye can and
cannot see, and how a threshold gets calibrated. Read the section for the gate you are about to
argue with — every rule there was paid for by a real failure, and the reason is attached.

Inside Tracy, `visual_qa` is a tool the Site agent already holds; the scripts are for hosts
where no tool reaches. Scripts live in `scripts/` beside this file and deploy to
`/opt/tracy-fleet/reskin/` on the fleet host — set `TRACY_QA_HOME` to run them anywhere else.
