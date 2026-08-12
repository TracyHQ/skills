#!/usr/bin/env bash
# sync-extensions.sh — apply the ticked rows of an extension diff to the client
# working copy (spec §5). Sources in order of trust:
#   (a) copy files from the demo container + refresh the DB row from the real
#       manifest XML — the path proven on the reference pair (the CLI installer can
#       refuse without a reason on these containers, trap 21)
#   (b) `enable` rows just flip `enabled` in the extensions table
# The reverse direction (demo lacks something) is out of scope by spec.
# `--index` schedules a `finder:index` afterwards — nice'd, because the 1GB
# droplet taught us what an un-nice'd indexer does to everything else.
#
# Usage:
#   sync-extensions.sh --diff extension-diff.json \
#     --client-db <ctr> --client-web <ctr> --prefix ja_ --pass <pw> \
#     --source-web <demo-web-ctr> \
#     [--only "com_finder,mod_ja_acm"] [--skip "akwarn"] [--index] [--dry-run]
set -euo pipefail

DIFF="" CDB="" CW="" PREFIX="" PASS="" SW="" ONLY="" SKIP="" INDEX=0 DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --diff) DIFF="$2"; shift 2 ;;
    --client-db) CDB="$2"; shift 2 ;;
    --client-web) CW="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --pass) PASS="$2"; shift 2 ;;
    --source-web) SW="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --skip) SKIP="$2"; shift 2 ;;
    --index) INDEX=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -f "$DIFF" ] && [ -n "$CDB" ] && [ -n "$CW" ] && [ -n "$PREFIX" ] && [ -n "$PASS" ] && [ -n "$SW" ] || {
  echo "usage: sync-extensions.sh --diff <json> --client-db <c> --client-web <c> --prefix <p> --pass <pw> --source-web <c> [--only a,b] [--skip a,b] [--index] [--dry-run]" >&2
  exit 2
}

python3 - "$DIFF" "$CDB" "$CW" "$PREFIX" "$PASS" "$SW" "$ONLY" "$SKIP" "$DRY" <<'PYEOF'
import json, subprocess, sys

diff_path, cdb, cw, P, pw, sw, only, skip, dry = sys.argv[1:10]
diff = json.load(open(diff_path))
only = {x.strip() for x in only.split(",") if x.strip()}
skip = {x.strip() for x in skip.split(",") if x.strip()}
dry = dry == "1"

def sql(q, mutate=True):
    if dry and mutate:
        print("  DRY:", q[:120]); return ""
    r = subprocess.run(["docker", "exec", cdb, "mariadb", "-uroot", f"-p{pw}", "joomla", "-N", "-B", "-e", q],
                       capture_output=True, text=True)
    if r.returncode: raise SystemExit(r.stderr[-300:])
    return r.stdout.strip()

def q1(s): return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'") + "'"

def sh(ctr, cmd):
    if dry:
        print(f"  DRY sh({ctr}):", cmd[:120]); return ""
    r = subprocess.run(["docker", "exec", ctr, "sh", "-c", cmd], capture_output=True, text=True)
    return r.stdout.strip()

def ext_dir(typ, element, folder):
    """Filesystem home of an extension inside a Joomla webroot."""
    if typ == "module": return f"modules/{element}"
    if typ == "component": return f"administrator/components/{element}", f"components/{element}"
    if typ == "plugin": return f"plugins/{folder}/{element}"
    if typ == "template": return f"templates/{element}"
    return None

def copy_dirs(paths):
    paths = [p for p in ([paths] if isinstance(paths, str) else list(paths)) if p]
    existing = [p for p in paths if sh(sw, f"[ -d /var/www/html/{p} ] && echo yes") == "yes"] if not dry else paths
    if not existing:
        return False
    joined = " ".join(f"'{p}'" for p in existing)
    if dry:
        print(f"  DRY copy: {joined}"); return True
    sh(sw, f"tar -C /var/www/html -cf /tmp/ext-sync.tar {joined}")
    subprocess.run(["docker", "cp", f"{sw}:/tmp/ext-sync.tar", "/tmp/ext-sync.tar"], check=True)
    subprocess.run(["docker", "cp", "/tmp/ext-sync.tar", f"{cw}:/tmp/ext-sync.tar"], check=True)
    sh(cw, "tar -C /var/www/html -xf /tmp/ext-sync.tar && rm /tmp/ext-sync.tar")
    return True

def manifest_version(typ, element, folder):
    d = ext_dir(typ, element, folder)
    d = d[0] if isinstance(d, tuple) else d
    xml = f"/var/www/html/{d}/{element.replace('com_', '') if typ == 'component' else element}.xml"
    v = sh(cw, f"grep -o '<version>[^<]*' {xml} 2>/dev/null | head -1 | cut -d'>' -f2")
    return v or None

def wanted(row):
    if only and row["element"] not in only: return False
    if row["element"] in skip: return False
    return True

acts = 0
for row in diff.get("disabled", []):
    if not wanted(row): continue
    folder = row.get("folder")
    cond = f"type={q1(row['type'])} AND element={q1(row['element'])}" + (f" AND folder={q1(folder)}" if folder else "")
    print(f"enable  {row['type']}:{row['element']}")
    sql(f"UPDATE {P}extensions SET enabled=1 WHERE {cond}")
    acts += 1

for col in ("missing", "version_older"):
    for row in diff.get(col, []):
        if not wanted(row): continue
        d = ext_dir(row["type"], row["element"], row.get("folder"))
        if not d:
            print(f"skip    {row['type']}:{row['element']} (no filesystem rule)"); continue
        print(f"{'install' if col == 'missing' else 'upgrade'} {row['type']}:{row['element']} from demo files")
        if not copy_dirs(d):
            print(f"  ! demo has no files for {row['element']} — flagged, not invented"); continue
        ver = manifest_version(row["type"], row["element"], row.get("folder"))
        folder = row.get("folder")
        cond = f"type={q1(row['type'])} AND element={q1(row['element'])}" + (f" AND folder={q1(folder)}" if folder else "")
        if sql(f"SELECT extension_id FROM {P}extensions WHERE {cond} LIMIT 1", mutate=False):
            if ver:
                sql(f"UPDATE {P}extensions SET enabled=1, manifest_cache=JSON_SET(manifest_cache, '$.version', {q1(ver)}) WHERE {cond}")
        else:
            # No row: let discover find the files we just copied.
            print(sh(cw, "php /var/www/html/cli/joomla.php extension:discover 2>&1 | tail -1"))
            print(f"  -> run `extension:discover:install` for {row['element']} once its eid is known (installer quirk, trap 21)")
        acts += 1

print(f"sync-extensions: {acts} actions" + (" (DRY RUN)" if dry else ""))
PYEOF

if [ "$INDEX" = 1 ] && [ "$DRY" = 0 ]; then
  # nice'd and detached: a full finder index flattened the 1GB droplet once.
  docker exec -d "$CW" sh -c "nice -n 19 php /var/www/html/cli/joomla.php finder:index > /tmp/finder-index.log 2>&1"
  echo "finder:index scheduled (nice -19, background, log /tmp/finder-index.log in container)"
fi
