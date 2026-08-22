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
verify → version 6.1.3 · admin 200 · front 500                            # core landed, front did NOT
```

The core reached 6.1.3 and the administrator answers 200 — the upgrade itself is done. But the
front page 500s. Reading the error: `templates/ja_teline_v/index.php` calls `JFactory`, a class
Joomla 6 removed. **This is not a failed hop** — the core is healthy — it is the template not yet
having a Joomla-6 build. Report it as exactly that:

> Your site's core is now on Joomla 6.1.3 and the admin works. The front page needs a Joomla-6
> version of the Teline V template (and its T3 framework), which today still uses APIs Joomla 6
> removed. Here is the preview with a stock Joomla 6 template so you can see your content on 6;
> your design will look like itself again once the Joomla-6 template ships.

What NOT to do: do not call this a success and hand over a 500, and do not "fix" it by editing the
template — that is a Joomla-6 template build, a separate deliverable, not this skill's to fake.

## If a hop had NOT landed

Say hop 2's verify came back `front 500` with a *schema* error, not a template one. That is a
failed hop. You would **stop** — not take hop 3 — restore the snapshot from the start of hop 2,
confirm the copy is back at 4.4.14 and healthy, and report which hop failed and why. Continuing
past a half-migrated schema is how one broken hop becomes a chain nobody can walk back.
