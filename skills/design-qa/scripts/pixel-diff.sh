#!/usr/bin/env bash
# pixel-diff.sh — visual regression: the same page, before and after a change.
#
# Unlike every other gate here this one needs NO browser: it reads two directories of PNGs
# that `visual-qa` already wrote. So it runs directly on the host when a node is available,
# and borrows the QA container's node only when one is not — no Chromium, no page loads, a
# second or two for a whole site instead of a minute.
#
# Usage:
#   pixel-diff.sh --before <baseline-dir> --after <fresh-dir> [--out <dir>] \
#                 [--threshold 0.5] [--accept yes]
#
#   --accept yes   promote the fresh render to the new baseline, AFTER you have looked at
#                  out/diff-*.png. Red is what moved; grey is what did not.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
QA_HOME="${TRACY_QA_HOME:-/opt/tracy-fleet/reskin}"
PW_VERSION="${PW_VERSION:-1.49.0}"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v${PW_VERSION}-jammy}"

BEFORE="" AFTER="" OUT="" ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --before) BEFORE="$2"; ARGS+=("$1" "$2"); shift 2 ;;
    --after) AFTER="$2"; ARGS+=("$1" "$2"); shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
[ -n "$BEFORE" ] && [ -n "$AFTER" ] || {
  echo "usage: pixel-diff.sh --before <baseline-dir> --after <fresh-dir> [--out dir] [--threshold 0.5] [--accept yes]" >&2
  exit 2
}
OUT="${OUT:-$QA_HOME/out/pixel}"
mkdir -p "$OUT" "$BEFORE"

if command -v node >/dev/null 2>&1; then
  exec node "$DIR/pixel-diff.mjs" ${ARGS[@]+"${ARGS[@]}"} --out "$OUT"
fi

# No node on the host: reuse the QA image, which has one. Nothing is installed — this script
# imports only node:zlib, which is why it can run in a bare image with no node_modules at all.
# Arguments go in as positional parameters, never spliced into the inner shell's program text.
docker run --rm \
  -v "$DIR:/qa/scripts:ro" -v "$OUT:/qa/out" -v "$BEFORE:/qa/before" -v "$AFTER:/qa/after:ro" \
  -w /qa "$IMAGE" bash -lc '
    shift_args=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --before) shift_args+=(--before /qa/before); shift 2 ;;
        --after) shift_args+=(--after /qa/after); shift 2 ;;
        *) shift_args+=("$1"); shift ;;
      esac
    done
    exec node /qa/scripts/pixel-diff.mjs "${shift_args[@]}" --out /qa/out
  ' pixel-diff ${ARGS[@]+"${ARGS[@]}"}
