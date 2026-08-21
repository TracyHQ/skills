---
name: reskin-qa
description: Judge a dressed site against what THAT dressing promised - the mapping's markers on every page, the branding deny-list across visible text and attributes, responsive behaviour compared to the demo's own reference, and a side-by-side skin diff that shows demo against dressed page in one image. Use after building or rebuilding a reskin proposal, and before showing it to anyone. Distinct from design-qa (absolute brokenness) - run both.
version: 1.1.0
platforms: any
provenOn: joomlart.com (responsive reference vs ja_stratum demo)
requires-mcp:
  - tracy-reskin
---

# Reskin QA — did we deliver what the mapping promised?

`design-qa` asks "is this page broken?". This skill asks the other question: **is this page
what the proposal said it would be?** The expectations are not in this skill — they are
per-proposal data, living in the proposal's own directory (`jobs/*.json` verify blocks,
`expect-pages.json`, the mapping). This skill is how to judge against them.

Three gates:

1. **`reskin-verify.sh`** — text against expectations. Per page: the mapping's markers
   present, forbidden demo strings absent, and the branding deny-list nowhere a reader can
   reach it — visible text *and* `alt`, `title`, `aria-label`, `placeholder` and meta
   `content`, which a screen reader announces, a search engine indexes and a tooltip shows.
   Scripts and styles stripped; case-insensitive; an allow-list covers legitimate
   real-content mentions (trap 25). Third-party names are data, never denied.
2. **`responsive-qa.sh`** — behaviour against the demo, not against absolute rules.
   `--mode reference` on the DEMO first (records how each block type stacks at
   375/768/1024/1440), then `--mode compare` on the dressed copy. It fails when a block
   refuses to collapse the way the demo's does, scrolls sideways where the demo's does not,
   or the nav stays expanded where the demo folds it (traps 34-35: compare fold rhythm,
   never absolute column counts).
3. **`skin-diff.sh`** — does the page WEAR the demo's skin, and what does the pair look
   like? Same two-run shape. The machine half judges what content cannot legitimately
   change: the demo's palette (weighted by painted area), its typeface, the container bands
   its layout is built on — a page that lost a stylesheet, fell back to a default serif, or
   lost its wrapper fails here with every geometry gate green. The eyes half writes a
   **contact sheet per page per viewport: the demo on the left, the dressed page on the
   right, in one image.**

All three take `--variant <slug>`, and now all three actually send the header —
`responsive-qa` used to accept the flag nowhere, which left the mode whose entire job is
judging a dressed proposal with no way to reach one. Both differential gates refuse to run
when their reference was recorded against the host being judged: that mistake overwrote the
demo's reference and made every later compare pass, silently, forever.

## Then look

`skin-diff` gives the eyes step a command and an artifact; it does not replace the eyes.
A block still wearing demo content, a logo dwarfing its column, a teaser whose copy never
got replaced — those are *arranged validly but wrong*, and trap 28 says the agent's eye on a
full-page screenshot is the only thing that has ever caught them. The contact sheet exists
so that look takes one image instead of twenty-one.

## Who runs this

Ideally not the agent that built the dressing. A builder grading its own work re-reads its
own assumptions; a second agent holding only `design-qa` + `reskin-qa` judges what is
actually on the page. Every FAIL goes back to the builder as a mapping decision, not as a
patch on the preview — the proposal's directory is the thing to fix.

## Install `design-qa` too — nothing will do it for you

`responsive-qa` and `skin-diff` render through `design-qa`'s browser engine: one browser and one
page load serve every tier. **Installing this skill alone leaves those two gates dead on first
use.** Tracy Desk installs each skill into its own folder under one library root and resolves
`requiresMcp` only — it has no concept of one skill needing another, so nothing pulls `design-qa`
in behind this one. Install it yourself.

Once both are installed the sibling layout is what makes the lookup work. Each script tries
`$DESIGN_QA_SCRIPTS`, then the sibling directory, then `$TRACY_QA_HOME/design-qa/scripts`, and
says which it wanted rather than failing obscurely.

A `requires-skill:` frontmatter key used to sit above, declaring this. It was removed once the
runtime was read: no validator checks it, the published index does not carry it, and the
installer has never heard of it. A declaration nothing reads is worse than none — it reads like
a guarantee.
