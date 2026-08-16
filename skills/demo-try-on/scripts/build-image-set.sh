#!/usr/bin/env bash
#
# The image set a try-on renders from: the client's own photos, resized, plus a brief for the
# ones that have to be invented.
#
#   build-image-set.sh --client <label> --demo <label> --map out/artifact-map.json [--apply]
#
# ## Two kinds of image, two different jobs
#
# **The client's** are copied and cropped to the demo's ratio. They are real photographs of a real
# business and they are the most valuable thing in a try-on — every block they can fill is a block
# that needs nothing invented.
#
# **The generated ones** have to match the article they sit beside, so they cannot be made until
# `generate-fill` has written that article. This script does not draw them; it emits the brief —
# subject, ratio, count — for whoever does.
#
# ## Why a pool and not one image per article
#
# 🔒 The fixture's demo consumes 208 articles; the client has 28 and 9 distinct images. One image
# per generated article would mean inventing ~180 pictures for a page nobody scrolls to the bottom
# of. The demo itself does not work that way — 324 images across several hundred articles.
#
# So the brief asks for a bounded pool per category and the assignment cycles through it. Repeats
# are visible only to someone comparing two blocks side by side, and that is a far smaller cost
# than 180 generations.

set -euo pipefail

POOL_PER_CATEGORY=8

CLIENT=""; DEMO=""; MAP=""; APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --client) CLIENT="$2"; shift 2 ;;
    --demo) DEMO="$2"; shift 2 ;;
    --map) MAP="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$CLIENT" ] && [ -n "$DEMO" ] && [ -n "$MAP" ] || {
  echo "need --client <label> --demo <label> --map <artifact-map.json>" >&2; exit 2; }

CROOT="/srv/tracy/$CLIENT/webroot"
DROOT="/srv/tracy/$DEMO/webroot"
[ -d "$CROOT" ] && [ -d "$DROOT" ] || { echo "missing a working copy" >&2; exit 1; }

# The target ratio is read from the demo's own images, never hard-coded: JoomlArt changes blocks,
# and a fixed number goes stale silently. Same measurement `image-fit.sh` reports.
read -r -d '' MEASURE <<'PHP' || true
$root = '/var/www/html/';
require_once $root . 'configuration.php';
$cfg = new JConfig();
$db = new mysqli($cfg->host, $cfg->user, $cfg->password, $cfg->db);
if ($db->connect_errno) exit(1);
$p = $cfg->dbprefix;
$rows = $db->query("SELECT images FROM {$p}content WHERE state = 1");
$seen = [];
while ($r = $rows->fetch_assoc()) {
    $j = json_decode((string) $r['images'], true);
    if (!is_array($j)) continue;
    foreach (['image_intro', 'image_fulltext'] as $k) {
        $path = ltrim(explode('#', trim((string) ($j[$k] ?? '')))[0], '/');
        if ($path === '' || isset($seen[$path])) continue;
        $seen[$path] = true;
        $full = $root . $path;
        if (!is_file($full)) continue;
        $s = @getimagesize($full);
        if ($s === false) continue;
        printf("%d\t%d\t%.3f\t%s\n", $s[0], $s[1], $s[1] ? $s[0] / $s[1] : 0, $path);
    }
}
PHP

demo_imgs=$(docker exec "${DEMO}-web-1" php -r "$MEASURE" 2>/dev/null)
client_imgs=$(docker exec "${CLIENT}-web-1" php -r "$MEASURE" 2>/dev/null)

TARGET=$(printf '%s\n' "$demo_imgs" | awk -F'\t' '{printf "%.1f\n", $3}' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
WIDTH=$(printf '%s\n' "$demo_imgs" | awk -F'\t' 'BEGIN{m=0} {if ($1>m) m=$1} END{print (m>1200?1200:m)}')
HAVE=$(printf '%s\n' "$client_imgs" | grep -c . || echo 0)

echo "════ IMAGE SET — $CLIENT → $DEMO"
echo
echo "  target ratio:  ${TARGET:-1.5}  (measured from ${DEMO})"
echo "  width:     ${WIDTH:-1000} px"
echo "  client images:   $HAVE distinct files"
echo

# ── Part 1: the client's real photos. Independent of the writing step — runs right after inventory.
echo "── PART 1 · real photos, cropping only"
if [ "$APPLY" = 1 ]; then
  # Crops are written into the DEMO copy, under their own directory: the client's media is never
  # modified, and a whole directory is what `take-off.sh` removes in one step.
  # Paths come from the database and can contain spaces, so they travel as a null-delimited list
  # rather than as words on a command line.
  printf '%s\n' "$client_imgs" | awk -F'\t' '{print $4}' \
    | docker exec -i "${CLIENT}-web-1" tar -C /var/www/html -cf - -T - 2>/dev/null \
    | docker exec -i "${DEMO}-web-1" tar -C /tmp -xf - 2>/dev/null || true

  # 🔒 `-i` or the PHP reads an empty STDIN and crops nothing, reporting "0 images" with no error:
  # the tar above needs it too, and only that one had it.
  docker exec -i "${DEMO}-web-1" php -r '
    $target = (float) $argv[1]; $width = (int) $argv[2];
    $out = "/var/www/html/images/_try-on/"; @mkdir($out, 0755, true);
    $done = 0;
    foreach (explode("\n", trim(stream_get_contents(STDIN))) as $line) {
        $c = explode("\t", $line);
        if (count($c) < 4) continue;
        $src = "/tmp/" . $c[3];
        $im = @imagecreatefromstring(@file_get_contents($src));
        if (!$im) continue;
        $w = imagesx($im); $h = imagesy($im);
        // Centred crop then a single downscale. Without knowing what the photo is of, the middle
        // is the least bad guess — and it is what the CSS would have done anyway, just once and
        // without asking the browser to do it on every page load.
        if ($w / $h > $target) { $nw = (int) round($h * $target); $nh = $h; }
        else                   { $nw = $w; $nh = (int) round($w / $target); }
        $cr = imagecrop($im, ["x" => (int)(($w-$nw)/2), "y" => (int)(($h-$nh)/2), "width" => $nw, "height" => $nh]);
        if (!$cr) continue;
        if (imagesx($cr) > $width) {
            $cr = imagescale($cr, $width, (int) round($width / $target));
        }
        imagejpeg($cr, $out . "client-" . substr(md5($c[3]), 0, 10) . ".jpg", 88);
        $done++;
    }
    fwrite(STDERR, "   cropped $done images into images/_try-on/\n");
  ' "${TARGET:-1.5}" "${WIDTH:-1000}" <<< "$client_imgs" 2>&1 | tail -2
else
  echo "   $HAVE images would be cropped to ${TARGET:-1.5} and placed in the demo (re-run with --apply)"
fi

# ── Part 2: the brief for images that must be generated. Nothing is drawn here — the article has
# to exist first, so this waits on generate-fill.
echo
echo "── PART 2 · brief for the images that must be made"
echo
python3 - "$MAP" "${TARGET:-1.5}" "${WIDTH:-1000}" "$POOL_PER_CATEGORY" "$HAVE" <<'PY'
import json, math, sys
mapping = json.load(open(sys.argv[1]))
target, width, pool_size, have = float(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])

briefs, total_needed = [], 0
for row in mapping.get("slots", []):
    gen = row.get("generate", 0)
    if not gen:
        continue
    total_needed += gen
    subject = (row.get("source") or {}).get("title") or row.get("position")
    briefs.append({
        "position": row["position"],
        "block": row.get("block"),
        "subject": subject,
        "articles_to_generate": gen,
        # A bounded pool, cycled. See the header for why this is not 1:1.
        "images_to_generate": min(gen, pool_size),
        "ratio": target,
        "width": width,
    })

print(f"  {total_needed} articles to generate · needs {sum(b['images_to_generate'] for b in briefs)} new images")
print(f"  (one image per article would be {total_needed} images — a pool of at most {pool_size} per category instead)")
print()
for b in briefs:
    print(f"  {b['position']:<16} {b['subject']:<28} {b['images_to_generate']:>2} images · {b['ratio']} · {b['width']}px")

print()
print("  Constraints (references/generation-rules.md §4):")
print("    NO faces · NO logos · NO text · NO real places · NO other brands")
print("    DO: abstract, textural, scenes from the client's own field")
print(f"    Write to images/_try-on/ · ratio {target} · width {width}px")
print()
print(json.dumps({"target_ratio": target, "width": width, "briefs": briefs}, ensure_ascii=False))
PY
