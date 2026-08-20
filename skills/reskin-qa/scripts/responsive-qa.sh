#!/usr/bin/env bash
# responsive-qa.sh — DIFFERENTIAL responsive QA. layout-qa asks "are the boxes sane?"; this
# one asks "does the dressed site respond the way the DEMO responds?" — because the demo is
# the living definition of correct behaviour for its own template.
#
# Two runs, always in this order:
#   1. --mode reference --host <DEMO host> --port <demo port>
#      Extracts a per-block-type responsive signature (columns, heading size, horizontal
#      overflow, nav collapse, footer columns) at 375/768/1024/1440 and saves it.
#   2. --mode compare --host <CLIENT host> --port <client port> [--variant <slug>]
#      Judges the dressed copy against that reference. A block that keeps 3 columns at 375px
#      where the demo drops to 1 is a FAIL; behaviour the demo shares is not a defect of the
#      dress (traps 34-35: compare fold rhythm, never absolute column counts).
#
# Both runs write into the same --out dir (the reference lives there). Compare now refuses to
# run when the reference is missing, unparseable, or was recorded against the very host being
# judged — that last one used to overwrite the demo's reference and make every compare pass
# forever, silently.
#
# --variant judges a PROPOSAL instead of the site, via `X-Tracy-Variant`. This gate never
# accepted the flag, which meant the mode whose entire job is judging a dressed proposal had
# no way to reach one.
#
# Usage:
#   responsive-qa.sh --mode reference --host <demo-host>   --port <demo-port>   --pages "/,/features"
#   responsive-qa.sh --mode compare   --host <client-host> --port <client-port> --pages "/,/faq" --variant stratum
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
QA_HOME="${TRACY_QA_HOME:-/opt/tracy-fleet/reskin}"

# The rendering engine lives in design-qa: one browser, one page load, every tier. The two
# skills are always installed together (reskin-qa's own first line is "run both"), but they
# are separate records that an installer may put anywhere — so the engine is LOOKED UP and
# the failure names the way to fix it, rather than assuming a layout.
ENGINE=""
for cand in "${DESIGN_QA_SCRIPTS:-}" "$DIR/../../design-qa/scripts" "$QA_HOME/design-qa/scripts"; do
  [ -n "$cand" ] && [ -x "$cand/browser-qa.sh" ] && { ENGINE="$cand"; break; }
done
[ -n "$ENGINE" ] || {
  echo "responsive-qa.sh: cannot find design-qa's browser-qa.sh." >&2
  echo "  This gate runs on design-qa's rendering engine. Install the design-qa skill" >&2
  echo "  beside this one, or point DESIGN_QA_SCRIPTS at its scripts/ directory." >&2
  exit 2
}

MODE="" HOST="" PORT="" PAGES="" OUT="" VARIANT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --pages) PAGES="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
case "$MODE" in
  reference) RMODE=write ;;
  compare) RMODE=compare ;;
  *) echo "usage: responsive-qa.sh --mode reference|compare --host <h> --port <n> --pages \"/a,/b\" [--variant s]" >&2; exit 2 ;;
esac
[ -n "$HOST" ] && [ -n "$PORT" ] && [ -n "$PAGES" ] || {
  echo "usage: responsive-qa.sh --mode reference|compare --host <h> --port <n> --pages \"/a,/b\" [--variant s]" >&2
  exit 2
}
OUT="${OUT:-$QA_HOME/out/responsive}"

# No screenshots from this tier: visual-qa already owns the picture record, and rendering
# four viewports of full-page PNGs a second time is the most expensive thing in the loop.
exec "$ENGINE/browser-qa.sh" --tiers responsive --responsive-mode "$RMODE" --screenshots off \
  --host "$HOST" --port "$PORT" --pages "$PAGES" --out "$OUT" \
  ${VARIANT:+--variant "$VARIANT"}
