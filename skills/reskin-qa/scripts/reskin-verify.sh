#!/usr/bin/env bash
# reskin-verify.sh — the EXPECTATION half of the old design-qa: judge pages against what THIS
# dressing promised. The expectations are per-proposal data (the mapping's markers, the
# branding deny-list) and travel with the proposal, not with this script.
#
# Expectations file (expect-pages.json shape):
# {
#  "denylist": ["Stratum"], "allow": ["JA Stratum"],
#  "pages": { "/blog/": {"markers": ["The JoomlArt Blog"], "forbid": ["THE STACK"]} }
# }
#
# Usage:
#   reskin-verify.sh --host <h> --port <n> --expect expectations.json \
#                    [--variant <slug>] [--workers 8] [--out report.json]
set -euo pipefail

HOST="" PORT="" EXPECT="" VARIANT="" OUT="" WORKERS=8
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --expect) EXPECT="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    --workers) WORKERS="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$HOST" ] && [ -n "$PORT" ] && [ -f "$EXPECT" ] || {
  echo "usage: reskin-verify.sh --host <h> --port <n> --expect f.json [--variant s] [--workers N] [--out f]" >&2
  exit 2
}
OUT="${OUT:-${TRACY_QA_HOME:-/opt/tracy-fleet/reskin}/out/reskin-verify.json}"
mkdir -p "$(dirname "$OUT")"

python3 - "$HOST" "$PORT" "$EXPECT" "$VARIANT" "$OUT" "$WORKERS" <<'PYEOF'
import html as htmlmod, json, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

host, port, expect_path, variant, out, workers_arg = sys.argv[1:7]
workers = max(1, min(16, int(workers_arg)))
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

# Fetched concurrently, judged in the listed order: no page's verdict depends on another's.
with ThreadPoolExecutor(max_workers=workers) as pool:
    fetched = dict(zip(pages, pool.map(fetch, pages)))

# Attributes a visitor reads without seeing a tag. The deny-list used to scan only text
# BETWEEN tags, so `alt="Stratum hero"`, `title="Stratum"` and a meta description carrying the
# demo brand were invisible to it — while a screen reader announces them, a search engine
# indexes them, and a tooltip shows them on hover. Each is named separately in the report,
# because "it is in an alt attribute" and "it is in the headline" are different fixes.
ATTRS = ("alt", "title", "aria-label", "content", "placeholder")
ATTR_RE = {a: re.compile(r'\b%s\s*=\s*"([^"]*)"' % a, re.I) for a in ATTRS}

def strip_code(raw):
    """Scripts and styles are not the page's visible text (trap 25)."""
    return re.sub(r"(?is)<(script|style).*?</\1>", "", raw)

def denied(token, raw):
    """Every place this token is readable, with the kind of place it is."""
    visible = strip_code(raw)
    hits = []
    for m in re.findall(r">([^<]*%s[^<]*)<" % re.escape(token), visible, re.I):
        hits.append(("text", htmlmod.unescape(m).strip()))
    for attr, rx in ATTR_RE.items():
        for value in rx.findall(visible):
            if re.search(re.escape(token), value, re.I):
                hits.append((attr, htmlmod.unescape(value).strip()))
    # An allow-list entry covers legitimate real-content mentions ("JA Stratum" is the
    # template's own product name and may appear in an article about it) — trap 25.
    return [h for h in hits if not any(a.lower() in h[1].lower() for a in allow)]

report, failed = [], 0
for path in pages:
    exp = expect["pages"][path]
    status, raw = fetched[path]
    # Markers and forbidden strings are matched against UNESCAPED text so an apostrophe or an
    # ampersand in the expectation file matches what a reader sees, not what the encoder wrote.
    body = htmlmod.unescape(raw)
    problems = []
    if status != 200:
        problems.append(f"status={status} (run design-qa for the absolute tier)")
    else:
        for mk in exp.get("markers", []):
            if mk not in body:
                problems.append(f"missing marker: {mk!r}")
        for fb in exp.get("forbid", []):
            if fb in body:
                problems.append(f"forbidden string: {fb!r}")
        # Case-insensitive throughout: "stratum.app" slipped past a cased match once.
        for token in denylist:
            hits = denied(token, raw)
            if hits:
                where, sample = hits[0]
                extra = f" (+{len(hits)-1} more)" if len(hits) > 1 else ""
                problems.append(f"denylist '{token}' in {where}: {sample[:70]!r}{extra}")

    ok = not problems
    failed += 0 if ok else 1
    report.append({"path": path, "ok": ok, "problems": problems})
    print(("PASS " if ok else "FAIL ") + path)
    for p in problems:
        print("   -", p)

json.dump({"host": host, "variant": variant or None, "pages": report},
          open(out, "w"), ensure_ascii=False, indent=1)
print(f"reskin-verify: {len(pages) - failed}/{len(pages)} pass -> {out}")
sys.exit(1 if failed else 0)
PYEOF
