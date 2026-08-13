#!/usr/bin/env bash
# responsive-qa.sh — differential responsive QA (script #12), the twin of
# layout-qa. layout-qa asks "are the boxes sane?"; this one asks "does the
# dressed site respond the way the DEMO responds?" — because the demo is the
# living definition of correct behaviour for its own template.
#
# Two runs, always in this order:
#   1. --mode reference --host <DEMO host> --port <demo port>
#      Extracts a per-block-type responsive signature (columns, heading size,
#      horizontal overflow, nav collapse, footer columns) at 375/768/1024/1440
#      and saves it as the reference.
#   2. --mode compare --host <CLIENT host> --port <client port>
#      Judges the dressed copy against that reference. A block that stacks 3
#      columns at 375px where the demo stacks 1 is a FAIL; behaviour the demo
#      shares is not a defect of the dress.
#
# Both runs write into the same --out dir (the reference lives there).
#
# Usage:
#   responsive-qa.sh --mode reference --host <demo-host> --port <demo-port> --pages "/,/features"
#   responsive-qa.sh --mode compare  --host <client-host> --port <client-port> --pages "/,/faq"
set -euo pipefail

MODE="" HOST="" PORT="" PAGES="" OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --pages) PAGES="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
case "$MODE" in
  reference) JSMODE=write ;;
  compare) JSMODE=compare ;;
  *) echo "usage: responsive-qa.sh --mode reference|compare --host <h> --port <n> --pages \"/a,/b\"" >&2; exit 2 ;;
esac
[ -n "$HOST" ] && [ -n "$PORT" ] && [ -n "$PAGES" ] || {
  echo "usage: responsive-qa.sh --mode reference|compare --host <h> --port <n> --pages \"/a,/b\"" >&2
  exit 2
}
OUT="${OUT:-/opt/tracy-fleet/reskin/out/responsive}"
mkdir -p "$OUT"

IMAGE="mcr.microsoft.com/playwright:v1.49.0-jammy"
DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE="/opt/tracy-fleet/reskin/.qa-cache"
mkdir -p "$CACHE"

docker run --rm --network host --memory 512m --shm-size 256m \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  -v "$DIR/responsive-qa.mjs:/qa/responsive-qa.mjs:ro" -v "$OUT:/qa/out" -v "$CACHE:/qa/node_modules" \
  -w /qa "$IMAGE" bash -lc '
    [ -d node_modules/playwright ] || npm install --no-save --loglevel=error playwright@1.49.0 >/dev/null 2>&1
    node responsive-qa.mjs "'"$HOST"'" "'"$PORT"'" /qa/out "'"$PAGES"'" "'"$JSMODE"'"
  '
