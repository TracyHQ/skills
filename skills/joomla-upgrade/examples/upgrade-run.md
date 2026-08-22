# Example — a preview upgrade, 4.3.4 to 6.1.3, one hop at a time

A JoomlArt customer on Joomla 4.3.4 (a Teline V template site) asks what their site would look
like on Joomla 6. The readiness report says the chain is `4.3.4 → 4.4 → 5.4 → 6.1` and that the
last two hops need PHP 8.1 and 8.3. This runs on a **preview copy**, never the live site.

Read the starting point from the site itself, not the report:

```
core_upgrade is not called yet — first confirm the version.
info → { php: "8.3.33", joomla: "4.3.4" }        # PHP already high enough for the whole chain
```

## Hop 1 — 4.3.4 → 4.4

`to` is `4.4`, not `5.4`: 5 is not offered to a 4.3 site.

```
snapshot the copy                                 # a restore point before anything
core_upgrade { to: "4.4", step: "prepare" }  → { ok: true, version: "4.4.14" }
core_upgrade { to: "4.4", step: "finalise" } → { ok: true, version: "4.4.14" }
verify → version 4.4.14 · front 200 · admin 200 · schema clean            # landed
```

## Hop 2 — 4.4 → 5.4

```
snapshot
core_upgrade { to: "5.4", step: "prepare" }  → { ok: true, version: "5.4.8" }
core_upgrade { to: "5.4", step: "finalise" } → { ok: true, version: "5.4.8" }
verify → version 5.4.8 · front 200 · admin 200 · schema clean             # landed
```

## Hop 3 — 5.4 → 6.1

```
snapshot
core_upgrade { to: "6.1", step: "prepare" }  → { ok: true, version: "6.1.3" }
core_upgrade { to: "6.1", step: "finalise" } → { ok: true, version: "6.1.3" }
verify → version 6.1.3 · admin 200 · front 200 (after enable-j6-legacy-compat)  # real Teline V on J6
```

The core reached 6.1.3, admin answers 200 — and on reaching 6 the preview job runs
`enable-j6-legacy-compat`: it installs and enables Joomla 6's `compat6` plugin (which re-registers
the `JFactory`/`JText`/… aliases the T3 template calls) and adds one guard to the T3 entry so those
aliases load before its legacy core. The front page then renders the **real Teline V design** on
Joomla 6, not a stock fallback. Hand the customer that preview URL (`reload_preview`).

What to still watch: a specific third-party extension with no Joomla-6 build can fatal a page on its
own — AcyMailing's legacy plugins did on this site. When a page 500s, read which extension's file is
in the error and report THAT extension as needing an update; do not call the whole upgrade blocked,
and do not "fix" it by editing the extension.

## If a hop had NOT landed

Say hop 2's verify came back `front 500` with a *schema* error, not a template one. That is a
failed hop. You would **stop** — not take hop 3 — restore the snapshot from the start of hop 2,
confirm the copy is back at 4.4.14 and healthy, and report which hop failed and why. Continuing
past a half-migrated schema is how one broken hop becomes a chain nobody can walk back.
