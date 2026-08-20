#!/usr/bin/env bash
# diag-server-audit — Hosting-layer audit for a working copy.
# Usage: diag-server-audit.sh --label <site-label> --page <path>
# Read-only on the copy; docker exec into the site web container reads PHP
# limits, host filesystem reads for permissions and .htaccess, loopback HTTP
# reads for the doctype/quirks-mode probe. No network calls off the host.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/result-envelope.sh"
source "$SCRIPT_DIR/json-helpers.sh"
source "$SCRIPT_DIR/page-probe.sh"

usage() {
  echo "Usage: diag-server-audit.sh --label <site-label> --page <path>" >&2
}

# ---------- arg parsing ----------

LABEL=""
PAGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --label)
      # A bare --label would die on an unbound $2 before any envelope exists,
      # breaking the one-JSON-document contract (ID-5).
      if [ $# -lt 2 ]; then usage; exit 2; fi
      LABEL="$2"; shift 2 ;;
    --page)
      if [ $# -lt 2 ]; then usage; exit 2; fi
      PAGE="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$LABEL" || -z "$PAGE" ]]; then usage; exit 2; fi
# The fleet gate already refuses a page without a leading slash; mirror it here
# so a direct CLI invocation is never the weaker path.
if [[ "$PAGE" != /* ]]; then
  echo "Page path must start with /: $PAGE" >&2
  exit 2
fi

WEBROOT="/srv/tracy/$LABEL/webroot"
CONFIG="$WEBROOT/configuration.php"
STACK_ENV="/srv/tracy/$LABEL/.env"
WEB_CONTAINER="${LABEL}-web-1"

envelope_init "diag-server-audit" "$LABEL"

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

# ---------- local helpers ----------

# stat takes different flags on GNU and BSD; the fallback keeps the same
# script working on Lee's Linux fleet-host and on a shared-iMac dev copy.
_stat_mode()  { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null || true; }
_stat_owner() { stat -c '%U' "$1" 2>/dev/null || stat -f '%Su' "$1" 2>/dev/null || true; }
_stat_group() { stat -c '%G' "$1" 2>/dev/null || stat -f '%Sg' "$1" 2>/dev/null || true; }

# ---------- PHP limits ----------
# Each ini value is asked separately so one unresolvable directive does not
# blank the rest. The key set is fixed, so the enclosing object's bound is the
# array length; every measured key is present, missing values are the empty
# string that php returns for an unknown directive.

PHP_LIMIT_KEYS=(
  memory_limit
  max_execution_time
  max_input_time
  max_input_vars
  post_max_size
  upload_max_filesize
  file_uploads
  display_errors
  log_errors
  error_reporting
)

query_php_limits() {
  LIMITS_JSON="null"
  # A single cheap liveness probe before ten ini_get calls each pay the
  # docker-exec startup cost.
  if ! docker exec "$WEB_CONTAINER" php -v >/dev/null 2>&1; then
    envelope_unavailable "phpLimits" "site web container not accessible: $WEB_CONTAINER"
    return 0
  fi
  local items=() key val
  for key in "${PHP_LIMIT_KEYS[@]}"; do
    val=$(docker exec "$WEB_CONTAINER" php -r "echo ini_get('$key');" 2>/dev/null || true)
    items+=("$(_jstr "$key"):$(_jstr "$val")")
  done
  local IFS=','
  LIMITS_JSON="{${items[*]}}"
}

# ---------- permission audit ----------
# The fixed target set is Joomla's writable/executable hotspots — the paths a
# broken update most often leaves in an unexpected mode or ownership. The
# reference owner/group is whatever the webroot itself carries on this copy,
# so drift is judged against the site's own norm, not a hardcoded value.

PERM_TARGETS=(
  configuration.php
  administrator
  administrator/cache
  administrator/logs
  cache
  images
  language
  modules
  plugins
  templates
  tmp
)

query_permissions() {
  local expected_owner expected_group
  expected_owner="$(_stat_owner "$WEBROOT")"
  expected_group="$(_stat_group "$WEBROOT")"
  PERM_REF_OWNER="$expected_owner"
  PERM_REF_GROUP="$expected_group"

  local items=() anomalies=() rel abs mode owner group
  for rel in "${PERM_TARGETS[@]}"; do
    abs="$WEBROOT/$rel"
    if [[ ! -e "$abs" ]]; then
      items+=("{\"path\":$(_jstr "$rel"),\"present\":false}")
      continue
    fi
    mode="$(_stat_mode "$abs")"
    owner="$(_stat_owner "$abs")"
    group="$(_stat_group "$abs")"
    items+=("{\"path\":$(_jstr "$rel"),\"present\":true,\"mode\":$(_jstr "$mode"),\"owner\":$(_jstr "$owner"),\"group\":$(_jstr "$group")}")

    # World-writable: any octal mode whose last (world) digit has the write
    # bit set (2, 3, 6, 7). Reported as one anomaly per path; the kind names
    # what it is so the enclosing count states the true total.
    if [[ -n "$mode" && "$mode" =~ [2367]$ ]]; then
      anomalies+=("{\"path\":$(_jstr "$rel"),\"kind\":$(_jstr "world-writable"),\"mode\":$(_jstr "$mode")}")
    fi
    if [[ -n "$expected_owner" && -n "$owner" && "$owner" != "$expected_owner" ]]; then
      anomalies+=("{\"path\":$(_jstr "$rel"),\"kind\":$(_jstr "owner-drift"),\"owner\":$(_jstr "$owner"),\"expected\":$(_jstr "$expected_owner")}")
    fi
    if [[ -n "$expected_group" && -n "$group" && "$group" != "$expected_group" ]]; then
      anomalies+=("{\"path\":$(_jstr "$rel"),\"kind\":$(_jstr "group-drift"),\"group\":$(_jstr "$group"),\"expected\":$(_jstr "$expected_group")}")
    fi
  done

  PERM_ITEMS_JSON=$(_join_json_array "${items[@]+"${items[@]}"}")
  PERM_ANOM_JSON=$(_join_json_array "${anomalies[@]+"${anomalies[@]}"}")
  PERM_ANOM_COUNT=${#anomalies[@]}
  PERM_TARGET_COUNT=${#PERM_TARGETS[@]}
}

# ---------- .htaccess ----------
# Two well-known files: the webroot's and the administrator/'s. Absence is a
# real finding, not an error. For each present file: a fixed pattern set of
# directive counts, plus a bounded list of risky-rule surfacings that name
# themselves so downstream reasoning stays out of this script.

HT_PATTERNS=(
  RewriteEngine
  RewriteRule
  RewriteCond
  ErrorDocument
  php_flag
  php_value
  SetHandler
  AddHandler
  AddType
  Options
  Order
  Deny
  Allow
  Require
  Header
)

# Hard ceiling so one runaway .htaccess (rare, but possible after a botched
# import) never produces an unbounded document.
RISKY_FLAG_CAP=100

build_directive_counts() {
  local f="$1" pat n items=()
  for pat in "${HT_PATTERNS[@]}"; do
    n="$(grep -cE "^[[:space:]]*${pat}\b" "$f" 2>/dev/null)" || true
    [[ "$n" =~ ^[0-9]+$ ]] || n=0
    items+=("$(_jstr "$pat"):$(_jnum "$n")")
  done
  local IFS=','
  printf '{%s}' "${items[*]}"
}

build_risky_flags() {
  local f="$1" flags=() line total=0
  # total/flags are these locals; bash dynamic scoping makes them visible to
  # add_flag, defined below and only ever called from here.
  add_flag() { # $1 = flag label
    total=$((total+1))
    (( ${#flags[@]} < RISKY_FLAG_CAP )) && flags+=("$(_jstr "$1")")
  }
  # Every pattern is anchored to line start (leading whitespace allowed) so a
  # directive named mid-line — in comment text or as another directive's
  # argument — does not count as a risky flag.
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[[:space:]]*php_flag[[:space:]]+display_errors[[:space:]]+(On|on|1) ]]; then
      add_flag "display_errors On via php_flag"
    fi
    if [[ "$line" =~ ^[[:space:]]*php_value[[:space:]]+auto_prepend_file ]]; then
      add_flag "auto_prepend_file set via php_value"
    fi
    if [[ "$line" =~ ^[[:space:]]*php_value[[:space:]]+auto_append_file ]]; then
      add_flag "auto_append_file set via php_value"
    fi
    if [[ "$line" =~ ^[[:space:]]*Options[[:space:]]+[+-]?(Indexes|ExecCGI|Includes|FollowSymLinks|All) ]]; then
      add_flag "Options directive: $(_collapse_ws "$line")"
    fi
    if [[ "$line" =~ ^[[:space:]]*Deny[[:space:]]+from[[:space:]]+all ]]; then
      add_flag "'Deny from all' present"
    fi
    if [[ "$line" =~ ^[[:space:]]*Require[[:space:]]+all[[:space:]]+denied ]]; then
      add_flag "'Require all denied' present"
    fi
    if [[ "$line" =~ ^[[:space:]]*SetHandler[[:space:]]+application/x-httpd-php ]]; then
      add_flag "SetHandler for php present"
    fi
    if [[ "$line" =~ ^[[:space:]]*AddHandler[[:space:]]+.*php ]]; then
      add_flag "AddHandler for php present"
    fi
    if [[ "$line" =~ ^[[:space:]]*RewriteRule ]] && [[ "$line" =~ \[.*R= ]]; then
      add_flag "RewriteRule with hard redirect: $(_collapse_ws "$line")"
    fi
  done < "$f"
  local arr
  arr="$(_join_json_array "${flags[@]+"${flags[@]}"}")"
  # {list, count, listCappedAt} — count is always the true total, matching
  # the D-38 honest-count rule that cap_error_entries follows in page-probe.
  printf '{"list":%s,"count":%s,"listCappedAt":%s}' "$arr" "$(_jnum "$total")" "$(_jnum "$RISKY_FLAG_CAP")"
}

query_htaccess() {
  local files=(".htaccess" "administrator/.htaccess")
  local rel abs results=() size directives risky
  for rel in "${files[@]}"; do
    abs="$WEBROOT/$rel"
    if [[ ! -f "$abs" ]]; then
      results+=("{\"path\":$(_jstr "$rel"),\"present\":false}")
      continue
    fi
    size="$(wc -c < "$abs" | tr -d ' ')"
    directives="$(build_directive_counts "$abs")"
    risky="$(build_risky_flags "$abs")"
    results+=("{\"path\":$(_jstr "$rel"),\"present\":true,\"sizeBytes\":$(_jnum "$size"),\"directives\":$directives,\"risky\":$risky}")
  done
  HT_JSON=$(_join_json_array "${results[@]+"${results[@]}"}")
  HT_FILE_COUNT=${#files[@]}
}

# ---------- doctype / quirks-mode probe ----------
# One page fetched over loopback (page-probe.sh); the verdict is a pure-string
# parse of the top DOCTYPE (if any). Kept in a discrete function so the same
# rule is what a smoke run against a legacy quirks page and a modern strict
# page both traverse — the verdict is the only bit that flips.
#
# Verdict scheme (matches the browser rendering-engine contract):
#   strict — <!DOCTYPE html> (HTML5), or HTML 4.01 Strict, or XHTML 1.0 Strict
#   quirks — no DOCTYPE, or HTML 4.01 Transitional/Frameset, or XHTML 1.0
#            Transitional, or an unrecognized DOCTYPE
# Prints two lines on stdout: "verdict\ndoctype"; doctype is empty when absent.
classify_doctype() {
  local body="$1" doctype="" verdict="" n=0 line lower
  # A leading UTF-8 BOM sits in front of the DOCTYPE and would otherwise push
  # the declaration off the start of its line, forcing a false quirks verdict.
  body="${body#$'\xef\xbb\xbf'}"
  while IFS= read -r line && (( n < 40 )); do
    n=$((n+1))
    [[ -z "$line" ]] && continue
    lower="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
    if [[ "$lower" == *"<!doctype"* ]]; then
      doctype="$(_collapse_ws "$line")"
      break
    fi
    # A DOCTYPE after real markup has no rendering effect; stop looking.
    if [[ "$lower" == *"<html"* || "$lower" == *"<head"* || "$lower" == *"<body"* ]]; then
      break
    fi
  done <<< "$body"

  if [[ -z "$doctype" ]]; then
    verdict="quirks"
  else
    local lower_dt dt
    lower_dt="$(printf '%s' "$doctype" | tr '[:upper:]' '[:lower:]')"
    if [[ "$lower_dt" != "<!doctype"* ]]; then
      # Real markup precedes the declaration on this line; a DOCTYPE after
      # content has no rendering effect (same as the doctype-after-content case).
      verdict="quirks"
    else
      # Judge the declaration only, cut at its first '>', so a DOCTYPE sharing
      # its line with following markup (minified output) still reads correctly.
      dt="${lower_dt%%>*}>"
      if [[ "$dt" == "<!doctype html>" ]]; then
        verdict="strict"
      elif [[ "$dt" == *"html public"* ]]; then
        if [[ "$dt" == *"html 4.01//en"* && "$dt" != *"transitional"* && "$dt" != *"frameset"* ]]; then
          verdict="strict"
        elif [[ "$dt" == *"xhtml 1.0 strict"* ]]; then
          verdict="strict"
        else
          verdict="quirks"
        fi
      else
        verdict="quirks"
      fi
    fi
  fi
  printf '%s\n%s\n' "$verdict" "$doctype"
}

query_doctype() {
  DOCTYPE_JSON="null"
  resolve_host_port "$STACK_ENV"
  if [[ -z "$HOST_PORT" ]]; then
    envelope_unavailable "doctype" "HOST_PORT not resolvable from $STACK_ENV; cannot probe page"
    return 0
  fi
  local body_file
  body_file="$(mktemp)"
  # probe_page writes its own unavailable[] entry on a no-answer; the temp body
  # file may exist (empty or partial) whether or not the fetch answered, so both
  # branches remove it.
  if ! probe_page "$LABEL" "$HOST_PORT" "$PAGE" "$body_file" "doctype"; then
    [[ -e "$body_file" ]] && rm -f "$body_file"
    return 0
  fi
  local body verdict doctype
  # 64KiB is enough for any real page header; a runaway body cannot inflate
  # the envelope through this path.
  body="$(head -c 65536 "$body_file")"
  [[ -e "$body_file" ]] && rm -f "$body_file"
  {
    read -r verdict
    read -r doctype
  } < <(classify_doctype "$body")

  DOCTYPE_JSON="$(printf '{"url":%s,"httpCode":%s,"verdict":%s,"doctype":%s}' \
    "$(_jstr "$PROBE_URL")" \
    "$(_jnum "$PROBE_HTTP_CODE")" \
    "$(_jstr "$verdict")" \
    "$([[ -n "$doctype" ]] && _jstr "$doctype" || printf 'null')")"
}

# ---------- run queries ----------

query_php_limits
query_permissions
query_htaccess
query_doctype

# ---------- assemble findings ----------

FINDINGS='{'
FINDINGS+="\"phpLimits\":{\"values\":$LIMITS_JSON"
FINDINGS+=",\"countedFrom\":$(_jstr "docker exec ${LABEL}-web-1 (ini_get, ${#PHP_LIMIT_KEYS[@]} fixed keys)")}"

FINDINGS+=",\"permissions\":{\"reference\":{\"owner\":$([[ -n "$PERM_REF_OWNER" ]] && _jstr "$PERM_REF_OWNER" || printf 'null'),\"group\":$([[ -n "$PERM_REF_GROUP" ]] && _jstr "$PERM_REF_GROUP" || printf 'null')}"
FINDINGS+=",\"targets\":$PERM_ITEMS_JSON"
FINDINGS+=",\"targetCount\":$(_jnum "$PERM_TARGET_COUNT")"
FINDINGS+=",\"anomalies\":$PERM_ANOM_JSON"
FINDINGS+=",\"anomalyCount\":$(_jnum "$PERM_ANOM_COUNT")"
FINDINGS+=",\"countedFrom\":$(_jstr "webroot key paths (fixed set, ${#PERM_TARGETS[@]} entries)")}"

FINDINGS+=",\"htaccess\":{\"files\":$HT_JSON"
FINDINGS+=",\"fileCount\":$(_jnum "$HT_FILE_COUNT")"
FINDINGS+=",\"countedFrom\":$(_jstr "webroot .htaccess and administrator/.htaccess")}"

FINDINGS+=",\"doctype\":$DOCTYPE_JSON"
FINDINGS+='}'

envelope_set_findings "$FINDINGS"
envelope_emit

# ---------- smoke-run ----------
# Command (kind 5):
#   bash diag-server-audit.sh --label <site-label> --page /
#
# Sources: docker exec into ${LABEL}-web-1 (php -v probe, then one ini_get
# per key in PHP_LIMIT_KEYS); host filesystem (stat + wc + grep) under
# /srv/tracy/$LABEL/webroot for permissions and .htaccess; one loopback
# curl to http://127.0.0.1:$HOST_PORT$PAGE (Host: ${LABEL}.tracy.ai) for the
# doctype probe. No off-host network. HOST_PORT read from
# /srv/tracy/$LABEL/.env when the fleet env did not set it.
#
# Expected top-level envelope keys:
#   schemaVersion ("1.0"), kind ("diag-server-audit"), label, startedAt,
#   finishedAt, status ("ok"|"error"), findings, unavailable, error
#
# findings keys (status=ok):
#   .phpLimits.values           {memory_limit, max_execution_time,
#                                max_input_time, max_input_vars, post_max_size,
#                                upload_max_filesize, file_uploads,
#                                display_errors, log_errors, error_reporting}
#                               (10 fixed keys; string values from ini_get,
#                                empty string when the directive is unknown)
#                               | null when the site web container is not
#                                accessible (also listed in unavailable[])
#   .phpLimits.countedFrom      string
#   .permissions.reference      {owner, group} — the webroot's own owner/group,
#                                the baseline drift is judged against
#   .permissions.targets[]      {path, present, mode?, owner?, group?}
#                                (mode/owner/group only when present)
#   .permissions.targetCount    int (bound: fixed set length, 11 entries)
#   .permissions.anomalies[]    {path, kind: "world-writable"|"owner-drift"|
#                                "group-drift", mode?/owner?/group?/expected?}
#   .permissions.anomalyCount   int (bound: 3 × targetCount)
#   .permissions.countedFrom    string
#   .htaccess.files[]           {path, present, sizeBytes?, directives?, risky?}
#   .htaccess.files[].directives {RewriteEngine, RewriteRule, RewriteCond,
#                                ErrorDocument, php_flag, php_value, SetHandler,
#                                AddHandler, AddType, Options, Order, Deny,
#                                Allow, Require, Header}
#                                (15 fixed keys; count of matching lines each)
#   .htaccess.files[].risky     {list[], count, listCappedAt}
#                                (list capped at listCappedAt; count is the
#                                true total before the cap)
#   .htaccess.fileCount         int (bound: 2 — webroot and administrator)
#   .htaccess.countedFrom       string
#   .doctype                    {url, httpCode, verdict: "strict"|"quirks",
#                                doctype: string | null}
#                                | null when HOST_PORT not resolvable or the
#                                loopback fetch got no answer (also listed in
#                                unavailable[])
#
# A failed part is always both null in findings and listed in unavailable[], so
# "no data" is never reported as a real zero.
#
# Error cases (status "error", findings {}, exit 0):
#   Webroot missing            -> "Webroot not found: /srv/tracy/<label>/webroot"
#   Config missing             -> "configuration.php not found in webroot"
#
# Argument errors (no envelope, exit 2):
#   --label missing / --page missing / --page not starting with /
#   / unknown flag
#
# Doctype verdict verification (feeds ticket 11 smoke deployment):
#   Run twice on Lee's copy:
#     bash diag-server-audit.sh --label <label> --page /
#     bash diag-server-audit.sh --label <label> --page /<known-quirks-path>
#   The first, against a Joomla page shipping <!DOCTYPE html>, yields
#   .doctype.verdict == "strict". The second, against a page whose top HTML
#   ships no DOCTYPE (or an HTML 4.01 Transitional / XHTML Transitional
#   DOCTYPE), yields .doctype.verdict == "quirks". The verdict flips; the
#   raw .doctype.doctype string is the wording that produced the flip.
