#!/usr/bin/env bash
# design-qa.sh — text-tier QA gate of the Reskin pipeline (visual-qa.sh is the
# geometry tier). Renders each page over loopback and asserts:
#   - HTTP 200, no literal {loadposition}, no PHP fatal leaking into the page
#   - expected real-copy markers present (per-page, from the mapping)
#   - branding deny-list absent from VISIBLE text (script/code excluded,
#     allowlist for legit real-content mentions — trap 25)
#   - every internal link and image on the page answers < 400 (trap 20:
#     probe every link, even the ones copied verbatim from the demo)
# Failures print a diff-style report and exit nonzero: the QA loop sends the
# page back to the agent, per spec (tracy-docs/reskin/README.md, Link scan QA).
#
# Expectations file (JSON, optional sections per page):
# {
#  "denylist": ["Stratum"],
#  "allow": ["JA Stratum", "jaStratumTheme"],
#  "pages": {
#    "/joomla-mcp": {"markers": ["Publish by asking"], "forbid": ["THE STACK"]},
#    "/blog/": {"markers": ["The JoomlArt Blog"]}
#  }
# }
#
# Usage:
#   design-qa.sh --host <public-host> --port <loopback-port> \
#                [--expect expectations.json] [--pages "/a,/b"] [--out report.json]
set -euo pipefail

HOST="" PORT="" EXPECT="" PAGES="" OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --expect) EXPECT="$2"; shift 2 ;;
    --pages) PAGES="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$HOST" ] && [ -n "$PORT" ] || {
  echo "usage: design-qa.sh --host <h> --port <n> [--expect f.json] [--pages \"/a,/b\"] [--out f]" >&2
  exit 2
}
OUT="${OUT:-/opt/tracy-fleet/reskin/out/design-qa.json}"
mkdir -p "$(dirname "$OUT")"

python3 - "$HOST" "$PORT" "${EXPECT:-}" "${PAGES:-}" "$OUT" <<'PYEOF'
import html as htmlmod, json, re, sys, urllib.request

host, port, expect_path, pages_arg, out = sys.argv[1:6]
expect = json.load(open(expect_path)) if expect_path else {}
pages = ([p.strip() for p in pages_arg.split(",") if p.strip()]
         if pages_arg else list(expect.get("pages", {}).keys()))
if not pages:
    raise SystemExit("no pages: pass --pages or an expectations file with a pages section")

denylist = expect.get("denylist", [])
allow = expect.get("allow", [])

def fetch(path, method="GET", timeout=40):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method,
                                 headers={"Host": host, "X-Forwarded-Proto": "https"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, (r.read().decode("utf-8", "replace") if method == "GET" else "")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception:
        return 0, ""

# Warm forSEF once (trap 22c) before judging any route.
fetch("/")

link_cache = {}
def probe(path):
    if path not in link_cache:
        code, _ = fetch(path, timeout=25)
        link_cache[path] = code
    return link_cache[path]

report, failed = [], 0
for path in pages:
    exp = expect.get("pages", {}).get(path, {})
    status, raw = fetch(path)
    body = htmlmod.unescape(raw)
    problems = []
    if status != 200:
        problems.append(f"status={status}")
    else:
        if "{loadposition" in body: problems.append("literal {loadposition} in output")
        for sig in ("Fatal error", "Uncaught Error", "Call to a member function"):
            if sig in body: problems.append(f"php error leaked: {sig}")
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
                problems.append(f"denylist '{token}' visible: {hits[0][:70]!r} (+{len(hits)-1} more)" if len(hits) > 1
                                else f"denylist '{token}' visible: {hits[0][:70]!r}")

        # probe internal links + images (dedup, capped per page)
        hrefs = set(re.findall(r'href="(/[^"#]*)"', raw)) | set(re.findall(r'src="(/[^"]+)"', raw))
        hrefs = {h for h in hrefs if not h.startswith("//")}
        bad_links = []
        for h in sorted(hrefs)[:40]:
            code = probe(h)
            if code >= 400 or code == 0:
                bad_links.append(f"{h} -> {code}")
        if bad_links:
            problems.append("dead links: " + "; ".join(bad_links[:6]) + (f" (+{len(bad_links)-6})" if len(bad_links) > 6 else ""))

    ok = not problems
    failed += 0 if ok else 1
    report.append({"path": path, "ok": ok, "problems": problems})
    print(("PASS " if ok else "FAIL ") + path)
    for p in problems:
        print("   -", p)

json.dump({"host": host, "pages": report}, open(out, "w"), ensure_ascii=False, indent=1)
print(f"design-qa: {len(pages) - failed}/{len(pages)} pass -> {out}")
sys.exit(1 if failed else 0)
PYEOF
