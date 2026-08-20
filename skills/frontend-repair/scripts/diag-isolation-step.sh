#!/usr/bin/env bash
# diag-isolation-step — apply exactly one toggle to a working copy, then probe a page.
# Usage: diag-isolation-step.sh --label <site-label> --page <path>
#          ( --disable <ids> | --enable <ids> | --set-template <style>
#          | --toggle-file <path> )
# Copy-only (D-04): every write lands in /srv/tracy/<label>'s own database
# container. One toggle, one probe, one envelope — never a loop: which
# extension to try next, and in what order, is playbook prose (D-11).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/result-envelope.sh"
source "$SCRIPT_DIR/json-helpers.sh"
source "$SCRIPT_DIR/envelope-exit-guard.sh"
source "$SCRIPT_DIR/joomla-copy-db.sh"
source "$SCRIPT_DIR/page-probe.sh"

usage() {
  echo "Usage: diag-isolation-step.sh --label <site-label> --page <path> \\" >&2
  echo "         ( --disable <ids> | --enable <ids> | --set-template <style> | --toggle-file <path> )" >&2
}

# The fleet gate already holds callers to this shape; a script run by hand
# reaches the same database, so it holds itself to it too.
SAFE_ARG_RE='^[A-Za-z0-9._:/@-]+$'

# ---------- arg parsing ----------

LABEL=""
PAGE=""
ACTION=""
TOGGLE_FILE=""
TEMPLATE_ARG=""
ITEMS=()

# Two different toggles in one run would make the probe unattributable to
# either, so the second one is refused. Repeating --disable (or --enable) is
# not that: it is one toggle over a longer list, and it adds to it.
set_action() {
  if [[ -n "$ACTION" ]]; then
    if [[ "$ACTION" != "$1" || "$1" == "set-template" || "$1" == "toggle-file" ]]; then
      echo "Only one of --disable/--enable/--set-template/--toggle-file per call" >&2
      usage
      exit 2
    fi
  fi
  ACTION="$1"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --label)
      # A bare flag would otherwise die on an unbound $2, before any envelope
      # exists, breaking the one-JSON-document contract (ID-5).
      if [ $# -lt 2 ]; then usage; exit 2; fi
      LABEL="$2"; shift 2 ;;
    --page)
      if [ $# -lt 2 ]; then usage; exit 2; fi
      PAGE="$2"; shift 2 ;;
    --disable)
      if [ $# -lt 2 ]; then usage; exit 2; fi
      set_action "disable"; ITEMS+=("$2"); shift 2 ;;
    --enable)
      if [ $# -lt 2 ]; then usage; exit 2; fi
      set_action "enable"; ITEMS+=("$2"); shift 2 ;;
    --set-template)
      if [ $# -lt 2 ]; then usage; exit 2; fi
      set_action "set-template"; TEMPLATE_ARG="$2"; shift 2 ;;
    --toggle-file)
      # The batch form: a list of extensions travels as a JSON file, never as
      # a command line, so the flag that named it is inside the file.
      if [ $# -lt 2 ]; then usage; exit 2; fi
      set_action "toggle-file"; TOGGLE_FILE="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$LABEL" || -z "$ACTION" ]]; then usage; exit 2; fi
if [[ -z "$PAGE" ]]; then
  echo "--page is required: a toggle whose effect is never probed answers nothing" >&2
  usage
  exit 2
fi
if [[ "$PAGE" != /* ]]; then
  echo "--page must start with /: $PAGE" >&2
  usage
  exit 2
fi

# ---------- the batch form: read the toggle list out of its JSON file ----------

# Only the two flags the fleet sends as a list travel this way, and only their
# own key may appear: a file naming both would be the two-toggle run refused
# above, arriving by another door.
read_toggle_file() {
  local path="$1" content key found=""
  if [[ ! -f "$path" ]]; then
    echo "--toggle-file not found: $path" >&2
    exit 2
  fi
  content="$(tr -d '\n\r\t' < "$path")"
  for key in disable enable; do
    # Matched at key position — quotes then a colon — so a list *value* that
    # happens to read "enable" is not mistaken for the other key's presence.
    if [[ "$content" =~ \"$key\"[[:space:]]*: ]]; then
      if [[ -n "$found" ]]; then
        echo "--toggle-file names both disable and enable: $path" >&2
        exit 2
      fi
      found="$key"
    fi
  done
  if [[ -z "$found" ]]; then
    echo "--toggle-file names neither disable nor enable: $path" >&2
    exit 2
  fi
  ACTION="$found"
  # Every element of the list is a validated safe string, so the values can be
  # lifted straight out of the quotes without a JSON parser on the host.
  local rest="${content#*\"$found\"}"
  rest="${rest#*[}"
  rest="${rest%%]*}"
  local raw
  while IFS= read -r raw; do
    [[ -z "$raw" ]] && continue
    ITEMS+=("$raw")
  done < <(printf '%s' "$rest" | grep -oE '"[^"]*"' | sed -e 's/^"//' -e 's/"$//')
  if [[ ${#ITEMS[@]} -eq 0 ]]; then
    echo "--toggle-file carries an empty $found list: $path" >&2
    exit 2
  fi
}

if [[ "$ACTION" == "toggle-file" ]]; then
  read_toggle_file "$TOGGLE_FILE"
fi

if [[ "$ACTION" == "set-template" ]]; then
  if [[ ! "$TEMPLATE_ARG" =~ $SAFE_ARG_RE ]]; then
    echo "Unsafe --set-template value: $TEMPLATE_ARG" >&2
    exit 2
  fi
else
  if [[ ${#ITEMS[@]} -eq 0 ]]; then usage; exit 2; fi
  for item in "${ITEMS[@]}"; do
    if [[ ! "$item" =~ $SAFE_ARG_RE ]]; then
      echo "Unsafe toggle value: $item" >&2
      exit 2
    fi
  done
fi

WEBROOT="/srv/tracy/$LABEL/webroot"
CONFIG="$WEBROOT/configuration.php"
STACK_ENV="/srv/tracy/$LABEL/.env"
DB_CONTAINER="${LABEL}-db-1"

# ---------- one envelope, whatever happens after init ----------

# emit_envelope_once / on_exit / TEMP_FILES come from envelope-exit-guard.sh.
ENVELOPE_ABORT_NOTE="the copy may be left toggled"
trap on_exit EXIT

envelope_init "diag-isolation-step" "$LABEL"
ENVELOPE_READY=1

if [[ ! -d "$WEBROOT" ]]; then
  envelope_error "Webroot not found: $WEBROOT"
  emit_envelope_once
  exit 0
fi

if [[ ! -f "$CONFIG" ]]; then
  envelope_error "configuration.php not found in webroot"
  emit_envelope_once
  exit 0
fi

# ---------- DB access ----------

# cfg_val / db_bootstrap / db_query / db_rows come from joomla-copy-db.sh.
if ! db_bootstrap; then
  envelope_error "$DB_BOOTSTRAP_ERROR"
  emit_envelope_once
  exit 0
fi

# ---------- extension toggles ----------

TOGGLE_ENTRIES=()
CHANGED_COUNT=0
CHANGED_IDS=()
MATCHED_ROWS=0
UNMATCHED=()
WRITE_FAILED=""

# An item is either an extension_id or the element (slug) Joomla knows it by.
# The element is not unique across types and folders — one slug can name a
# component and its plugin — so every row it names is toggled and reported.
select_extension_rows() {
  local item="$1"
  if [[ "$item" =~ ^[0-9]+$ ]]; then
    db_query "SELECT extension_id, name, type, element, folder, enabled \
      FROM ${DB_PREFIX}extensions WHERE extension_id = '$item' ORDER BY extension_id"
  else
    db_query "SELECT extension_id, name, type, element, folder, enabled \
      FROM ${DB_PREFIX}extensions WHERE element = '$item' ORDER BY extension_id"
  fi
}

toggle_extensions() {
  local want
  [[ "$ACTION" == "disable" ]] && want=0 || want=1

  local item rc data eid name type element folder before after
  for item in "${ITEMS[@]}"; do
    rc=0
    data="$(select_extension_rows "$item")" || rc=$?
    if (( rc != 0 )); then
      # Reported as unavailable only: unmatched[] means "no row carried this
      # item", which a failed read never established either way.
      envelope_unavailable "toggle:$item" "DB read failed before any write for this item"
      continue
    fi
    if [[ -z "$data" ]]; then
      # Named but absent: reported, never silently treated as done.
      UNMATCHED+=("$item")
      TOGGLE_ENTRIES+=("{\"requested\":$(_jstr "$item"),\"matched\":false,\"extensionId\":null\
,\"name\":null,\"type\":null,\"element\":null,\"folder\":null,\"before\":null,\"after\":null,\"changed\":false}")
      continue
    fi

    # Read over db_rows, not raw tabs: a component's empty folder column would
    # otherwise collapse and shift every field after it.
    while IFS=$'\x1f' read -r eid name type element folder before; do
      if [[ -z "$eid" ]]; then continue; fi
      (( MATCHED_ROWS++ )) || true

      rc=0
      db_query "UPDATE ${DB_PREFIX}extensions SET enabled = $want WHERE extension_id = '$eid'" >/dev/null || rc=$?

      # Read back rather than trust the write: the state this run claims to
      # have applied is what the next probe is judged against.
      after=""
      if (( rc == 0 )); then
        after="$(db_query "SELECT enabled FROM ${DB_PREFIX}extensions WHERE extension_id = '$eid'" || true)"
        after="$(printf '%s' "$after" | head -1)"
      fi
      if (( rc != 0 )) || [[ "$after" != "$want" ]]; then
        WRITE_FAILED="extension $eid ($element): wanted enabled=$want, read back ${after:-<unreadable>}"
      fi

      local changed="false"
      if [[ -n "$after" && "$after" != "$before" ]]; then changed="true"; fi
      if [[ "$changed" == "true" ]]; then
        (( CHANGED_COUNT++ )) || true
        # The reverse call is built from these ids alone: mirroring every
        # requested item would move rows this step never moved.
        CHANGED_IDS+=("$eid")
      fi

      TOGGLE_ENTRIES+=("{\"requested\":$(_jstr "$item"),\"matched\":true\
,\"extensionId\":$(_jnum "$eid"),\"name\":$(_jstr "$name"),\"type\":$(_jstr "$type")\
,\"element\":$(_jstr "$element"),\"folder\":$(_jstr "$folder")\
,\"before\":{\"enabled\":$(_jnum "$before")},\"after\":{\"enabled\":$(_jnum "${after:-x}")}\
,\"changed\":$changed}")
    done < <(db_rows "$data")

    # Spelled as an if, not an AND-list: as the loop body's last command, an
    # AND-list that does not fire returns 1, which under `set -e` would abort
    # the run right after a write that took.
    if [[ -n "$WRITE_FAILED" ]]; then break; fi
  done
}

# ---------- template style swap ----------

TEMPLATE_JSON='null'
PREVIOUS_HOME_ID=""
TEMPLATE_APPLIED_ID=""
# Set when the run deliberately writes nothing: the copy still stands where it
# did, so there is nothing to probe and nothing to reverse.
TEMPLATE_NOT_APPLIED=""

# The style is named either by its own id or by the template it belongs to;
# only the site's own styles (client_id 0) are in scope, never the admin's.
# The id alone is selected: what the swap then reports is read back from the
# copy afterwards, never carried over from this lookup.
select_style_row() {
  local arg="$1"
  if [[ "$arg" =~ ^[0-9]+$ ]]; then
    db_query "SELECT id FROM ${DB_PREFIX}template_styles \
      WHERE client_id = 0 AND id = '$arg' ORDER BY id LIMIT 1"
  else
    db_query "SELECT id FROM ${DB_PREFIX}template_styles \
      WHERE client_id = 0 AND template = '$arg' ORDER BY home DESC, id LIMIT 1"
  fi
}

# The shape a templateSwap finding takes when this run wrote nothing: what the
# copy already had, no after-state, nothing changed.
template_not_applied_json() {
  local prev_id="$1" prev_template="$2" prev_title="$3"
  printf '{"requested":%s,"before":{"styleId":%s,"template":%s,"title":%s},"after":null,"changed":false}' \
    "$(_jstr "$TEMPLATE_ARG")" \
    "$(_jnum "${prev_id:-x}")" \
    "$([[ -n "$prev_id" ]] && _jstr "$prev_template" || printf 'null')" \
    "$([[ -n "$prev_id" ]] && _jstr "$prev_title" || printf 'null')"
}

swap_template() {
  local rc=0 data
  data="$(db_query "SELECT id, template, title FROM ${DB_PREFIX}template_styles \
    WHERE client_id = 0 AND home = '1' ORDER BY id LIMIT 1")" || rc=$?
  if (( rc != 0 )); then
    envelope_error "DB read failed: cannot determine the copy's current default template style"
    emit_envelope_once
    exit 0
  fi

  local prev_id prev_template prev_title
  IFS=$'\x1f' read -r prev_id prev_template prev_title <<< "$(db_rows "$data" | head -1)"
  PREVIOUS_HOME_ID="$prev_id"

  if [[ -z "$prev_id" ]]; then
    # No site default to record means no state to put back: a swap from here
    # could not be undone by the mirror call, so nothing is written at all.
    # The tool itself ran fine, so the envelope stays "ok" (ID-5) and says why.
    TEMPLATE_JSON="$(template_not_applied_json "$prev_id" "$prev_template" "$prev_title")"
    envelope_unavailable "templateSwap" \
      "The copy has no site default template style (client_id 0, home '1'), so a swap could not be reversed; nothing was written"
    TEMPLATE_NOT_APPLIED=1
    return 0
  fi

  rc=0
  data="$(select_style_row "$TEMPLATE_ARG")" || rc=$?
  if (( rc != 0 )); then
    envelope_error "DB read failed while looking up template style: $TEMPLATE_ARG"
    emit_envelope_once
    exit 0
  fi
  if [[ -z "$data" ]]; then
    # Named but absent, as on the extension path: the tool ran to completion and
    # wrote nothing, so it is a finding, not a tool failure (ID-5). The name is
    # reported in unmatched[], never silently treated as done.
    UNMATCHED+=("$TEMPLATE_ARG")
    TEMPLATE_JSON="$(template_not_applied_json "$prev_id" "$prev_template" "$prev_title")"
    TEMPLATE_NOT_APPLIED=1
    return 0
  fi

  local new_id
  IFS=$'\x1f' read -r new_id <<< "$(db_rows "$data" | head -1)"

  # Joomla's home column carries a language tag as well as '0'/'1': a
  # per-language default outranks the site default at render time. The swap
  # below deliberately touches only the site default, so where language rows
  # exist this probe cannot speak for those languages, and says so.
  rc=0
  local lang_rows
  lang_rows="$(db_query "SELECT COUNT(*) FROM ${DB_PREFIX}template_styles \
    WHERE client_id = 0 AND home NOT IN ('0','1') AND home <> ''")" || rc=$?
  lang_rows="$(printf '%s' "$lang_rows" | head -1)"
  if (( rc != 0 )); then
    envelope_unavailable "templateSwap:languageDefaults" \
      "DB read failed while checking for language-scoped default template styles, so it is unknown whether one outranks this swap"
  elif [[ -n "$lang_rows" && "$lang_rows" != "0" ]]; then
    envelope_unavailable "templateSwap:languageDefaults" \
      "$lang_rows template style row(s) carry a language-scoped default (home is a language tag); this swap moves the site default only, so the probe result cannot be trusted for those languages"
  fi

  rc=0
  db_query "UPDATE ${DB_PREFIX}template_styles SET home = '0' WHERE client_id = 0 AND home = '1'" >/dev/null || rc=$?
  if (( rc == 0 )); then
    db_query "UPDATE ${DB_PREFIX}template_styles SET home = '1' WHERE id = '$new_id'" >/dev/null || rc=$?
  fi

  # Everything the after-block reports is read back from the copy, title
  # included: the requested style's own title would describe the row that was
  # asked for rather than the one the copy ended up on.
  local applied_id applied_template applied_title
  if (( rc == 0 )); then
    local after
    after="$(db_query "SELECT id, template, title FROM ${DB_PREFIX}template_styles \
      WHERE client_id = 0 AND home = '1' ORDER BY id LIMIT 1" || true)"
    IFS=$'\x1f' read -r applied_id applied_template applied_title <<< "$(db_rows "$after" | head -1)"
  fi
  TEMPLATE_APPLIED_ID="${applied_id:-}"

  # One comparison feeds both the reported flag and the count, so a failed
  # write can never report "changed" beside a changedCount of 0.
  local changed="false"
  if [[ -n "$applied_id" && "$prev_id" != "$applied_id" ]]; then changed="true"; fi
  if [[ "$changed" == "true" ]]; then CHANGED_COUNT=1; else CHANGED_COUNT=0; fi

  if (( rc != 0 )) || [[ "$applied_id" != "$new_id" ]]; then
    WRITE_FAILED="template style: wanted default id=$new_id, read back ${applied_id:-<unreadable>}"
  fi

  TEMPLATE_JSON="{\"requested\":$(_jstr "$TEMPLATE_ARG")"
  TEMPLATE_JSON+=",\"before\":{\"styleId\":$(_jnum "${prev_id:-x}"),\"template\":$(_jstr "$prev_template")\
,\"title\":$(_jstr "$prev_title")}"
  TEMPLATE_JSON+=",\"after\":{\"styleId\":$(_jnum "${applied_id:-x}")\
,\"template\":$([[ -n "$applied_id" ]] && _jstr "$applied_template" || printf 'null')\
,\"title\":$([[ -n "$applied_id" ]] && _jstr "$applied_title" || printf 'null')}"
  TEMPLATE_JSON+=",\"changed\":$changed}"
}

# ---------- apply exactly the one toggle ----------

if [[ "$ACTION" == "set-template" ]]; then
  swap_template
else
  toggle_extensions
fi

# ---------- the mirror call that undoes this step ----------

# Reversibility is the agent's, not the script's: the step is undone by the
# opposite call, printed here so the agent never has to reconstruct it. It
# names only what this run actually moved — replaying a call that mirrors every
# requested item would move rows this step left alone.
build_reverse_call() {
  local flag eid args=""
  case "$ACTION" in
    disable) flag="--enable" ;;
    enable)  flag="--disable" ;;
    set-template)
      # Only when the default really moved; the previous style is named by id,
      # which is exact where a template name may cover several styles.
      if [[ -z "$TEMPLATE_NOT_APPLIED" && -n "$PREVIOUS_HOME_ID" \
            && "$PREVIOUS_HOME_ID" != "$TEMPLATE_APPLIED_ID" ]]; then
        printf 'diag-isolation-step.sh --label %s --set-template %s --page %s' \
          "$LABEL" "$PREVIOUS_HOME_ID" "$PAGE"
      else
        printf ''
      fi
      return 0 ;;
  esac
  if (( ${#CHANGED_IDS[@]} == 0 )); then
    printf ''
    return 0
  fi
  # Reversed by extension_id, not by the requested slug: one slug can name
  # several rows, and only some of them may have moved.
  for eid in "${CHANGED_IDS[@]}"; do
    args+=" $flag $eid"
  done
  printf 'diag-isolation-step.sh --label %s%s --page %s' "$LABEL" "$args" "$PAGE"
}

REVERSE_CALL="$(build_reverse_call)"

# ---------- probe results, empty until the probe runs ----------

PROBE_JSON='null'
MARKER_ENTRIES=()
MARKER_TOTAL=0

# ---------- findings, assembled from whatever is known so far ----------

TOGGLE_COUNTED_FROM="rows of ${DB_PREFIX}extensions whose extension_id or element matches a requested item"
MARKER_COUNTED_FROM="lines of this probe's page body matching PHP's error wording,"
MARKER_COUNTED_FROM+=" identical lines counted once; errorMarkers[] capped at $ERROR_ENTRY_CAP while"
MARKER_COUNTED_FROM+=" errorMarkerCount stays the true total"

# Called on the failing path too: a run that wrote some toggles and then failed
# still has to hand the agent the record of what it moved.
assemble_findings() {
  local findings changed_counted_from u
  findings='{'
  findings+="\"action\":$(_jstr "$ACTION")"
  findings+=",\"page\":$(_jstr "$PAGE")"

  # Written by both branches: a name that matched nothing is reported the same
  # way whether it named an extension or a template style.
  local unmatched_json=()
  for u in ${UNMATCHED[@]+"${UNMATCHED[@]}"}; do unmatched_json+=("$(_jstr "$u")"); done

  if [[ "$ACTION" == "set-template" ]]; then
    changed_counted_from="${DB_PREFIX}template_styles default (home) rows this run moved,"
    changed_counted_from+=" counted from the read-back after the write (0 or 1)"
    findings+=",\"templateSwap\":$TEMPLATE_JSON"
    findings+=",\"unmatched\":$(_join_json_array "${unmatched_json[@]+"${unmatched_json[@]}"}")"
  else
    changed_counted_from="rows of ${DB_PREFIX}extensions whose read-back enabled state"
    changed_counted_from+=" differs from the pre-write read"
    findings+=",\"toggles\":$(_join_json_array "${TOGGLE_ENTRIES[@]+"${TOGGLE_ENTRIES[@]}"}")"
    findings+=",\"requestedCount\":$(_jnum "${#ITEMS[@]}")"
    findings+=",\"matchedRowCount\":$(_jnum "$MATCHED_ROWS")"
    findings+=",\"countedFrom\":$(_jstr "$TOGGLE_COUNTED_FROM")"
    findings+=",\"unmatched\":$(_join_json_array "${unmatched_json[@]+"${unmatched_json[@]}"}")"
  fi

  findings+=",\"changedCount\":$(_jnum "$CHANGED_COUNT")"
  findings+=",\"changedCountedFrom\":$(_jstr "$changed_counted_from")"
  findings+=",\"reverseCall\":$([[ -n "$REVERSE_CALL" ]] && _jstr "$REVERSE_CALL" || printf 'null')"
  findings+=",\"probe\":$PROBE_JSON"
  findings+=",\"errorMarkers\":$(_join_json_array "${MARKER_ENTRIES[@]+"${MARKER_ENTRIES[@]}"}")"
  findings+=",\"errorMarkerCount\":$(_jnum "$MARKER_TOTAL")"
  findings+=",\"errorMarkersCountedFrom\":$(_jstr "$MARKER_COUNTED_FROM")"
  findings+='}'
  printf '%s' "$findings"
}

if [[ -n "$TEMPLATE_NOT_APPLIED" ]]; then
  # Nothing was written, so there is nothing to probe: the page would answer for
  # the state the copy already stood in, which no step of this run produced. The
  # tool ran to completion, so the envelope stays "ok" (ID-5) and the findings
  # say what was asked for and what the copy still holds.
  envelope_set_findings "$(assemble_findings)"
  emit_envelope_once
  exit 0
fi

if [[ -n "$WRITE_FAILED" ]]; then
  # Stop before the probe: probing a copy whose state is not the one asked for
  # would attribute the page's behaviour to a toggle that never took. The
  # findings still carry what was already applied, and the call that undoes it.
  envelope_set_findings "$(assemble_findings)"
  envelope_error "Toggle did not take — $WRITE_FAILED"
  emit_envelope_once
  exit 0
fi

# ---------- probe the page ----------

# ERROR_PATTERN / parse_error_lines / file_size / resolve_host_port /
# probe_page / cap_error_entries come from page-probe.sh.
resolve_host_port "$STACK_ENV"

BODY_FILE="$(mktemp)"
TEMP_FILES+=("$BODY_FILE")

# Seconds with three decimals, as curl reports them, become whole milliseconds:
# a probe's timing is only ever compared coarsely, step against step.
seconds_to_ms() {
  printf '%s' "$1" | awk '{ printf "%d", ($1 * 1000) + 0.5 }'
}

if [[ -z "$HOST_PORT" ]]; then
  envelope_unavailable "probe" "HOST_PORT not found in environment or $STACK_ENV"
else
  if probe_page "$LABEL" "$HOST_PORT" "$PAGE" "$BODY_FILE"; then
    BODY_BYTES="$(file_size "$BODY_FILE")"
    PROBE_JSON="{\"url\":$(_jstr "$PROBE_URL"),\"httpStatus\":$(_jnum "$PROBE_HTTP_CODE")"
    PROBE_JSON+=",\"bodyBytes\":$(_jnum "$BODY_BYTES")"
    PROBE_JSON+=",\"responseTimeMs\":$(_jnum "$(seconds_to_ms "${PROBE_TIME_TOTAL:-0}")")}"

    if [[ -s "$BODY_FILE" ]]; then
      while IFS= read -r entry; do
        if [[ -n "$entry" ]]; then MARKER_ENTRIES+=("$entry"); fi
      done < <(parse_error_lines < "$BODY_FILE")
    fi
    # Bounded so one runaway page cannot produce an unbounded envelope; the
    # count reported alongside always states the true total.
    cap_error_entries MARKER_ENTRIES
    MARKER_TOTAL=$ERROR_ENTRY_TOTAL
  fi
fi
rm -f "$BODY_FILE"

# ---------- emit ----------

envelope_set_findings "$(assemble_findings)"
emit_envelope_once

# ---------- smoke-run ----------
# Commands:
#   bash diag-isolation-step.sh --label <site-label> --disable com_example --page /
#   bash diag-isolation-step.sh --label <site-label> --enable com_example --page /
#   bash diag-isolation-step.sh --label <site-label> --set-template 5 --page /
#   bash diag-isolation-step.sh --label <site-label> --toggle-file /tmp/diag-toggle-<jobId>.json --page /
#     where that file holds {"disable":["ext-1","ext-2"]} or {"enable":[...]}
#
# Sources: /srv/tracy/<label>/webroot/configuration.php for the table prefix;
# the site's db container (<label>-db-1) over docker exec for every read and
# every write (copy only, D-04); /srv/tracy/<label>/.env for HOST_PORT; a
# loopback HTTP request to 127.0.0.1:<HOST_PORT><page> carrying
# Host: <label>.tracy.ai. No call ever leaves the host.
#
# One step per invocation: this script applies the one toggle it was given and
# probes once. Which extension to try next, and in what order, is the agent's
# strategy in playbook prose (D-11), never a loop in here.
#
# Expected top-level envelope keys:
#   schemaVersion ("1.0"), kind ("diag-isolation-step"), label, startedAt,
#   finishedAt, status ("ok"|"error"), findings, unavailable, error
#
# findings keys, every action:
#   .action                    "disable" | "enable" | "set-template"
#                              (a --toggle-file run reports the action its file named)
#   .page                      string (the probed path)
#   .changedCount              int — rows whose state actually moved
#   .changedCountedFrom        string (the bound of that count)
#   .reverseCall               string — the mirror invocation covering only the
#                              rows this run actually moved (extensions are
#                              named by extension_id there, a template style by
#                              its previous style id), or null when nothing
#                              moved and so nothing is left to undo
#   .probe                     object | null — null wholesale when HOST_PORT is
#                              unknown or the copy gave no HTTP answer
#   .probe.url                 string
#   .probe.httpStatus          int
#   .probe.bodyBytes           int
#   .probe.responseTimeMs      int
#   .errorMarkers[]            {message, file: string|null, line: int|null}
#   .errorMarkerCount          int — total parsed, even when the array is capped
#   .errorMarkersCountedFrom   string (the bound of that count)
#   .unmatched[]               the requested names no row carried — a template
#                              style name as well as an extension item (an item
#                              whose read failed is not one of these: it is
#                              reported in unavailable[], since nothing was
#                              established)
#
# findings keys, --disable / --enable / --toggle-file only:
#   .toggles[]                 {requested, matched, extensionId, name, type,
#                              element, folder, before:{enabled}, after:{enabled},
#                              changed} — one entry per matched row, plus one
#                              matched:false entry per item nothing matched
#   .requestedCount            int (items asked for)
#   .matchedRowCount           int (bound: rows of {prefix}extensions matched)
#   .countedFrom               string
#
# findings keys, --set-template only:
#   .templateSwap              {requested, before:{styleId, template, title},
#                              after:{styleId, template, title}, changed} —
#                              every after value is read back from the copy
#                              after the write, never carried over from the
#                              request; after is null wholesale when this run
#                              wrote nothing at all
#
# Mirror-call reversibility, demonstrated:
#   Run A: --disable com_example --page /   -> findings.toggles[0].extensionId 42,
#          .before.enabled 1, .after.enabled 0, .changed true, .reverseCall
#          "diag-isolation-step.sh --label <label> --enable 42 --page /"
#   Run B: run exactly that reverseCall     -> .before.enabled 0, .after.enabled 1,
#          .changed true, and the copy stands where it did before run A.
#   A row already in the asked-for state moves nothing, so it is not in that
#   call; when no row moved at all, .reverseCall is null.
#   Same for the template swap: run A reports .templateSwap.before.styleId <n>
#   and .reverseCall "... --set-template <n> --page /", which run B applies.
#
# Error cases (status "error", exit 0; findings {} unless noted):
#   Webroot missing            -> "Webroot not found: ..."
#   Config missing             -> "configuration.php not found in webroot"
#   Prefix undeterminable      -> "Cannot determine DB table prefix ..."
#   DB container inaccessible  -> "DB container not accessible: <label>-db-1"
#   Write did not take         -> "Toggle did not take — ..." (no probe follows,
#                                 because the copy is not in the asked-for state;
#                                 findings still carry the toggles applied before
#                                 the failure and the .reverseCall that undoes
#                                 them, with .probe null and .errorMarkers [])
#   Unexpected mid-run abort   -> "Run aborted unexpectedly (exit N); ..."
#
# Other cases (status "ok", exit 0):
#   Item matched nothing       -> a matched:false toggle entry and the item
#                                 listed in .unmatched — never counted as a
#                                 toggle that happened
#   No style matches           -> the name listed in .unmatched, .templateSwap
#                                 in its not-applied shape (after null, changed
#                                 false), nothing written, no probe follows —
#                                 the tool ran fine, so this is a finding, not
#                                 a tool failure
#   Copy has no site default   -> "templateSwap" in unavailable[] (a swap from
#                                 no recorded state could not be reversed),
#                                 nothing written, no probe follows,
#                                 .templateSwap in its not-applied shape
#   Language-scoped default    -> "templateSwap:languageDefaults" in
#                                 unavailable[]: the swap still moves the site
#                                 default, but a per-language default outranks
#                                 it at render time, so the probe cannot speak
#                                 for those languages
#   Probe unreachable          -> "probe" in unavailable[], .probe null
#
# Usage errors (nothing on stdout, exit 2 — "called wrong", as against "ran but
# failed", which is exit 0 with an envelope):
#   Missing --label or --page, --page not starting with "/", no toggle flag,
#   more than one toggle flag, unknown flag, unsafe toggle value, a
#   --toggle-file that is missing, empty, names neither list, or names both.
