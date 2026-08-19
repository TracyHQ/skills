#!/usr/bin/env bash
# skin-diff.sh — the eyes tier: does the dressed page WEAR the demo's skin, and what does the
# pair look like side by side?
#
# Two runs, in this order:
#   1. skin-diff.sh --mode reference --host <DEMO host>   --port <demo port>   --pages "/,/features"
#   2. skin-diff.sh --mode compare   --host <CLIENT host> --port <client port> --pages "/,/what-we-do" --variant <slug>
#
# Pages pair BY POSITION in the two --pages lists — only the mapping knows the demo's
# /features became /what-we-do — and every pair is printed so a misalignment is visible
# rather than silently confident.
#
# It produces two things:
#   skin-diff.json    machine verdicts on what content cannot legitimately change: the demo's
#                     palette, its typeface, its container bands.
#   sheet-*.png       a contact sheet per page per viewport, demo on the left and the dressed
#                     page on the right, at the same width. This is the artifact for the step
#                     the skills used to describe as "your own eyes" and never gave a command.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
QA_HOME="${TRACY_QA_HOME:-/opt/tracy-fleet/reskin}"
PW_VERSION="${PW_VERSION:-1.49.0}"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v${PW_VERSION}-jammy}"

# design-qa carries the shared library (PNG codec, arg parsing, viewport table). The two
# skills are always installed together; the lookup makes the dependency explicit and its
# failure actionable instead of assuming a directory layout.
LIB=""
for cand in "${DESIGN_QA_SCRIPTS:-}" "$DIR/../../design-qa/scripts" "$QA_HOME/design-qa/scripts"; do
  [ -n "$cand" ] && [ -f "$cand/png.mjs" ] && { LIB="$(cd "$cand" && pwd)"; break; }
done
[ -n "$LIB" ] || {
  echo "skin-diff.sh: cannot find design-qa's png.mjs." >&2
  echo "  Install the design-qa skill beside this one, or point DESIGN_QA_SCRIPTS at its scripts/." >&2
  exit 2
}

OUT="" ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
OUT="${OUT:-$QA_HOME/out/skin}"
mkdir -p "$OUT"
CACHE="$QA_HOME/.qa-cache"
mkdir -p "$CACHE"

docker run --rm --network host --memory 512m --shm-size 256m \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 -e QA_LIB=/qa/lib/ \
  -v "$DIR:/qa/scripts:ro" -v "$LIB:/qa/lib:ro" -v "$OUT:/qa/out" -v "$CACHE:/qa/node_modules" \
  -w /qa "$IMAGE" bash -lc '
    set -euo pipefail
    pw_version="$1"; shift
    exec 9>/qa/node_modules/.install.lock
    flock 9
    [ -d /qa/node_modules/playwright ] || npm install --no-save --loglevel=error "playwright@${pw_version}" >/dev/null 2>&1
    flock -u 9
    exec node /qa/scripts/skin-diff.mjs "$@" --out /qa/out
  ' skin-diff "$PW_VERSION" ${ARGS[@]+"${ARGS[@]}"}
