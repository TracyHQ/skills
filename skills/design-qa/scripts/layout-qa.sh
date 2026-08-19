#!/usr/bin/env bash
# layout-qa.sh — the BOX MODEL tier. A wrapper: the engine is `browser-qa.sh --tiers layout`,
# and the flags below are the ones this command has always taken, plus `--variant`, which it
# documented but never had.
#
# visual-qa asserts nav geometry; this one asserts the page's dimensions:
#   section-overlap   in-flow siblings stacking on top of each other
#   parent-escape     children breaking out of their parent's width
#   collapsed-section a section with real content but no height
#   media-size        images/SVG taller than the viewport, wider than the page, or upscaled
#                     far past natural resolution (giant logos)
#   content-measure   text nothing constrains — a full-bleed wall that never overflows
#   page-height       suspiciously short pages (an empty shell renders "fine")
#   drift             height/section-count change vs a saved baseline
# Plus a crawl mode: discovered internal pages are measured and REPORTED, not gated — they
# may still wear the old skin by design. When the crawl stops at the cap, the run says so.
#
# Usage:
#   layout-qa.sh --host <public-host> --port <loopback-port> --pages "/,/pricing-stratum" \
#                [--variant <slug>] [--crawl 15] [--min-height 500] \
#                [--baseline write|compare] [--out <dir>]
#
# --variant judges a PROPOSAL instead of the site, via the `X-Tracy-Variant` header. This
# tier accepted the flag nowhere and sent the header never, so a proposal run silently
# measured the live site and passed — which is the exact failure the skill warns about.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="" PORT="" PAGES="" CRAWL=0 MINH=500 BASE="off" OUT="" VARIANT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --pages) PAGES="$2"; shift 2 ;;
    --crawl) CRAWL="$2"; shift 2 ;;
    --min-height) MINH="$2"; shift 2 ;;
    --baseline) BASE="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$HOST" ] && [ -n "$PORT" ] && [ -n "$PAGES" ] || {
  echo "usage: layout-qa.sh --host <h> --port <n> --pages \"/a,/b\" [--variant s] [--crawl N] [--min-height N] [--baseline write|compare]" >&2
  exit 2
}
OUT="${OUT:-${TRACY_QA_HOME:-/opt/tracy-fleet/reskin}/out/layout}"

exec "$DIR/browser-qa.sh" --tiers layout \
  --host "$HOST" --port "$PORT" --pages "$PAGES" --out "$OUT" \
  --crawl "$CRAWL" --min-height "$MINH" --baseline "$BASE" \
  ${VARIANT:+--variant "$VARIANT"}
