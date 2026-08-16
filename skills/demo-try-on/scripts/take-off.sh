#!/usr/bin/env bash
#
# Take the clothes off: put the demo back the way it was.
#
#   take-off.sh --demo <label> [--force]
#
# A fitting room where the clothes cannot come off is a shop that has sold you something. This
# has to stay cheap and it has to be complete, or nobody will risk running a try-on twice.
#
# Two halves, and both are needed:
#
#   1. Everything ABOVE the offset goes — categories, articles, generated images. `apply-map.sh`
#      never wrote anywhere else, so a delete by id range is exact rather than approximate.
#   2. Module params come back from the snapshot. This is the half a range delete cannot do: the
#      modules are the demo's own rows, and only their category references were changed.
#
# 🔒 If `try-on-snapshot.json` is missing, the run that wrote is unknown and this stops. Guessing
# a module's original category is how a demo ends up quietly pointing at nothing.

set -euo pipefail

OFFSET=900000
VARIANT=""
DEMO=""; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --demo) DEMO="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DEMO" ] || { echo "need --demo <label>" >&2; exit 2; }

ROOT="/srv/tracy/$DEMO/webroot"
# 🔒 Một file cho mỗi bản thử, không phải một file cho mỗi bản demo. Dùng chung đường dẫn thì
# lượt mặc lên MỘT schema ghi đè bản chụp của schema khác, và lượt cởi sau đó khôi phục nhầm
# params: bản demo gốc còn 8 module trỏ vào chuyên mục đã bị xoá, mọi block ấy rỗng, và trang
# tụt từ 320KB xuống 159KB mà không có lỗi nào ở đâu cả.
SNAP="/srv/tracy/$DEMO/try-on-snapshot${VARIANT:+-$VARIANT}.json"
[ -d "$ROOT" ] || { echo "no demo at $ROOT" >&2; exit 1; }

PASS=$(grep -m1 '^DB_PASSWORD=' "/srv/tracy/$DEMO/.env" | cut -d= -f2-)
PREFIX=$(grep -m1 'dbprefix' "$ROOT/configuration.php" | sed "s/.*= *'\([^']*\)'.*/\1/")
DBNAME=$(grep -m1 'public \$db ' "$ROOT/configuration.php" | sed "s/.*= *'\([^']*\)'.*/\1/")
# Schema của bản thử: gạch ngang trong hostname, gạch dưới trong tên schema — cùng phép đổi
# make-variant.sh làm. Không có --variant thì đây là database chính, đúng như trước.
[ -n "$VARIANT" ] && DBNAME="${DBNAME}_$(printf '%s' "$VARIANT" | tr '-' '_')"
dq() { docker exec "${DEMO}-db-1" mariadb -uroot -p"$PASS" -N -B -r "$DBNAME" -e "$1" 2>/dev/null; }

# Bản thử sống trong schema RIÊNG thì cởi ra là xoá cả schema — không snapshot, không dải id,
# không sót bảng phụ. Cả trap 10 biến mất cùng nó: những bảng hàng-treo-theo-bài không còn chỗ để
# sống sót.
#
# Chỉ làm khi có `--variant`. Không có nó nghĩa là bản thử nằm trong database chính của bản demo,
# và ở đó xoá theo id range là cách duy nhất không mang bản demo đi cùng.
if [ -n "$VARIANT" ]; then
  echo "════ TAKE OFF — $DEMO (variant $VARIANT)"
  echo
  arts=$(dq "select count(*) from ${PREFIX}content;")
  echo "  articles in the variant: ${arts:-0}"
  docker exec "${DEMO}-db-1" mariadb -uroot -p"$PASS" -e "drop database \`${DBNAME}\`;" 2>/dev/null || {
    echo "  ✗ could not drop ${DBNAME}" >&2; exit 1; }
  left=$(docker exec "${DEMO}-db-1" mariadb -uroot -p"$PASS" -N -B -e \
    "select count(*) from information_schema.schemata where schema_name='${DBNAME}';" 2>/dev/null)
  docker exec "${DEMO}-web-1" sh -c 'rm -rf /var/www/html/images/_try-on' 2>/dev/null || true
  docker exec "${DEMO}-web-1" sh -c 'rm -rf /var/www/html/cache/* /var/www/html/administrator/cache/*' 2>/dev/null || true
  [ "${left:-1}" = "0" ] && echo "  ✓ schema ${DBNAME} dropped" || {
    echo "  ✗ ${DBNAME} still there" >&2; exit 1; }
  exit 0
fi

arts=$(dq "select count(*) from ${PREFIX}content where id >= $OFFSET;")
cats=$(dq "select count(*) from ${PREFIX}categories where id >= $OFFSET;")

echo "════ TAKE OFF — $DEMO"
echo
echo "  articles above offset:   ${arts:-0}"
echo "  categories above offset: ${cats:-0}"

if [ ! -f "$SNAP" ]; then
  echo
  echo "  ✗ no $SNAP" >&2
  echo "    Which modules were changed is unknown, so their params cannot be restored." >&2
  [ "$FORCE" = 1 ] || {
    echo "    Use --force to delete above the offset anyway (modules will point at a category that is gone)." >&2
    exit 1; }
else
  echo "  snapshot:              $(wc -c < "$SNAP") bytes"
fi

# ── 1. Module params first. Deleting the categories before restoring leaves a window in which
# the page renders with modules pointing at a category that has just vanished.
if [ -f "$SNAP" ]; then
  restored=0
  while IFS=$'\t' read -r mid b64; do
    [ -n "$mid" ] || continue
    dq "update ${PREFIX}modules set params = from_base64('$b64') where id = $mid;" || true
    restored=$((restored + 1))
  done < <(python3 -c "
import base64, json, sys
snap = json.load(open('$SNAP'))
for mid, params in snap.get('modules', {}).items():
    print(mid, base64.b64encode(params.encode('utf-8')).decode('ascii'), sep='\t')
")
  echo "  modules restored:        $restored"
fi

# ── 2. Only then remove what was created.
# 🔒 Four tables, not two. The rows that hang off an article do not go away when the article does,
# and the ones that survive carry unique keys: a second try-on hits
# `Duplicate entry '1-950000-900001' for key 'uc_ItemnameTagid'` and mariadb stops there, leaving
# a half-dressed demo that every count reports as fine. Delete these BEFORE the articles, while
# the id range still describes them.
dq "delete from ${PREFIX}contentitem_tag_map where content_item_id >= $OFFSET;"
dq "delete from ${PREFIX}content_frontpage   where content_id      >= $OFFSET;"
dq "delete from ${PREFIX}tags                where id              >= $OFFSET;"
dq "delete from ${PREFIX}content    where id >= $OFFSET;"
dq "delete from ${PREFIX}categories where id >= $OFFSET;"

# Generated images live in their own directory, so removing them is a directory delete rather
# than a list of filenames nobody kept.
docker exec "${DEMO}-web-1" sh -c 'rm -rf /var/www/html/images/_try-on' 2>/dev/null || true
docker exec "${DEMO}-web-1" sh -c 'rm -rf /var/www/html/cache/* /var/www/html/administrator/cache/*' 2>/dev/null || true

left=$(dq "select (select count(*) from ${PREFIX}content where id >= $OFFSET)
                 + (select count(*) from ${PREFIX}categories where id >= $OFFSET)
                 + (select count(*) from ${PREFIX}contentitem_tag_map where content_item_id >= $OFFSET)
                 + (select count(*) from ${PREFIX}content_frontpage where content_id >= $OFFSET)
                 + (select count(*) from ${PREFIX}tags where id >= $OFFSET);")
echo
echo "  left above offset:       ${left:-0}  (articles + categories + tags + featured)"
[ "${left:-0}" = "0" ] && echo "  ✓ taken off cleanly" || echo "  ✗ ${left} rows remain — check by hand" >&2

mv "$SNAP" "$SNAP.done" 2>/dev/null || true
