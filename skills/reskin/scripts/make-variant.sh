#!/usr/bin/env bash
# make-variant.sh — give a proposal its own database, so two skins of one site can be
# looked at side by side instead of one overwriting the other (ADR 0040).
#
# A variant is a schema named `<base>_<slug>` beside the site's own, reached by the
# `X-Tracy-Variant` header the edge Worker sets from the hostname. Files are shared:
# a template lives on disk once, and it is the DATABASE that decides which one is worn.
#
# Cheap on purpose. A live Joomla site is mostly SEO cache, redirect logs and form
# submissions — on the site this was written for, 697 MB of 748 MB. None of it belongs
# to a proposal: the cache rebuilds itself, the logs are the site's own history, and the
# submissions are other people's personal data that has no business being copied around.
# Their STRUCTURE is copied so the site still boots; their rows are not.
#
# Usage:
#   make-variant.sh --db <ctr> --slug stratum [--base joomla] [--replace] [--dry-run]
set -euo pipefail

DB="" SLUG="" BASE="joomla" REPLACE=0 DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --slug) SLUG="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --replace) REPLACE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DB" ] && [ -n "$SLUG" ] || {
  echo "usage: make-variant.sh --db <ctr> --slug <name> [--base joomla] [--replace]" >&2
  exit 2
}
# The slug reaches a schema name and an HTTP header; keep it to what both accept.
echo "$SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]{0,30}$' || {
  echo "refused: slug must be lowercase letters, digits and dashes: $SLUG" >&2
  exit 2
}

# Underscores in the schema, dashes in the hostname — the same swap configuration.php makes.
TARGET="${BASE}_$(echo "$SLUG" | tr '-' '_')"

# Cache, logs and other people's data. Structure yes, rows no.
SKIP="sh404sef_pageids sh404sef_urls sh404sef_urls_pageid rsform_submissions rsform_submission_values \
redirect_links jalog session core_log_searches forsef_urls cmc_users user_keys action_logs \
finder_links finder_links_terms finder_terms finder_tokens finder_tokens_aggregate"

echo "base=$BASE target=$TARGET container=$DB"
[ "$DRY" = 1 ] && { echo "(dry run) would skip rows of: $SKIP"; exit 0; }

docker exec -i "$DB" sh -c '
set -e
BASE="'"$BASE"'"; TARGET="'"$TARGET"'"; REPLACE="'"$REPLACE"'"; SKIP="'"$SKIP"'"
M="mariadb -uroot -p$MARIADB_ROOT_PASSWORD"
DUMP="mariadb-dump -uroot -p$MARIADB_ROOT_PASSWORD --single-transaction --quick --no-tablespaces"

exists=$($M -N -e "select count(*) from information_schema.schemata where schema_name=\"$TARGET\"")
if [ "$exists" != "0" ]; then
  if [ "$REPLACE" != "1" ]; then
    echo "refused: $TARGET already exists (pass --replace to rebuild it)" >&2
    exit 3
  fi
  $M -e "drop database \`$TARGET\`"
fi
$M -e "create database \`$TARGET\` character set utf8mb4 collate utf8mb4_unicode_ci"

# The prefix is whatever the base uses; discover it rather than assume ja_.
# Shortest match wins: `%_extensions` also matches `ja_update_sites_extensions`, and the
# underscore is a LIKE wildcard, so the obvious query picks the wrong table.
PREFIX=$($M -N -e "select table_name from information_schema.tables where table_schema=\"$BASE\" and table_name like \"%extensions\" order by length(table_name) limit 1" | sed "s/extensions$//")
[ -n "$PREFIX" ] || { echo "could not find the table prefix in $BASE" >&2; exit 4; }

IGNORE=""; HEAVY=""
for t in $SKIP; do
  full="$PREFIX$t"
  have=$($M -N -e "select count(*) from information_schema.tables where table_schema=\"$BASE\" and table_name=\"$full\"")
  [ "$have" = "1" ] || continue
  IGNORE="$IGNORE --ignore-table=$BASE.$full"
  HEAVY="$HEAVY $full"
done

$DUMP $IGNORE "$BASE" | $M "$TARGET"
[ -n "$HEAVY" ] && $DUMP --no-data "$BASE" $HEAVY | $M "$TARGET"

MB=$($M -N -e "select round(sum(data_length+index_length)/1048576) from information_schema.tables where table_schema=\"$TARGET\"")
BASEMB=$($M -N -e "select round(sum(data_length+index_length)/1048576) from information_schema.tables where table_schema=\"$BASE\"")
N=$($M -N -e "select count(*) from information_schema.tables where table_schema=\"$TARGET\"")
echo "make-variant: $TARGET ready — $N tables, ${MB}MB (base ${BASEMB}MB); emptied:$HEAVY"
'
