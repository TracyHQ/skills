---
name: reskin
description: Dress a client site's working copy in a demo template's layout while keeping every word of the client's real content. The craft skill - scanning, mapping, building the frame and jobs, rolling back. Works inside a proposal (see the proposals skill); quality is judged by design-qa (absolute) and reskin-qa (against this dressing's own promises). Use when someone asks to reskin a site, apply a demo/template look to an existing site, or try a new template with real content.
version: 2.0.0
platforms: joomla
requires-mcp:
  - tracy-reskin
provenOn: joomlart.com x Stratum & Teline V; teline-v demo x Stratum (fixture 2)
---

# Reskin — real copy, demo layout

You dress the **working copy** of a client site in the layout of a **demo** (a template
quickstart), keeping the client's real content untouched. The demo lends its shape; it never
lends its words. The live site is never touched.

This skill is one of four that share the work — a change this size is not one job:

- **`proposals`** — the contract: directory anatomy, branches, carries, Approve=merge.
  Every reskin lives inside a proposal; open one first and record everything there.
- **this skill** — the craft: scan, map, build the frame and jobs, roll back.
- **`design-qa`** — is the page broken, by criteria true on any site.
- **`reskin-qa`** — is the page what THIS dressing promised (ideally run by a second agent).

Everything mechanical is owned by deterministic scripts shipping **with their skill** —
`scripts/` beside each SKILL.md. Two more scripts (`make-variant.sh`,
`rebuild-proposal.sh`) are fleet infrastructure in `tracy-fleet/reskin-host/`: the webhook
and the app call them, you never do. You do exactly two jobs the scripts cannot: **write the
content mapping** and **write real copy into block shapes**. You never write SQL — if you are
about to, stop: either a script owns that step, or the step is wrong.

The full spec — including the trap list that every rule below comes from — is
`tracy-docs/reskin/README.md`. Read it before your first run.

## Reaching the scripts and the site

**Inside Tracy, call the tools.** A Site agent is handed `scan_client`, `make_proposal`,
`list_proposals`, `fill_block` and `visual_qa`. They resolve the host, the container names, the
port, the table prefix and the database password from the site you are already working on, so
none of the four facts below are yours to find and no credential is yours to hold. When those
tools are present, use them and skip to the pipeline; the rest of this section is for running
the toolkit by hand on a machine that has none.

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
   (a login form, an old footer menu). Each line is a decision — keep, move, or unpublish.

   Every row of the mapping answers: which real page ↔ which demo pattern, and *for every
   field of every block*, where the words and images come from — `real` (verbatim, source named),
   `placeholder` (kept from the demo, flagged), or dropped. Chrome (header, menu, footer,
   branding) is mapped once for the whole site. Pages the demo can't express and parts of the
   client site that are not this CMS go into a **customer report**, not into the build.
3. **Build**: `install-demo-frame.sh` (template + framework + the default/home style pair +
   render preconditions), `sync-extensions.sh` (only ticked rows), `port-assets.sh` (demo
   image namespaces, never overwriting client files), then `fill-block.sh` per page — it takes
   a **job JSON** you write and verifies the render immediately after writing.
4. **QA, looped until clean** — run `design-qa` (absolute: text tier, geometry tier, box
   model) and `reskin-qa` (this dressing's promises: markers, deny-list, responsive vs the
   demo's reference), then your own eyes on the screenshots. Every gate takes
   `--variant <slug>`; every FAIL comes back here as a mapping decision, never as a patch
   on the preview. Details and discipline live in those two skills.
5. **Rollback** when asked: `undress.sh` restores the client copy from the snapshot. Pass
   `--keep-files` when another proposal of the same site is still standing: only the database is
   per-proposal, so stripping a stylesheet reaches every one of them.

### Dressing a proposal instead of the site

A site can wear more than one dressing at a time, each on its own address (ADR 0044). The
mechanism is one schema per proposal beside the site's own, chosen by the `X-Tracy-Variant`
header the edge derives from the hostname; files are shared, so a template lives on disk once
and the database decides who wears it.

- `make_proposal` (the app's tool — or `make-variant.sh` on the fleet) builds the proposal's
  schema from the site's. It copies the
  structure of cache, log and submission tables without their rows — on a real site that is the
  difference between 748 MB and 43 MB, and it keeps other people's form submissions out of a
  copy that exists to be shown to people.
- Then pass the same slug to the build and the gates: `install-demo-frame.sh --variant <name>`,
  `"client": {"variant": "<name>"}` in every `fill-block` job, `--variant <name>` on every gate.
  Miss it on the gate and you grade the site while the proposal goes unlooked at.
- `--unpin all` is usually right on a site that pins pages to template styles by habit: a pin
  outranks the default, so pinned pages keep wearing the old template inside the new one.

## Rules that are not negotiable

- **Real copy only.** No invented quotes, numbers, or pages. A block whose fields have no real
  source is unpublished (`fill-block` has an `unpublish` action), never left wearing demo text.
  Its `publish` action is the other half: a module the site already owns, that the old template
  never rendered, is the right thing to put in the new one's drawer — its links are real.
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
