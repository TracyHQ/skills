#!/usr/bin/env bash
#
# Will the customer's images survive the template's frames?
#
# A transplant moves articles into a demo whose blocks were designed around images of a certain
# shape. Teline V's `news-featured` crops to a fixed ratio; an article image that is too small
# renders soft, and one that is far off the ratio loses whatever sat at its edges — a face, a
# logo, the thing the photo was of. Neither shows up as an error. The site just looks worse than
# the demo it was supposed to look like.
#
#   image-fit.sh --site <label> --demo <label> [--crop]
#
# Measured, not assumed: the target shape is read from the images the demo actually ships, so it
# stays true when JoomlArt changes a block. No CLI image tools exist in these containers, so the
# measuring runs as PHP inside them (GD and Imagick are both present).
#
# `--crop` writes centred crops to `images/_transplant/` and never touches an original. The
# customer's media is theirs; a copy is reversible, an overwrite is not.

set -euo pipefail

SITE=""; DEMO=""; CROP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --site) SITE="$2"; shift 2 ;;
    --demo) DEMO="$2"; shift 2 ;;
    --crop) CROP=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$SITE" ] && [ -n "$DEMO" ] || { echo "need --site <label> --demo <label>" >&2; exit 2; }

# One PHP program, run in whichever container is being measured. Reads every article's image
# fields straight from the database, resolves them to files, and prints one row per image.
read -r -d '' MEASURE <<'PHP' || true
// Article images live in a JSON column, two keys, either of which may be empty or carry a
// "#joomlaImage://..." suffix that is metadata rather than part of the path.
$root = '/var/www/html/';
require_once $root . 'configuration.php';
$cfg = new JConfig();
$db = new mysqli($cfg->host, $cfg->user, $cfg->password, $cfg->db);
if ($db->connect_errno) { fwrite(STDERR, "db: {$db->connect_error}\n"); exit(1); }
$p = $cfg->dbprefix;

$rows = $db->query("SELECT images FROM {$p}content WHERE state = 1");
$seen = [];
while ($r = $rows->fetch_assoc()) {
    $j = json_decode((string) $r['images'], true);
    if (!is_array($j)) continue;
    foreach (['image_intro', 'image_fulltext'] as $key) {
        $path = trim((string) ($j[$key] ?? ''));
        if ($path === '') continue;
        $path = explode('#', $path)[0];            // drop the joomlaImage metadata
        $path = ltrim($path, '/');
        if (isset($seen[$path])) continue;
        $seen[$path] = true;
        $full = $root . $path;
        if (!is_file($full)) { echo "MISSING\t0\t0\t0\t{$path}\n"; continue; }
        $size = @getimagesize($full);
        if ($size === false) { echo "UNREADABLE\t0\t0\t0\t{$path}\n"; continue; }
        [$w, $h] = $size;
        $ratio = $h > 0 ? round($w / $h, 3) : 0;
        echo "OK\t{$w}\t{$h}\t{$ratio}\t{$path}\n";
    }
}
PHP

measure() { docker exec "${1}-web-1" php -r "$MEASURE" 2>/dev/null; }

echo "════ IMAGE MEASUREMENTS"
echo
demo_rows=$(measure "$DEMO")
site_rows=$(measure "$SITE")

summarise() {
  awk -F'\t' '$1=="OK" {n++; w+=$2; h+=$3; r[NR]=$4; if($2<minw||!minw)minw=$2}
    END {
      if (!n) { print "  (nothing could be measured)"; exit }
      printf "  %d images · mean width %d px · narrowest %d px\n", n, w/n, minw
    }'
}

# The target shape is whatever the demo's images cluster around — read, not decided here.
ratio_mode() {
  awk -F'\t' '$1=="OK" {printf "%.1f\n", $4}' | sort | uniq -c | sort -rn | head -3 \
    | awk '{printf "    ratio %s — %d images\n", $2, $1}'
}

echo "  DEMO ($DEMO)"
printf '%s\n' "$demo_rows" | summarise
printf '%s\n' "$demo_rows" | ratio_mode
TARGET=$(printf '%s\n' "$demo_rows" | awk -F'\t' '$1=="OK" {printf "%.1f\n", $4}' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
MINW=$(printf '%s\n' "$demo_rows" | awk -F'\t' '$1=="OK" && ($2<m || m=="") {m=$2} END {print m+0}')
echo
echo "  CLIENT ($SITE)"
printf '%s\n' "$site_rows" | summarise
printf '%s\n' "$site_rows" | ratio_mode

echo
echo "════ IMAGES THAT WILL NOT FIT"
echo
echo "  Taken from the demo: ratio ${TARGET:-?}, narrowest width ${MINW:-?} px."
echo "  A ratio off by more than 25% means losing a real part of the other dimension."
echo
printf '%s\n' "$site_rows" | TARGET="${TARGET:-1.5}" MINW="${MINW:-0}" awk -F'\t' '
  BEGIN { target = ENVIRON["TARGET"] + 0; minw = ENVIRON["MINW"] + 0; bad = 0 }
  $1 != "OK" { printf "  ✗ %-58s %s\n", substr($5,1,58), tolower($1); bad++; next }
  {
    why = ""
    if (minw > 0 && $2 < minw) why = "narrower than the demo\x27s narrowest (" $2 "px)"
    d = (target > 0) ? ($4 - target) / target : 0
    if (d < 0) d = -d
    if (d > 0.25) why = why (why ? " · " : "") sprintf("ratio %.2f, off by %.0f%%", $4, d * 100)
    if (why != "") { printf "  ✗ %-58s %s\n", substr($5,1,58), why; bad++ }
  }
  END { if (!bad) print "  (no image is outside the threshold)"; else printf "\n  %d images to look at\n", bad }'

if [ "$CROP" = 1 ]; then
  echo
  echo "════ CẮT VỀ TỈ LỆ ${TARGET:-?}"
  echo "  Crops are written to images/_transplant/ — the originals are never touched."
  docker exec "${SITE}-web-1" php -r '
    $root = "/var/www/html/";
    $target = (float) ($argv[1] ?? 1.5);
    $out = $root . "images/_transplant/";
    if (!is_dir($out)) mkdir($out, 0755, true);
    $done = 0;
    foreach (explode("\n", trim(stream_get_contents(STDIN))) as $line) {
        $c = explode("\t", $line);
        if (count($c) < 5 || $c[0] !== "OK") continue;
        [$ok, $w, $h, $r, $path] = $c;
        $src = $root . $path;
        $im = @imagecreatefromstring(@file_get_contents($src));
        if (!$im) continue;
        // Centred crop: without knowing what the photo is of, the middle is the least bad guess,
        // and it is what the CSS would have done anyway — this just does it once, losslessly.
        $w = imagesx($im); $h = imagesy($im);
        if ($w / $h > $target) { $nw = (int) round($h * $target); $nh = $h; }
        else                   { $nw = $w; $nh = (int) round($w / $target); }
        $dst = imagecrop($im, ["x" => (int)(($w-$nw)/2), "y" => (int)(($h-$nh)/2), "width" => $nw, "height" => $nh]);
        if (!$dst) continue;
        $name = $out . str_replace("/", "_", $path);
        imagejpeg($dst, preg_replace("/\.(png|gif|webp)$/i", ".jpg", $name), 88);
        $done++;
    }
    echo "  cropped $done images\n";
  ' "${TARGET:-1.5}" <<< "$site_rows"
fi
