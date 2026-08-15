# QA scans — the reference behind the gates

What each gate measures, why it measures it that way, and the failures that shaped it. Every rule
here was paid for by a real run; the wording keeps the reason attached because a gate whose reason
is lost gets tuned away the first time it is inconvenient.

Standalone by design. `reskin` keeps its own numbered trap log for building a dressing; this file
restates only what judging a page needs, so `design-qa` never sends a reader to another skill.

## Contents

- [The two-gate rule](#the-two-gate-rule)
- [Link scan](#link-scan) — taxonomy, probing, the QA loop
- [Accessibility scan](#accessibility-scan) — the two-pass baseline, and the catalogue
- [Geometry gate](#geometry-gate) — what the machine eye can and cannot see
- [Trusting a gate](#trusting-a-gate)

---

## The two-gate rule

A link, a contrast ratio or a column count is never allowed to be *lucky*. Each has two gates: one
inside the pipeline (a decision written down before the work) and one at QA (a re-measurement after
it). Miss either and the failure shows up in front of the customer instead.

The QA gate is a **blocking** gate. A failure returns the page to whoever built it as a decision to
redo, never as a warning line in a report nobody re-reads.

---

## Link scan

### Why paths cannot be guessed

A database path is not a public URL — **not even on the site the content came from**. The real URL
is produced at render time by the router plus whatever SEO layer sits above it, and a long-lived
site is a stack of them: a modern SEF router, an older alias table left switched off but still
holding rows, plus rewrite rules in `.htaccess`.

Two consequences the gate is built around:

- **Crawl hrefs from rendered pages.** The rendered nav is the truth; database paths are a hint.
- **A link copied from a demo is not safer than a guessed one.** Demos ship dead links —
  `/component/content/article/<id>-<alias>` patterns that 404 on the demo itself, because current
  routers serve articles at `/<category-path>/<alias>`. Probe every link before writing it,
  including the ones that came from somewhere authoritative.

### Three kinds of internal link

1. **Routable** — resolves in the site's own URL map. Must answer 200. A failure here is a defect.
2. **Internal but not this CMS** — forums, download areas, a subdomain, another application. A
   working copy cannot reproduce them. **Not a QA failure**: it belongs in a customer report
   ("this part lives outside the CMS, so it is outside what a working copy can serve").
3. **External** — another domain. Kept verbatim.

Mixing 2 into the failure list is the most common way a link report becomes unreadable.

### Probing rules

- **A link has two failure layers, and they need different people.** Probe as a pair: if the raw
  non-SEF form answers 200 while the pretty path 404s, the *route* is missing (the SEO layer's
  problem). If both 404, the *content* is missing. Recording only one of them hands the wrong team
  the wrong bug.
- **Do not follow redirects.** A 301's `Location` is an absolute public URL — following it leaves
  the loopback, hits the CDN edge, and collects a 403 that means nothing. Treat 2xx and 3xx as
  alive, and stop there.
- **HTTP 200 is not proof you got what you asked for.** A router fallback answers 200 with an HTML
  page for `/sitemap.xml`; the body has zero `<loc>` elements. Parse and check content — never
  trust a status code alone.
- **A custom 404 page returning 404 is correct behaviour**, not a defect. Recognise the site's own
  error-page entry and do not count it.
- **Known-dead links that are dead on the live site too** belong in an allow-list: they are
  inherited content, they go in the customer report, and they do not block the gate.

### The QA loop

1. Crawl the whole dressed copy: every routable internal link — nav, blocks, footer, inside
   articles — must answer 200. Including the ones that are "obviously fine".
2. Check content URLs against the original site's sitemap: a page that moved has broken SEO even
   though it answers 200.
3. Any failure returns to the builder. **The loop runs until the crawl is clean.**
4. Kind-2 links leave as a customer report, not as failures.

---

## Accessibility scan

Mostly machine-measurable (axe-core / pa11y, headless), which is what makes it a gate rather than
an opinion. Two passes, and the second one is the point:

1. **Baseline on the demo** — the accessibility debt the template already carries. Nobody is
   fixing the template, but the number has to be known and told to the customer.
2. **The dressed pages**, judged as: **no worse than baseline, and no new faults introduced by the
   real content.** A template's own fault is recorded. A fault this dressing caused — a missing
   alt, a hard-coded colour, a second `h1` — must be fixed.

That split is the whole design. Without a baseline every audit reports the template's debt as the
dressing's fault, and the report gets ignored.

### The catalogue

- **Colour scheme.** Does the template support dark mode, by toggle or `prefers-color-scheme`?
  The trap that has actually bitten: real content carrying hard-coded colours — a pricing page with
  an inline `<style>` of fixed hex on an assumed white background, so dark mode swallows the text.
  Flag every inline colour in mapped real content. Branding follows: a logo needs a variant per
  scheme.
- **Alt text.** Long-lived articles usually have none; check whether the block's image field even
  offers a place to write one. Alt comes from real context — never `image1`.
- **Heading hierarchy.** The reskin-specific fault: every block carries its own heading level, so
  assembling several yields two `h1`s or an `h2 → h4` jump, and real content poured into a block
  sometimes brings its own `h1` in the HTML.
- **Landmarks and skip link.** header / nav / main / footer in their real roles, skip-to-content.
  Template tier, checked once.
- **Keyboard and focus.** Megamenu operable by keyboard, focus visible, and the off-canvas menu
  needs a focus trap — the mobile twin is a separate component and is forgotten every time.
- **ARIA on interactive blocks.** Accordions, filters, carousels: `aria-expanded`, working
  controls, a way to pause auto-play.
- **Forms.** Labels on newsletter and search, error states a screen reader can reach.
- **Motion.** `prefers-reduced-motion` against counters, parallax and block animations.
- **`lang`.** Matches the language of the real content, not the template's default.
- **Links and touch targets.** Repeated undifferentiated "Read more", icon-only buttons with no
  `aria-label`, touch targets under size on mobile.

When the demo has dark mode, render and judge **both schemes**.

---

## Geometry gate

Grepping HTML cannot see a broken menu. The machine eye runs headless on the host, so the
customer's site installs nothing and depends on no vendor.

**What it asserts from the DOM**, per page, at desktop / tablet / mobile: horizontal overflow
(`scrollWidth > clientWidth`), nav overlap (header link bounding boxes intersecting, 4px
tolerance), edge bleed, clipped labels, images with `naturalWidth = 0`. Screenshots are kept as the
record; the exit code is the gate.

Three refinements that came from false results:

- **Overflow is not clipping.** A breadcrumb with generous padding and `overflow: visible` trips
  `scrollWidth > clientWidth` and loses nothing. Only count a clip when the element is a real
  clipping context.
- **Broken layout is first of all broken *size*.** A 4674px-tall intro screenshot swallowed a whole
  blog listing while both the text gate and the nav gate passed. Measure the box model separately:
  vertical section overlap, horizontal parent escape, a section collapsed to nothing, oversized
  media (taller than the viewport, wider than the page, upscaled beyond ~2.5× natural), suspiciously
  short pages, and drift from a baseline (height ±25%, section count changed).
- **Navigation has a width budget.** Adding items to a full main menu overlaps the CTA. A new page
  needs a decided home — a dropdown, the footer, or not in the nav at all — never appended by
  default.

- **Overflow and "not inside a container" are two different faults, and every overflow measure is
  blind to the second.** A page whose text runs the full bleed does not overflow at all —
  `scrollWidth` equals the viewport, so page-width, edge-bleed and parent-escape all pass, while a
  person sees it instantly. Measure it directly: at ≥1024px, take the longest in-flow paragraph or
  heading (≥40 characters) and ask what share of the viewport it spans.
- **Calibrate a threshold against the real site, never against a feeling.** That content-measure
  threshold was first set at 92% — which fails the customer's own live portfolio page, deliberately
  running at 93%. Raised to 97%, so only text that is genuinely unbounded fails. The general rule:
  measure the origin before fixing a number. **A gate the real site fails is a gate nobody trusts.**
- **Gate only the pages this run owns.** Pages that deliberately kept their old skin belong in the
  crawl as report-only. Two of them put through the gate "failed" on an 11px header overflow — and
  the origin overflows 15px at the same viewport. That is a finding for the customer report, not a
  defect of the work.

### Pressing the page

A page sitting still hides behavioural faults. Load-time measurement cannot see a menu that does
not open, an accordion that does not expand, or JavaScript throwing on interaction. Two more
measures close that:

- **Interaction** — at mobile width, press the toggler and count visible links again. A control
  that declares `aria-expanded` must flip; only judge that when the template declares the contract
  itself.
- **JavaScript errors** — the page's own `pageerror` and console errors, **exempting third-party
  CORS/CDN noise**: a dressing can neither cause nor cure a font host refusing cross-origin.

**Never guess a container name.** The first interaction check counted links inside `.off-canvas`;
one template calls its panel `.t3-off-canvas`, so the gate reported "menu did not open" while it
opened perfectly (0 → 177 links). Count **every visible link on the page** instead of naming a
frame. The negative test proved both directions: hiding the panel produced
`toggler opens nothing (153/153)`, and injecting a `throw` failed all three viewports.

**What the machine eye cannot see**, and why a human still looks at the screenshots: a block that
is arranged correctly but still wearing demo content, a logo dwarfing its column, a teaser whose
copy never got replaced. *Arranged validly but wrong* is a real category, and only eyes catch it.

Infrastructure note: on a small host, run the browser container with a memory cap and one page at a
time rather than in parallel.

---

## Trusting a gate

**A gate you have never seen fail is not yet trusted.** Before relying on a new check, break the
page on purpose, watch it fail with a message that names the element, then unbreak it and watch it
go green.

This is not ceremony. Two examples from this toolkit's own history:

- A responsive check reported 16 failures that were all false — it compared absolute column counts,
  so a customer with four pricing tiers "failed" against a demo with three. What must match is the
  *fold rhythm* relative to each layout's own desktop state.
- After that was fixed, four failures remained, still false: a chevron beside a label, and two
  adjacent buttons, were each being counted as a column. A column had to be defined strictly —
  a child at least a quarter of its parent's width and tall enough to be a column at all.

Both were found by deliberately breaking a page and watching what the tool said. Neither would have
been found by watching it pass.
