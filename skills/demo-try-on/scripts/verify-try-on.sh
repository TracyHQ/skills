#!/usr/bin/env bash
#
# Does it still look like the template?
#
#   verify-try-on.sh --demo <label> [--map out/artifact-map.json]
#
# The comparison is with the demo **as it shipped**, not with the client's old site. A try-on that
# ends up looking like the site they already have has failed at the only thing it was for.
#
# Four questions, in the order they go wrong:
#
#   1. Does the page still render? A broken try-on is not a verdict on the template.
#   2. Is any of the demo's own content still on it? That is the one outcome nobody accepts —
#      a page presented as the client's, showing JoomlArt's articles.
#   3. Is every mapped slot actually filled? An empty block reads as unfinished.
#   4. Do the generated rows carry their markers? See references/generation-rules.md §1.

set -euo pipefail

OFFSET=900000
VARIANT=""
DEMO=""; MAP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --demo) DEMO="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    # Optional: with the map, check 3 can name the slots that were promised and are still empty,
    # instead of only counting categories.
    --map) MAP="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DEMO" ] || { echo "need --demo <label>" >&2; exit 2; }

ROOT="/srv/tracy/$DEMO/webroot"
PASS=$(grep -m1 '^DB_PASSWORD=' "/srv/tracy/$DEMO/.env" | cut -d= -f2-)
PREFIX=$(grep -m1 'dbprefix' "$ROOT/configuration.php" | sed "s/.*= *'\([^']*\)'.*/\1/")
DBNAME=$(grep -m1 'public \$db ' "$ROOT/configuration.php" | sed "s/.*= *'\([^']*\)'.*/\1/")
# Schema của bản thử: gạch ngang trong hostname, gạch dưới trong tên schema — cùng phép đổi
# make-variant.sh làm. Không có --variant thì đây là database chính, đúng như trước.
[ -n "$VARIANT" ] && DBNAME="${DBNAME}_$(printf '%s' "$VARIANT" | tr '-' '_')"
PORT=$(grep -m1 '^HOST_PORT=' "/srv/tracy/$DEMO/.env" | cut -d= -f2- || echo "")
dq() { docker exec "${DEMO}-db-1" mariadb -uroot -p"$PASS" -N -B -r "$DBNAME" -e "$1" 2>/dev/null; }

fail=0
echo "════ TRY-ON CHECK — $DEMO"
echo

# ── 1. Render. Asked of the container directly, not through the public URL: Cloudflare Access
# sits in front of some demos and a login page is not a verdict on the try-on.
echo "── 1 · does the page render"
if [ -n "$PORT" ]; then
  # 🔒 Two traps, one line. The demo answers 301 because Joomla is set to force SSL, and following
  # that redirect leaves the container entirely: it lands on Cloudflare Access's own sign-in page,
  # a 33KB document that passes a size check and contains none of the demo's articles — so checks
  # 1 and 2 both silently graded the wrong page. `X-Forwarded-Proto` tells Joomla the hop it cares
  # about already happened, and the request stays inside the container. Never add `-L` here.
  # 🔒 Với `--variant`, cùng một URL phục vụ HAI trang: không header là bản demo gốc, có header là
  # bản thử. Kiểm mà quên header là chấm điểm bản demo — nó luôn đẹp, và bản thử hỏng thế nào cũng
  # không ai biết.
  code=$(curl -s -o /tmp/try-on-page.html -w '%{http_code}' --max-time 20 \
    -H "Host: ${DEMO}.tracy.ai" -H 'X-Forwarded-Proto: https' \
    ${VARIANT:+-H "X-Tracy-Variant: $VARIANT"} \
    "http://127.0.0.1:${PORT}/" || echo 000)
  bytes=$(wc -c < /tmp/try-on-page.html 2>/dev/null || echo 0)
  echo "   HTTP $code · $bytes bytes"
  # A Joomla fatal still answers 200 with a short body, so size is the real signal.
  # A Cloudflare sign-in page is ~33KB, so 5000 was never a real floor. The demo's own front page
  # is 320KB; anything under 50KB is not a rendered Teline V front page.
  if [ "$code" != "200" ] || [ "$bytes" -lt 50000 ]; then
    echo "   ✗ page did not render in full"; fail=$((fail+1))
  else
    echo "   ✓"
  fi
else
  echo "   (port unknown — skipped)"
fi

# ── 2. Demo content still visible. The check that matters most, and the cheapest to get wrong:
# a block whose module was never re-pointed keeps rendering JoomlArt's articles.
echo
echo "── 2 · any of the demo's own articles left"
if [ -s /tmp/try-on-page.html ]; then
  # Newest first, not random. 🔒 A random 40 out of several hundred articles almost never
  # includes what the front page is showing, so this check passed on a demo that had not been
  # dressed at all — a check that cannot fail is worse than no check.
  demo_titles=$(dq "select title from ${PREFIX}content
                     where state=1 and id < $OFFSET
                     order by created desc limit 200;")
  hits=0; sample=""
  while IFS= read -r t; do
    [ ${#t} -ge 12 ] || continue
    if grep -qF "$t" /tmp/try-on-page.html 2>/dev/null; then
      hits=$((hits+1)); [ -n "$sample" ] || sample="$t"
    fi
  done <<< "$demo_titles"
  if [ "$hits" -gt 0 ]; then
    echo "   ✗ $hits demo headlines still on the page — e.g. ${sample:0:60}"
    # Name the likely cause instead of leaving the reader to guess. A slot the mapper marked
    # `empty` was never touched, so the demo's own articles are still in it — expected at this
    # stage, and still a failure: a try-on shown to a client cannot carry JoomlArt's content.
    if [ -n "$MAP" ] && [ -f "$MAP" ]; then
      unmapped=$(python3 -c "
import json
m = json.load(open('$MAP'))
print(sum(1 for r in m['slots'] if r['fill'] == 'empty' and r.get('wants', 0) > 0))")
      [ "${unmapped:-0}" = "0" ] || echo "     ${unmapped} slots have no client source at all (fill=empty) — that is where they come from"
    fi
    echo "     apply-map.sh --dry-run lists every position it touches."
    fail=$((fail+1))
  else
    echo "   ✓ no demo headline found"
  fi
fi

# ── 3. Mapped slots actually carry something.
echo
echo "── 3 · do the mapped slots carry content"
mapped=$(dq "select count(*) from ${PREFIX}categories where id >= $OFFSET;")
copied=$(dq "select count(*) from ${PREFIX}content where id >= $OFFSET and note='try-on:mapped';")
echo "   $mapped categories created · $copied articles from the client"
if [ "${mapped:-0}" = "0" ]; then
  echo "   ✗ nothing applied — has apply-map.sh run?"; fail=$((fail+1))
else
  empty=$(dq "select count(*) from ${PREFIX}categories c
               where c.id >= $OFFSET
                 and not exists (select 1 from ${PREFIX}content a where a.catid = c.id and a.state = 1);")
  [ "${empty:-0}" = "0" ] && echo "   ✓ no created category is empty" || {
    echo "   ✗ ${empty} categories created with no articles in them"; fail=$((fail+1)); }

  if [ -n "$MAP" ] && [ -f "$MAP" ]; then
    promised=$(python3 -c "
import json,sys
m=json.load(open('$MAP'))
print(sum(1 for r in m['slots'] if r['fill'] in ('client','mixed','generated')))")
    echo "   the map promises $promised slots with content"
    if [ "${mapped:-0}" -lt "${promised:-0}" ]; then
      echo "   ✗ only ${mapped}/${promised} applied"; fail=$((fail+1))
    fi
  fi
fi

# ── 4. Markers. Generated rows must be findable forever; this is the last chance to notice they
# are not.
echo
echo "── 4 · is generated content marked"
gen=$(dq "select count(*) from ${PREFIX}content where id >= $OFFSET and note='try-on:generated';")
untagged=$(dq "select count(*) from ${PREFIX}content a
                where a.id >= $OFFSET and a.note='try-on:generated'
                  and not exists (select 1 from ${PREFIX}contentitem_tag_map m
                                   where m.content_item_id = a.id);")
echo "   $gen generated · $untagged untagged"
if [ "${untagged:-0}" != "0" ]; then
  echo "   ✗ generated rows that cannot be found again — see generation-rules.md §1"
  fail=$((fail+1))
else
  echo "   ✓"
fi

echo
if [ "$fail" = 0 ]; then
  echo "  ✓ the try-on holds up — look at it before deciding"
else
  echo "  ✗ $fail things to fix before showing this to a client" >&2
  exit 1
fi
