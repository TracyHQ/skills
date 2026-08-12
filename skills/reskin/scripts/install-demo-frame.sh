#!/usr/bin/env bash
# install-demo-frame.sh — put the demo's FRAME onto a client working copy
# (spec §4): template files + framework + the two-style structure, plus the
# render preconditions every later step depends on. Idempotent: rerunning on a
# dressed copy is a no-op. Carries traps 1/2/3/6/7/21 from the reference pair:
#   - template + T4 framework + versioned deps come as FILES from the demo
#     container (the CLI installer can refuse without a reason, trap 21) with
#     the DB rows discover'd or manifest-synced
#   - TWO styles ported from the demo: the default (with a component area) and
#     the home style (positions only) — pinning home-style on inner pages
#     renders empty shells (trap 7)
#   - `.htaccess` provisioned when sef_rewrite is on (trap 6)
#   - page cache off (trap 3), listed style pins removed (trap 2)
#
# Usage:
#   install-demo-frame.sh \
#     --client-db <ctr> --client-web <ctr> --prefix ja_ --pass <pw> \
#     --source-db <ctr> --source-web <ctr> --source-prefix stratum_ --source-pass <pw> \
#     --template ja_stratum \
#     --style-default-id 174 --style-home-id 173 \
#     [--home-menu-id 435] [--unpin "435,666"] [--dry-run]
set -euo pipefail

CDB="" CW="" P="" PW="" SDB="" SW="" SP="" SPW="" TPL="" SDID="" SHID="" HOMEID="" UNPIN="" DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --client-db) CDB="$2"; shift 2 ;;
    --client-web) CW="$2"; shift 2 ;;
    --prefix) P="$2"; shift 2 ;;
    --pass) PW="$2"; shift 2 ;;
    --source-db) SDB="$2"; shift 2 ;;
    --source-web) SW="$2"; shift 2 ;;
    --source-prefix) SP="$2"; shift 2 ;;
    --source-pass) SPW="$2"; shift 2 ;;
    --template) TPL="$2"; shift 2 ;;
    --style-default-id) SDID="$2"; shift 2 ;;
    --style-home-id) SHID="$2"; shift 2 ;;
    --home-menu-id) HOMEID="$2"; shift 2 ;;
    --unpin) UNPIN="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$CDB" ] && [ -n "$CW" ] && [ -n "$P" ] && [ -n "$PW" ] && [ -n "$SDB" ] && [ -n "$SW" ] && \
[ -n "$SP" ] && [ -n "$SPW" ] && [ -n "$TPL" ] && [ -n "$SDID" ] && [ -n "$SHID" ] || {
  echo "usage: see header of install-demo-frame.sh" >&2; exit 2
}

python3 - "$CDB" "$CW" "$P" "$PW" "$SDB" "$SW" "$SP" "$SPW" "$TPL" "$SDID" "$SHID" "${HOMEID:-}" "$UNPIN" "$DRY" <<'PYEOF'
import base64, json, subprocess, sys

cdb, cw, P, pw, sdb, sw, SP, spw, tpl, sdid, shid, homeid, unpin, dry = sys.argv[1:15]
dry = dry == "1"

def sql_on(db, dbpw, q, mutate=False):
    if dry and mutate:
        print("  DRY:", q[:120]); return ""
    r = subprocess.run(["docker", "exec", db, "mariadb", "-uroot", f"-p{dbpw}", "joomla", "-N", "-B", "-e", q],
                       capture_output=True, text=True)
    if r.returncode: raise SystemExit(r.stderr[-300:])
    return r.stdout.strip()

def csql(q, mutate=True): return sql_on(cdb, pw, q, mutate)
def ssql(q): return sql_on(sdb, spw, q)

def sh(ctr, cmd, mutate=True):
    if dry and mutate:
        print(f"  DRY sh({ctr}):", cmd[:120]); return ""
    r = subprocess.run(["docker", "exec", ctr, "sh", "-c", cmd], capture_output=True, text=True)
    return r.stdout.strip()

def q1(s): return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'") + "'"

def copy_tree(paths):
    joined = " ".join(f"'{p}'" for p in paths)
    if dry:
        print("  DRY copy:", joined); return
    sh(sw, f"tar -C /var/www/html -cf /tmp/frame.tar {joined}", mutate=False)
    subprocess.run(["docker", "cp", f"{sw}:/tmp/frame.tar", "/tmp/frame.tar"], check=True)
    subprocess.run(["docker", "cp", "/tmp/frame.tar", f"{cw}:/tmp/frame.tar"], check=True)
    sh(cw, "tar -C /var/www/html -xf /tmp/frame.tar && rm /tmp/frame.tar", mutate=False)

# --- 1. template files + T4 framework files --------------------------------
have_tpl = sh(cw, f"[ -d /var/www/html/templates/{tpl} ] && echo yes", mutate=False) == "yes"
print(f"[1] template files {tpl}: {'present' if have_tpl else 'copying from demo'}")
if not have_tpl:
    copy_tree([f"templates/{tpl}", "plugins/system/t4", "media/t4"])
    sh(cw, "chown -R www-data:www-data /var/www/html/templates /var/www/html/plugins/system/t4 /var/www/html/media/t4 2>/dev/null; true")

# --- 2. DB rows: template + t4 plugin discover'd or manifest-synced --------
row = csql(f"SELECT extension_id FROM {P}extensions WHERE type='template' AND element={q1(tpl)}", mutate=False)
print(f"[2] template DB row: {'present' if row else 'discovering'}")
if not row:
    print(sh(cw, "php /var/www/html/cli/joomla.php extension:discover 2>&1 | tail -1"))
# A discovered row sits at state=-1 and enabling it does nothing until
# discover:install runs (second reference pair: "T4 Framework Plugin is not enabled"
# with enabled=1). Install every discovered row we care about, then enable.
for el, cond in ((tpl, f"type='template' AND element={q1(tpl)}"),
                 ("t4", "type='plugin' AND element='t4' AND folder='system'")):
    pending = csql(f"SELECT extension_id FROM {P}extensions WHERE {cond} AND state=-1", mutate=False)
    if pending:
        print(f"  discover:install {el} (eid {pending})")
        print(sh(cw, f"php /var/www/html/cli/joomla.php extension:discover:install --eid {pending} 2>&1 | tail -1"))
csql(f"UPDATE {P}extensions SET enabled=1 WHERE (type='template' AND element={q1(tpl)}) OR (type='plugin' AND element='t4' AND folder='system')")

# --- 3. two-style structure ported from the demo (trap 7) ------------------
sdef = ssql(f"SELECT id FROM {SP}template_styles WHERE template={q1(tpl)} AND client_id=0 AND home='1'")
# The home style is whichever style the demo's OWN home page is pinned to — a title
# match fails the moment a template calls it something else (Teline calls it "Magazine").
shome = ssql(f"SELECT template_style_id FROM {SP}menu WHERE home=1 AND client_id=0 AND template_style_id>0 LIMIT 1")
if not shome:
    shome = ssql(f"SELECT id FROM {SP}template_styles WHERE template={q1(tpl)} AND client_id=0 AND title LIKE '%Home%' LIMIT 1")
print(f"[3] port styles: demo default={sdef} -> client {sdid}; demo home={shome} -> client {shid}")
for src, dst, title, make_default in ((sdef, sdid, f"{tpl} - Default", True), (shome, shid, f"{tpl} - Home", False)):
    if not src:
        print(f"  ! demo style missing for {title} — skipped"); continue
    b = ssql(f"SELECT REPLACE(TO_BASE64(params), CHAR(10), '') FROM {SP}template_styles WHERE id={src}")
    csql(f"INSERT INTO {P}template_styles (id, template, client_id, home, title, inheritable, parent, params) "
         f"VALUES ({dst}, {q1(tpl)}, 0, '0', {q1(title)}, 0, '', FROM_BASE64('{b}')) "
         f"ON DUPLICATE KEY UPDATE params=FROM_BASE64('{b}')")
if sdef:
    csql(f"UPDATE {P}template_styles SET home='0' WHERE client_id=0")
    csql(f"UPDATE {P}template_styles SET home='1' WHERE id={sdid}")
if homeid and shome:
    csql(f"UPDATE {P}menu SET template_style_id={shid} WHERE id={homeid}")
    print(f"  home menu item {homeid} pinned to home style {shid}")

# --- 4. unpin listed old-style pins (trap 2) -------------------------------
pins = [x.strip() for x in unpin.split(",") if x.strip()]
if pins:
    csql(f"UPDATE {P}menu SET template_style_id=0 WHERE id IN ({','.join(pins)})")
print(f"[4] unpinned {len(pins)} menu items")

# --- 5. render preconditions: .htaccess (trap 6) + cache off (trap 3) ------
sef_rw = sh(cw, "grep -c \"public [$]sef_rewrite = true\" /var/www/html/configuration.php || true", mutate=False)
has_ht = sh(cw, "[ -f /var/www/html/.htaccess ] && echo yes", mutate=False) == "yes"
if sef_rw.strip() == "1" and not has_ht:
    print("[5] sef_rewrite on, no .htaccess -> provisioning from htaccess.txt")
    sh(cw, "cp /var/www/html/htaccess.txt /var/www/html/.htaccess && chown www-data:www-data /var/www/html/.htaccess")
else:
    print(f"[5] .htaccess: {'present' if has_ht else 'not needed'}")
sh(cw, "sed -i \"/public [$]caching/s/= '[0-9]'/= '0'/\" /var/www/html/configuration.php")
sh(cw, "rm -rf /var/www/html/cache/* 2>/dev/null; true")
print("[6] page cache off, cache dir cleared")
# --- 7. position bleed: the client's OWN modules that the new template renders ---
# Two templates on one framework share position names, so the old skin's modules
# reappear inside the new one (a login form on the homepage, a stray menu in the
# footer). This is a mapping decision, never a guess — so the list is printed,
# loudly, and the run is not "done" until someone has ruled on every line.
# Positions come from TWO places: the manifest, and the layout mapping files a
# framework template routes through (T3/T4 `etc/layout/*.ini`). Reading only the
# manifest missed `header-1` — the very slot that put a login form on a homepage.
declared = set(sh(cw, f"grep -ohE '<position>[a-z0-9_-]+' /var/www/html/templates/{tpl}/templateDetails.xml | cut -d'>' -f2",
                  mutate=False).split())
declared |= set(sh(cw, f"grep -ohE '^position=\"[a-z0-9_-]+' /var/www/html/templates/{tpl}/etc/layout/*.ini 2>/dev/null | cut -d'\"' -f2",
                   mutate=False).split())
declared = sorted(declared)
bleed = []
if declared:
    inlist = ",".join(q1(x) for x in declared)
    rows = csql(f"SELECT id, title, module, position FROM {P}modules "
                f"WHERE id<1000 AND published=1 AND client_id=0 AND position IN ({inlist}) "
                f"ORDER BY position", mutate=False)
    bleed = [r.split("\t") for r in rows.split("\n") if r.strip()]
print(f"[7] POSITION BLEED: {len(bleed)} client module(s) sit in positions {tpl} renders")
for mid, title, mod, pos in bleed[:40]:
    print(f"      {pos:<16} {mod:<24} #{mid} {title[:40]}")
if bleed:
    print("    -> Each line is a mapping decision: keep it, move it, or unpublish it.")
    print("       Nothing here is a defect the QA gates can see — they are all valid layouts.")
print("install-demo-frame:", "DRY RUN" if dry else "done")
PYEOF
