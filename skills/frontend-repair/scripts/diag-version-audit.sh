#!/usr/bin/env bash
# diag-version-audit — Joomla version/compat audit for a working copy.
# Usage: diag-version-audit.sh --label <site-label>
# Read-only on the copy; zero network calls (D-41). DB and PHP facts are read
# from the site's own containers over local docker IPC, never over the network.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/result-envelope.sh"
source "$SCRIPT_DIR/json-helpers.sh"
source "$SCRIPT_DIR/joomla-copy-db.sh"

usage() {
  echo "Usage: diag-version-audit.sh --label <site-label>" >&2
}

# ---------- arg parsing ----------

LABEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --label)
      # A bare --label would otherwise die on an unbound $2, before any
      # envelope exists, breaking the one-JSON-document contract (ID-5).
      if [ $# -lt 2 ]; then
        usage
        exit 2
      fi
      LABEL="$2"
      shift 2
      ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$LABEL" ]]; then
  usage
  exit 2
fi

WEBROOT="/srv/tracy/$LABEL/webroot"
CONFIG="$WEBROOT/configuration.php"
DB_CONTAINER="${LABEL}-db-1"
WEB_CONTAINER="${LABEL}-web-1"

envelope_init "diag-version-audit" "$LABEL"

if [[ ! -d "$WEBROOT" ]]; then
  envelope_error "Webroot not found: /srv/tracy/$LABEL/webroot"
  envelope_emit
  exit 0
fi

if [[ ! -f "$CONFIG" ]]; then
  envelope_error "configuration.php not found in webroot"
  envelope_emit
  exit 0
fi

# ---------- DB access ----------

# cfg_val / db_bootstrap / db_query / db_rows come from joomla-copy-db.sh.
if ! db_bootstrap; then
  envelope_error "$DB_BOOTSTRAP_ERROR"
  envelope_emit
  exit 0
fi

# ---------- JSON helpers ----------

# _jstr / _jnum / _join_json_array come from json-helpers.sh. _jnum answers
# null for anything that is not a plain integer, which is what mariadb
# --batch printing SQL NULL as the literal "NULL" needs.
_jbool() { [[ "$1" == "1" ]] && printf 'true' || printf 'false'; }

# GNU date and BSD date disagree on epoch conversion; an unconvertible value
# yields an empty string, which callers turn into JSON null.
epoch_to_iso() {
  date -u -d "@$1" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
    || date -u -r "$1" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || true
}

# ---------- Joomla version ----------

JOOMLA_VERSION=""
MANIFEST="$WEBROOT/administrator/manifests/files/joomla.xml"
if [[ -f "$MANIFEST" ]]; then
  JOOMLA_VERSION=$(grep -oP '<version>\K[^<]+' "$MANIFEST" 2>/dev/null || true)
fi
if [[ -z "$JOOMLA_VERSION" ]]; then
  envelope_unavailable "joomlaVersion" "Manifest file missing or unreadable"
fi

# ---------- PHP version ----------

# The site's own web container is the only PHP runtime that matters here; the
# host CLI binary, if present at all, is a different environment.
PHP_VER=$(docker exec "$WEB_CONTAINER" php -r 'echo PHP_VERSION;' 2>/dev/null || true)
if [[ -z "$PHP_VER" ]]; then
  envelope_unavailable "phpVersion" "not measurable in site web container"
fi

# ---------- extensions inventory ----------

query_extensions() {
  local query="SELECT extension_id, name, type, element, folder, enabled, \
    CASE WHEN manifest_cache LIKE '%\"version\":\"%' \
      THEN SUBSTRING_INDEX(SUBSTRING_INDEX(manifest_cache, '\"version\":\"', -1), '\"', 1) \
      ELSE '' END \
    FROM ${DB_PREFIX}extensions ORDER BY type, name, extension_id"

  local rc=0 data
  data=$(db_query "$query") || rc=$?

  if (( rc != 0 )); then
    envelope_unavailable "extensions" "DB query failed (container not running or SQL error)"
    EXT_JSON="null"
    EXT_COUNT="null"
    return 0
  fi

  local items=() count=0

  if [[ -n "$data" ]]; then
    # Read over db_rows: a component's empty folder column would otherwise
    # collapse under tab-as-whitespace and shift every field after it.
    while IFS=$'\x1f' read -r eid name type element folder enabled version; do
      [[ -z "$eid" ]] && continue
      local item='{'
      item+="\"extensionId\":$(_jnum "$eid")"
      item+=",\"name\":$(_jstr "$name")"
      item+=",\"type\":$(_jstr "$type")"
      item+=",\"element\":$(_jstr "$element")"
      item+=",\"version\":$(_jstr "$version")"
      item+=",\"enabled\":$(_jbool "$enabled")"
      item+=",\"folder\":$(_jstr "$folder")"
      item+='}'
      items+=("$item")
      (( count++ )) || true
    done < <(db_rows "$data")
  fi

  EXT_JSON=$(_join_json_array "${items[@]+"${items[@]}"}")
  EXT_COUNT=$count
}

# ---------- template styles ----------

query_template_styles() {
  local query="SELECT id, template, client_id, home, title \
    FROM ${DB_PREFIX}template_styles ORDER BY client_id, template, id"

  local rc=0 data
  data=$(db_query "$query") || rc=$?

  if (( rc != 0 )); then
    envelope_unavailable "templateStyles" "DB query failed (container not running or SQL error)"
    STYLE_JSON="null"
    STYLE_COUNT="null"
    return 0
  fi

  local items=() count=0

  if [[ -n "$data" ]]; then
    # Read over db_rows: a style with no title would otherwise collapse under
    # tab-as-whitespace and shift every field after it.
    while IFS=$'\x1f' read -r sid template client_id home title; do
      [[ -z "$sid" ]] && continue
      local item='{'
      item+="\"id\":$(_jnum "$sid")"
      item+=",\"template\":$(_jstr "$template")"
      item+=",\"title\":$(_jstr "$title")"
      item+=",\"clientId\":$(_jnum "$client_id")"
      item+=",\"isDefault\":$(_jbool "$home")"
      item+='}'
      items+=("$item")
      (( count++ )) || true
    done < <(db_rows "$data")
  fi

  STYLE_JSON=$(_join_json_array "${items[@]+"${items[@]}"}")
  STYLE_COUNT=$count
}

# ---------- recorded updates ----------

query_recorded_updates() {
  local query="SELECT update_id, extension_id, name, element, type, version \
    FROM ${DB_PREFIX}updates ORDER BY name, update_id"

  local rc=0 data
  data=$(db_query "$query") || rc=$?

  if (( rc != 0 )); then
    envelope_unavailable "recordedUpdates" "DB query failed (container not running or SQL error)"
    UPD_JSON="null"
    UPD_COUNT="null"
    UPD_OK=0
    return 0
  fi
  UPD_OK=1

  local items=() count=0

  if [[ -n "$data" ]]; then
    # Read over db_rows: an update row with no element or version would
    # otherwise collapse under tab-as-whitespace and shift the fields after it.
    while IFS=$'\x1f' read -r uid ext_id name element type version; do
      [[ -z "$uid" ]] && continue
      local item='{'
      item+="\"updateId\":$(_jnum "$uid")"
      item+=",\"extensionId\":$(_jnum "$ext_id")"
      item+=",\"name\":$(_jstr "$name")"
      item+=",\"element\":$(_jstr "$element")"
      item+=",\"type\":$(_jstr "$type")"
      item+=",\"availableVersion\":$(_jstr "$version")"
      item+='}'
      items+=("$item")
      (( count++ )) || true
    done < <(db_rows "$data")
  fi

  UPD_JSON=$(_join_json_array "${items[@]+"${items[@]}"}")
  UPD_COUNT=$count
}

# ---------- update site freshness ----------

query_update_freshness() {
  local query="SELECT update_site_id, name, enabled, last_check_timestamp \
    FROM ${DB_PREFIX}update_sites ORDER BY update_site_id"

  local rc=0 data
  data=$(db_query "$query") || rc=$?

  if (( rc != 0 )); then
    envelope_unavailable "updateSiteFreshness" "DB query failed (container not running or SQL error)"
    FRESH_JSON="null"
    FRESH_LATEST="null"
    FRESH_OK=0
    return 0
  fi
  FRESH_OK=1

  local items=() latest_ts=0

  if [[ -n "$data" ]]; then
    # Read over db_rows: an update site with no name would otherwise collapse
    # under tab-as-whitespace and shift the fields after it.
    while IFS=$'\x1f' read -r usid name enabled last_check; do
      [[ -z "$usid" ]] && continue

      local ts_json="null"
      if [[ "$last_check" =~ ^[0-9]+$ && "$last_check" != "0" ]]; then
        local iso
        iso=$(epoch_to_iso "$last_check")
        [[ -n "$iso" ]] && ts_json="\"$iso\""
        if (( last_check > latest_ts )); then
          latest_ts="$last_check"
        fi
      fi

      local item='{'
      item+="\"updateSiteId\":$(_jnum "$usid")"
      item+=",\"name\":$(_jstr "$name")"
      item+=",\"enabled\":$(_jbool "$enabled")"
      item+=",\"lastChecked\":$ts_json"
      item+='}'
      items+=("$item")
    done < <(db_rows "$data")
  fi

  FRESH_JSON=$(_join_json_array "${items[@]+"${items[@]}"}")

  FRESH_LATEST="null"
  if (( latest_ts > 0 )); then
    local latest_iso
    latest_iso=$(epoch_to_iso "$latest_ts")
    [[ -n "$latest_iso" ]] && FRESH_LATEST="\"$latest_iso\""
  fi
}

# ---------- run queries ----------

query_extensions
query_template_styles
query_recorded_updates
query_update_freshness

# Both queries succeeded, no update rows and no refresh ever recorded: the copy
# has never checked for updates, which is not the same as "up to date".
if (( UPD_OK == 1 && FRESH_OK == 1 )) && [[ "$UPD_COUNT" == "0" && "$FRESH_LATEST" == "null" ]]; then
  envelope_unavailable "recordedUpdates" "no recorded update data and no update-site refresh timestamp — record never refreshed on this copy"
fi

# ---------- assemble findings ----------

FINDINGS='{'

if [[ -n "$JOOMLA_VERSION" ]]; then
  FINDINGS+="\"joomlaVersion\":$(_jstr "$JOOMLA_VERSION")"
else
  FINDINGS+="\"joomlaVersion\":null"
fi

if [[ -n "$PHP_VER" ]]; then
  FINDINGS+=",\"phpVersion\":$(_jstr "$PHP_VER")"
else
  FINDINGS+=",\"phpVersion\":null"
fi

FINDINGS+=",\"inventory\":{\"extensions\":$EXT_JSON,\"count\":$EXT_COUNT"
FINDINGS+=",\"countedFrom\":$(_jstr "${DB_PREFIX}extensions (all rows)")}"

FINDINGS+=",\"templateStyles\":{\"styles\":$STYLE_JSON,\"count\":$STYLE_COUNT"
FINDINGS+=",\"countedFrom\":$(_jstr "${DB_PREFIX}template_styles (all rows)")}"

FINDINGS+=",\"recordedUpdates\":{\"updates\":$UPD_JSON,\"count\":$UPD_COUNT"
FINDINGS+=",\"countedFrom\":$(_jstr "${DB_PREFIX}updates (all rows)")"
FINDINGS+=",\"freshness\":{\"sites\":$FRESH_JSON"
FINDINGS+=",\"countedFrom\":$(_jstr "${DB_PREFIX}update_sites (all rows)")"
FINDINGS+=",\"latestRefresh\":$FRESH_LATEST}}"

FINDINGS+='}'

envelope_set_findings "$FINDINGS"
envelope_emit

# ---------- smoke-run ----------
# Command:
#   bash diag-version-audit.sh --label <site-label>
#
# Sources: webroot files on the host; the site's db container
# (${LABEL}-db-1) over docker exec for all SQL; the site's web container
# (${LABEL}-web-1) over docker exec for the PHP version. No network calls.
#
# Expected top-level envelope keys:
#   schemaVersion ("1.0"), kind ("diag-version-audit"), label, startedAt,
#   finishedAt, status ("ok"|"error"), findings, unavailable, error
#
# findings keys (status=ok):
#   .joomlaVersion          string | null
#   .phpVersion             string | null
#   .inventory.extensions[] {extensionId, name, type, element, version, enabled, folder}
#                           | null when the query failed
#   .inventory.count        int (bound: all rows in {prefix}extensions) | null
#   .inventory.countedFrom  string
#   .templateStyles.styles[]  {id, template, title, clientId, isDefault}
#                             | null when the query failed
#   .templateStyles.count     int (bound: all rows in {prefix}template_styles) | null
#   .templateStyles.countedFrom string
#   .recordedUpdates.updates[]  {updateId, extensionId, name, element, type, availableVersion}
#                               | null when the query failed
#   .recordedUpdates.count      int (bound: all rows in {prefix}updates) | null
#   .recordedUpdates.countedFrom string
#   .recordedUpdates.freshness.sites[]         {updateSiteId, name, enabled, lastChecked}
#                                              | null when the query failed
#   .recordedUpdates.freshness.countedFrom     string
#   .recordedUpdates.freshness.latestRefresh   string (ISO 8601) | null
#
# A failed part is always both null in findings and listed in unavailable[], so
# "no data" is never reported as a real zero.
#
# Error cases (status "error", findings {}, exit 0):
#   Webroot missing            -> "Webroot not found: ..."
#   Config missing             -> "configuration.php not found in webroot"
#   Prefix undeterminable      -> "Cannot determine DB table prefix ..."
#   DB container inaccessible  -> "DB container not accessible: <label>-db-1"
#
# Other cases:
#   Partial DB/PHP access      -> status "ok", affected sections in unavailable[]
#   Never-refreshed record     -> status "ok", "recordedUpdates" in unavailable[]
