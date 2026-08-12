#!/usr/bin/env bash
# visual-qa.sh — tier-1 visual QA (deterministic layout assertions) for the
# Reskin pipeline. Renders pages of a working copy in headless Chromium
# (Playwright docker image) on the fleet host and asserts geometry: horizontal
# overflow, overlapping nav items, edge bleed, clipped labels, broken images.
# Screenshots land next to the JSON for the vision tier / human review.
#
# Nothing is installed on the client site; the browser runs in a throwaway
# container and reaches the copy over loopback with a Host-header rewrite.
#
# Spec: tracy-docs/reskin/README.md (Accessibility & Link scan chapters' QA loop)
#
# Usage:
#   visual-qa.sh --host <public-host> --port <loopback-port> \
#                --pages "/,/pricing-stratum,/blog/" [--out /opt/tracy-fleet/reskin/out/visual] \
#                [--variant stratum]
#
# --variant judges a PROPOSAL instead of the site: the same container and port, with the
# `X-Tracy-Variant` header that decides which database it reads (ADR 0044). Judging a proposal
# through the site's own address would grade the wrong thing and pass.
set -euo pipefail

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
  echo "usage: visual-qa.sh --host <h> --port <n> --pages \"/a,/b\" [--out dir]" >&2
  exit 2
}
OUT="${OUT:-/opt/tracy-fleet/reskin/out/visual}"
mkdir -p "$OUT"

IMAGE="mcr.microsoft.com/playwright:v1.49.0-jammy"
DIR="$(cd "$(dirname "$0")" && pwd)"

# The host has ~1GB RAM: one page at a time, no sandbox, capped container memory
# so a Chromium spike cannot take the fleet down with it.
# node_modules persists in a cache dir — reinstalling playwright on every run
# was the single biggest cost of the whole check (~35s of pure waste).
CACHE="/opt/tracy-fleet/reskin/.qa-cache"
mkdir -p "$CACHE"
docker run --rm --network host --memory 512m --shm-size 256m \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  -v "$DIR/visual-qa.mjs:/qa/visual-qa.mjs:ro" -v "$OUT:/qa/out" -v "$CACHE:/qa/node_modules" \
  -w /qa "$IMAGE" bash -lc '
    [ -d node_modules/playwright ] || npm install --no-save --loglevel=error playwright@1.49.0 >/dev/null 2>&1
    node visual-qa.mjs "'"$HOST"'" "'"$PORT"'" /qa/out "'"$PAGES"'" "'"$VARIANT"'"
  '
