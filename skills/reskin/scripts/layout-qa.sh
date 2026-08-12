#!/usr/bin/env bash
# layout-qa.sh — page-dimension QA tier of the Reskin pipeline (script #11).
# visual-qa asserts nav geometry; this one asserts the page's BOX MODEL:
#   section-overlap   in-flow siblings stacking on top of each other
#   parent-escape     children breaking out of their parent's width
#   collapsed-section a section with real content but no height
#   media-size        images/SVG taller than the viewport, wider than the page,
#                     or upscaled far past natural resolution (giant logos)
#   page-height       suspiciously short pages (an empty shell renders "fine")
#   drift             height/section-count change vs a saved baseline
# Plus a crawl mode: discovered internal pages are measured and REPORTED
# (not gated) — the trap-32 coverage hole, closed.
#
# Usage:
#   layout-qa.sh --host <public-host> --port <loopback-port> \
#                --pages "/,/pricing-stratum" \
#                [--crawl 15] [--min-height 500] [--baseline write|compare]
set -euo pipefail

HOST="" PORT="" PAGES="" CRAWL=0 MINH=500 BASE="off" OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --pages) PAGES="$2"; shift 2 ;;
    --crawl) CRAWL="$2"; shift 2 ;;
    --min-height) MINH="$2"; shift 2 ;;
    --baseline) BASE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$HOST" ] && [ -n "$PORT" ] && [ -n "$PAGES" ] || {
  echo "usage: layout-qa.sh --host <h> --port <n> --pages \"/a,/b\" [--crawl N] [--min-height N] [--baseline write|compare]" >&2
  exit 2
}
OUT="${OUT:-/opt/tracy-fleet/reskin/out/layout}"
mkdir -p "$OUT"

IMAGE="mcr.microsoft.com/playwright:v1.49.0-jammy"
DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE="/opt/tracy-fleet/reskin/.qa-cache"
mkdir -p "$CACHE"

docker run --rm --network host --memory 512m --shm-size 256m \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  -v "$DIR/layout-qa.mjs:/qa/layout-qa.mjs:ro" -v "$OUT:/qa/out" -v "$CACHE:/qa/node_modules" \
  -w /qa "$IMAGE" bash -lc '
    [ -d node_modules/playwright ] || npm install --no-save --loglevel=error playwright@1.49.0 >/dev/null 2>&1
    node layout-qa.mjs "'"$HOST"'" "'"$PORT"'" /qa/out "'"$PAGES"'" "'"$CRAWL"'" "'"$MINH"'" "'"$BASE"'"
  '
