#!/usr/bin/env bash
# design-qa.sh — the ABSOLUTE text-tier gate: what makes a page broken on any site,
# with no knowledge of what anyone was trying to build. (Its expectation-judging half
# moved to reskin-qa/reskin-verify.sh when the two kinds of judgment were separated.)
#
# Per page:
#   - HTTP 200
#   - no literal {loadposition} in output, no PHP fatal leaking into the page
#   - every internal link and image answers < 400 (code samples in <pre>/<code>
#     excluded: documentation is not navigation)
#
# Usage:
#   design-qa.sh --host <public-host> --port <loopback-port> --pages "/a,/b" \
#                [--variant <slug>] [--out report.json]
set -euo pipefail

HOST="" PORT="" PAGES="" VARIANT="" OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --pages) PAGES="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$HOST" ] && [ -n "$PORT" ] && [ -n "$PAGES" ] || {
  echo "usage: design-qa.sh --host <h> --port <n> --pages \"/a,/b\" [--variant s] [--out f]" >&2
  exit 2
}
OUT="${OUT:-/opt/tracy-fleet/reskin/out/design-qa.json}"
mkdir -p "$(dirname "$OUT")"

python3 - "$HOST" "$PORT" "$PAGES" "$VARIANT" "$OUT" <<'PYEOF'
import json, re, sys, urllib.request

host, port, pages_arg, variant, out = sys.argv[1:6]
pages = [p.strip() for p in pages_arg.split(",") if p.strip()]

# This gate judges ONE site. Following a redirect onto someone else's host would make the
# verdict depend on their server (it did once: a menu link 301'd to the customer's live
# domain, whose WAF answered 403, and the gate blamed the page). Same-host redirects are
# followed; off-site ones are reported as facts, never fetched.
OFFSITE = -1

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

opener = urllib.request.build_opener(NoRedirect)

def fetch(path, timeout=40, hops=0):
    headers = {"Host": host, "X-Forwarded-Proto": "https"}
    if variant:
        headers["X-Tracy-Variant"] = variant
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers=headers)
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        loc = e.headers.get("Location", "")
        if e.code in (301, 302, 303, 307, 308):
            if loc.startswith("/") or loc.startswith(f"https://{host}") or loc.startswith(f"http://{host}"):
                if hops < 3:
                    nxt = loc if loc.startswith("/") else "/" + loc.split("/", 3)[3] if loc.count("/") >= 3 else "/"
                    return fetch(nxt, timeout, hops + 1)
            return OFFSITE, loc
        return e.code, ""
    except Exception:
        return 0, ""

# Warm forSEF once (trap 22c) before judging any route.
fetch("/")

link_cache = {}
def probe(path):
    if path not in link_cache:
        link_cache[path] = fetch(path, timeout=25)[0]
    return link_cache[path]

report, failed = [], 0
for path in pages:
    status, raw = fetch(path)
    problems = []
    if status == OFFSITE:
        # A page that leaves the site is a fact about the site, not a defect of the page.
        print(f"PASS {path} (redirects off-site: {raw})")
        report.append({"path": path, "ok": True, "offsite": raw, "problems": []})
        continue
    if status != 200:
        problems.append(f"status={status}")
    else:
        if "{loadposition" in raw: problems.append("literal {loadposition} in output")
        for sig in ("Fatal error", "Uncaught Error", "Call to a member function"):
            if sig in raw: problems.append(f"php error leaked: {sig}")
        crawlable = re.sub(r"(?is)<(pre|code|textarea).*?</\1>", "", raw)
        hrefs = set(re.findall(r'href="(/[^"#]*)"', crawlable)) | set(re.findall(r'src="(/[^"]+)"', crawlable))
        hrefs = {h for h in hrefs if not h.startswith("//")}
        bad = [f"{h} -> {probe(h)}" for h in sorted(hrefs)[:40] if probe(h) >= 400 or probe(h) == 0]
        # OFFSITE (-1) never lands in bad: a link that leaves the site is alive by definition here.
        if bad:
            problems.append("dead links: " + "; ".join(bad[:6]) + (f" (+{len(bad)-6})" if len(bad) > 6 else ""))

    ok = not problems
    failed += 0 if ok else 1
    report.append({"path": path, "ok": ok, "problems": problems})
    print(("PASS " if ok else "FAIL ") + path)
    for p in problems:
        print("   -", p)

json.dump({"host": host, "variant": variant or None, "pages": report}, open(out, "w"), ensure_ascii=False, indent=1)
print(f"design-qa: {len(pages) - failed}/{len(pages)} pass -> {out}")
sys.exit(1 if failed else 0)
PYEOF
