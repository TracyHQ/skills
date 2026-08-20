---
name: joomla-readiness
description: >-
  Answer whether a Joomla site can move to Joomla 6, what would break, and how many upgrades
  stand in the way. Reads the site's own version and installed extensions, looks each one up in
  the public extension registry, and says out loud what it could not find out. Use when someone
  asks if a site is ready for Joomla 6, what is blocking an upgrade, or how far behind a site is.
version: 1.0.0
platforms: joomla
tags:
  - joomla
  - upgrade
  - maintenance
requires-mcp:
  - tracy-site
provenOn: >-
  Live registry of 5,604 Joomla extensions, 2026-08-19: K2, JomSocial and Akeeba Backup resolved
  correctly against a simulated 5.4.8 site, and a 3.10.12 site was correctly told it faces three
  upgrades. Never yet run against a connected site, so the reading half is unproven even though
  the tools for it now exist.
---

# Joomla readiness

You answer one question, and it is the question the customer cannot answer for themselves:

> **Does my site move to Joomla 6, and what breaks?**

You do not upgrade anything. You read what is there and say what it means.

## Two chains, and the second one is the one people miss

Joomla's update server will not let a site skip a major. Its signed metadata matches the running
version against a regex per package, so a Joomla 6 package is offered only to 5.4.x, a Joomla 5
package only to 4.4.x, and 3.10.x goes straight to 4.4:

```
3.10  ->  4.4  ->  5.4  ->  6.1
```

A site on Joomla 3 is **three upgrades away**, not one. Saying "upgrade to Joomla 6" without
saying that is telling somebody the job is smaller than it is.

PHP is the second chain. Joomla 4 runs on 8.0 to 8.2, Joomla 5 on 8.2 to 8.3, Joomla 6 on 8.3 to
8.4. A site on Joomla 3 usually runs PHP 7.4, so the road raises PHP twice, and PHP lives with
the hosting provider rather than in the site. Name it; do not promise it.

## Getting the two inputs, which is the awkward part

Two tools, and neither takes arguments because they read the Site this agent belongs to:

1. **`mcp__tracy-site__read_versions`** gives the Joomla version and the PHP version, read from
   the site itself. If it says it could not read them, that is a real answer: the version is
   unknown and nothing may be called ready. Do not go looking for a second opinion in the HTML.
2. **`mcp__tracy-site__list_extensions`** gives every installed extension with its name, type,
   element, version and whether it is enabled. The element is what the registry lookup joins on.

Both reach the site through Tracy's component. Where the component is not installed they fail
rather than guess, and a failure is not an empty site: say the site could not be read.

Do not guess either one from the site's HTML. A generator meta tag is frequently wrong, often
removed, and the whole point of this skill is not to be confidently wrong.

## What you read, and from where

| Source | Answers | Limits |
| --- | --- | --- |
| the site's own manifest | which Joomla it runs, exactly | needs the site connected |
| the site's installed extensions | what is actually there, not what was bought | says nothing about whether each is in use |
| `registry.tracy.ai/platform/joomla` | does this extension have a Joomla 6 build | 5,604 records, and it does not know every extension that exists |

Run the engine rather than reasoning it out yourself:

```
scripts/site_state.py     what the site reports, joined to the registry
scripts/upgrade_path.py   the chain, and the bridge into the verdict rules
scripts/verdict.py        one of three levels, with its scope attached
scripts/catalog.py        the registry client
```

## The one rule

**Silence is never allowed to read as "fine".**

An extension the registry has never heard of is **unknown**, and unknown is a thing you print,
not a gap you fill. A wrong assertion of the same shape, *"this is ready for Joomla 6"*, has
white-screened live sites. Concretely:

- an extension not in the registry is unknown, not fine
- a registry record with no Joomla 6 field is unknown, not false
- a site whose version could not be read is never "ready", whatever its extensions say
- a core extension is not evidence of anything: it moves with the core

## Where the honest limit is

The registry is keyed by directory listing slug; a site reports Joomla element names; there is
no shared key between them:

```
k2            -> com_k2         the slug happens to be the element
akeeba-backup -> com_akeeba     close, and not equal
jomsocial     -> com_community  no textual relationship at all
```

Two routes are tried, the element and the human name, and **what neither reaches is counted**.
That count belongs in your answer every time. A report that quietly drops the half it did not
recognise is worse than one that admits the half.

## What you must say you did not look at

Three things, every time, because a report silent about them reads as a report that checked
them:

- **the PHP version**, which lives with the hosting provider
- **whether each extension is actually in use**, as opposed to installed
- **anything the registry does not list**, named with its count

## Never

- Never say a site is ready when its Joomla version could not be read.
- Never turn "the registry does not list this" into "this does not support Joomla 6".
- Never promise an upgrade path shorter than the chain allows.
- Never offer to have someone confirm a third-party extension as though it were ours.
