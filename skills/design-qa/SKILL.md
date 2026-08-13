---
name: design-qa
description: The absolute QA gates for any site change - what makes a page broken regardless of what anyone was building. Horizontal overflow, overlapping nav, elements escaping their parent, collapsed sections, giant media, broken images, a mobile menu that will not open, JS errors, PHP fatals, dead links. Use after ANY change to a site's pages - a reskin, a content edit, a CSS tweak, a new page.
version: 1.0.0
platforms: any
provenOn: joomlart.com (caught the trap-37 blog 500 the homepage hid)
---

# Design QA — the scale, not the expectation

These gates know nothing about what you were trying to build. They answer one question:
**is this a broken page?** — by criteria true on every site. What a specific dressing was
supposed to achieve is a different judgment: that is `reskin-qa`, and its expectations live
with each proposal.

Three tiers, run in this order (cheap → expensive):

1. **`design-qa.sh`** — text tier, seconds. HTTP 200, no literal `{loadposition}`, no PHP
   fatal leaking into the page, every internal link and image < 400 (code samples in
   `<pre>`/`<code>` excluded — documentation is not navigation).
2. **`visual-qa.sh`** — geometry + behaviour, headless Chromium, three viewports.
   Horizontal overflow, nav items overlapping, edge bleed, clipped labels, broken images,
   uncaught JS errors — and it PRESSES the page: a mobile toggler must reveal a menu, an
   `aria-expanded` control must flip. A page standing still hides behavioural breakage.
3. **`layout-qa.sh`** — box model. Sibling sections stacking on each other, children
   escaping their parent's width, sections with content but no height, media taller than
   the viewport or upscaled far past natural resolution.

All three take `--variant <slug>` to judge a proposal instead of the site — miss it and you
grade the wrong thing, and it passes.

## Discipline that is not optional

- **A gate that has never caught a real defect is not yet trustworthy.** Prove it negative:
  inject a breaking style, watch the gate fail, remove it (trap 36).
- Thresholds are calibrated against the origin site itself, not against taste (trap 40).
- Full-page screenshots ship with every visual run — machines pass layouts that are
  *arranged but wrong*; eyes catch those. Look every round.

Inside Tracy, `visual_qa` is a tool the Site agent already holds; the scripts are for hosts
where no tool reaches. Scripts live in `scripts/` beside this file and deploy to
`/opt/tracy-fleet/reskin/` on the fleet host.
