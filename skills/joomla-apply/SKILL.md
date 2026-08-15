---
name: joomla-apply
description: Apply an approved deliverable to a client site's LIVE copy — update content (articles, modules, template styles), upload media, and install supporting extensions. The Apply direction of a site: the opposite of reskin, which only dresses the working copy on the fleet. Every change is grouped under one apply_id so the whole deliverable reverts to exactly what was there. Only Owner/Admin seats may apply, and the relay enforces it. Use when a deliverable has been approved and must land on the live site.
version: 1.0.0
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

You never reach the site directly — no SQL, no file edits, no admin login. Every tool below goes
out through the relay, which is the one that checks the seat's role, holds the site's component
token, forwards the change to the site's own component, and records what was applied (ADR 0051). If
you find yourself about to touch the site any other way, stop: the tool is the only door.

## The one rule that makes Apply safe: apply_id

Every content update and media upload carries an **`apply_id`**. Use **the same id for every step of
one deliverable** — pick it once (the task or deliverable id is ideal) and reuse it. That grouping
is what lets `revert_apply` undo the *whole* deliverable back to exactly what was on the site
before, to the byte. An Apply that cannot be reverted is one that cannot be guaranteed (ADR 0048),
so this is required, not optional.

## The tools

A Site agent is handed these by `tracy-apply`; the site is resolved for you, so you never name a
host or hold a credential.

- **`update_content`** — one article, module, or template style. `kind` is `article` | `module` |
  `templateStyle`. Leave `id` at 0 to insert; give an existing id to update it. `fields` is a map of
  column → value; only the columns allowed for that kind are written, the rest are ignored.
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
