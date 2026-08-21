---
name: joomla-readiness
description: >-
  Answer whether a Joomla site can move to Joomla 6, what would break, and how many upgrades
  stand in the way. Reads the site's own version and installed extensions, looks each one up in
  the public extension registry, and says out loud what it could not find out. Use when someone
  asks if a site is ready for Joomla 6, what is blocking an upgrade, or how far behind a site is.
version: 1.7.0
platforms: joomla
tags:
  - joomla
  - upgrade
  - maintenance
requires-mcp:
  - tracy-site
provenOn: >-
  Run end to end against a real customer site's real extensions table on 2026-08-21:
  ja-teline-v.demo.joomlart.com, read through its installed component with a real token, entirely
  read-only. 252 rows, 21 non-core, and every rule fired on real data rather than on a fixture —
  the three-hop staged migration for Joomla 4.3.4, the package roll-up folding a child into its
  package by real package_id, a vendor declaration printed as "the publisher declares", and the
  unknowns named and counted rather than rounded to fine. Earlier the same engine ran against
  forty live sites via manifests over HTTP. The one seam still untested is the MCP wrapper
  itself: read_versions and list_extensions over the tracy-site relay have not been called from a
  connected desk, though the component actions they wrap now have.
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

Count the hops rather than the major. A Joomla **5.2** site is two upgrades away, not one: a 6
package is offered only to 5.4, so it has to reach its own launch point first. It looks like one
hop to anybody counting majors, and it was told so until 2026-08-20.

PHP is the second chain, and it is a **floor, never a ceiling**:

```
-> 4.4    PHP 7.2.5        -> 5.4    PHP 8.1        -> 6.1    PHP 8.3
```

A site on Joomla 3 usually runs PHP 7.4, so the road raises PHP once or twice, and PHP lives
with the hosting provider rather than in the site. Name it; do not promise it.

**Ask for the next hop's minimum, never the destination's.** "Set PHP to 8.3, that is what
Joomla 6 needs" is wrong for every site not already at 5.4, and it is the advice a helpful
person gives. `scripts/php_step.py` answers one hop at a time; use it rather than reasoning it
out, and it returns an empty note when there is nothing to ask.

**Do not call a high PHP a problem.** An earlier version of this treated the PHP versions the
Joomla project builds images for as a valid range and flagged anything above it. Measured
against 553 live customer sites on 2026-08-20 that rule fired on 16 sites that were serving
perfectly well, among them Joomla 3.10 on PHP 8.1, 8.2, 8.3 and 8.5, and Joomla 4.4 on 8.4. The
site is the authority on what it runs; a table is not.

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

Pass the PHP version from the first tool into `profile_from_state(state, php=...)`. Left out, the
report tells the reader PHP was not looked at, which is a limit they are entitled to believe and
it would be false.

Both reach the site through Tracy's component. Where the component is not installed they fail
rather than guess, and a failure is not an empty site: say the site could not be read.

Do not guess either one from the site's HTML. A generator meta tag is frequently wrong, often
removed, and the whole point of this skill is not to be confidently wrong.

## What you read, and from where

| Source | Answers | Limits |
| --- | --- | --- |
| the site's own manifest | which Joomla it runs, exactly | needs the site connected |
| the site's installed extensions | what is actually there, not what was bought | says nothing about whether each is in use |
| `registry.tracy.ai/platform/joomla` | does this extension have a Joomla 6 build | it does not know every extension that exists, and the count changes: read it from the catalog you loaded rather than from this table |

Run the engine rather than reasoning it out yourself:

```
scripts/site_state.py     what the site reports, joined to the registry
scripts/php_step.py       the one PHP change to ask for now, or none
scripts/upgrade_path.py   the chain, and the bridge into the verdict rules
scripts/verdict.py        one of three levels, with its scope attached
scripts/catalog.py        the registry client
tests/run.sh              every check this skill makes about itself, one command
examples/readiness-run.md a finished report, and the engine call that produced it
```

Run `tests/run.sh` before trusting a change to any of them. 233 checks, no pytest, no network.

`examples/readiness-run.md` shows one site go from the two tool calls to the finished report,
with the numbers pasted from a real run rather than written by hand.

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

### Say how old the reading is

`load_catalog()` returns `observed_at` alongside the records, and it is there because the
registry is re-crawled by hand: its own README lists "no `schedule:` in the publish workflow"
as an open question. Measured on 2026-08-20 the live index was stamped 2026-08-04, sixteen days
behind.

**Print that date in your answer.** "The extension directory records no Joomla 6 build" is a
claim about a crawl, not about the world, and a reader given the sentence without the date will
take it for the world. A build published last week does not exist yet as far as this data is
concerned, and the customer is the person best placed to know that.

## The shape of the answer

Six parts, in this order. Two agents reading this should produce the same report about the same
site, and the order is chosen so that a reader who stops early has still read the true parts.

```
1  Verdict          one of three levels, and the headline that belongs to it
2  Scope            what the verdict was computed over, verbatim from the profile
3  The road         how many upgrades, named. One is "one"; more is a staged migration
4  What blocks it   the blockers list, most severe first. Empty is allowed and means empty
5  What to do next  the next steps, PHP first when there is one
6  What was not     the unseen list, and the date the registry was crawled
   looked at
```

**Do not reorder 1 and 6.** A report that opens with its limits reads as hedging and gets
skimmed past; one that closes with them has already said the thing the customer came for. Both
must be present.

**Print the level's own headline.** `verdict.headline` is chosen for the level and for the case,
including the two that override it: a site already on Joomla 6 and a site nothing could be read
from. Rewriting it in your own words is how those overrides get lost.

**Do not add a recommendation the engine did not make.** Naming a replacement template, quoting
a timeline, or estimating effort is inventing a finding. If the customer asks for one, say it is
a question for a person and offer to pass it on.

## The one rule

**Silence is never allowed to read as "fine".**

An extension the registry has never heard of is **unknown**, and unknown is a thing you print,
not a gap you fill. A wrong assertion of the same shape, *"this is ready for Joomla 6"*, has
white-screened live sites. Concretely:

- **a site nothing could be read from is not a cleared site.** The headline says the reading
  failed; it does not describe what was never read. A site whose read succeeded and returned
  only core rows is the opposite finding and reads as ready: it runs nothing that can block
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

Because a report silent about them reads as a report that checked them:

- **whether each extension is actually in use**, as opposed to installed
- **anything the registry does not list**, named with its count
- **the PHP version, only when it could not be read.** `read_versions` usually gives it, and
  `profile_from_state` then turns it into an instruction rather than a disclaimer. Saying it was
  not looked at while holding the number is a false limit, and a reader is entitled to believe
  a limit.

## Never

- Never say a site is ready when its Joomla version could not be read.
- Never turn "the registry does not list this" into "this does not support Joomla 6".
- Never promise an upgrade path shorter than the chain allows.
- Never offer to have someone confirm a third-party extension as though it were ours.
