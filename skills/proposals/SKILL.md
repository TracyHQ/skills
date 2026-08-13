---
name: proposals
description: The contract every site proposal follows (ADR 0045) - when to open one, what lives in its directory, how previews build from branches, who approves what, and why "rebuildable from the directory" is the definition of done. Use when starting, recording, or reviewing any proposed change to a site - a reskin, a content restructure, a code change.
version: 1.0.0
platforms: any
provenOn: joomlart.com (TracyHQ/joomlart.com — teline & stratum rebuild from their directories)
requires-mcp:
  - tracy-reskin
---

# Proposals — a change the customer can walk through before agreeing to it

A **proposal** is a second dressing of a site, living at its own address
(`<label>--<slug>.tracy.ai`), that the customer compares against their own site page by page.
The site itself and the customer's live site are never touched by any of this.

## When to open one

Ask one question about the thing you are about to produce: **"After the customer clicks
Approve, does this run on their site?"**

- Yes → it is a proposal. Open one (`make_proposal`) and do all work inside it.
- No → it is a deliverable (a report, content for people, an export). Write it under
  `deliverables/<task-slug>/` — inert by design, nothing there ever deploys.

Never write code meant for the site into `deliverables/`: a PHP file there is a dead file —
no preview shows it, no QA runs it, and its only path to the site bypasses every gate.

## The directory is the whole truth

```
proposals/<slug>/
  proposal.json   what the switcher shows: name, author, brief, carries, preview URL
  mapping.md      the decisions, reviewed by a person; jobs are refused without it
  frame.json      the template frame step (Joomla/WP), when the proposal wears one
  jobs/NN-*.json  the database half: declarative, replayed in filename order
  files/          the file half: paths relative to webroot/
```

**Definition of done: the preview rebuilds from this directory with no human in the loop.**
A push to branch `proposal/<slug>` triggers exactly that rebuild. If it fails or differs from
what you built by hand, the directory is lying — fix the directory, not the preview.

Hard-won rules (each one cost a broken rebuild):
- Filename order is dependency order: a job whose verify markers name another job's output
  runs after it.
- A job's `client` block is infrastructure, filled at run time — never in git, it carries
  credentials. The `source` block names the demo (`demo` + `prefix`); passwords resolve on
  the fleet.
- Read a stray job's `client` block to learn which site it belongs to. Filenames lie.
- Only jobs the mapping gate ACCEPTED belong in `jobs/` — a refused job recorded anyway
  makes the directory unreplayable.

## carries — what the proposal bundles, and who approves it

`proposal.json` declares `carries`: `look`, `content`, `skills`, `mcp`. Skill and MCP changes
ride the same branch but live in their real homes (`.claude/skills/`, `_Settings_/mcp/`).

| carries | who says yes | why |
| --- | --- | --- |
| look / content | the customer, on the preview | they can see it and compare two tabs |
| skills | a Developer reviews scripts as code, an Admin accepts the capability | skill scripts run on coworkers' machines, outside the relay |
| mcp | an Admin, always | it changes what the agent can reach; secrets never enter git |

## Approve is a merge — and only a merge

The customer's Approve merges `proposal/<slug>` into `main`, pinning the commit they were
looking at (a moved branch head answers "preview is stale", never a blind merge). From then on
`main` IS the record of what was agreed. **Approve is not Apply**: nothing reaches the live
site until the customer separately asks. The snapshot copy keeps mirroring the live site and
changes only when the live site does.
