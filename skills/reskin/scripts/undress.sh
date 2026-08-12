#!/usr/bin/env bash
# undress.sh — the brake of the Reskin pipeline: put the client working copy
# back the way the snapshot recorded it. Cheap by design (spec §9):
# every Reskin row lives above an ID offset, and the snapshot JSON *is* the
# semantic backup of everything the run was allowed to mutate.
#
# Restores, in order:
#   1. drop Reskin modules (id >= module offset) + their menu assignments
#   2. drop Reskin menu items (ids not present in the snapshot), closing
#      nested-set gaps leaf by leaf
#   3. drop Reskin article shells (id >= content offset)
#   4. restore link + template_style_id of every surviving menu item from the
#      snapshot (style pins, de-ja_v5'd links, repointed pages)
#   5. drop template styles not present in the snapshot; restore the original
#      default-style flag
#   6. restore extension enabled flags from the snapshot
#   7. strip the "TRACY RESKIN TINT" block from darkmode.css (unless --keep-files)
#   8. purge the forSEF url cache, clear Joomla cache, verify homepage
#
# Known limits (recorded in the spec): menu params edits (page_heading) and the
# provision-level .htaccess are left in place — both are harmless to the old
# look and the latter predates the reskin.
#
# Usage:
#   undress.sh --db <ctr> --web <ctr> --prefix ja_ --pass <pw> \
#              --snapshot content-inventory.json --host <h> --port <n> \
#              [--module-offset 1000] [--content-offset 3000] [--keep-files] [--dry-run]
#
# --keep-files leaves step 7 alone. Files are shared by every variant of a site (ADR 0044):
# only the database is per-proposal. Undressing the base must not reach into a stylesheet a
# proposal is still wearing — and the tint it would strip lives in the demo template's own
# CSS, which the undressed site no longer loads anyway.
set -euo pipefail

DB="" WEB="" PREFIX="" PASS="" INV="" HOST="" PORT="" MOFF=1000 COFF=3000 DRY=0 KEEPF=0
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --web) WEB="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --pass) PASS="$2"; shift 2 ;;
    # --snapshot is the name; --inventory still works for older call sites.
    --snapshot|--inventory) INV="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --module-offset) MOFF="$2"; shift 2 ;;
    --content-offset) COFF="$2"; shift 2 ;;
    --keep-files) KEEPF=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DB" ] && [ -n "$WEB" ] && [ -n "$PREFIX" ] && [ -n "$PASS" ] && [ -f "$INV" ] || {
  echo "usage: undress.sh --db <c> --web <c> --prefix <p> --pass <pw> --snapshot <json> --host <h> --port <n> [--dry-run]" >&2
  exit 2
}

python3 - "$DB" "$WEB" "$PREFIX" "$PASS" "$INV" "$HOST" "$PORT" "$MOFF" "$COFF" "$DRY" "$KEEPF" <<'PYEOF'
import base64, json, subprocess, sys, urllib.request

db, web, P, pw, inv_path, host, port, moff, coff, dry, keep_files = sys.argv[1:12]
moff, coff, dry, keep_files = int(moff), int(coff), dry == "1", keep_files == "1"
inv = json.load(open(inv_path))

def sql(q, mutate=True):
    if dry and mutate:
        print("  DRY:", q[:140].replace("\n", " "))
        return ""
    r = subprocess.run(["docker", "exec", db, "mariadb", "-uroot", f"-p{pw}", "joomla", "-N", "-B", "-e", q],
                       capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL failed: {r.stderr[-300:]}")
    return r.stdout.strip()

def q1(s):
    return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'") + "'"

# --- 1. modules above the offset -------------------------------------------
mods = sql(f"SELECT COUNT(*) FROM {P}modules WHERE id>={moff}", mutate=False)
print(f"[1] drop {mods} reskin modules (id>={moff})")
sql(f"DELETE FROM {P}modules_menu WHERE moduleid>={moff}")
sql(f"DELETE FROM {P}modules WHERE id>={moff}")

# --- 2. menu items the snapshot never saw ---------------------------------
inv_menu_ids = {i["id"] for items in inv["menus"].values() for i in items}
live = sql(f"SELECT id FROM {P}menu WHERE client_id=0 AND id>1", mutate=False)
added = [int(x) for x in live.split() if x and int(x) not in inv_menu_ids]
print(f"[2] drop {len(added)} added menu items: {sorted(added)}")
for mid in sorted(added):
    row = sql(f"SELECT lft, rgt FROM {P}menu WHERE id={mid}", mutate=False)
    if dry and not row:
        continue
    lft, rgt = (map(int, row.split("\t")) if row else (0, 1))
    if rgt != lft + 1:
        print(f"  ! {mid} is not a leaf (children?) — skipped, resolve by hand"); continue
    sql(f"DELETE FROM {P}menu WHERE id={mid}")
    sql(f"UPDATE {P}menu SET lft=lft-2 WHERE lft>{lft}")
    sql(f"UPDATE {P}menu SET rgt=rgt-2 WHERE rgt>{rgt}")

# --- 3. article shells above the offset ------------------------------------
arts = sql(f"SELECT COUNT(*) FROM {P}content WHERE id>={coff}", mutate=False)
print(f"[3] drop {arts} reskin article shells (id>={coff})")
sql(f"DELETE FROM {P}content WHERE id>={coff}")

# --- 4. restore surviving menu items from the inventory --------------------
restored = 0
for items in inv["menus"].values():
    for i in items:
        style = i.get("style_pin") or 0
        sql(f"UPDATE {P}menu SET link={q1(i['link'])}, template_style_id={style} WHERE id={i['id']}")
        restored += 1
print(f"[4] restored link+style on {restored} menu items from snapshot")

# --- 5. template styles ----------------------------------------------------
inv_styles = {s["id"] for s in inv.get("styles", [])}
default_id = next((s["id"] for s in inv.get("styles", []) if s.get("default")), None)
live_styles = sql(f"SELECT id FROM {P}template_styles WHERE client_id=0", mutate=False)
extra = [int(x) for x in live_styles.split() if x and int(x) not in inv_styles]
print(f"[5] drop {len(extra)} added styles {sorted(extra)}; default back to {default_id}")
for sid in extra:
    sql(f"DELETE FROM {P}template_styles WHERE id={sid}")
if default_id:
    sql(f"UPDATE {P}template_styles SET home='0' WHERE client_id=0")
    sql(f"UPDATE {P}template_styles SET home='1' WHERE id={default_id}")

# --- 6. extension enabled flags -------------------------------------------
flips = 0
for e in inv.get("extensions_ui", []):
    want = 1 if e.get("enabled") else 0
    folder = e.get("folder")
    cond = f"type={q1(e['type'])} AND element={q1(e['element'])}" + (f" AND folder={q1(folder)}" if folder else "")
    cur = sql(f"SELECT enabled FROM {P}extensions WHERE {cond} LIMIT 1", mutate=False)
    if cur and cur != str(want):
        sql(f"UPDATE {P}extensions SET enabled={want} WHERE {cond}")
        flips += 1
print(f"[6] restored enabled flag on {flips} extensions")

# --- 7. tint block ---------------------------------------------------------
tint_cmd = ("f=/var/www/html/templates/*/css/darkmode.css; for x in $f; do "
            "grep -q 'TRACY RESKIN TINT' $x 2>/dev/null && "
            "sed -i '/TRACY RESKIN TINT/,$d' $x && sed -i '${/^\\/\\* =*$/d}' $x && echo tinted:$x; done; true")
print("[7] strip tint block from darkmode.css" + (" — skipped (--keep-files)" if keep_files else ""))
if not dry and not keep_files:
    subprocess.run(["docker", "exec", web, "sh", "-c", tint_cmd], check=False)

# --- 8. caches + verify ----------------------------------------------------
# Not every site runs forSEF (the second reference pair didn't) — purge only what exists.
if sql(f"SHOW TABLES LIKE '{P}forsef_urls'", mutate=False):
    sql(f"DELETE FROM {P}forsef_urls")
if not dry:
    subprocess.run(["docker", "exec", web, "sh", "-c", "rm -rf /var/www/html/cache/* 2>/dev/null; true"], check=False)
    if host and port:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/",
                                     headers={"Host": host, "X-Forwarded-Proto": "https"})
        with urllib.request.urlopen(req, timeout=40) as r:
            print(f"[8] homepage after undress: {r.status}")
print("undress:", "DRY RUN — no changes made" if dry else "done")
PYEOF
