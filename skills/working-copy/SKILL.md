---
name: working-copy
description: >-
  Build and find a Site's working copy, the running copy of the customer's site on Tracy's own
  infrastructure that all agent work happens on. Exports the live site's database and webroot,
  builds them into a running site at the site's own fleet address behind a login, and writes the
  address into the workspace. Reads the live site, never writes to it. Use before any work that
  would otherwise touch a customer's site, and whenever anyone asks where this site's copy lives.
version: 1.0.0
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

A Site in Tracy has two copies, and every rule in this skill follows from telling them apart:

| | Where | What it is for |
| --- | --- | --- |
| **Local copy** | in the workspace, on disk | reading — read-only, refreshed by Sync |
| **Working copy** | running on the fleet, at its own address | **working** — this is where changes are made |

The working copy is the customer's whole site standing on Tracy's infrastructure: their database,
their files, their extensions, their theme. It exists so that an agent can be given real work to
do. Without it, every useful thing an agent does would land on a live business — and no owner
should be asked to accept that, however good the agent is.

So the direction is fixed, and it is the reason this skill is safe to run: **the live site is
read, never written.** Getting work back onto the live site is an Apply, it is a different skill,
and it is always the customer's decision.

## Called bare

`/working-copy` **asks `find_working_copy` and reports what it finds.** It does not build one.

That answer is this skill's own and must not be copied from another: building is not additive. A
site that already has a working copy is **rebuilt in place** — same address, same database name —
by extracting the archive over the webroot and importing the dump over the database. Anything
anyone changed on the copy is overwritten with the live site's current state, silently, with no
diff and no prompt. So the cheap read comes first, and building is something a person asks for.

Build when nothing is standing and there is work to do, or when the copy is known to be stale and
whoever is asking understands what a rebuild discards.

## The three tools

| Tool | What it costs | What it answers |
| --- | --- | --- |
| `find_working_copy` | one HTTP request | Where the working copy is, and whether it is standing |
| `working_copy_status` | nothing | How the last build went, step by step |
| `build_working_copy` | minutes, and traffic on the live site | Builds it, and returns the address |

Never assemble an address yourself and never go looking for one. It is derived from the site's own
hostname on the app's side of the wire, so `find_working_copy` is both cheaper and more correct
than anything you could put together.

## The address is derivable, and that is exactly why it goes missing

Every Site has **one** working copy at **one** address, forever — the label is a pure function of
the site's hostname. There is no list to search, no name to choose, and no way to end up with two
differently-addressed copies of one site.

Which produced a failure worth naming, because it happened (2026-08-16). Asked where a site's copy
lived, an agent with no record of it searched the workspace, found the one file whose name looked
close, and answered — confidently, with a file path — about an unrelated database dump. Nothing
was broken. The address had simply never been written down, and *derivable* is not *written down*.

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
joins the run in progress instead of starting a second — the app holds that lock, and this is one
of the few places where it does. Do not write a waiting loop around it.

## Where to look, in order

Stop as soon as you can answer; each step costs more than the one above it.

1. `facts/working-copy.json` in the workspace — the address, if any session wrote it.
2. `find_working_copy` — the truth, one request, always available.
3. `working_copy_status` — only when something just ran and you need to know how far it got.
4. The person, in words — only for the question no tool answers: whether they accept the copy
   being rebuilt over.

## What this skill does not do

- **It does not reach the live site.** No SQL, no file edits, no admin login, no write of any
  kind. If you are about to do one of those, you are in the wrong skill.
- **It does not choose infrastructure.** Hosts, ports, object store keys, DNS and the login are
  resolved from the site key by the app. There is nothing to configure and no host to name.
- **It does not decide whether a rebuild is acceptable.** That is a person's call, because it is
  their work on the copy that a rebuild discards.

## Keeping this skill honest

Every build that surprises you becomes a line in this file. If you needed a hedge that is not
written here — a state one of the three tools reports that this document does not describe, or a
question you had to put to a person because no tool answered it — that is a rule this skill is
missing, not a one-off. Add it, raise the version, and name the site it happened on in `provenOn`.
