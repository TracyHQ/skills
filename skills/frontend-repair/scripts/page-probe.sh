#!/usr/bin/env bash
# Shared page-probe helpers for C1 diagnostic scripts.
# One concern: asking a working copy for a page over loopback, and reading
# PHP's error wording back out of whatever text that produced.
# Source order: source result-envelope.sh and json-helpers.sh FIRST — the
# probe here calls envelope_unavailable and the parser calls
# _jstr / _jnum / _collapse_ws. Sourced as a library, so it sets no shell
# flags.

# PHP's own wording for a surfaced problem, in page output or container log.
ERROR_PATTERN='Fatal error|Parse error|Warning|Notice|Deprecated|Strict Standards|Uncaught|PHP message'

# How many parsed entries an envelope carries at most, so one runaway page
# cannot produce an unbounded document. The count beside the array always
# states the true total.
ERROR_ENTRY_CAP=100

# Caps an entry list at ERROR_ENTRY_CAP in place and reports what it held
# before the cap in ERROR_ENTRY_TOTAL, so the count an envelope carries is
# always the true total rather than the capped length. bash 3.2 has no
# namerefs, so the caller's array is reached by name; the cap cannot run in a
# command substitution, which would trim a copy in a subshell and leave the
# caller's array untouched.
#   cap_error_entries ENTRIES; TOTAL=$ERROR_ENTRY_TOTAL
ERROR_ENTRY_TOTAL=0
cap_error_entries() {
  local name="$1"
  eval "ERROR_ENTRY_TOTAL=\${#$name[@]}"
  if (( ERROR_ENTRY_TOTAL > ERROR_ENTRY_CAP )); then
    eval "$name=(\"\${$name[@]:0:\$ERROR_ENTRY_CAP}\")"
  fi
}

# The port the copy's stack publishes on the host: the job environment when the
# fleet set it, otherwise the stack's own .env file.
resolve_host_port() {
  local stack_env="$1"
  HOST_PORT="${HOST_PORT:-}"
  if [[ -z "$HOST_PORT" && -f "$stack_env" ]]; then
    HOST_PORT="$(sed -n 's/^HOST_PORT=//p' "$stack_env" | head -1 || true)"
  fi
}

# Asks the copy for one page over loopback, writing the body to the given file.
# Loopback with the public name in the Host header: the copy answers as itself
# without the request ever leaving the host.
# Sets PROBE_URL, PROBE_HTTP_CODE and PROBE_TIME_TOTAL (curl's seconds). When
# the copy gave no answer at all, records the honest miss, clears
# PROBE_HTTP_CODE and returns 1, so a caller can tell "no page" from "a page
# that answered badly" — the second is a finding, the first is not measurable.
#   probe_page "$LABEL" "$HOST_PORT" "$PAGE" "$BODY_FILE" || …
probe_page() {
  local label="$1" host_port="$2" page="$3" body_file="$4" out
  PROBE_URL="http://127.0.0.1:${host_port}${page}"
  out="$(curl -sS -o "$body_file" -w '%{http_code} %{time_total}' --max-time 60 \
    -H "Host: ${label}.tracy.ai" -H "X-Forwarded-Proto: https" \
    "$PROBE_URL" 2>/dev/null || true)"
  PROBE_HTTP_CODE="$(printf '%s' "$out" | awk '{print $1}')"
  PROBE_TIME_TOTAL="$(printf '%s' "$out" | awk '{print $2}')"
  if [[ -z "$PROBE_HTTP_CODE" || "$PROBE_HTTP_CODE" == "000" ]]; then
    envelope_unavailable "probe" "No HTTP response from $PROBE_URL"
    PROBE_HTTP_CODE=""
    return 1
  fi
  return 0
}

# Reads text on stdin, prints one JSON entry per matching line.
# Entry shape: {message, file, line} — file/line null when the text does not
# name them. Given a source name, each entry leads with {"source":…} instead,
# for callers that read more than one source into one list.
parse_error_lines() {
  local source="${1:-}"
  local source_field=""
  if [[ -n "$source" ]]; then
    source_field="\"source\":$(_jstr "$source"),"
  fi
  # The guarded grep keeps a no-match from failing the whole pipeline under
  # pipefail, which would otherwise abort a direct (non process-substitution) call.
  sed -e 's/<br[[:space:]]*\/*>/\n/g' -e 's/<[^>]*>//g' \
    | { grep -aE "$ERROR_PATTERN" || true; } \
    | awk '!seen[$0]++' \
    | while IFS= read -r raw; do
        local line file lineno
        # Collapse whitespace so the same error reads identically run to run.
        line="$(_collapse_ws "$raw")"
        if [[ -z "$line" ]]; then continue; fi
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
        printf '{%s"message":%s,"file":%s,"line":%s}\n' \
          "$source_field" \
          "$(_jstr "$line")" \
          "$([[ -n "$file" ]] && _jstr "$file" || printf 'null')" \
          "$(_jnum "${lineno:-x}")"
      done
}

file_size() { [[ -f "$1" ]] && wc -c < "$1" | tr -d ' ' || echo 0; }
