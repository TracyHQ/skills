#!/usr/bin/env bash
# Shared result-envelope helper for C1 diagnostic scripts.
# Source this file, then call envelope_init / envelope_set_findings /
# envelope_unavailable / envelope_error / envelope_emit.
# Run directly (not sourced) for a demo envelope.

# C0 control characters that JSON has no short escape for. NUL cannot appear in
# a shell string, so the set starts at U+0001; \n, \r and \t are handled above.
_RE_CTRL_CHARS=$'\x01\x02\x03\x04\x05\x06\x07\x08\x0b\x0c\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f'

_re_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  # Runs last so the backslashes introduced here are not re-escaped.
  local i ch code
  for (( i = 0; i < ${#_RE_CTRL_CHARS}; i++ )); do
    ch="${_RE_CTRL_CHARS:i:1}"
    [[ "$s" == *"$ch"* ]] || continue
    printf -v code '\\u%04x' "'$ch"
    s="${s//"$ch"/$code}"
  done
  printf '%s' "$s"
}

envelope_init() {
  local kind="$1" label="$2"
  _RE_KIND="$kind"
  _RE_LABEL="$label"
  _RE_STARTED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  _RE_STATUS="ok"
  _RE_FINDINGS='{}'
  _RE_UNAVAIL_N=0
  _RE_UNAVAIL_JSON=''
  _RE_ERROR='null'
}

envelope_set_findings() {
  _RE_FINDINGS="$1"
}

envelope_unavailable() {
  local part="$1" reason="$2"
  local ep er
  ep=$(_re_json_escape "$part")
  er=$(_re_json_escape "$reason")
  local entry="{\"part\":\"$ep\",\"reason\":\"$er\"}"
  if (( _RE_UNAVAIL_N == 0 )); then
    _RE_UNAVAIL_JSON="$entry"
  else
    _RE_UNAVAIL_JSON="${_RE_UNAVAIL_JSON},$entry"
  fi
  (( _RE_UNAVAIL_N++ )) || true
}

envelope_error() {
  local msg="$1"
  _RE_STATUS="error"
  local em
  em=$(_re_json_escape "$msg")
  _RE_ERROR="\"$em\""
}

envelope_emit() {
  local finished
  finished=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local unavail
  if (( _RE_UNAVAIL_N > 0 )); then
    unavail="[${_RE_UNAVAIL_JSON}]"
  else
    unavail='[]'
  fi
  local ek el
  ek=$(_re_json_escape "$_RE_KIND")
  el=$(_re_json_escape "$_RE_LABEL")
  printf '{"schemaVersion":"0.1-draft","kind":"%s","label":"%s","startedAt":"%s","finishedAt":"%s","status":"%s","findings":%s,"unavailable":%s,"error":%s}\n' \
    "$ek" "$el" "$_RE_STARTED" "$finished" "$_RE_STATUS" "$_RE_FINDINGS" "$unavail" "$_RE_ERROR"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  # Guarded only on the runnable path: this file is sourced as a library, so
  # these flags must not leak into callers.
  set -euo pipefail
  envelope_init "demo" "demo-site"
  envelope_set_findings '{"exampleCount":0}'
  envelope_emit
fi
