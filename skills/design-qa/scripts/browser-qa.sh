#!/usr/bin/env bash
# browser-qa.sh — the one container behind every rendered gate. `visual-qa.sh`,
# `layout-qa.sh` and `reskin-qa/responsive-qa.sh` are thin wrappers that name a tier and
# call this; running several tiers in one invocation renders each page once instead of once
# per tier.
#
# Usage (tiers may be combined — that is the point):
#   browser-qa.sh --host <h> --port <n> --pages "/a,/b" --tiers visual,layout,responsive \
#                 [--variant <slug>] [--out <dir>] [--crawl N] [--min-height N] \
#                 [--baseline write|compare] [--responsive-mode write|compare] \
#                 [--screenshots on|off]
#
# Nothing is installed on the client site: the browser runs in a throwaway container and
# reaches the copy over loopback with a Host-header rewrite.
#
# Environment:
#   TRACY_QA_HOME     where output and the node_modules cache live (default the fleet path).
#                     Set it to run this skill anywhere else — it is published as
#                     `platforms: any` and a hard-coded /opt path is not "any".
#   PW_VERSION        playwright version, ONE source of truth for both the image tag and the
#                     npm install below. They used to be six separate literals across three
#                     scripts, which is a silent breakage waiting for whoever bumps one.
#   PLAYWRIGHT_IMAGE  override the whole image reference.
set -euo pipefail

QA_HOME="${TRACY_QA_HOME:-/opt/tracy-fleet/reskin}"
PW_VERSION="${PW_VERSION:-1.49.0}"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v${PW_VERSION}-jammy}"
DIR="$(cd "$(dirname "$0")" && pwd)"

# --out names a host directory that has to be created and bind-mounted, so it is handled
# here and replaced with the in-container path. Every other flag is forwarded untouched and
# validated by browser-qa.mjs, which rejects unknown flags rather than ignoring them.
OUT=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --out)
      [ $# -ge 2 ] || { echo "browser-qa.sh: --out needs a value" >&2; exit 2; }
      OUT="$2"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
OUT="${OUT:-$QA_HOME/out/browser-qa}"
mkdir -p "$OUT"

# node_modules persists between runs — reinstalling playwright on every run was the single
# biggest cost of the whole check (~35s of pure waste). It is shared by every tier and every
# concurrent run, so the install is taken under a lock: two runs starting together used to
# race into the same directory and leave it half-written.
CACHE="$QA_HOME/.qa-cache"
mkdir -p "$CACHE"

# The host has ~1GB RAM: one page at a time, no sandbox, capped container memory so a
# Chromium spike cannot take the fleet down with it.
#
# Arguments are passed as POSITIONAL PARAMETERS to the inner shell, never spliced into its
# program text. The previous form was `node x.mjs "'"$HOST"'"`, which concatenates the value
# into the script the inner bash then parses — so a page path containing $(...) was command
# execution inside the container, and a value containing a quote broke the run.
docker run --rm --network host --memory 512m --shm-size 256m \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  -v "$DIR:/qa/scripts:ro" -v "$OUT:/qa/out" -v "$CACHE:/qa/node_modules" \
  -w /qa "$IMAGE" bash -lc '
    set -euo pipefail
    pw_version="$1"; shift
    exec 9>/qa/node_modules/.install.lock
    flock 9
    [ -d /qa/node_modules/playwright ] || npm install --no-save --loglevel=error "playwright@${pw_version}" >/dev/null 2>&1
    flock -u 9
    exec node /qa/scripts/browser-qa.mjs "$@" --out /qa/out
  ' browser-qa "$PW_VERSION" ${ARGS[@]+"${ARGS[@]}"}
