---
name: reskin
description: Dress a client site's working copy in a demo template's layout while keeping every word of the client's real content, then gate it on text, collision, box-model and responsive checks. Use when someone asks to reskin a site, apply a demo/template look to an existing site, try a new template with real content, check a dressed site's layout or mobile behaviour, or roll a reskin back.
version: 1.6.0
---

# Reskin — real copy, demo layout

You dress the **working copy** of a client site in the layout of a **demo** (a template
quickstart), keeping the client's real content untouched. The demo lends its shape; it never
lends its words. The live site is never touched.

Everything mechanical is owned by twelve deterministic scripts, and they ship **with this
skill** — `scripts/` beside this file. You do exactly two jobs the scripts cannot: **write the
content mapping** and **write real copy into block shapes**. You never write SQL — if you are
about to, stop: either a script owns that step, or the step is wrong.

The full spec — including the trap list that every rule below comes from — is
`tracy-docs/reskin/README.md`. Read it before your first run.

## Reaching the scripts and the site

The scripts run on the **fleet host** (the machine hosting the working copies), not on this
computer, and they act on the copy's containers — never on the customer's live site. Work out
the four facts below before step 1; everything after them is just arguments.

1. **The fleet host.** `TRACY_FLEET_HOST` in the environment, or the SSH alias the operator
   uses for it. **Deploy the toolkit before the first run** — the scripts travel with this
   skill, so put them where they need to run and keep them current:

   ```
   ssh <host> 'mkdir -p /opt/tracy-fleet/reskin'
   scp <skill-dir>/scripts/* <host>:/opt/tracy-fleet/reskin/
   ssh <host> 'chmod +x /opt/tracy-fleet/reskin/*.sh && ls /opt/tracy-fleet/reskin/'
   ```

   Re-copying is safe and idempotent: the scripts hold no state, everything they produce lands
   in `out/`. Do it at the start of every run so a host is never a version behind the skill.
   The QA gates also need Docker with the Playwright image — `docker pull
   mcr.microsoft.com/playwright:v1.49.0-jammy` once per host.
2. **The site's label.** The first hostname segment of the working copy's address
   (`joomlart-com-0871462c.tracy.ai` → `joomlart-com-0871462c`). It names both the stack
   directory and the containers.
3. **Port and database password**, from the stack's own env file:
   `ssh <host> 'cat /srv/tracy/<label>/.env'` → `HOST_PORT` and `DB_PASSWORD`. Container names
   are `<label>-web-1` and `<label>-db-1`; confirm with `docker ps`.
4. **The table prefix**, from the copy itself:
   `docker exec <label>-web-1 grep dbprefix /var/www/html/configuration.php`.

Sanity-check the pair before doing anything else — a loopback request with the public Host
header must answer 200:

```
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: <label>.tracy.ai" \
  -H "X-Forwarded-Proto: https" http://127.0.0.1:<HOST_PORT>/
```

The demo (the mold) is another stack on the same host, discovered the same way. Both scans need
it: the client copy alone cannot tell you how the template is meant to look.

## The pipeline, in order

1. **Scan** (read-only): `scan-demo.sh` → the demo's *pattern library* (pages, block shapes
   with example values, styles, extensions, assets, branding deny-list). `scan-client-site.sh`
   → the client's *content inventory* (menus with per-item flags, content mines, SEO stack,
   link diagnosis, branding). `scan-extensions.sh` → a three-column UI-relevant diff.
   **Keep that inventory as the snapshot** — the picture of the site before anything was
   touched, and the only thing `undress.sh` can restore from. Never re-scan over it mid-run: a
   snapshot taken halfway through a dress restores a half-dressed site. A fresh scan goes to a
   different file.
2. **Mapping** (your first real job): one document, reviewed by a human before anything is
   built. **`fill-block` refuses a job that names no mapping** — the gate is mechanical
   because an advisory step is one an agent skips under pressure, especially when it "already
   knows" the site from a previous run. Knowing it is not the same as having ruled on it.
   `install-demo-frame` hands you the hardest part of this document for free: a **position
   bleed report** listing every client module that the new template's positions would surface
   (a login form, an old footer menu). Each line is a decision — keep, move, or unpublish. Every row answers: which real page ↔ which demo pattern, and *for every field of
   every block*, where the words and images come from — `real` (verbatim, source named),
   `placeholder` (kept from the demo, flagged), or dropped. Chrome (header, menu, footer,
   branding) is mapped once for the whole site. Pages the demo can't express and parts of the
   client site that are not this CMS go into a **customer report**, not into the build.
3. **Build**: `install-demo-frame.sh` (template + framework + the default/home style pair +
   render preconditions), `sync-extensions.sh` (only ticked rows), `port-assets.sh` (demo
   image namespaces, never overwriting client files), then `fill-block.sh` per page — it takes
   a **job JSON** you write and verifies the render immediately after writing.
4. **QA, looped until clean** — four machine gates plus your eyes, each answering a different
   question. A failure comes back to you to fix; it never ships as a warning.
   - `design-qa.sh` — the words and the wiring: markers present, demo copy absent, every
     internal link and image answers.
   - `visual-qa.sh` — collision geometry: nav items overlapping, edge bleed, clipped labels,
     broken images. Saves full-page screenshots.
   - `layout-qa.sh` — the page box model, in absolute terms: horizontal page overflow **with
     the culprit elements named**, sections overlapping vertically, children escaping their
     parent, collapsed sections, media taller than the viewport or upscaled past its natural
     size, suspiciously short pages, and height/section drift against a saved baseline
     (`--baseline write` once the page is right, `compare` after). `--crawl N` also measures
     pages outside the mapping list, report-only — that is how a page nobody mapped gets seen.
   - `responsive-qa.sh` — behaviour, judged **against the demo, not against absolute rules**.
     Run `--mode reference` on the DEMO first (it records how each block type stacks at
     375/768/1024/1440), then `--mode compare` on the dressed copy. It fails when a block
     refuses to collapse the way the demo's does, when a block scrolls sideways where the
     demo's doesn't, when the nav stays expanded where the demo folds it into a toggler, or
     when `<meta viewport>` is missing.
   - **Your own eyes** on the screenshots. Machines pass layouts that are *arranged but wrong*
     — a block still wearing demo content, a logo that dwarfs its column. Look every round.
5. **Rollback** when asked: `undress.sh` restores the client copy from the snapshot.

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
- **Unmapped pages keep the old skin.** Flipping the default template style dresses *every*
  page nobody pinned — including ones the mapping never considered, which then render new
  chrome around raw component output. Decide each one: dress it, or pin it back to the old
  style. Half-dressed is the worst of both.
- **The demo defines "responsive correct", the client's data defines the counts.** Never judge
  a block by its absolute column count — four real plans against the demo's three is data, not
  a defect. Judge how it *collapses* relative to its own desktop layout.
- **A gate you have never seen fail is not yet trusted.** Before relying on a new check, break
  the page on purpose, watch it fail, then unbreak it.

## Writing a fill-block job

A job is one JSON file: client/source connection blocks, an optional page shell (article +
menu item — the article alias **is** the public URL), modules with a `set` of field overrides
(shapes and example values come from the pattern library), and `verify` with markers that must
appear and demo strings that must not. The script owns escaping, ID offsets, publish dates,
router-cache purges, and cache clearing — your job is only *what the fields say*.

Write the job locally, copy it over, run it there. The same goes for the expectations file
`design-qa` reads — only `scripts/` is deployed, so anything else you hand a script has to
travel with the command:

```
scp job-home.json expect-pages.json <host>:/opt/tracy-fleet/reskin/
ssh <host> 'bash /opt/tracy-fleet/reskin/fill-block.sh /opt/tracy-fleet/reskin/job-home.json'
```

Worked examples of every job shape — a page shell, block overrides, an `unpublish`, a
`mod_custom` with HTML — ship with this skill in `examples/joomlart-stratum/`. Read one before
writing your first; its README also lists the two edits no script owns yet (the brand tint
block, and article layouts for pages that stay on the old skin).

## Reporting back

The person who asked cannot see your terminal. When a stage finishes, tell them: which pages
now wear the new layout and which deliberately still wear the old one, what each gate returned,
what went into the customer report (parts of the site this CMS does not serve, defects that
exist on the live site too), and what still carries demo content behind a placeholder flag.
Screenshots from `visual-qa` are the fastest way to show it.

## When something breaks

Read the spec's numbered traps first — the failure you are looking at is very likely trap-shaped
(router caches with a will of their own, layouts pinned at four different layers, logs that are
pipes). Add what you learn: every new trap becomes a numbered rule in the spec, with the fix
folded into the script that owns the step.
