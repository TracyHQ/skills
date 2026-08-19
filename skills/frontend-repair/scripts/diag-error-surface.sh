#!/usr/bin/env bash
# diag-error-surface — turn error display on or off on a working copy, and
# (with --state on) probe a page so the copy speaks its errors out loud.
# Usage: diag-error-surface.sh --label <site-label> --state on|off [--page <path>]
# Copy-only (D-04): the single config write touches /srv/tracy/<label>/webroot
# only. Both states are reachable deterministically (D-40); WHEN to switch is
# playbook prose, never this script's business.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/result-envelope.sh"
source "$SCRIPT_DIR/json-helpers.sh"

usage() {
  echo "Usage: diag-error-surface.sh --label <site-label> --state on|off [--page <path>]" >&2
}

# ---------- arg parsing ----------

LABEL=""
STATE=""
PAGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --label)
      # "Called wrong" (exit 2, no JSON) is deliberately distinct from "ran but
      # failed" (exit 0, envelope with status "error"): a bare flag means no run
      # ever happened, so there is nothing to report on.
      if [ $# -lt 2 ]; then usage; exit 2; fi
      LABEL="$2"; shift 2 ;;
    --state)
      if [ $# -lt 2 ]; then usage; exit 2; fi
      STATE="$2"; shift 2 ;;
    --page)
      if [ $# -lt 2 ]; then usage; exit 2; fi
      PAGE="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$LABEL" || -z "$STATE" ]]; then usage; exit 2; fi
if [[ "$STATE" != "on" && "$STATE" != "off" ]]; then
  echo "Invalid --state: $STATE (expected on|off)" >&2
  usage
  exit 2
fi
# The page is the probe that makes the broken page speak, so it is required
# with "on" and carries no meaning with "off".
if [[ "$STATE" == "on" && -z "$PAGE" ]]; then
  echo "--page is required with --state on" >&2
  usage
  exit 2
fi
if [[ "$STATE" == "on" && "$PAGE" != /* ]]; then
  echo "--page must start with /: $PAGE" >&2
  usage
  exit 2
fi

WEBROOT="/srv/tracy/$LABEL/webroot"
CONFIG="$WEBROOT/configuration.php"
STACK_ENV="/srv/tracy/$LABEL/.env"
WEB_CONTAINER="${LABEL}-web-1"
JOOMLA_LOG="$WEBROOT/administrator/logs/error.php"
# Set only when the copy's configured log_path could not be mapped to a host
# path, so a missing-log reason can name the path that was actually asked for.
JOOMLA_LOG_CONFIGURED=""

# ---------- one envelope, whatever happens after init ----------

ENVELOPE_READY=0
ENVELOPE_EMITTED=0
TEMP_FILES=()

emit_envelope_once() {
  (( ENVELOPE_EMITTED == 1 )) && return 0
  ENVELOPE_EMITTED=1
  envelope_emit
}

# An unforeseen mid-run failure would otherwise leave the copy half-switched
# and print nothing at all — neither a result nor a reason. Usage errors exit
# before the envelope exists and stay silent by design.
on_exit() {
  local rc=$?
  local f
  for f in ${TEMP_FILES[@]+"${TEMP_FILES[@]}"}; do
    [[ -n "$f" ]] && rm -f "$f"
  done
  if (( rc != 0 && ENVELOPE_READY == 1 && ENVELOPE_EMITTED == 0 )); then
    envelope_error "Run aborted unexpectedly (exit $rc); the copy's config may be half-switched"
    emit_envelope_once
    exit 0
  fi
}
trap on_exit EXIT

envelope_init "diag-error-surface" "$LABEL"
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

if [[ ! -w "$CONFIG" ]]; then
  envelope_error "configuration.php is not writable: $CONFIG"
  emit_envelope_once
  exit 0
fi

# ---------- configuration.php read/write ----------

# Returns the raw right-hand side of `public $<key> = ...;`, last definition
# wins — the same rule PHP itself applies to a repeated property assignment.
read_config_value() {
  local key="$1"
  sed -nE "s|^[[:space:]]*public[[:space:]]+\\\$$key[[:space:]]*=[[:space:]]*(.*);[[:space:]]*\$|\1|p" \
    "$CONFIG" | tail -1
}

# Strips the surrounding quotes of a PHP scalar literal so findings carry the
# value, not its source spelling.
unquote() {
  local v="$1"
  v="${v#\'}"; v="${v%\'}"
  v="${v#\"}"; v="${v%\"}"
  printf '%s' "$v"
}

set_config_value() {
  local key="$1" literal="$2" tmp
  tmp="$(mktemp)"
  TEMP_FILES+=("$tmp")
  if grep -qE "^[[:space:]]*public[[:space:]]+\\\$$key[[:space:]]*=" "$CONFIG"; then
    sed -E "s|^([[:space:]]*public[[:space:]]+\\\$$key[[:space:]]*=[[:space:]]*).*\$|\1$literal;|" \
      "$CONFIG" > "$tmp"
  else
    # Insert before the class's closing brace so an older config that never
    # carried the key still ends up with it.
    awk -v newline="	public \$$key = $literal;" '
      { lines[NR] = $0 }
      END {
        last = 0
        for (i = NR; i >= 1; i--) {
          if (lines[i] ~ /^[[:space:]]*}[[:space:]]*$/) { last = i; break }
        }
        for (i = 1; i <= NR; i++) {
          if (i == last) print newline
          print lines[i]
        }
        if (last == 0) print newline
      }' "$CONFIG" > "$tmp"
  fi
  # Written through cat, not mv, so the file keeps its own owner and mode.
  cat "$tmp" > "$CONFIG"
  rm -f "$tmp"
}

# ---------- where this copy keeps its Joomla log ----------

# The configured log_path is a container-internal path while this script runs
# host-side, so it is usable only when its tail can be found under the webroot.
map_container_path_to_host() {
  local rel="${1#/}"
  while [[ -n "$rel" ]]; do
    if [[ -d "$WEBROOT/$rel" ]]; then
      printf '%s' "$WEBROOT/$rel"
      return 0
    fi
    [[ "$rel" == */* ]] || break
    rel="${rel#*/}"
  done
  return 1
}

CONFIGURED_LOG_PATH="$(unquote "$(read_config_value "log_path")")"
if [[ -n "$CONFIGURED_LOG_PATH" ]]; then
  if MAPPED_LOG_DIR="$(map_container_path_to_host "$CONFIGURED_LOG_PATH")"; then
    JOOMLA_LOG="$MAPPED_LOG_DIR/error.php"
  elif [[ "$CONFIGURED_LOG_PATH" != */administrator/logs ]]; then
    JOOMLA_LOG_CONFIGURED="$CONFIGURED_LOG_PATH"
  fi
fi

# ---------- error parsing ----------

# PHP's own wording for a surfaced problem, in page output or container log.
ERROR_PATTERN='Fatal error|Parse error|Warning|Notice|Deprecated|Strict Standards|Uncaught|PHP message'

# Joomla writes tab-separated log lines: datetime, priority, clientip,
# category, message. Only the error-ish priorities are countable errors —
# INFO/DEBUG/NOTICE entries are the copy narrating itself, not a defect.
JOOMLA_ERROR_PRIORITY_RE='^(EMERGENCY|ALERT|CRITICAL|ERROR|WARNING)$'

joomla_line_is_error() {
  local prio
  prio="$(printf '%s\n' "$1" | awk -F'\t' '{print $2}')"
  # A line in some other layout carries no priority to judge by, so it is kept
  # rather than silently dropped; countedFrom says so.
  [[ -z "$prio" ]] && return 0
  [[ "$prio" =~ $JOOMLA_ERROR_PRIORITY_RE ]]
}

# Reads text on stdin, prints one JSON entry per matching line.
# Entry shape: {source, message, file, line} — file/line null when the text
# does not name them.
parse_error_lines() {
  local source="$1"
  # The guarded grep keeps a no-match from failing the whole pipeline under
  # pipefail, which would otherwise abort a direct (non process-substitution) call.
  sed -e 's/<br[[:space:]]*\/*>/\n/g' -e 's/<[^>]*>//g' \
    | { grep -aE "$ERROR_PATTERN" || true; } \
    | awk '!seen[$0]++' \
    | while IFS= read -r raw; do
        local line file lineno
        # Collapse whitespace so the same error reads identically run to run.
        line="$(_collapse_ws "$raw")"
        [[ -z "$line" ]] && continue
        # PHP writes the origin two ways: "in <file> on line <n>" and
        # "in <file>:<n>". Matched separately — a single alternation group is
        # not portable across the seds this may run under.
        file="$(printf '%s' "$line" | sed -nE 's|.* in (/[^ :]+\.php) on line [0-9]+.*|\1|p')"
        if [[ -z "$file" ]]; then
          file="$(printf '%s' "$line" | sed -nE 's|.* in (/[^ :]+\.php):[0-9]+.*|\1|p')"
        fi
        lineno="$(printf '%s' "$line" | sed -nE 's|.* in /[^ :]+\.php on line ([0-9]+).*|\1|p')"
        if [[ -z "$lineno" ]]; then
          lineno="$(printf '%s' "$line" | sed -nE 's|.* in /[^ :]+\.php:([0-9]+).*|\1|p')"
        fi
        printf '{"source":%s,"message":%s,"file":%s,"line":%s}\n' \
          "$(_jstr "$source")" "$(_jstr "$line")" \
          "$([[ -n "$file" ]] && _jstr "$file" || printf 'null')" \
          "$(_jnum "${lineno:-x}")"
      done
}

file_size() { [[ -f "$1" ]] && wc -c < "$1" | tr -d ' ' || echo 0; }

# ---------- apply the state ----------

# "off" writes 'none', never 'default': 'default' hands the decision to the
# server's php.ini and so cannot guarantee a page rendering without debug
# output, which is the whole point of the off state (D-40).
if [[ "$STATE" == "on" ]]; then
  WANT_REPORTING="maximum"
  WANT_DEBUG="true"
else
  WANT_REPORTING="none"
  WANT_DEBUG="false"
fi

# Byte offset and clock taken before the write, so "errors this probe produced"
# never includes what was already sitting in the log.
JOOMLA_LOG_OFFSET="$(file_size "$JOOMLA_LOG")"
SINCE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

set_config_value "error_reporting" "'$WANT_REPORTING'"
set_config_value "debug" "$WANT_DEBUG"

APPLIED_REPORTING="$(unquote "$(read_config_value "error_reporting")")"
APPLIED_DEBUG="$(unquote "$(read_config_value "debug")")"

# Readable is not enough: the values read back must be the ones asked for, or
# the state this run claims to have applied is fiction.
if [[ "$APPLIED_REPORTING" != "$WANT_REPORTING" || "$APPLIED_DEBUG" != "$WANT_DEBUG" ]]; then
  envelope_error "Config write did not take: wanted error_reporting=$WANT_REPORTING debug=$WANT_DEBUG, read back error_reporting=${APPLIED_REPORTING:-<unreadable>} debug=${APPLIED_DEBUG:-<unreadable>}"
  emit_envelope_once
  exit 0
fi

# ---------- probe (state on only) ----------

ERROR_ENTRIES=()
ERROR_TOTAL=0
PROBE_JSON='null'
LOGTAIL_JSON='null'
CONTAINER_LOG=""

if [[ "$STATE" == "on" ]]; then
  HOST_PORT="${HOST_PORT:-}"
  if [[ -z "$HOST_PORT" && -f "$STACK_ENV" ]]; then
    HOST_PORT="$(sed -n 's/^HOST_PORT=//p' "$STACK_ENV" | head -1 || true)"
  fi

  BODY_FILE="$(mktemp)"
  TEMP_FILES+=("$BODY_FILE")
  HTTP_CODE=""

  if [[ -z "$HOST_PORT" ]]; then
    envelope_unavailable "probe" "HOST_PORT not found in environment or $STACK_ENV"
  else
    PROBE_URL="http://127.0.0.1:${HOST_PORT}${PAGE}"
    # Loopback with the public name in the Host header: the copy answers as
    # itself without the request ever leaving the host.
    HTTP_CODE="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' --max-time 60 \
      -H "Host: ${LABEL}.tracy.ai" -H "X-Forwarded-Proto: https" \
      "$PROBE_URL" 2>/dev/null || true)"
    if [[ -z "$HTTP_CODE" || "$HTTP_CODE" == "000" ]]; then
      envelope_unavailable "probe" "No HTTP response from $PROBE_URL"
      HTTP_CODE=""
    else
      BODY_BYTES="$(file_size "$BODY_FILE")"
      PROBE_JSON="{\"url\":$(_jstr "$PROBE_URL"),\"httpStatus\":$(_jnum "$HTTP_CODE")"
      PROBE_JSON+=",\"bodyBytes\":$(_jnum "$BODY_BYTES")}"
    fi
  fi

  # Source 1 — what the page itself printed.
  if [[ -s "$BODY_FILE" ]]; then
    while IFS= read -r entry; do
      [[ -n "$entry" ]] && ERROR_ENTRIES+=("$entry")
    done < <(parse_error_lines "page" < "$BODY_FILE")
  fi
  rm -f "$BODY_FILE"

  # Source 2 — PHP/web-server output, which these images send to the
  # container's stderr rather than to a file in the webroot. Judged on docker's
  # exit status, never on the wording of its complaint: a failure read as log
  # content would be parsed as site errors and then reported as a real zero.
  DOCKER_LOG_OUTPUT=""
  if DOCKER_LOG_OUTPUT="$(docker logs --since "$SINCE" "$WEB_CONTAINER" 2>&1)"; then
    CONTAINER_LOG="$DOCKER_LOG_OUTPUT"
  else
    envelope_unavailable "phpLog" "Web container log not readable ($WEB_CONTAINER): $(_collapse_ws "$DOCKER_LOG_OUTPUT")"
    CONTAINER_LOG=""
  fi
  if [[ -n "$CONTAINER_LOG" ]]; then
    while IFS= read -r entry; do
      [[ -n "$entry" ]] && ERROR_ENTRIES+=("$entry")
    done < <(printf '%s\n' "$CONTAINER_LOG" | parse_error_lines "phpLog")
  fi

  # Source 3 — Joomla's own log, read from the byte where it stood before the
  # write, so only this probe's lines count.
  if [[ -f "$JOOMLA_LOG" ]]; then
    JOOMLA_NEW="$(tail -c "+$((JOOMLA_LOG_OFFSET + 1))" "$JOOMLA_LOG" 2>/dev/null || true)"
    if [[ -n "$JOOMLA_NEW" ]]; then
      while IFS= read -r raw; do
        [[ -z "$raw" || "$raw" == \#* ]] && continue
        joomla_line_is_error "$raw" || continue
        collapsed="$(_collapse_ws "$raw")"
        [[ -z "$collapsed" ]] && continue
        ERROR_ENTRIES+=("{\"source\":$(_jstr "joomlaLog"),\"message\":$(_jstr "$collapsed"),\"file\":null,\"line\":null}")
      done < <(printf '%s\n' "$JOOMLA_NEW" | awk '!seen[$0]++')
    fi
  elif [[ -n "$JOOMLA_LOG_CONFIGURED" ]]; then
    envelope_unavailable "joomlaLog" "Joomla log not found: $JOOMLA_LOG (the copy's configured log_path $JOOMLA_LOG_CONFIGURED is a container path with no counterpart under this webroot)"
  else
    envelope_unavailable "joomlaLog" "Joomla log not found: $JOOMLA_LOG"
  fi

  ERROR_TOTAL=${#ERROR_ENTRIES[@]}
  # Bounded so one runaway page cannot produce an unbounded envelope; the
  # count above always states the true total.
  if (( ERROR_TOTAL > 100 )); then
    ERROR_ENTRIES=("${ERROR_ENTRIES[@]:0:100}")
  fi

  # A short tail of each source, for the reader's eyes rather than for counting.
  tail_json() {
    local text="$1" items=() ln collapsed
    while IFS= read -r ln; do
      collapsed="$(_collapse_ws "$ln")"
      [[ -z "$collapsed" ]] && continue
      items+=("$(_jstr "$collapsed")")
    done <<< "$text"
    _join_json_array "${items[@]+"${items[@]}"}"
  }
  PHP_TAIL='[]'
  if [[ -n "$CONTAINER_LOG" ]]; then
    PHP_TAIL="$(tail_json "$(printf '%s\n' "$CONTAINER_LOG" | tail -n 50)")"
  fi
  JOOMLA_TAIL='[]'
  if [[ -f "$JOOMLA_LOG" ]]; then
    JOOMLA_TAIL="$(tail_json "$(tail -n 50 "$JOOMLA_LOG" | { grep -av '^#' || true; })")"
  fi
  LOGTAIL_JSON="{\"phpLog\":$PHP_TAIL,\"joomlaLog\":$JOOMLA_TAIL}"
fi

# ---------- assemble findings ----------

COUNTED_FROM="page body and phpLog lines matching PHP's error wording, plus joomlaLog lines"
COUNTED_FROM+=" at priority EMERGENCY/ALERT/CRITICAL/ERROR/WARNING (a line in another layout is kept),"
COUNTED_FROM+=" all of them written during this probe; identical lines within one source counted once;"
COUNTED_FROM+=" errors[] capped at 100 while errorCount stays the true total"

FINDINGS='{'
FINDINGS+="\"state\":$(_jstr "$STATE")"
FINDINGS+=",\"applied\":{\"errorReporting\":$(_jstr "$APPLIED_REPORTING")"
FINDINGS+=",\"debug\":$(_jstr "$APPLIED_DEBUG")"
FINDINGS+=",\"configPath\":$(_jstr "$CONFIG")}"

if [[ "$STATE" == "on" ]]; then
  FINDINGS+=",\"page\":$(_jstr "$PAGE")"
  FINDINGS+=",\"probe\":$PROBE_JSON"
  FINDINGS+=",\"errors\":$(_join_json_array "${ERROR_ENTRIES[@]+"${ERROR_ENTRIES[@]}"}")"
  FINDINGS+=",\"errorCount\":$(_jnum "$ERROR_TOTAL")"
  FINDINGS+=",\"countedFrom\":$(_jstr "$COUNTED_FROM")"
  FINDINGS+=",\"logTail\":$LOGTAIL_JSON"
fi

FINDINGS+='}'

envelope_set_findings "$FINDINGS"
emit_envelope_once

# ---------- smoke-run ----------
# Commands:
#   bash diag-error-surface.sh --label <site-label> --state on --page /
#   bash diag-error-surface.sh --label <site-label> --state off
#
# Sources: /srv/tracy/<label>/webroot/configuration.php (the one config write,
# D-10 — copy only, D-04); /srv/tracy/<label>/.env for HOST_PORT; a loopback
# HTTP request to 127.0.0.1:<HOST_PORT><page> carrying Host: <label>.tracy.ai;
# `docker logs` of <label>-web-1 since the write; the copy's own Joomla log
# (the configured log_path when it maps under the webroot, otherwise
# administrator/logs/error.php). No call ever leaves the host.
#
# Expected top-level envelope keys:
#   schemaVersion ("0.1-draft"), kind ("diag-error-surface"), label, startedAt,
#   finishedAt, status ("ok"|"error"), findings, unavailable, error
#
# findings keys, both states:
#   .state                    "on" | "off"
#   .applied.errorReporting   string — read back from the config and verified
#                             against the request ("maximum" on, "none" off)
#   .applied.debug            string — "true" for on, "false" for off
#   .applied.configPath       string
#
# findings keys, state on only:
#   .page                     string (the requested path)
#   .probe                    object | null — null wholesale when HOST_PORT is
#                             unknown or the copy gave no HTTP answer
#   .probe.url                string
#   .probe.httpStatus         int
#   .probe.bodyBytes          int
#   .errors[]                 {source: "page"|"phpLog"|"joomlaLog", message,
#                             file: string|null, line: int|null}
#   .errorCount               int — total parsed, even when errors[] is capped
#   .countedFrom              string (the bound of that count)
#   .logTail.phpLog[]         up to the last 50 container log lines written
#                             since the config write, whitespace-collapsed
#   .logTail.joomlaLog[]      up to the last 50 lines of the whole Joomla log
#                             minus its "#" header lines — the whole file, not
#                             only the probe window as .errors[] is — collapsed
#
# A source that could not be read is listed in unavailable[] and never reported
# as a real zero: probe (no HOST_PORT, or no HTTP answer), phpLog (`docker
# logs` exited non-zero — its own message goes in the reason, never into
# errors[] or logTail), joomlaLog (log file absent).
#
# Error cases (status "error", findings {}, exit 0):
#   Webroot missing            -> "Webroot not found: ..."
#   Config missing             -> "configuration.php not found in webroot"
#   Config not writable        -> "configuration.php is not writable: ..."
#   Write did not take         -> "Config write did not take: wanted ... read back ..."
#   Unexpected mid-run abort   -> "Run aborted unexpectedly (exit N): ..."
#
# Usage errors (nothing on stdout, exit 2 — "called wrong", as against "ran but
# failed", which is exit 0 with an envelope):
#   Missing --label / --state, --state not on|off, --page missing or not
#   starting with "/" when --state on, unknown flag.
#
# Round trip: `--state on --page /` then `--state off` leaves the copy at
# error_reporting "none" and debug "false", i.e. rendering with no debug output
# whatever the server's php.ini says, which is what phase-7 regression and
# phase-8 preview require (D-40).
