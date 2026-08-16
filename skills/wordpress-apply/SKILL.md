---
name: wordpress-apply
description: Apply an approved deliverable to a WordPress site's LIVE copy — edit a post, one of its meta values or an option, add a file to the Media Library, and install or activate a plugin or theme. The Apply direction of a site: the opposite of reskin, which only dresses the working copy on the fleet. Every change is grouped under one apply_id so the whole deliverable reverts to exactly what was there. Only Owner/Admin seats may apply, and the relay enforces it. Use when a deliverable has been approved and must land on the live WordPress site.
version: 1.1.0
platforms: wordpress
tags:
  - apply
  - wordpress
  - content
  - media
  - seo
requires-mcp:
  - tracy-apply
provenOn: tracy.ai (WordPress 7.0.2) — post + postmeta + option + media round-trip, reverted exactly
---

# WordPress Apply — an approved deliverable, onto the live site

You apply an approved change to the **live copy** of a client's WordPress site. This is the
opposite direction from `reskin`, which dresses the *working copy* and never touches the live site
— Apply is the deliberate step that reaches the real one. It is always the customer's decision:
only an **Owner** or **Admin** seat may apply, and the relay refuses anyone else.

What counts as "approved" is not this skill's to define — `proposals` owns that contract: a
proposal is approved by the customer's merge, a deliverable by the customer's explicit yes in its
Task. This skill starts where that decision ends.

You never reach the site directly — no SQL, no wp-admin login, no file edits, no WP-CLI. Every tool
below goes out through the relay, which is the one that checks the seat's role, holds the site's
plugin token, forwards the change to the site's own plugin, and records what was applied (ADR
0051). If you find yourself about to touch the site any other way, stop: the tool is the only door.

This is `joomla-apply`'s counterpart, and the shape of a run is the same. What differs is WordPress
itself, and those differences are the reason this is a separate skill rather than a `platform`
parameter — see **Where a page's fields actually live** below.

## Where things live

Read in this order; stop as soon as you have what the step needs.

1. **`deliverables/<task-slug>/`** — the thing being applied, and the only source of what to
   write. If the change rode a proposal instead, its record is `proposals/<slug>/` and the
   approval is the merge to `main`.
2. **The approval itself** — the customer's yes, in the Task or as the merged proposal. No
   approval on record, no Apply: ask, do not infer one from enthusiasm.
3. **The workspace's local copy** (`surface/pages/`, `digest/content-map.md`) — to find the post
   you are about to touch. It is **Observed** and may be stale: a wrong id is answered by the
   plugin's own `{ok:false}`, which names what is missing — trust that answer over the snapshot.

Nothing else is input. In particular the live site's admin is not: you never sign in anywhere.

**One thing you need is in no file at all.** `install_plugin` answers with the plugin file it just
installed (`wordpress-seo/wp-seo.php`) — that string exists only in that reply, and
`activate_plugin` is the only thing that takes it. Lose it and you are back to listing the site's
plugins to work out which one arrived. Write it down as it goes past, in the Task, before the next
step.

## The one rule that makes Apply safe: apply_id

Every content update and media upload carries an **`apply_id`**. Use **the same id for every step of
one deliverable** — pick it once (the task or deliverable id is ideal) and reuse it. That grouping
is what lets `revert_apply` undo the *whole* deliverable back to exactly what was on the site
before, to the byte. An Apply that cannot be reverted is one that cannot be guaranteed (ADR 0048),
so this is required, not optional.

**One applier per apply_id, and nothing enforces it but you.** Checked, not assumed: the relay
holds no lock, and the plugin's log numbers each step with `MAX(seq) + 1` read a moment before it
writes — so two agents under one id interleave into one revert log, and can even land on the same
sequence number. The revert then replays a history neither of them made. Mint the id from the task
or deliverable — something no second run would pick — and if an Apply may already be running on
this site, ask before starting; `list_apply` on the id shows whether it has begun.

**What "exactly what was there" covers, and what it does not.** A revert restores the *values*: a
post's words, a meta, an option, a file's bytes. It does not rewind WordPress's own bookkeeping —
the edit filed a revision and moved `post_modified`, and putting the old text back files another
revision on top. The page reads as it did; its history shows both moves. Say so when a customer
asks whether the site is "back to normal", because the front end and the revisions screen give
different answers.

**Undoing a create deletes for real.** A post this Apply inserted is removed with force, not sent
to the trash — a customer must not be left holding something they never approved, waiting in a bin
for someone to notice. There is no undo for the undo: what protects you is that the revert only
ever removes what this same Apply created.

## Where a page's fields actually live

The one thing to get right before writing anything. A WordPress page is not one row:

- **The words** — title, body, excerpt, slug, status — are the post itself. `kind: "post"`.
- **The SEO fields** — meta description, focus keyword, canonical, social titles — are **not**
  columns of the post. They are meta values *named* against it, owned by whichever plugin the site
  runs (Yoast: `_yoast_wpseo_metadesc`; Rank Math: `rank_math_description`; SEOPress:
  `_seopress_titles_desc`). `kind: "postmeta"`, with the key.
- **Site-wide settings** — the site title, a theme option — are options. `kind: "option"`, with the
  option name.

Writing a meta description into `post_excerpt` because both are "the description" is the mistake
this section exists to prevent: it lands, it looks applied, and the search result never changes.

**Which SEO plugin is this site running?** The local copy answers it (`surface/site.json`, or the
plugin list in the digest). Do not guess the key from the plugin's name — read it, or write nothing.

## The tools

A Site agent is handed these by `tracy-apply`; the site is resolved for you, so you never name a
host or hold a credential.

- **`update_content`** — one post, one post meta, or one option. `kind` is `post` | `postmeta` |
  `option`.
  - `post`: `id` is the post; leave it at 0 to insert. `fields` may carry `post_title`,
    `post_content`, `post_excerpt`, `post_status`, `post_name`, `post_parent`, `menu_order`, and
    `post_type` on insert only. **Any other field is refused**, with both lists named — it is not
    dropped silently.
  - `postmeta`: `id` is the **post** the value hangs off, `key` is the meta key, `fields` is
    `{ "value": … }`. Writing the value it already holds answers `ok` — WordPress reports "nothing
    stored" for an unchanged value and a no-op is not a failure, so do not read success as proof
    the value changed. `list_apply` and the site itself are what prove that.
  - `option`: `key` is the option name, `fields` is `{ "value": … }`. A short list of options is
    refused outright (`siteurl`, `home`, `active_plugins`, `template`, `stylesheet`, `user_roles`,
    the plugin's own token, and transients): each of those takes the site away from whoever would
    have to fix it, and breaking one breaks the way back to the revert too.
- **`upload_media`** — one file under `wp-content/uploads/` only (never code), carried as base64,
  registered in the **Media Library** so a person can find it where they would look. **The ceiling
  is 8 MiB of decoded bytes** (`MAX_MEDIA_BYTES` in the site plugin's engine); past that the answer
  is `too_large` and the file needs the signed-URL path, which this skill does not have. Base64
  inflates by about a third, so a 6 MB photo is near the line — check the file's size before
  spending a call on it.
- **`install_plugin`** / **`install_theme`** — from a public `https` `.zip` URL the site downloads
  itself. Neither turns anything on. Not part of the revert log: installing is additive and
  WordPress owns the uninstall.
- **`activate_plugin`** (`file`, e.g. `akismet/akismet.php`) / **`activate_theme`** (`stylesheet`,
  e.g. `twentytwentytwo`). Separate from installing because they fail differently: a package can
  install fine and still refuse to run. `activate_theme` returns the theme it replaced — put that
  in your report, it is the undo.
- **`revert_apply`** — undo a whole Apply by its `apply_id`, newest step first.
- **`list_apply`** — see what an `apply_id` touched (kind, id or path, create-or-update) without the
  before-payload.

## What a new post does by default

A post inserted with no `post_status` is created as a **draft**. That is deliberate: a page
appearing on a live site because nobody mentioned a status is the one outcome an Apply must not
produce by omission. If the deliverable says publish, say `post_status: "publish"` and mean it.

## How a refusal reads

A refusal is an answer, not a crash — read it and decide the next move:

- `NOT_SITE_ADMIN` — this seat is an Editor or Developer; only Owner/Admin apply. Do not retry;
  the change needs an authorised seat to approve it.
- `COMPONENT_NOT_REGISTERED` — the site has no plugin credential at the relay yet (it is set when
  the site is migrated/connected). Applying is not possible until it is.
- The plugin's own `{ok:false, error, message}` — the site refused the specific change (a field
  outside the whitelist, a protected option, a post id that is not there). Fix what it names and
  try that step again under the same `apply_id`.
- `bad_action: unknown action: content.update` — the site is running a plugin from before the write
  side existed (anything under 0.3.0). It is not a refusal of *this* change and no retry helps: the
  site needs its plugin brought up to date, which happens through Tracy, not from here.
- `write_failed: could not write wp-content/uploads/…` — nothing is wrong with the file or the
  path: that folder is not writable on this site. 🔒 Seen on tracy.ai, 2026-08-16: `uploads/` was
  left read-only (mode 555) after a security cleanup, so every upload failed while every content
  edit succeeded. Report it and carry on with the rest of the deliverable; whether uploads should
  be writable is the site owner's decision, not a step to retry.

## The shape of a run

1. Confirm the deliverable is approved and you hold an Owner/Admin seat.
2. Pick one `apply_id` for the whole deliverable.
3. Apply each step — `update_content` / `upload_media` / `install_plugin` + `activate_plugin`.
4. If anything is wrong, `revert_apply` the id and start over; the site returns to exactly what it
   was.
5. When the Apply landed, say so to the preview: `reload_preview`.

## Telling the preview

The customer is often watching their site inside Tracy while you work. What you just applied lives
in the site's database — a theme switched on, a page rewritten — and a database change produces no
commit, so nothing outside the site can notice it. The preview watches the deployed commit and
reloads on its own for anything that arrives through git; for your work it has nothing to watch.
🔒 Seen on 2026-08-15: a theme installed through git appeared in five seconds, and then activating
it changed nothing the customer could see until they reloaded by hand.

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

`/wordpress-apply` with nothing attached is **not** an instruction you can act on. This skill writes
to a customer's production site, and it needs two facts nobody can infer: which deliverable, and
where its approval is recorded. Say what is missing and offer `list_apply` to show what has already
been applied. Never pick a deliverable yourself — an unasked-for write to a live site is the one
mistake this skill exists to make impossible.

## Reporting back

The person cannot see the relay. When the run finishes, tell them: what landed (each step, in their
words — "the meta description of the pricing page", not a row id), the `apply_id` that reverts all
of it, and anything the plugin refused with what it said. A theme switch also reports the theme it
replaced; that belongs in the report. **Answer in the language the person is writing in**; ids,
field names, meta keys and the `apply_id` stay as they are — they are addresses, not prose.

Worked examples — a real run, step by step, and the mistakes that look right — ship with this skill
in `examples/apply-run.md`. Read it before your first Apply.

## When something breaks

- **`NOT_SITE_ADMIN`** — stop; the change needs an authorised seat, and retrying cannot make one.
- **`COMPONENT_NOT_REGISTERED`** — the site has no plugin credential at the relay. It arrives with
  migrate/connect; nothing you do from here creates it.
- **A step half-applied** — `revert_apply` the id, report what the plugin said, start over with a
  fresh id. Never leave a deliverable partially on a live site while you investigate.
- **A plugin installed but would not activate** — that is recoverable and it is where to stop: an
  installed-and-off plugin changes nothing, where a half-activated one can be a white screen with
  no admin left to undo it from. Report it; do not retry activation in a loop.
- **The revert itself refused** — stop everything and say so plainly; that is the one state a
  person must handle, because the guarantee (ADR 0048) rests on revert working.

What you learn here belongs back in this file: a refusal that needed a rule nobody had written down
is a rule this skill is missing, not a thing to remember.
