#!/usr/bin/env bash
#
# Put the client's content on. Writes to the DEMO copy only.
#
#   apply-map.sh --demo <label> --client <label> --map out/artifact-map.json [--dry-run]
#
# ## The shape of the write
#
# Nothing belonging to the demo is edited or deleted. For each mapped slot this creates a NEW
# category in the demo, copies the client's articles into it, and re-points the demo's existing
# module at it. The demo's own categories and articles stay exactly where they were — they simply
# stop being what the front page reads.
#
# That is what makes `take-off.sh` cheap: everything this run created lives above one ID offset,
# and the only demo rows it modified are module params, whose originals are snapshotted first.
#
# ## The offset
#
# 900000. `reskin` owns its own range; two skills writing on one host must not erase each other,
# so this number is not to be shared or reused.

set -euo pipefail

OFFSET=900000
# How many articles per created category get marked featured. See the frontpage insert below.
FEATURED_PER_CATEGORY=4
DEMO=""; CLIENT=""; MAP=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --demo) DEMO="$2"; shift 2 ;;
    --client) CLIENT="$2"; shift 2 ;;
    --map) MAP="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DEMO" ] && [ -n "$CLIENT" ] && [ -n "$MAP" ] || {
  echo "need --demo <label> --client <label> --map <artifact-map.json>" >&2; exit 2; }
[ -f "$MAP" ] || { echo "no map at $MAP" >&2; exit 1; }

conn() {  # label → "pass|prefix|db"
  local root="/srv/tracy/$1/webroot"
  printf '%s|%s|%s' \
    "$(grep -m1 '^DB_PASSWORD=' "/srv/tracy/$1/.env" | cut -d= -f2-)" \
    "$(grep -m1 'dbprefix' "$root/configuration.php" | sed "s/.*= *'\([^']*\)'.*/\1/")" \
    "$(grep -m1 'public \$db ' "$root/configuration.php" | sed "s/.*= *'\([^']*\)'.*/\1/")"
}
IFS='|' read -r DPASS DPREFIX DDB <<< "$(conn "$DEMO")"
IFS='|' read -r CPASS CPREFIX CDB <<< "$(conn "$CLIENT")"

dq() { docker exec "${DEMO}-db-1"   mariadb -uroot -p"$DPASS" -N -B -r "$DDB" -e "$1" 2>/dev/null; }
cq() { docker exec "${CLIENT}-db-1" mariadb -uroot -p"$CPASS" -N -B -r "$CDB" -e "$1" 2>/dev/null; }

# ── The gate. references/artifact-map.md lists these; they are enforced here because this is the
# last place a bad map is still cheap.
python3 - "$MAP" <<'PY' || exit 1
import json, sys
m = json.load(open(sys.argv[1]))
problems = []
if not m.get("language"):
    problems.append("no `language` — one per run")
for row in m.get("slots", []):
    where = row.get("position", "?")
    if not (row.get("why") or "").strip():
        problems.append(f"{where}: empty `why` — a row nobody could explain is a row nobody checked")
    fill, src, gen = row.get("fill"), row.get("source"), row.get("generate", 0)
    if fill in ("client", "mixed") and not src:
        problems.append(f"{where}: fill={fill} but no source")
    if fill == "client" and src and src.get("articles", 0) < row.get("wants", 0):
        problems.append(f"{where}: fill=client but category has {src['articles']} for {row['wants']}")
    if fill == "mixed" and src and gen != row.get("wants", 0) - src.get("articles", 0):
        problems.append(f"{where}: generate={gen} does not close the gap")
    if fill in ("client", "empty") and gen:
        problems.append(f"{where}: fill={fill} must not generate")
if problems:
    print("map rejected:", file=sys.stderr)
    for p in problems:
        print("  ✗", p, file=sys.stderr)
    sys.exit(1)
print(f"map ok — {len(m.get('slots', []))} slots, language {m['language']}")
PY

LANG=$(python3 -c "import base64,json,sys; print(json.load(open(sys.argv[1]))['language'])" "$MAP")

# ── Snapshot before touching anything. `take-off.sh` restores module params from this file; if it
# is not written, the run is not reversible and must not proceed.
SNAP="/srv/tracy/$DEMO/try-on-snapshot.json"
if [ "$DRY" = 0 ]; then
  dq "select concat(id,'|',replace(replace(to_base64(params),'\n',''),'\r','')) from ${DPREFIX}modules
       where published=1 and client_id=0 and position <> '';" \
    | python3 -c '
import base64, json, sys
rows = {}
for line in sys.stdin:
    line = line.strip()
    if not line or "|" not in line: continue
    mid, b64 = line.split("|", 1)
    try: rows[mid] = base64.b64decode(b64).decode("utf-8")
    except Exception: pass
print(json.dumps({"modules": rows}, ensure_ascii=False))' > "$SNAP"
  [ -s "$SNAP" ] || { echo "empty snapshot — stopping, this run could not be undone" >&2; exit 1; }
  echo "  snapshot: $SNAP ($(wc -c < "$SNAP") bytes)"
fi

echo
# 🔒 Not `${DRY:+ (dry-run)}`: that expands whenever DRY is non-empty, and DRY is "0" on a real
# run — so the header announced a dry run while the script was writing.
DRY_LABEL=""; [ "$DRY" = 1 ] && DRY_LABEL=" (dry-run)"
echo "════ APPLY MAP${DRY_LABEL}"
echo

cat_id=$((OFFSET + 100))
art_id=$((OFFSET + 1000))

# The bridge to generate-fill. 🔒 Without it that script attaches its articles to `source.id`,
# which is a category id in the CLIENT database — on the demo those ids belong to JoomlArt's own
# categories, so 74 generated articles land in the demo's content while the three categories this
# script created stay empty and the blocks render nothing. Nothing downstream notices.
CATMAP="/srv/tracy/$DEMO/try-on-categories.tsv"
[ "$DRY" = 1 ] || : > "$CATMAP"

python3 -c "
import base64, json, sys
m = json.load(open('$MAP'))
for r in m['slots']:
    if r['fill'] in ('client', 'mixed') and r.get('source'):
        # Title travels base64'd. The trick this replaces swapped spaces for NBSP and swapped
        # back with tr, which works a byte at a time and mangles every 2-byte character it
        # meets — the fixture's category names arrived with doubled spaces.
        print(r['position'], r['source']['id'],
              base64.b64encode(r['source']['title'].encode()).decode(),
              r['wants'], r['source'].get('articles', 0), sep='\t')
" | while IFS=$'\t' read -r position src_id src_title wants expected; do
  title=$(printf '%s' "$src_title" | base64 -d)
  echo "  ── $position ← $title"

  # Articles the client actually has for this category, in the run's language (or `*`, which
  # means "shows in every language" rather than a language of its own).
  ids=$(cq "select id from ${CPREFIX}content
             where state=1 and catid=$src_id and (language='$LANG' or language='*')
             order by created desc limit $wants;" | tr '\n' ' ')
  n=$(echo "$ids" | wc -w | tr -d ' ')
  echo "     $n articles selected (map counted ${expected:-?})"

  # 🔒 A slot that promised articles and selects none is the failure this whole step exists to
  # avoid: it produces an empty block that no later check attributes to the mapping. It happened
  # on the first fixture — a category flagged en-GB holding four fr-FR articles — and nothing in
  # the run said so. Stop instead, and name the two numbers that disagree.
  if [ "${expected:-0}" -gt 0 ] && [ "$n" = "0" ]; then
    echo "     ✗ map counted ${expected} but category $src_id holds no $LANG articles" >&2
    echo "       re-run inventory-client.sh then propose-map.mjs — the old count read the category" >&2
    echo "       label rather than the language of the articles." >&2
    exit 1
  fi

  if [ "$DRY" = 1 ]; then
    echo "     (dry-run: would create category $cat_id, copy $n articles from id $art_id, retarget $position)"
    cat_id=$((cat_id + 1)); art_id=$((art_id + 100)); continue
  fi

  # A new category in the demo, above the offset. The demo's own categories are left untouched.
  dq "insert into ${DPREFIX}categories
        (id, asset_id, parent_id, lft, rgt, level, path, extension, title, alias, published, access, params, language, note)
      values
        ($cat_id, 0, 1, 0, 0, 1, 'try-on-$cat_id', 'com_content', '$(printf '%s' "$title" | sed "s/'/''/g")',
         'try-on-$cat_id', 1, 1, '{}', '*', 'try-on:mapped');" || true

  printf '%s\t%s\n' "$position" "$cat_id" >> "$CATMAP"

  featured=0
  for aid in $ids; do
    # Copied field by field rather than with SELECT INTO: the two databases are separate servers,
    # and the copy has to land above the offset with a new category anyway.
    row=$(cq "select concat(replace(replace(to_base64(title),'\n',''),'\r',''),'|',
                             replace(replace(to_base64(introtext),'\n',''),'\r',''),'|',
                             replace(replace(to_base64(coalesce(images,'{}')),'\n',''),'\r',''),'|',
                             coalesce(created,now()))
                from ${CPREFIX}content where id=$aid;")
    [ -n "$row" ] || continue
    b_title="${row%%|*}"; rest="${row#*|}"
    b_intro="${rest%%|*}"; rest="${rest#*|}"
    b_images="${rest%%|*}"; created="${rest#*|}"
    dq "insert into ${DPREFIX}content
          (id, asset_id, title, alias, introtext, \`fulltext\`, state, catid, created, created_by,
           access, images, urls, attribs, version, metakey, metadesc, metadata, language, note)
        values
          ($art_id, 0, from_base64('$b_title'), 'try-on-$art_id', from_base64('$b_intro'), '',
           1, $cat_id, '$created', 0, 1, from_base64('$b_images'), '{}', '{}', 1, '', '', '{}', '*',
           'try-on:mapped');" || {
      # 🔒 This was `|| true`, and it hid a syntax error that inserted nothing at all: apply-map
      # printed "→ category 900100" for three slots while copying zero articles, and only
      # verify-try-on caught it, one step later, as "3 categories created and empty". A write that
      # fails has to say so where it fails.
      echo "     ✗ could not copy article $aid — stopping" >&2; exit 1; }
    # 🔒 Some blocks are configured `show_front: only` — they render featured articles and nothing
    # else. A try-on that fills a category and marks nothing featured leaves those blocks empty
    # while every count says the content arrived. The demo runs 101 featured out of 442, so a few
    # per category matches how it was built rather than flooding the front page.
    if [ "$featured" -lt "$FEATURED_PER_CATEGORY" ]; then
      dq "insert into ${DPREFIX}content_frontpage (content_id, ordering, featured_up, featured_down)
            values ($art_id, 0, null, null);" || true
      featured=$((featured + 1))
    fi
    art_id=$((art_id + 1))
  done

  # Re-point every content module at this position to the new category. Params are copied and
  # only the category reference changes — the block keeps the configuration JoomlArt tuned.
  for mid in $(dq "select id from ${DPREFIX}modules where published=1 and client_id=0 and position='$position';"); do
    cur=$(dq "select replace(replace(to_base64(params),'\n',''),'\r','') from ${DPREFIX}modules where id=$mid;")
    new=$(printf '%s' "$cur" | CATID="$cat_id" python3 -c '
import base64, json, os, re, sys
catid = os.environ["CATID"]
KEY = re.compile(r"catid|categor", re.I)
def retarget(v):
    if isinstance(v, list): return [retarget(x) for x in v]
    if isinstance(v, dict):
        return {k: ([catid] if isinstance(v[k], list) else catid) if KEY.search(k) else retarget(v[k]) for k in v}
    if isinstance(v, str) and v.strip().startswith("{"):
        try: return json.dumps(retarget(json.loads(v)))
        except Exception: return v
    return v
raw = sys.stdin.read().strip()
try: params = json.loads(base64.b64decode(raw).decode("utf-8"))
except Exception: sys.exit(1)
print(base64.b64encode(json.dumps(retarget(params)).encode("utf-8")).decode("ascii"))')
    [ -n "$new" ] && dq "update ${DPREFIX}modules set params=from_base64('$new') where id=$mid;" || true
  done
  echo "     → category $cat_id, modules at $position retargeted"
  cat_id=$((cat_id + 1))
done

if [ "$DRY" = 0 ]; then
  echo
  echo "  clearing cache so the page re-renders:"
  docker exec "${DEMO}-web-1" sh -c 'rm -rf /var/www/html/cache/* /var/www/html/administrator/cache/*' 2>/dev/null || true
  # Printed, not only written. 🔒 When this runs through the `tracy-demo-try-on` tools the caller
  # is on another machine and cannot read the file — and without this bridge the next step
  # attaches its articles to client category ids. See spec §9.
  echo
  echo "  position → category id (generate-fill.mjs --categories needs this):"
  sed 's/^/    /' "$CATMAP" 2>/dev/null || true
  echo
  echo "  done. Review with verify-try-on.sh, remove with take-off.sh"
fi
