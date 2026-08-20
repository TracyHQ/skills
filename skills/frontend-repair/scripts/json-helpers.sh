#!/usr/bin/env bash
# Shared JSON value helpers for C1 diagnostic scripts.
# Source order matters: source result-envelope.sh FIRST — the helpers here call
# its _re_json_escape. Sourced as a library, so it sets no shell flags.

# A JSON string literal, escaped.
_jstr() { printf '"%s"' "$(_re_json_escape "$1")"; }

# A JSON number, or null when the value is not a plain integer (e.g. the
# literal "NULL" a SQL batch client prints, or an unmatched capture).
_jnum() { [[ "$1" =~ ^-?[0-9]+$ ]] && printf '%s' "$1" || printf 'null'; }

# A JSON array from already-encoded elements; "[]" when there are none.
_join_json_array() {
  if [[ $# -eq 0 ]]; then
    printf '[]'
  else
    local IFS=','
    printf '[%s]' "$*"
  fi
}

# Collapses runs of whitespace to one space and trims both ends, so the same
# log line reads identically run to run wherever it is reported.
_collapse_ws() {
  printf '%s' "$1" | tr -s '[:space:]' ' ' | sed -e 's/^ //' -e 's/ $//'
}
