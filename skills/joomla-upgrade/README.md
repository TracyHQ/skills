# joomla-upgrade — map & build story

> **What this is.** A skill that upgrades a JoomlArt customer's Joomla site up the version chain to
> **Joomla 6**, one launch point at a time, and shows the customer their *own* site on 6 — a
> preview — before anyone commits. `SKILL.md` is the operating instructions the agent follows; this
> README is the map: what was built, where it lives across four repos, and *why* each piece exists.
> Read this to understand the whole; read `SKILL.md` to run it.

---

## 1. The one-paragraph goal

JoomlArt's customer base is stuck on old Joomla (3.x / 4.x) with paid JoomlArt templates. Joomla 6
is out. The question a customer asks is *"what does my site look like on 6?"* — and the honest
answer is a **preview**: take a copy of their site, walk it up to Joomla 6, and hand them a URL. The
core upgrade is only the middle of that; the ends are "make a safe copy" and "make the copy render
its real template on 6". This skill is the whole arc.

---

## 2. The map — four repos, one flow

The skill is markdown, but it drives machinery spread across four repositories. Nothing here is in
this repo except `SKILL.md` + `examples/`; the map tells you where the rest is.

```
                          ┌─────────────────────────────────────────────────────────────┐
                          │  tracy-skills  (this repo)                                    │
                          │  skills/joomla-upgrade/SKILL.md   ← the agent's instructions  │
                          │  skills/joomla-upgrade/README.md  ← you are here              │
                          └─────────────────────────────────────────────────────────────┘
                                                   │ the agent calls MCP tools
                                                   ▼
          ┌──────────────────────────────────────────────────────────────────────────────────┐
          │  tracy-desk  (the Electron app / the agent's MCP tools)                            │
          │                                                                                    │
          │  src/main/ai/mcp/servers/tracyApply.ts    → tool `core_upgrade`         (LIVE path) │
          │  src/main/ai/mcp/servers/tracyReskin.ts   → tool `upgrade_working_copy` (PREVIEW)   │
          │                                                                                    │
          │  Both go out through the RELAY (seats.tracy.ai): seat check (Owner/Admin),         │
          │  custodied component token, audit. The desk never holds the token.                 │
          └──────────────────────────────────────────────────────────────────────────────────┘
              │ LIVE path: relay → site's component            │ PREVIEW path: relay → fleet job
              ▼                                                 ▼
  ┌─────────────────────────────────────────┐   ┌───────────────────────────────────────────────┐
  │ claude-cowork  (the Joomla component)    │   │ tracy-fleet  (the fleet host scripts)         │
  │  installed on the customer's OWN site    │   │  runs on a CLONE of the site, on the fleet    │
  │                                          │   │                                               │
  │  lib/CoreUpgrader.php        (interface) │   │  tools/preview-to-six.sh   ← one command → J6 │
  │  .../Controller/JoomlaCoreUpgrader.php   │   │  tools/upgrade-hop.sh      ← one hop          │
  │     = the real upgrade: applyUpdateSite  │   │  provision/enable-j6-legacy-compat.sh         │
  │       + UpdateModel download/extract +   │   │     ← compat6 + T3 guard so template renders  │
  │       finaliseUpgrade, in TWO steps      │   │  provision/php_matrix.py   ← the version/PHP  │
  │  action name: `core.upgrade {to,step}`   │   │     chain (which hop, which PHP)              │
  └─────────────────────────────────────────┘   │  provision/{snapshot,restore,verify,set-php}  │
                                                 └───────────────────────────────────────────────┘
```

### The two paths, and which one actually ships today

| | **LIVE (self-serve)** | **PREVIEW / operator (recommended)** |
|---|---|---|
| Who drives | the customer, in Tracy Desk | JoomlArt, on the fleet |
| Tool | `core_upgrade` (tracy-apply) | `upgrade_working_copy` (tracy-reskin) → fleet job |
| Runs on | the customer's live site | a disposable **clone** on the fleet |
| Recovery if a hop breaks | needs a proven restore back into the customer's host *(open question)* | re-clone — trivial |
| Needs | the customer to be a **provisioned Tracy seat** (org + fleet) | **nothing from the customer** — the operator drives the fleet |
| Status | skill + agent run; end-to-end **blocked at seat/org/fleet provisioning** (a Tracy billing/backend concern, not the skill) | **proven end to end**: ja-teline 4.3.4 → 6.1.3, real Teline V template rendering, served at a public URL |

> **Takeaway:** to actually give a customer a Joomla-6 preview *today*, use the **operator path** —
> it sidesteps per-customer provisioning entirely. `tools/preview-to-six.sh` is that path in one
> command.

---

## 3. The mechanism — why the upgrade is shaped the way it is

**The chain is not skippable.** Joomla's update server enforces the path with signed TUF metadata: a
6.x package is only offered to a **5.4** site, a 5.x to a **4.4**, a 4.x to a **3.10**. So:

```
3.10 → 4.4 → 5.4 → 6.1        (a 4.3 site hops to 4.4 first; a 5.2 site to 5.4 first)
```

Under it runs a **PHP chain** people forget — each hop runs on a PHP its target supports (→4.4:
7.2.5+, →5.4: 8.1+, →6.1: 8.3+). `php_matrix.py` owns both chains.

**One hop is two calls — `prepare` then `finalise` — and it has to be two.** A core upgrade replaces
the code on disk mid-flight, so the process that copied the new files is still running the old ones
and cannot finalise against class signatures it never loaded. The web updater solves this by
finalising in a fresh request; the component does the same. `prepare` opens the channel
(`applyUpdateSite('next')` — the param alone is not enough), downloads and extracts; `finalise` runs
on the new code the next call loads.

**Every hop snapshots first.** `snapshot.sh` before, `verify.sh` after (front + admin 200, schema
clean). A hop that does not land is **restored and the chain stops** — a half-migrated schema makes
the next hop refuse to start, so continuing turns one break into a chain nobody can walk back.

---

## 4. The build story — what was proven, and where the surprises were

Read in order; each step earned the next.

1. **Proved the hardest hop in a Docker lab.** 5.4.8 → 6.1.3 by hand, and learned the two things the
   spec got wrong: a hop needs **two** `core:update` calls (the cross-version `setAdapter` crash), and
   `maintenance:database` needs `--fix`, not just a check. Conclusion: drive `UpdateModel`, not the
   CLI — the CLI can't open the 4.4→5.4 channel and crashes finalise. *(See `08-J6-Upgrade/RECIPE-5.4-to-6.md`.)*
2. **Built the component action** `core.upgrade` on that conclusion (`JoomlaCoreUpgrader`), then proved
   the **whole chain through the component over HTTP** in a lab: 4.4 → 5.4 → 6.1, the CLI-impossible
   4.4→5.4 hop included. *(See `08-J6-Upgrade/RECIPE-component-full-chain.md`.)*
3. **Ran it on a real JoomlArt site** (ja-teline-v.demo, Teline V, 4.3.4) on the fleet — and a real
   site taught what a clean lab never did. Eight findings the component now handles or the operator
   expects (see below).
4. **The "hard wall" that wasn't.** A JoomlArt template on the **T3 framework** calls the global `J*`
   aliases (`JFactory`, `JText`, …) Joomla 6 removed, so the front page 500s even with a healthy 6
   core. This looked like it needed JoomlArt to ship new templates first. It did **not**: Joomla 6
   *ships* the fix (the `compat6` behaviour plugin re-registers every alias); it just isn't installed
   and loads too late for T3. `enable-j6-legacy-compat.sh` installs+enables it and adds one guard to
   the T3 entry — and the **real Teline V design renders on Joomla 6**. This is the finding that made
   a faithful preview possible.
5. **Wired it into Tracy** — the MCP tools (`core_upgrade`, `upgrade_working_copy`), the skill, and the
   fleet tools, and tested the skill running in the real Tracy Desk app: the agent loads the skill,
   reads the site, plans the chain, calls the tools, exports the DB — all correct. End-to-end
   self-serve stops at **account provisioning** (`SEAT_NOT_AUTHORIZED`: the test account is an
   identity, not a provisioned Tracy seat with an org + fleet — a billing/backend concern, not the
   skill).
6. **Packaged the operator path** as `preview-to-six.sh`: one command takes a standing clone all the
   way to a Joomla-6 preview and reports the URL.

### The eight real-site findings (baked into the component / expected by the operator)

1. The CMS core **update site ships disabled** on some hosts → every check says "already latest". Re-enable it.
2. A **same-major hop** (4.3 → 4.4) needs the `default` channel, not just `next` for a crossing.
3. `applyUpdateSite` reads a **cached** component param → the first prepare after a channel change may need a retry.
4. Between prepare and finalise, drop the **cached PSR-4 map + opcache** — else finalise loads old classes against new files. (A fleet clone gets a container restart; a customer host gets `opcache_reset` from the component.)
5. `finaliseUpgrade` can leave **schema migrations owed** across a multi-major climb → apply them (`maintenance:database --fix`).
6. A site upgraded from an old major has an **empty `#__tuf_metadata`** + the host may 403 the TUF endpoint → seed the TUF root from an install of the same version.
7. The **compat behaviour-plugin toggle** must happen *after* the update refresh, not before — disabling `compat` first strips the aliases a 5.x site's own extensions use during the check.
8. Joomla 6 boots heavier — a host pinned at **`memory_limit = 128M`** exhausts on the first 6.x request.

### The provisioning boundary (why self-serve stalls, and it's fine)

Tracy's model is *"identity is bought, the gateway is built"* — a magic-link sign-in gives an
**identity**, but being an authorized **seat** with an org + a fleet is provisioned/purchased. A real
customer has it; a fresh test account does not, so the artifact upload during `build_working_copy`
returns `SEAT_NOT_AUTHORIZED`. This is **not** the skill — it's onboarding/billing, and it is **not**
solved by making anyone a `tracy_admin`. The operator path avoids it because JoomlArt drives the
fleet directly.

> **⚠️ Note — separate the proven from the inferred (added after review).**
>
> **Proven (hard evidence).** `SEAT_NOT_AUTHORIZED` is because the test account is a magic-link
> *identity*, not a provisioned seat: `/me` → 403, `POST /orgs` → 404, artifact `PUT` → 403. That is
> exactly "no seat granted, no org grant". A customer who has onboarded/paid already has a granted
> seat + org + fleet, so **they will not hit this particular gate**. That much is certain.
>
> **Inferred (NOT verified).** We never tested with a real provisioned account — this is reasoning
> from the seat-registry code, not a demonstrated fact. **Clearing the seat gate does not guarantee
> the rest of the self-serve flow runs clean to the end.** The full self-serve chain
> (`build_working_copy` → `upgrade_working_copy` → preview) has never run to completion, even with a
> real account, simply because we had no real account to try. After the seat gate there is still:
> provision the clone onto *that org's* fleet, run the upgrade chain, publish the URL — and each step
> can surface something new, exactly the way the final 5.4→6.1 hop surfaced the extension/JPlugin
> problem the spec never anticipated.
>
> **Bottom line.** A paid customer won't hit `SEAT_NOT_AUTHORIZED` — true. But do **not** read that as
> "a real customer = self-serve runs smoothly end to end" — nobody has proven that. What *is* proven
> is the core-upgrade mechanism on the fleet (4.3.4 → 6.1.3 + the template rendering), and that a
> preview can be delivered to a customer via the **operator path**, independent of whether the
> customer is a provisioned Tracy user.

---

## 5. Files in this skill

```
skills/joomla-upgrade/
├── SKILL.md              the agent's operating instructions (the loop: snapshot, hop, verify, stop)
├── README.md             this map
└── examples/
    └── upgrade-run.md    a worked run: 4.3.4 → 6.1.3, incl. the template-renders-after-compat step
```

`requires-mcp: tracy-fleet, tracy-reskin, tracy-apply` — the three MCP servers whose tools the skill
calls (`build_working_copy`, `upgrade_working_copy`, `reload_preview`; and `core_upgrade` on the live
path).

---

## 6. How to run

### Operator preview (recommended — no customer provisioning)

```
# On the fleet, once a clone of the customer's site stands (Tracy Migrate / provision.sh):
tools/preview-to-six.sh --label <clone-label>
```
It reads the version, loops `upgrade-hop.sh` over every launch point the chain requires, enables the
Joomla-6 legacy compat on the 6.1 landing, and prints the version, whether the front renders, and
**three ways to view it**: loopback, the durable `<label>.tracy.ai` URL (front page public once
Cloudflare Access gates only `/administrator*`), or an ephemeral `cloudflared tunnel` right now.

### Self-serve, in Tracy Desk

Add the site, chat *"preview this site on Joomla 6"*. The agent loads this skill and runs
`build_working_copy` → `upgrade_working_copy` → `reload_preview`. Requires the seat to be a
provisioned Tracy customer (org + fleet) — see the provisioning boundary above.

---

## 7. Status & pull requests

| Repo | What | PR |
|---|---|---|
| `claude-cowork` | `core.upgrade` component action, hardened for real hosts | #12 (merged) |
| `tracy-desk` | MCP tools `core_upgrade` + `upgrade_working_copy` | #419 (merged) |
| `tracy-skills` | this skill | #54 (merged), #55 (T3-compat doc) |
| `tracy-fleet` | `upgrade-hop.sh`, `enable-j6-legacy-compat.sh` | #8, #9 (merged) |
| `tracy-fleet` | `preview-to-six.sh` (operator one-command) | #13 (merged) |

**Proven:** the full chain 4.3.4 → 6.1.3 on a real JoomlArt site, the real T3 template rendering on
Joomla 6, served at a public URL, and the skill running correctly in Tracy Desk.
**Open (not the skill):** the customer-self-serve path has **never run end to end** — its first
blocker is Tracy account provisioning (`SEAT_NOT_AUTHORIZED`, no org + fleet), and what lies past
that gate is untested because we had no provisioned account to try (see the ⚠️ note in §4). A durable
public preview URL waits on a Cloudflare Access policy that gates only `/administrator*`.

---

## 8. Deeper reading

The blow-by-blow lives in the JoomlArt working notes (not in this repo): `08-J6-Upgrade/` —
`SPEC-v2.md` (the host-in-place vs fleet decision), `RECIPE-5.4-to-6.md` and
`RECIPE-component-full-chain.md` (the proven recipes), `HANDOFF-skill-to-run-on-tracy.md` (what it
takes to run on Tracy). The version/PHP chain rules live in the **tracy-fleet** repo at
`provision/php_matrix.py`; the upgrade conductor logic is `joomlart-joomla-ops/upgrade/upgrade_plan.py`.
