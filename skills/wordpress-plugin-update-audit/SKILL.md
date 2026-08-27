---
name: wordpress-plugin-update-audit
description: Read this BEFORE updating, installing or activating any plugin on a WordPress site — it is the one class of change Tracy cannot undo for you, and cannot verify afterwards. Use when someone asks whether their plugins need updating, asks you to update or install one, or asks whether an update is safe. Covers what the site's own inventory can and cannot tell you, why the usual integrity check is unavailable here, and what must be agreed with the customer before the call rather than explained after it.
version: 2.0.0
platforms: wordpress, woocommerce
requires-mcp:
  - tracy-apply
tags:
  - wordpress
  - maintenance
provenOn: —
---

# Before a plugin update

Every other change an agent makes to a WordPress site can be taken back. This one cannot. Read the
two sections below before the first call, not after it.

## What Tracy can and cannot do here

| | |
| --- | --- |
| Read what is installed, with versions and on/off state | ✅ `TracyWork/agents/surface/inventory.json` |
| Install a plugin, or install a newer version over an older one | ✅ `mcp__tracy-apply__install_plugin`, from a public `https` `.zip` URL the site downloads itself |
| Turn one on | ✅ `mcp__tracy-apply__activate_plugin` |
| **Undo any of that** | ❌ **Nothing.** Install and activate sit outside the Apply log, and `mcp__tracy-apply__revert_apply` does not reach them |
| **Snapshot the site first** | ❌ No tool exposed to you does this |
| **Verify the installed files are unmodified** | ❌ No checksum check is available |

Three of those rows are absences, and each one changes what you must say out loud.

**No undo.** Turning a plugin off afterwards does not undo activation: activation hooks have already
created tables and written options, and those stay. So the sentence *"I can put this back if it goes
wrong"* is one you may not say.

**No snapshot.** You cannot take a backup before the call. If the customer wants one, that is theirs
to take from their host, and it is worth asking rather than assuming they have one.

**No integrity check.** You cannot tell whether the files installed on that site are the ones the
author published. A plugin edited on the server looks identical to a clean one from here.

## The inventory, and what it does not carry

`inventory.json` lists every plugin with its version and whether it is running, and it is
**attested** — the site itself answered, through the component, rather than being guessed at from
outside. Two limits belong in what you say:

- It is a **photograph taken at the last Sync**. Name that date whenever you lean on it.
- It carries the **installed** version, never the **latest available** one. Nothing in Tracy tells
  you a plugin is out of date. If you claim one is, say where the newer number came from.

And a missing `inventory.json` never means "no plugins". It means nobody asked the site, or the site
did not answer — see the same rule in `wordpress-edit`.

## What to do

1. **Read the inventory.** Name the plugins, their versions, which are on and which are installed
   but off, and the date the list was taken.
2. **Say what you cannot check**, in the same breath: not whether a newer version exists, not
   whether the files are unmodified, and not how the site will behave afterwards.
3. **Get agreement before the call, not after.** The customer needs to know this specific change is
   one Tracy cannot reverse, and that no backup is being taken on their behalf. Say it plainly:
   *this one I cannot undo, and I am not taking a backup — do you have one?*
4. **Install, then activate — two calls.** A package can install cleanly and still refuse to run, so
   `mcp__tracy-apply__install_plugin` does not turn anything on. It answers with the plugin file it
   installed (`wordpress-seo/wp-seo.php`); that string exists only in that reply and
   `mcp__tracy-apply__activate_plugin` is the only thing that takes it. Write it down as it goes
   past.
5. **Report what actually happened**, including `was_active` if the plugin was already on, and say
   what you did not verify.

## Old patterns

<details>
<summary>The WP-CLI checksum procedure (removed 2026-08-27)</summary>

Version 1 of this skill was built around `wp plugin verify-checksums`, `wp core verify-checksums`
and `wp db size`. 🔒 An agent has no route to run WP-CLI on a customer's host: the component exposes
no shell, and no MCP server of Tracy's opens one. The procedure was unreachable from the first line.

One finding from it is worth keeping in mind if that route ever opens: `wp plugin verify-checksums`
**skips** any plugin it cannot look up on wordpress.org and still exits reporting success —
*"Verified 3 of 4 plugins (1 skipped)"*. A skipped plugin is not a clean plugin; it is a plugin
nobody checked. And skips are not random: they cluster on paid plugins, bespoke ones, and plugins
pinned to a version wordpress.org has dropped — the set most likely to have been edited on the
server. Any future integrity check must report the skip count separately from the pass count.

</details>
