---
name: joomla-readiness
description: >-
  Answer whether a Joomla site can move to Joomla 6, what would break, and how many upgrades
  stand in the way. Reads the site's own version and installed extensions, looks each one up in
  the public extension registry, and says out loud what it could not find out. Use when someone
  asks if a site is ready for Joomla 6, what is blocking an upgrade, or how far behind a site is.
version: 1.2.0
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
  the tools for it now exist. Package roll-up measured on a real Joomla 6.1.2 webroot,
  2026-08-20: 34 of 86 non-core rows were parts of ten packages, and reading them as ten
  products rather than forty-four cut the unrecognised count from 65 to 50.
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

## What this needs before it can read anything

`requires-mcp: tracy-site` says a server has to be there. It does not say the site has to have
been connected first, and people have read it as "point it at any Joomla site". It is not.

**The site must already be onboarded.** The tools reach the site through Tracy's component, and
the component is opened with a token held for that site. No token on file is answered
`needs_sign_in` before anything is read — not an empty site, not a failure, a question for the
customer.

**Getting that first token needs one admin sign-in, and there is no way round it.** Joomla does
not let a stranger enumerate installed extensions; if it did, that would be the security hole.
A person signs in to the site's administrator once so the component can be installed, and the
token is minted from that.

**After that, no password is read.** Every later run answers on the token alone, so a backend
that has since grown an MFA prompt keeps working. A token whose component has fallen behind
this build still does the job rather than refusing: an old component reads a database perfectly
well, and refusing would be the worse answer.

So there are two states, and only one of them is this skill's:

```
site already connected   -> this skill reads it, no password, no admin screen
site never connected     -> nothing here runs. Say so; do not go looking in the HTML.
```

If the answer is needed for a site nobody can sign in to, this is not the tool. Say what could
not be read rather than producing a report that looks like a reading.

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

### One product arrives as many rows

A package installs a component and its plugins as separate rows, and `#__extensions` holds
nothing that says they were one purchase. Xmap arrives as eight rows, RSForm! Pro as six. Left
alone they become eight unknown products in a count the whole report is built around, and the
customer reads a problem seven times larger than the one they have.

`read_state` takes an optional `packages` list to close this. Each entry is what one package
manifest says about itself:

```
{"name": "Xmap Package", "element": "xmap", "version": "2.3.3",
 "children": [{"type": "plugin", "element": "com_k2", "group": "xmap"}, ...]}
```

Where it comes from: `administrator/manifests/packages/pkg_*.xml`, a plain file in the webroot.
`list_extensions` cannot supply it today, because it returns neither `package_id` nor the plugin
group even though Joomla has both columns. Until it does, pass `packages` from whatever route
read those manifests, or pass nothing: without them this behaves exactly as it did before.

Keep the group. Two products ship a plugin whose element is `com_k2`, and without the group in
the key one product's row answers to the other's claim.

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
