---
name: reskin-qa
description: Judge a dressed site against what THAT dressing promised - the mapping's markers on every page, the branding deny-list, and responsive behaviour compared to the demo's own reference. Use after building or rebuilding a reskin proposal, and before showing it to anyone. Distinct from design-qa (absolute brokenness) - run both.
version: 1.0.0
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

Two gates:

1. **`reskin-verify.sh`** — text against expectations. Per page: the mapping's markers
   present, forbidden demo strings absent, and the branding deny-list nowhere in VISIBLE
   text (scripts/styles stripped; case-insensitive; an allow-list covers legitimate
   real-content mentions — trap 25). Third-party names are data, never denied.
2. **`responsive-qa.sh`** — behaviour against the demo, not against absolute rules.
   `--mode reference` on the DEMO first (records how each block type stacks at
   375/768/1024/1440), then `--mode compare` on the dressed copy. It fails when a block
   refuses to collapse the way the demo's does, scrolls sideways where the demo's does not,
   or the nav stays expanded where the demo folds it (traps 34-35: compare fold rhythm,
   never absolute column counts).

Both take `--variant <slug>`. Then finish with **your own eyes** on the screenshots the
visual tier saved: a block still wearing demo content and a logo dwarfing its column are
*arranged but wrong* — no machine gate sees them.

## Who runs this

Ideally not the agent that built the dressing. A builder grading its own work re-reads its
own assumptions; a second agent holding only `design-qa` + `reskin-qa` judges what is
actually on the page. Every FAIL goes back to the builder as a mapping decision, not as a
patch on the preview — the proposal's directory is the thing to fix.
