#!/usr/bin/env bash
#
# Every check this skill can make about itself, in one command.
#
# The scripts here decide what a customer is told about their own site, and until now the only
# tests covering them lived in a private repository belonging to one vendor. A skill installed
# from a registry has to be verifiable by whoever installed it, so they live here too.
#
#   skills/joomla-readiness/tests/run.sh
#
# Python 3 only, no pytest, no network. `test_catalog.py` stubs its fetch rather than reaching
# registry.tracy.ai, so this runs on a machine with no internet and in CI without a secret.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

fail=0
for t in "$HERE"/test_*.py; do
  name="$(basename "$t")"
  out="$(python3 "$t" 2>&1)"; rc=$?      # read rc BEFORE anything else clobbers it
  last="$(printf '%s' "$out" | tail -1)"
  if [ "$rc" -ne 0 ] || printf '%s' "$out" | grep -q "  FAIL  "; then
    printf '%-26s %s\n' "$name" "$last"
    printf '%s\n' "$out" | grep "  FAIL  "
    fail=1
  else
    printf '%-26s %s\n' "$name" "$last"
  fi
done
exit "$fail"
