#!/usr/bin/env bash
# reskin-verify.sh — the EXPECTATION half of the old design-qa: judge pages against what
# THIS dressing promised. The expectations are per-proposal data (the mapping's markers,
# the branding deny-list) and travel with the proposal, not with this script.
#
# Expectations file (expect-pages.json shape):
# {
#  "denylist": ["Stratum"], "allow": ["JA Stratum"],
#  "pages": { "/blog/": {"markers": ["The JoomlArt Blog"], "forbid": ["THE STACK"]} }
# }
#
# Usage:
#   reskin-verify.sh --host <h> --port <n> --expect expectations.json \
#                    [--variant <slug>] [--out report.json]
set -euo pipefail

HOST="" PORT="" EXPECT="" VARIANT="" OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --expect) EXPECT="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$HOST" ] && [ -n "$PORT" ] && [ -f "$EXPECT" ] || {
  echo "usage: reskin-verify.sh --host <h> --port <n> --expect f.json [--variant s] [--out f]" >&2
  exit 2
}
OUT="${OUT:-/opt/tracy-fleet/reskin/out/reskin-verify.json}"
mkdir -p "$(dirname "$OUT")"

python3 - "$HOST" "$PORT" "$EXPECT" "$VARIANT" "$OUT" <<'PYEOF'
import html as htmlmod, json, re, sys, urllib.request

host, port, expect_path, variant, out = sys.argv[1:6]
expect = json.load(open(expect_path))
pages = list(expect.get("pages", {}).keys())
if not pages:
    raise SystemExit("the expectations file names no pages")

denylist = expect.get("denylist", [])
allow = expect.get("allow", [])

def fetch(path):
    headers = {"Host": host, "X-Forwarded-Proto": "https"}
    if variant:
        headers["X-Tracy-Variant"] = variant
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception:
        return 0, ""

fetch("/")  # warm forSEF (trap 22c)

report, failed = [], 0
for path in pages:
    exp = expect["pages"][path]
    status, raw = fetch(path)
    body = htmlmod.unescape(raw)
    problems = []
    if status != 200:
        problems.append(f"status={status} (run design-qa for the absolute tier)")
    else:
        for mk in exp.get("markers", []):
            if mk not in body: problems.append(f"missing marker: {mk!r}")
        for fb in exp.get("forbid", []):
            if fb in body: problems.append(f"forbidden string: {fb!r}")
        # deny-list over VISIBLE text only; scripts/styles stripped first (trap 25).
        # Case-insensitive: "stratum.app" slipped past a cased match once.
        visible = re.sub(r"(?is)<(script|style).*?</\1>", "", raw)
        for token in denylist:
            hits = [m.strip() for m in re.findall(r">([^<]*%s[^<]*)<" % re.escape(token), visible, re.I)]
            hits = [h for h in hits if not any(a.lower() in h.lower() for a in allow)]
            if hits:
                extra = f" (+{len(hits)-1} more)" if len(hits) > 1 else ""
                problems.append(f"denylist '{token}' visible: {hits[0][:70]!r}{extra}")

    ok = not problems
    failed += 0 if ok else 1
    report.append({"path": path, "ok": ok, "problems": problems})
    print(("PASS " if ok else "FAIL ") + path)
    for p in problems:
        print("   -", p)

json.dump({"host": host, "variant": variant or None, "pages": report}, open(out, "w"), ensure_ascii=False, indent=1)
print(f"reskin-verify: {len(pages) - failed}/{len(pages)} pass -> {out}")
sys.exit(1 if failed else 0)
PYEOF
