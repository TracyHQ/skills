---
name: wordpress-plugin-update-audit
description: Use before updating plugins on a live WordPress site — establishes what is actually verifiable, what the checksum check silently skipped, and what to snapshot, so an update that breaks the site can be undone and explained.
tags:
  - wordpress
  - wp-cli
  - maintenance
  - security
---

# Auditing a WordPress site before a plugin update

Updating plugins on a site that takes orders is not a package-manager problem. The risk is not
that an update fails loudly — it is that it succeeds, changes behaviour, and nobody notices until
a customer does.

This skill produces the evidence you need **before** touching anything, and it is written around
one specific trap that reads as good news.

## The trap: "Success" does not mean "all verified"

`wp plugin verify-checksums` compares installed files against wordpress.org's published hashes.
Plugins it cannot look up are **skipped**, and the command still exits reporting success:

```
Warning: Could not retrieve the checksums for version 8.0.0 of plugin acme-widget, skipping.
Success: Verified 3 of 4 plugins (1 skipped).
```

A skipped plugin is not a clean plugin. It is a plugin nobody checked.

Skips are not rare and they are not random. They cluster on exactly the plugins that matter most:

- **paid plugins** — never published to wordpress.org, so never checkable
- **custom or client-commissioned plugins** — same
- **plugins pinned to a version wordpress.org has dropped**

So the skip list is closer to a list of "plugins most likely to break or to have been edited on
the server" than to a list of "plugins we can ignore".

**Never report a checksum run without reporting the skip count separately from the pass count.**

## Procedure

Run these read-only. None of them writes to the site.

### 1. Record what is installed and what wants updating

```bash
wp plugin list --fields=name,status,version,update,update_version --format=csv
```

Keep this output. It is the only record of the pre-update state that survives the update, and it
is what you diff against if something changes.

Pay attention to `status`: an **inactive** plugin with a pending update is still a file on disk
that can be exploited, but updating it changes nothing a visitor sees. Active plugins are the
ones that carry behavioural risk.

### 2. Verify core, then plugins — and read the skip line

```bash
wp core verify-checksums
wp plugin verify-checksums --all
```

For core, `Success: WordPress installation verifies against checksums.` means what it says: every
core file matches.

For plugins, read the `Warning:` lines, not just the final line. Write down each skipped plugin by
name and version. Those are the ones you cannot make any claim about.

If a plugin verifies as **modified** rather than skipped, stop. Someone edited plugin files on the
server. Updating overwrites that edit — which may be the right outcome, or may destroy a fix
somebody made deliberately and never documented. That is a decision for the site owner, not for
the person running the update.

### 3. Size the rollback before you need it

```bash
wp db size --format=csv
wp core version
```

Knowing the database size tells you whether a pre-update export is a ten-second operation or a
ten-minute one. Decide that before starting, not while a page is down.

### 4. Snapshot

Take the database export and a copy of `wp-content/plugins` before the first update. An export you
did not take is not a rollback plan.

## What to report

State these four things separately. Collapsing them is how a real problem gets rounded off into
"looks fine":

1. **Verified clean** — core, and the plugins that passed.
2. **Skipped** — by name and version, with the reason they cannot be checked.
3. **Modified** — any plugin whose files do not match, and what that implies.
4. **Pending updates** — split into active and inactive.

If someone only wants one sentence, the honest one names the gap:

> Core verifies. 3 of 4 plugins verify. `acme-widget 8.0.0` could not be checked because it is not
> on wordpress.org, so its files are unverified — that is the one to look at by hand.

## What this skill does not do

It does not update anything, and it does not decide whether an update is safe. It establishes what
is known and what is unknown, so that the decision is made with the gap visible rather than hidden
behind a success message.
