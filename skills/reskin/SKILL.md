---
name: reskin
description: Dress a client site's working copy in a demo template's layout while keeping every word of the client's real content. Use when someone asks to reskin a site, apply a demo/template look to an existing site, try a new template with real content, or roll a reskin back.
version: 1.0.0
---

# Reskin — real copy, demo layout

You dress the **working copy** of a client site in the layout of a **demo** (a template
quickstart), keeping the client's real content untouched. The demo lends its shape; it never
lends its words. The live site is never touched.

Everything mechanical is owned by ten deterministic scripts (in `tracy.ai`
`infra/fleet/reskin/`, deployed on the fleet host). You do exactly two jobs the scripts cannot:
**write the content mapping** and **write real copy into block shapes**. You never write SQL —
if you are about to, stop: either a script owns that step, or the step is wrong.

The full spec — including the trap list that every rule below comes from — is
`tracy-docs/reskin/README.md`. Read it before your first run.

## The pipeline, in order

1. **Scan** (read-only): `scan-demo.sh` → the demo's *pattern library* (pages, block shapes
   with example values, styles, extensions, assets, branding deny-list). `scan-client-site.sh`
   → the client's *content inventory* (menus with per-item flags, content mines, SEO stack,
   link diagnosis, branding). `scan-extensions.sh` → a three-column UI-relevant diff.
   **Freeze the inventory file** — it is the restore point `undress.sh` uses. Never re-scan
   over it mid-run; a fresh scan goes to a different file.
2. **Mapping** (your first real job): one document, reviewed by a human before anything is
   built. Every row answers: which real page ↔ which demo pattern, and *for every field of
   every block*, where the words and images come from — `real` (verbatim, source named),
   `placeholder` (kept from the demo, flagged), or dropped. Chrome (header, menu, footer,
   branding) is mapped once for the whole site. Pages the demo can't express and parts of the
   client site that are not this CMS go into a **customer report**, not into the build.
3. **Build**: `install-demo-frame.sh` (template + framework + the default/home style pair +
   render preconditions), `sync-extensions.sh` (only ticked rows), `port-assets.sh` (demo
   image namespaces, never overwriting client files), then `fill-block.sh` per page — it takes
   a **job JSON** you write and verifies the render immediately after writing.
4. **QA, looped until clean**: `design-qa.sh` (markers present, demo words absent, every
   internal link and image answers), `visual-qa.sh` (headless-browser geometry: overlaps,
   overflow, clipped labels, broken images — three viewports), and **your own eyes** on the
   full-page screenshots it saves. A QA failure comes back to you to fix; it never ships as a
   warning.
5. **Rollback** when asked: `undress.sh` with the frozen inventory restores the client copy.

## Rules that are not negotiable

- **Real copy only.** No invented quotes, numbers, or pages. A block whose fields have no real
  source is unpublished (`fill-block` has an `unpublish` action), never left wearing demo text.
- **Every link is looked up, never guessed.** Database paths are not public URLs — take links
  from rendered pages or probe them. This applies to links copied from the demo too: demos
  ship dead links.
- **Write, then look.** Every `fill-block` job carries `verify` markers; every build step is
  followed by its check. A step that cannot be verified is not done.
- **Branding has no placeholder tier.** Demo names, logos, domains and schema must not survive
  anywhere the client's visitors can see; the client's real content mentioning the demo's name
  as a *product* is data and stays.
- **New pages need a seat, not just a URL.** The nav has a width budget; the mapping decides
  where a new page lives (a dropdown, the footer) — never append to the main menu by default.
- **Same-framework templates share position names.** Old client modules will bleed into the
  new skin's positions — the mapping lists them, and keeps or unpublishes each one on purpose.

## Writing a fill-block job

A job is one JSON file: client/source connection blocks, an optional page shell (article +
menu item — the article alias **is** the public URL), modules with a `set` of field overrides
(shapes and example values come from the pattern library), and `verify` with markers that must
appear and demo strings that must not. The script owns escaping, ID offsets, publish dates,
router-cache purges, and cache clearing — your job is only *what the fields say*.

## When something breaks

Read the spec's numbered traps first — the failure you are looking at is very likely trap-shaped
(router caches with a will of their own, layouts pinned at four different layers, logs that are
pipes). Add what you learn: every new trap becomes a numbered rule in the spec, with the fix
folded into the script that owns the step.
