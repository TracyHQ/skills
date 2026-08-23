---
name: joomla-apply
description: >-
  Apply an approved deliverable to a client site's LIVE copy — update content (articles, modules,
  template styles), upload media, and install supporting extensions. The Apply direction of a site:
  the opposite of reskin, which only dresses the working copy on the fleet. Every change is grouped
  under one apply_id so the whole deliverable reverts to exactly what was there. Only Owner/Admin
  seats may apply, and the relay enforces it. Use when a deliverable has been approved and must land
  on the live site.
version: 1.5.0
platforms: joomla
requires-mcp:
  - tracy-apply
provenOn: joomlart.com (Joomla 6) — content update + media upload round-trip, reverted exactly
---

# Joomla Apply — an approved deliverable, onto the live site

You apply an approved change to the **live copy** of a client site. This is the opposite
direction from `reskin`, which dresses the *working copy* and never touches the live site — Apply
is the deliberate step that reaches the real one. It is always the customer's decision: only an
**Owner** or **Admin** seat may apply, and the relay refuses anyone else.

What counts as "approved" is not this skill's to define — `proposals` owns that contract: a
proposal is approved by the customer's merge, a deliverable by the customer's explicit yes in its
Task. This skill starts where that decision ends.

You never reach the site directly — no SQL, no file edits, no admin login. Every tool below goes
out through the relay, which is the one that checks the seat's role, holds the site's component
token, forwards the change to the site's own component, and records what was applied (ADR 0051). If
you find yourself about to touch the site any other way, stop: the tool is the only door.

## Where things live

Read in this order; stop as soon as you have what the step needs.

1. **`deliverables/<task-slug>/`** — the thing being applied, and the only source of what to
   write. If the change rode a proposal instead, its record is `proposals/<slug>/` and the
   approval is the merge to `main`.
2. **The approval itself** — the customer's yes, in the Task or as the merged proposal. No
   approval on record, no Apply: ask, do not infer one from enthusiasm.
3. **The workspace's local copy** (`surface/pages/`, `digest/content-map.md`) — to find the
   article or module you are about to touch. It is **Observed** and may be stale: a wrong id is
   answered by the component's own `{ok:false}`, which names the missing row — trust that answer
   over the snapshot.

Nothing else is input. In particular the live site's admin is not: you never sign in anywhere.

## The one rule that makes Apply safe: apply_id

Every content update and media upload carries an **`apply_id`**. Use **the same id for every step of
one deliverable** — pick it once (the task or deliverable id is ideal) and reuse it. That grouping
is what lets `revert_apply` undo the *whole* deliverable back to exactly what was on the site
before, to the byte. An Apply that cannot be reverted is one that cannot be guaranteed (ADR 0048),
so this is required, not optional.

**One applier per apply_id, and nothing enforces it but you.** The relay holds no lock: two agents
writing under one id interleave their steps into one revert log, and the revert then restores a
history neither of them made. Mint the id from the task or deliverable — something no second run
would pick — and if an Apply may already be running on this site, ask before starting; `list_apply`
on the id shows whether it has begun.

## The tools

A Site agent is handed these by `tracy-apply`; the site is resolved for you, so you never name a
host or hold a credential.

- **`update_content`** — one row of the site's catalog (ADR 0080). `kind` is one of: `article`,
  `category`, `tag`, `field`, `menuItem`, `menutype`, `redirect`, `banner`, `bannerClient`,
  `contact`, `newsfeed` (content kinds — every Editor), `module`, `templateStyle` (code kinds —
  Developers), `user`, `extensionParams` (site kinds — Admins). **A menu item rename is kind
  `menuItem`** — an ordinary content edit. Leave `id` at 0 to insert where allowed — including
  tree-shaped kinds since component 0.8.14: a new `menuItem` needs `title`, `menutype` and
  `link` (`type` defaults to `url`; use `component` with an `option=` link for component pages);
  a new `category` or `tag` needs a `title`; `parent_id` is optional and defaults to root.
  Aliases are minted for you — never send `alias`. On an EXISTING tree node, `parent_id`
  MOVES it under that parent (optional `move_after`: a sibling id to slot in after, 0 for
  first); paths rebuild for the whole branch and revert restores the exact old position. An
  article changes category by writing `catid` — a plain field, not a move.
  `fields` is a map of column → value; only the columns allowed for that kind are written.
- **`delete_content`** — move one row to Joomla's own trash (revertable through the same
  `apply_id`). Structure and identity kinds (menutype, user, templateStyle, extensionParams)
  cannot be deleted through Apply at all.
- **`upload_media`** — one file under `images/` or `media/` only (never code), carried as base64.
- **`install_extension`** — a component, template, or plugin from a public `https` `.zip` URL the
  site downloads itself. Use when a template needs a supporting extension. Not part of the revert
  log: installing is additive and the CMS owns the uninstall.
- **`revert_apply`** — undo a whole Apply by its `apply_id`, newest step first.
- **`list_apply`** — see what an `apply_id` touched (kind, id or path, create-or-update) without the
  before-payload.

## How a refusal reads

A refusal is an answer, not a crash — read it and decide the next move:

- `NOT_SITE_ADMIN` — this seat is an Editor or Developer; only Owner/Admin apply. Do not retry;
  the change needs an authorised seat to approve it.
- `COMPONENT_NOT_REGISTERED` — the site has no component credential at the relay yet (it is set
  when the site is migrated/connected). Applying is not possible until it is.
- The component's own `{ok:false, error, message}` — the site refused the specific change (a bad
  field, a missing row). Fix what it names and try that step again under the same `apply_id`.

## The shape of a run

1. Confirm the deliverable is approved and you hold an Owner/Admin seat.
2. Pick one `apply_id` for the whole deliverable.
3. Apply each step — `update_content` / `upload_media` / `install_extension`.
4. If anything is wrong, `revert_apply` the id and start over; the site returns to exactly what it
   was.
5. When the Apply landed, say so to the preview: `reload_preview`.

## Telling the preview

The customer is often watching their site inside Tracy while you work. What you just applied lives
in the site's database — a template switched on, an article rewritten — and a database change
produces no commit, so nothing outside the site can notice it. The preview watches the deployed
commit and reloads on its own for anything that arrives through git; for your work it has nothing
to watch. 🔒 Seen on 2026-08-15: a template installed through git appeared in five seconds, and
then activating it changed nothing the customer could see until they reloaded by hand.

So call **`reload_preview`** once, after the last successful step. It takes no arguments — the
address is derived from the site you are already bound to, never passed in. If no preview is open
it costs nothing and says so; that is not a failure and does not change how you report the run.

**Call it only when the Apply actually landed.** A run you reverted, or one that stopped on a
refusal, has nothing for the customer to look at, and reloading then shows them the old site with
a fresh timestamp — which reads as "something happened" when nothing did.

The tool reaches you from one of two places and you do not choose which: a Site agent inside Tracy
Desk is handed it in-process, and an agent working outside Desk gets it from the `tracy-desk` MCP
server if the person wired one up. It is therefore **optional by design** and deliberately absent
from `requires-mcp`: an Apply that landed is a success whether or not anyone was watching, and a
skill that refused to run without a screen would be wrong. If you do not have the tool, skip this
step in silence — do not mention it, and do not ask the person to install anything.

## Being invoked bare

`/joomla-apply` with nothing attached is **not** an instruction you can act on. This skill writes
to a customer's production site, and it needs two facts nobody can infer: which deliverable, and
where its approval is recorded. Say what is missing and offer `list_apply` to show what has already
been applied. Never pick a deliverable yourself — an unasked-for write to a live site is the one
mistake this skill exists to make impossible.

## Reporting back

The person cannot see the relay. When the run finishes, tell them: what landed (each step, in their
words — "the meta description of the Admin template glossary page", not a row id), the `apply_id`
that reverts all of it, and anything the component refused with what it said. **Answer in the
language the person is writing in**; ids, field names and the `apply_id` stay as they are — they
are addresses, not prose.

Worked examples — a real run, step by step, and the mistakes that look right — ship with this skill
in `examples/apply-run.md`. Read it before your first Apply.

## When something breaks

- **`NOT_SITE_ADMIN`** — stop; the change needs an authorised seat, and retrying cannot make one.
- **`COMPONENT_NOT_REGISTERED`** — the site has no component credential at the relay. It arrives
  with migrate/connect; nothing you do from here creates it.
- **A step half-applied** — `revert_apply` the id, report what the component said, start over with
  a fresh id. Never leave a deliverable partially on a live site while you investigate.
- **The revert itself refused** — stop everything and say so plainly; that is the one state a
  person must handle, because the guarantee (ADR 0048) rests on revert working.

What you learn here belongs back in this file: a refusal that needed a rule nobody had written down
is a rule this skill is missing, not a thing to remember.
