#!/usr/bin/env bash
# scan-extensions.sh — 3-column UI-relevant extension diff between a demo's
# Pattern library and a client site's Content inventory (both produced by the
# scan pair). Pure computation over the two JSON documents: no DB access.
#
# Columns: `missing` (demo needs it, client has no row), `version_older`
# (client's row is older than the demo's), `disabled` (client has it, turned
# off). Every row carries the UI reason from the demo side — which positions
# and blocks actually need it — so the mapping review can see WHY.
# The reverse direction (client has, demo lacks) is out of scope by spec:
# we dress the client site, we never fix the demo.
#
# Spec: tracy-docs/reskin/README.md
#
# Usage:
#   scan-extensions.sh --demo pattern-library.json --client content-inventory.json \
#                      [--out extension-diff.json]
set -euo pipefail

DEMO="" CLIENT="" OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --demo) DEMO="$2"; shift 2 ;;
    --client) CLIENT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DEMO" ] && [ -n "$CLIENT" ] || {
  echo "usage: scan-extensions.sh --demo <pattern-library.json> --client <content-inventory.json> [--out f]" >&2
  exit 2
}
OUT="${OUT:-/opt/tracy-fleet/reskin/out/extension-diff.json}"
mkdir -p "$(dirname "$OUT")"

python3 - "$DEMO" "$CLIENT" "$OUT" <<'PYEOF'
import json, re, sys
from datetime import datetime, timezone

demo_path, client_path, out = sys.argv[1:4]
demo = json.load(open(demo_path))
client = json.load(open(client_path))

def key(e):
    return (e["type"], e["element"], e.get("folder") or "")

def vertuple(v):
    if not v:
        return ()
    return tuple(int(x) for x in re.findall(r"\d+", str(v))[:4])

client_by_key = {key(e): e for e in client["extensions_ui"]}

# Where each module element is actually used on the demo — the UI reason.
module_use = {}
for b in demo.get("blocks", []):
    module_use.setdefault(b["module"], {"positions": set(), "sample_blocks": []})
    if b.get("position"):
        module_use[b["module"]]["positions"].add(b["position"])
    if len(module_use[b["module"]]["sample_blocks"]) < 3:
        module_use[b["module"]]["sample_blocks"].append(b["title"])

def ui_reason(e):
    if e["type"] == "module" and e["element"] in module_use:
        use = module_use[e["element"]]
        return f"positions: {', '.join(sorted(use['positions']))}"
    return e.get("reason") or "ui"

missing, older, disabled = [], [], []
for e in demo["extensions_ui"]:
    if not e.get("enabled"):
        continue
    c = client_by_key.get(key(e))
    row = {"type": e["type"], "element": e["element"], "folder": e.get("folder"),
           "demo_version": e.get("version"), "why": ui_reason(e)}
    if c is None:
        missing.append({**row, "action": "install"})
    elif not c.get("enabled"):
        disabled.append({**row, "client_version": c.get("version"), "action": "enable"})
    elif vertuple(c.get("version")) < vertuple(e.get("version")):
        older.append({**row, "client_version": c.get("version"), "action": "upgrade"})

doc = {
  "meta": {"kind": "extension-diff",
           "demo": demo["meta"].get("template"), "client": client["meta"].get("host"),
           "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")},
  "missing": sorted(missing, key=lambda r: (r["type"], r["element"])),
  "version_older": sorted(older, key=lambda r: (r["type"], r["element"])),
  "disabled": sorted(disabled, key=lambda r: (r["type"], r["element"])),
}
with open(out, "w") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1)
print(f"extension-diff: {len(missing)} missing, {len(older)} version-older, "
      f"{len(disabled)} disabled -> {out}")
PYEOF
