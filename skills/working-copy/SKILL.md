---
name: working-copy
description: >-
  Build and find a Site's working copy, the running copy of the customer's site on Tracy's own
  infrastructure that all agent work happens on. Exports the live site's database and webroot,
  builds them into a running site at the site's own fleet address behind a login, and writes the
  address into the workspace. Use before any work that would otherwise touch a customer's site,
  and whenever anyone asks where this site's copy lives.
version: 1.2.0
platforms: joomla, wordpress
tags:
  - working-copy
  - fleet
  - migrate
  - safety
requires-mcp:
  - tracy-fleet
provenOn: —
---

# Working copy — the site the agent is allowed to touch

A Site in Tracy has two copies, and every rule below follows from telling them apart:

| | Where | For | Cost of a mistake |
|---|---|---|---|
| **Local copy** | in the workspace, on disk | **reading** — read-only, refreshed by Sync | re-Sync it |
| **Working copy** | running on the fleet, at its own address | **working** — changes are made here | rebuild it, and lose whatever was done on it |
| the **live site** | the customer's own hosting | their business | there is no undo |

The working copy is the customer's whole site standing on Tracy's infrastructure: their database,
their files, their extensions, their theme. It exists so an agent can be given real work to do.
Without it, every useful thing an agent does would land on a live business — and no owner should
be asked to accept that, however good the agent is.

**The live site is the source of truth, and the working copy is disposable.** That is ADR 0051's
host-in-place model, which is the only one built today: the customer's site stays on their own
hosting, the copy is staging, Sync runs one way (live → copy), and the copy can be thrown away and
rebuilt. Which is exactly what makes it safe to work in — a mistake here costs a rebuild, and a
rebuild is a Tuesday.

This skill only **builds and finds** the copy. Dressing it is `reskin`; showing the customer's
content inside a template demo is `demo-try-on`; putting finished work onto the live site is an
Apply (`joomla-apply` / `wordpress-apply`), always the customer's decision and gated at the relay
to Owner/Admin.

## How a build reaches the live site

A build is a **Migrate** — the same run the setup wizard performs, reached from a conversation
instead of a screen. It is the first automatic action a Site gets, and it is gated on an admin
login the owner supplies themselves: without one, nothing runs at all.

That credential does one job: **bootstrap**. Tracy signs in once, installs or refreshes its own
component (Joomla) or plugin (WordPress), and mints the token everything afterwards uses. It is
not the channel work travels on — writing content back to the live site is an Apply, and it goes
through the relay with its own role gate.

The install step is idempotent: a component already present and current is used as it stands
rather than reinstalled. A fresh token is written into the site's settings on every run, which is
the one thing that happens to their site each time.

| On the live site | |
|---|---|
| **Reached** | Tracy's own component/plugin — installed or refreshed if needed |
| **Not touched** | articles, posts, pages, media, users, theme, settings, any file they wrote |

So do not call a build "read-only" — it does reach their site. But do not dress it up as a
surprise either: it is the documented way a Site is connected, and the owner opened that door on
purpose. Writing *content* back to the live site is an Apply, a separate act with its own skill
and its own role gate at the relay.

## Called bare

`/working-copy` **asks `find_working_copy` and reports what it finds.** It does not build one.

That answer is this skill's own and must not be copied from another: building is not additive. A
site that already has a working copy is **rebuilt in place** — same address, same database name —
by unpacking the archive over the webroot and importing the dump over the database. Work done on
the copy is replaced by the live site's current state, silently, with no diff and no prompt. What
exactly goes and what stays is below, and the difference matters. So the cheap read comes first,
and building is something a person asks for.

Build when nothing is standing and there is work to do, or when the copy is known to be stale and
whoever is asking understands what a rebuild discards.

### The rebuild gate

**`build_working_copy` looks for a standing copy every time, and refuses to replace one unless you
pass `confirm_rebuild: true`.** You do not have to remember to check, and you cannot skip the
check — it is not advice in this document, it is the tool's first action.

Nothing else in the system refuses a second build: not the relay, which checks the seat and the
artifact keys and nothing more, and least of all the fleet, whose provision script is *written* to
be re-run (it keeps the copy's port and database password on purpose). The limit of "one working
copy per Site" is structural — the address derives from the hostname, so you cannot end up with
two — not a guard against rebuilding the one. This gate is the only guard there is.

When it refuses, it hands you what it found: the address, the proposals standing on the copy, and
when this Desk last built it. Take that to the person. `confirm_rebuild: true` is the answer to
someone saying "yes, replace it" — never your own conclusion, and never a way to retry a refusal.

### What a rebuild actually replaces

| | On a rebuild |
|---|---|
| **Database tables in the export** | dropped and recreated from the live site |
| **Database tables not in the export** | survive — including every `reskin` proposal's own schema |
| **Files** | the archive is unpacked *over* the webroot; it never wipes first, so a file only the copy had stays |
| **Address, port, login** | unchanged, deliberately |
| **What is exported** | fresh every time; a previous run's artifacts are reused only after a *failed* build |

The trap is in rows two and three together. A `reskin` proposal keeps its own database schema but
**shares the webroot files** with the site — one template on disk, the database deciding who wears
it. A rebuild therefore leaves every standing proposal listed, addressed, and wearing the live
site's files again: half-restored, and it looks finished. This is why the gate names them for you;
put that list in front of the person before anyone confirms.

## The three tools

| Tool | What it costs | What it answers |
| --- | --- | --- |
| `find_working_copy` | two quick calls | Where the copy is, whether it is standing, what stands on it |
| `working_copy_status` | nothing | How the last build went, step by step |
| `build_working_copy` | minutes — or nothing, when it refuses | Builds it, returns the address |

Only `build_working_copy` takes an argument, and only `confirm_rebuild`. The site is the one you
belong to: never assemble an address yourself and never go looking for one, because it is derived
from the site's own hostname on the app's side of the wire.

### What is knowable about a copy that exists, and what is not

`find_working_copy` reports three things, and there is no fourth to ask for:

- **It is answering** — from one HTTP request. Anything below a 500 means something is standing
  there; an Access login page answers 302.
- **The proposals on it** — from the relay. This is what a rebuild would half-undo.
- **When this Desk last built it** — from `facts/working-copy.json`, if a session wrote one.

Nothing reports how old the copy is otherwise, what content it holds, whether it has drifted from
the live site, or who built it. No route exists for any of that. So when the local record is
absent, that means *nobody wrote one down here* — a copy built from a coworker's Desk leaves no
note in this workspace. It never means the copy is new.

Say that limit out loud rather than describing a copy you have not seen. To know what is on it,
open the address.

## The address is derivable, and that is exactly why it goes missing

Every Site has **one** working copy at **one** address, forever — the label is a pure function of
the site's hostname. There is no list to search, no name to choose, and no way to end up with two
differently-addressed copies of one site.

Which produced a failure worth naming, 🔒 because it happened (2026-08-16). Asked where a site's
copy lived, an agent with no record of it searched the workspace, found the one file whose name
looked close, and answered — confidently, with a file path — about an unrelated database dump.
Nothing was broken. The address had simply never been written down, and *derivable* is not
*written down*.

So `build_working_copy` writes `facts/working-copy.json` into the workspace on success, and that
file is the answer in any later session. If you find the copy by some other route, put it there. A
fact nobody recorded is a fact the next session invents.

## What each answer means, exactly

**`working_copy_status` is held in memory.** It answers `none` after the app restarts, however
many copies are standing. `none` therefore never means "there is no working copy" — it means
"nothing was recorded in this session". The question that survives a restart is
`find_working_copy`.

**A working copy with no address is a success, not a failure.** A copy is given an address only
once a login stands in front of it, because it carries the customer's entire user table. If the
build reports that it stood the copy up but published no address, the copy is real and the door is
what failed. Do not hand out a guessed URL, and do not report it as a build error.

**A failure answers with the app's own code, not prose.** `no_admin_login` means Tracy holds no
working admin credential and a person must supply one; `provision_failed` means the export
succeeded and the build did not, which is Tracy's infrastructure and not something the customer
can fix. Report the code you were given rather than a guess at its cause.

**Two builds of one site cannot run at once.** Calling `build_working_copy` while one is running
joins the run in progress instead of starting a second — the app holds that lock. Do not write a
waiting loop around it. 🔒 Do not carry that reassurance into `reskin`: nothing locks a reskin
job, and that skill says so itself.

## Where to look, in order

Stop as soon as you can answer; each step costs more than the one above it.

1. `facts/working-copy.json` in the workspace — the address, if any session wrote it.
2. `find_working_copy` — the truth, one request, always available.
3. `working_copy_status` — only when something just ran and you need to know how far it got.
4. The person, in words — for the question no tool answers: whether they accept the copy being
   rebuilt over. You will not have to remember this step; the refusal puts you here.

## Rules that are not negotiable

- **Never call a build read-only.** It reaches their site to install or refresh Tracy's component.
  It changes nothing of theirs, and both halves of that sentence have to survive.
- **`confirm_rebuild: true` reports a decision, it does not make one.** Pass it only after a person
  has been shown what is standing and has said to replace it. Passing it to get past a refusal is
  the failure the gate exists to make impossible, done by hand.
- **Never describe a copy you have not opened.** Three facts are knowable and the rest is not; a
  fluent guess about what is on it is the same failure as the one that started this skill.
- **You never reach the live site yourself.** No SQL, no file edits, no admin login, no write of
  any kind of your own. If you are about to, stop: either a tool owns that step, or the step
  belongs to an Apply skill and is not yours.
- **You never choose infrastructure.** Hosts, ports, object store keys, DNS and the login are
  resolved from the site key by the app. There is nothing to configure and no host to name; if you
  find yourself looking for one, you are working around a tool instead of using it.
- **You never decide that a rebuild is acceptable.** That is a person's call, because it is their
  work on the copy that a rebuild discards.

## Reporting back

The person who asked cannot see your terminal. When a build finishes, tell them, in this order:

1. **The address**, or the reason there is none. A build that stood the copy up but published no
   address is not a success to report quietly — say the copy is standing and the login is not, so
   they know why there is nothing to click.
2. **What a rebuild replaced**, if the copy already existed and somebody had work on it. This is
   the only irreversible thing a build does.
3. **What was installed**, when the build installed or updated the component. Not an alarm — a
   line, because it is a change to their site and they should hear it from you first.

> Your working copy is standing at `https://<label>.tracy.ai`, behind your Tracy login. Nothing on
> your live site changed; Tracy's plugin was already installed, so the export used the one that was
> there.

**The address is not optional in the report.** Reporting that the copy was built while staying
quiet about a failed address reads as success — the failure is then discovered by the person who
clicks nothing.

**Answer in the language the person is writing in** (ADR 0053 §7). Addresses, labels, file names
and error codes stay verbatim — they are addresses, not prose, and translating one makes it wrong.

## When something breaks

Two failures account for most of them; check these before anything else.

- **`no_admin_login`.** Tracy has no working admin credential for the site, or the one it has
  stopped working. This is not something you can fix and not something to retry — a person opens
  Site Configuration and supplies one. Say which site, and stop.
- **`provision_failed`.** The export finished and the build did not, which is Tracy's own
  infrastructure. `working_copy_status` names the step it died on; report that step rather than
  the generic code, and do not re-run more than once — a second identical failure is news for a
  person, not for another attempt.

A build that never answers is a third case and it is the one to be careful with: the tool gives up
reporting after 30 minutes, but **the build has not been cancelled and is still running**. Read
`working_copy_status`; do not start another.

## Keeping this skill honest

Every build that surprises you becomes a line in this file. If you needed a hedge that is not
written here — a state one of the three tools reports that this document does not describe, or a
question you had to put to a person because no tool answered it — that is a rule this skill is
missing, not a one-off. Add it, raise the version, and name the site it happened on in `provenOn`.
Once this file holds enough of them to cite by number, they move to `references/spec.md`, the way
`reskin` and `demo-try-on` keep theirs.
