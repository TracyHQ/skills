#!/usr/bin/env bash
# visual-qa.sh — the geometry + behaviour + assets tier. A wrapper: the engine is
# `browser-qa.sh --tiers visual`, and the flags below are exactly the ones this command has
# always taken, so every existing caller keeps working.
#
# Renders each page in headless Chromium at desktop/tablet/mobile and asserts: horizontal
# overflow, nav items overlapping, edge bleed, clipped labels, broken images, this site's own
# assets answering 4xx/5xx (CSS backgrounds included — <img> checks never saw those), and
# uncaught JS errors. Then it PRESSES the page: a mobile toggler must reveal a menu, an
# `aria-expanded` control must flip. Full-page screenshots land next to the JSON.
#
# Spec: ../references/qa-scans.md (link scan, accessibility, the geometry gate)
#
# Usage:
#   visual-qa.sh --host <public-host> --port <loopback-port> \
#                --pages "/,/pricing-stratum,/blog/" [--out <dir>] [--variant <slug>]
#
# --variant judges a PROPOSAL instead of the site: the same container and port, with the
# `X-Tracy-Variant` header that decides which database it reads (ADR 0044). Judging a proposal
# through the site's own address would grade the wrong thing and pass.
#
# Running this tier alongside the others? Call `browser-qa.sh --tiers visual,layout` once
# instead of two commands — each page is then rendered once, not twice.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="" PORT="" PAGES="" OUT="" VARIANT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --pages) PAGES="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$HOST" ] && [ -n "$PORT" ] && [ -n "$PAGES" ] || {
  echo "usage: visual-qa.sh --host <h> --port <n> --pages \"/a,/b\" [--out dir] [--variant s]" >&2
  exit 2
}
OUT="${OUT:-${TRACY_QA_HOME:-/opt/tracy-fleet/reskin}/out/visual}"

exec "$DIR/browser-qa.sh" --tiers visual \
  --host "$HOST" --port "$PORT" --pages "$PAGES" --out "$OUT" \
  ${VARIANT:+--variant "$VARIANT"}
