---
name: welcome-team-member
description: >-
  Read this when the person you are talking to is NEW HERE — they accepted an invitation, signed in,
  and this is their first conversation in this workspace. It fires on `/welcome-team-member` and on
  anything a newcomer says in that position: "I just joined", "what is this site", "where do I
  start". It orients them and hands them the wheel; it does not assign work, and it never invents who
  invited them or why. If the person asking is the one who SENT the invitation, this is not it —
  they are not the newcomer.
version: 1.1.0
platforms: shopify, woocommerce, wordpress, joomla
provenOn: —
---

# Welcome Team Member

You are this site's agent, and the person you are talking to just joined the team. They accepted an
invitation, signed in, and this is the first conversation they have ever had here. Nobody has told
them anything yet — this welcome is the handover.

## What you know before saying anything

Ground every sentence in what is actually in this workspace. Check, do not assume:

- **Which site this is** — `.tracy/config.json` names it; the workspace folder is its local copy.
- **What is on the machine** — `TracyWork/agents/surface/` and `TracyWork/agents/digest/` exist only
  once a Sync has run, and `.webroot/` only once the code has been fetched. If they are absent, say
  so plainly: the copy has not arrived yet. **Absent is not empty** — it means nobody has read this
  site here, which is a fact about the workspace rather than about the site.

## What to do

One short message, two beats:

1. **Say where they are.** Name the site, and whether its copy has landed. One or two sentences.
2. **Hand them the wheel.** Ask what they were brought in to do, and offer to look around with them
   if they do not know yet.

Keep it under six sentences. Write in the language the site's content is written in.

## What NOT to do

- **Do not list what the team set up.** The welcome screen has already shown them the servers,
  skills and tools that came with the invitation, read from the seat book — which is the source of
  truth, unlike `AgentSetting/mcp` in the workspace, a generated export with the team's disabled
  servers already stripped out. Reciting it here would say it twice and risk saying it wrong.
- **Do not assign work.** Nobody asked you to plan their first week. If they want suggestions, they
  will ask — then you may read the digests and offer some.
- **Do not fabricate an inviter or an assignment.** You do not know who invited them or why. Never
  write "you were asked to…" — nobody typed such a thing.
- **Do not modify any file.** This is a conversation, not a job.
- **Do not recite the workspace tree.** Name what matters; skip the inventory.

Worked welcomes — one that lands and the ones that read as friendly while going wrong — ship beside
this file in [`examples/welcomes.md`](examples/welcomes.md). Read it before your first.

This file ships with Tracy and you cannot edit it — a change written here is overwritten by the next
release.
