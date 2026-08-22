---
name: joomla-upgrade
description: >-
  Upgrade a Joomla site's core toward version 6, one launch-point hop at a time
  (3.10 → 4.4 → 5.4 → 6.1), through the site's own component: snapshot, hop, verify, and
  stop the moment a hop does not land. Built for the JoomlArt customers still on a low
  Joomla who want to SEE their site on Joomla 6 before committing to it. Only Owner/Admin
  seats may upgrade, and the relay enforces it. Use when a readiness check says a site can
  reach 6 and the customer wants it upgraded, or previewed on a disposable copy first.
version: 0.1.0
platforms: joomla
requires-mcp:
  - tracy-fleet
  - tracy-reskin
  - tracy-apply
provenOn: >-
  ja-teline-v.demo.joomlart.com (Joomla 4.3.4) driven end to end to 6.1.3 — front and admin
  200 at each landing (4.3.4 → 4.4.14 → 5.4.8 → 6.1.3); and a clean 4.4 → 5.4 → 6.1 re-run,
  green with no manual step, 2026-08.
---

# Joomla Upgrade — a site's core toward Joomla 6, one hop at a time

You move a Joomla site's **core** up the version chain toward 6, and you do it the only way the
update server allows: one launch point at a time. You never touch the site directly — no SQL, no
file edits, no admin login. Every step goes out through the relay, which checks the seat is an
**Owner** or **Admin**, holds the site's component token, forwards the action to the site's own
`com_claudecowork` component, and audits it. If you find yourself about to reach the site any other
way, stop: the tool is the only door.

This is the most destructive thing Tracy can do to a site — it replaces the code the site runs.
So the shape of this skill is not "run the upgrade", it is **snapshot, one hop, verify, and stop
the instant a hop does not land where it aimed.** A half-finished hop leaves a site no single call
puts back.

## Preview first. Always offer the copy before the real one.

The reason this skill exists is a customer question: *what does my site look like on Joomla 6?* You
can answer it without risking their live site at all, and this is the default path:

1. **`build_working_copy`** — stand a full copy of the site on the fleet (its own container, webroot
   and database, at the site's fleet address). This is Migrate; it also installs the site's
   component on the copy, which is the thing the hops drive. Minutes, not seconds. If a copy is
   already standing, this joins it; do not rebuild one someone is looking at.
2. **`upgrade_working_copy { to }`** — one launch-point hop on that copy, for each hop up the chain.
   This is the copy-safe sibling of `core_upgrade`: the fleet snapshots the copy, moves PHP, drives
   its component through prepare/finalise and verifies, and a broken hop is re-cloned, not recovered
   — which is exactly why the copy needs no recovery net and the live site does.
3. **`reload_preview`** after the last hop, and hand the customer the URL.

The live-site upgrade (`core_upgrade` on tracy-apply) is a separate, later, explicit step, gated on
the one thing the preview does not need: a recovery path back into the customer's own host (see
**The recovery net**). Default to the preview. Only upgrade the live site when the customer has seen
the preview, said yes, and the recovery net is in place.

## The chain is not negotiable, and you cannot skip a stop

The update server enforces the path with signed TUF metadata. A 6.x package is only offered to a
site at **5.4**; a 5.x package only to one at **4.4**; a 4.x package only to one at **3.10**. So the
chain is:

```
3.10 → 4.4 → 5.4 → 6.1
```

A site at 4.3.4 hops to **4.4 first** — never straight to 5, because 5 is not offered to a 4.3. A
site at 5.2 hops to its own launch point 5.4 first. `to` is always the next launch point up from
where the site is now, and it is one of `4.4`, `5.4`, `6.1`. Read the site's current version from
its own report (`info`), not from a stored guess, and compute the next stop from that.

Under the version chain runs a **PHP chain**, and it is the one people forget. Each hop has to run
on a PHP its target supports: →4.4 needs PHP 7.2.5+, →5.4 needs 8.1+, →6.1 needs 8.3+. **This tool
cannot change PHP** — it lives in the customer's hosting panel. Before a hop whose target needs a
higher PHP than the site is on, stop and have the customer raise it, then read the PHP back (`info`)
before you continue: a site left on too low a PHP after a hop is a site that is already down.

## One hop, and it is always two calls

`core_upgrade` takes `to` (the launch point) and `step`. A hop is **prepare then finalise**, two
separate calls, and it has to be two:

- **prepare** opens the update channel, downloads the package, and extracts it over the site. When
  it returns `ok`, the new code is on disk but the site is still *running* the old code this request
  loaded.
- **finalise** is a fresh call, now on the new code, that runs the finalise and the schema
  migrations. It cannot be folded into prepare: the process that copied the new files is still
  running the old ones and cannot finalise against classes it never loaded. (The component clears
  the cached class map and opcache at the end of prepare so the finalise request loads the new code
  cleanly — you do not have to do anything for that.)

On the **preview** path a hop is a single `upgrade_working_copy {to}` call — the fleet does the two
steps, the PHP move, the snapshot and the verify inside one job, and answers with the result. On the
**live** path you drive the two steps yourself: `core_upgrade {to, step:'prepare'}` →
`core_upgrade {to, step:'finalise'}` → verify.

## The loop, per hop, in order

1. **Snapshot.** Before every hop, take a restore point — the site's files and database — and know
   it landed before you touch anything. A hop pays this once, so a Joomla 3 site pays it three
   times; that is the cost of being able to go back. Never start a hop you cannot undo.
2. **PHP gate.** If the target needs a PHP the site is not on, stop, have the customer raise it in
   their panel, read it back. Do not guess it is fine.
3. **prepare**, then **finalise** (above).
4. **Verify** — and mean it. The site's own reported version must equal the launch point you aimed
   at, the **front page and the administrator must both answer 200**, and the schema must be clean.
   A 200 that is Joomla's own "Environment Setup Incomplete" page is a *failed* verify, not a pass:
   the framework did not boot. If any of these is not true, the hop did **not** land.
5. **If a hop did not land: STOP and restore.** Do not take the next hop. A schema left half-migrated
   makes the next `core:update` refuse to start, so continuing turns one broken hop into a chain
   nobody can walk back. Restore the snapshot from step 1, confirm the site is back, and report what
   happened — do not retry the same hop blind.

Only when a hop verifies do you compute the next stop and go again, until the site reports 6.x.

## What a real customer site does that a clean install does not

These are not hypotheticals — every one cost a live JoomlArt site a red verify before it was
understood. The component now handles the ones it can; the rest are yours to expect.

- **The JoomlArt template on Joomla 6 — handled, not a wall.** Joomla 6 removed the global `J*`
  class aliases (`JFactory`, `JText`, …), and the **T3 framework the older JoomlArt templates are
  built on** calls them, so left alone a site reaches 6 with a healthy core and a *front page that
  still 500s*. This looked like it needed JA to ship new templates first. It does not: Joomla 6
  ships the replacement (the `compat6` behaviour plugin, whose classmap re-registers every alias),
  and the **preview path installs and enables it and prepares the T3 entry automatically** — the
  `upgrade_working_copy` job runs `enable-j6-legacy-compat` on reaching 6, and the real template
  renders (proven on Teline V, 4.3.4 → 6.1.3, the actual T3 design). T4, the current framework,
  already uses namespaced classes and needs none of it. So the preview shows the customer their
  ACTUAL site on 6, not a stock fallback. What is still yours to watch: a *specific* third-party
  extension with no Joomla-6 build (AcyMailing's legacy plugins, for one) can still fatal a page —
  when one does, read which extension's file is in the error and report THAT single extension as
  needing an update, rather than calling the whole upgrade blocked.
- **The core update site is sometimes disabled**, and then every check answers "already latest". The
  component re-enables it before checking; if you still see "offered nothing" when a newer version
  plainly exists, that is where to look.
- **A site upgraded from an old major can land with schema migrations still owed.** The component
  applies them after finalise; a "tables not up to date" that survives is a real finding, not
  cosmetic, and it will block the next hop.
- **Memory.** Joomla 6 boots heavier; a host pinned at PHP `memory_limit = 128M` can exhaust it on
  the first 6.x request. If the front 500s with an out-of-memory in the log rather than a class
  error, the fix is the customer's `memory_limit`, not the upgrade.

## The recovery net (why the live-site upgrade is gated)

The preview runs on a disposable copy: if a hop breaks it, you throw the copy away and re-clone. The
live-site upgrade has no such luxury — a broken hop on the customer's own host needs a proven way
back *into that host*, and that path is the one open question of this whole capability. **Do not run
the live-site upgrade until the snapshot in step 1 can be demonstrably restored onto the customer's
own host, end to end, on a copy you are willing to lose.** Until then, this skill upgrades previews,
and hands the customer a report and a preview URL, not a changed live site.

## Seats, and whose decision this is

Only an **Owner** or **Admin** seat may upgrade, and the relay refuses anyone else — the tool's
answer will say so (`403`), and that is the answer, not an error to route around. An upgrade is at
least as much the customer's decision as a content change: it is theirs to ask for, on a version
they were shown a preview of first.

## Where things live

Read in this order; stop as soon as you have what the step needs.

1. **The readiness report** for this site — which version it is on, the chain to 6, and the PHP each
   hop needs. `joomla-readiness` owns that; this skill starts where it ends. No readiness on record,
   no upgrade: a hop planned without knowing the starting version is a hop planned blind.
2. **The site's own `info`** — the current version and PHP, read fresh at the start and after every
   hop and every PHP change. It is the only version truth; the readiness report can be a day stale.
3. **The customer's yes** — for a live-site upgrade, the explicit approval, after a preview. A
   preview needs only that the customer asked to see one.

Nothing else is input. The live site's admin is not: you never sign in anywhere.
