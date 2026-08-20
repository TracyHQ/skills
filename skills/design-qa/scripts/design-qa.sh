#!/usr/bin/env bash
# design-qa.sh — the ABSOLUTE text-tier gate: what makes a page broken on any site, with no
# knowledge of what anyone was trying to build. (Its expectation-judging half moved to
# reskin-qa/reskin-verify.sh when the two kinds of judgment were separated.)
#
# Per page:
#   - HTTP 200
#   - no literal {loadposition} in output, no PHP fatal leaking into the page
#   - every internal link and image answers < 400 (code samples in <pre>/<code> excluded:
#     documentation is not navigation)
#
# Usage:
#   design-qa.sh --host <public-host> --port <loopback-port> --pages "/a,/b" \
#                [--variant <slug>] [--max-links 40] [--workers 8] [--out report.json]
set -euo pipefail

HOST="" PORT="" PAGES="" VARIANT="" OUT="" MAXLINKS=40 WORKERS=8
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --pages) PAGES="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    --max-links) MAXLINKS="$2"; shift 2 ;;
    --workers) WORKERS="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$HOST" ] && [ -n "$PORT" ] && [ -n "$PAGES" ] || {
  echo "usage: design-qa.sh --host <h> --port <n> --pages \"/a,/b\" [--variant s] [--max-links N] [--workers N] [--out f]" >&2
  exit 2
}
OUT="${OUT:-${TRACY_QA_HOME:-/opt/tracy-fleet/reskin}/out/design-qa.json}"
mkdir -p "$(dirname "$OUT")"

python3 - "$HOST" "$PORT" "$PAGES" "$VARIANT" "$OUT" "$MAXLINKS" "$WORKERS" <<'PYEOF'
import json, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

host, port, pages_arg, variant, out, max_links_arg, workers_arg = sys.argv[1:8]
pages = [p.strip() for p in pages_arg.split(",") if p.strip()]
max_links = max(1, int(max_links_arg))
workers = max(1, min(16, int(workers_arg)))

# This gate judges ONE site. Following a redirect onto someone else's host would make the
# verdict depend on their server (it did once: a menu link 301'd to the customer's live
# domain, whose WAF answered 403, and the gate blamed the page). Same-host redirects are
# followed; off-site ones are reported as facts, never fetched.
OFFSITE = -1

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

opener = urllib.request.build_opener(NoRedirect)

def same_host(loc):
    return loc.startswith("/") or loc.startswith(f"https://{host}") or loc.startswith(f"http://{host}")

def to_path(loc):
    """An absolute same-host Location -> the path this gate can re-fetch over loopback."""
    if loc.startswith("/"):
        return loc
    rest = loc.split("/", 3)
    return "/" + rest[3] if len(rest) > 3 else "/"

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
            if same_host(loc) and hops < 3:
                return fetch(to_path(loc), timeout, hops + 1)
            return OFFSITE, loc
        return e.code, ""
    except Exception:
        return 0, ""

# Warm forSEF once before judging any route: it only relearns a URL when another page builds
# that link, so a fresh page 404s on its pretty path while its content answers 200.
fetch("/")

# Pages are fetched concurrently, then judged in the order they were listed. Serial fetching
# made the wall clock the sum of every page's latency for no reason — nothing here depends on
# an earlier page's body, and the warm-up above is the one ordering that mattered.
with ThreadPoolExecutor(max_workers=workers) as pool:
    fetched = dict(zip(pages, pool.map(lambda p: fetch(p), pages)))

# Collect every internal link across every page FIRST, then probe the union once. The nav
# repeats on all of them, so the union is a fraction of the per-page totals — and probing it
# in parallel turns a chain of 25-second timeouts into one.
page_links, skipped = {}, {}
for path in pages:
    status, raw = fetched[path]
    if status != 200:
        page_links[path] = []
        continue
    crawlable = re.sub(r"(?is)<(pre|code|textarea).*?</\1>", "", raw)
    hrefs = set(re.findall(r'href="(/[^"#]*)"', crawlable)) | set(re.findall(r'src="(/[^"]+)"', crawlable))
    hrefs = sorted(h for h in hrefs if not h.startswith("//"))
    page_links[path] = hrefs[:max_links]
    # A cap that reports nothing reads as full coverage. Say what was not probed, and how to
    # probe it — the same honesty the crawl caps in this toolkit are held to.
    skipped[path] = len(hrefs) - len(page_links[path])

todo = sorted({h for hs in page_links.values() for h in hs})
with ThreadPoolExecutor(max_workers=workers) as pool:
    link_status = dict(zip(todo, pool.map(lambda h: fetch(h, timeout=25)[0], todo)))

report, failed = [], 0
for path in pages:
    status, raw = fetched[path]
    problems = []
    if status == OFFSITE:
        # A page that leaves the site is a fact about the site, not a defect of the page.
        print(f"PASS {path} (redirects off-site: {raw})")
        report.append({"path": path, "ok": True, "offsite": raw, "problems": []})
        continue
    if status != 200:
        problems.append(f"status={status}")
    else:
        if "{loadposition" in raw:
            problems.append("literal {loadposition} in output")
        for sig in ("Fatal error", "Uncaught Error", "Call to a member function"):
            if sig in raw:
                problems.append(f"php error leaked: {sig}")
        # OFFSITE (-1) never lands in bad: a link that leaves the site is alive by definition.
        bad = [f"{h} -> {link_status[h]}" for h in page_links[path] if link_status[h] >= 400 or link_status[h] == 0]
        if bad:
            problems.append("dead links: " + "; ".join(bad[:6]) + (f" (+{len(bad)-6})" if len(bad) > 6 else ""))

    ok = not problems
    failed += 0 if ok else 1
    entry = {"path": path, "ok": ok, "problems": problems,
             "linksProbed": len(page_links[path]), "linksSkipped": skipped.get(path, 0)}
    report.append(entry)
    print(("PASS " if ok else "FAIL ") + path)
    for p in problems:
        print("   -", p)
    if skipped.get(path):
        print(f"   ! {skipped[path]} more internal link(s) on this page were NOT probed "
              f"(--max-links {max_links}); raise it to cover them")

json.dump({"host": host, "variant": variant or None, "maxLinks": max_links,
           "uniqueLinksProbed": len(todo), "pages": report},
          open(out, "w"), ensure_ascii=False, indent=1)
total_skipped = sum(skipped.values())
print(f"design-qa: {len(pages) - failed}/{len(pages)} pass, {len(todo)} unique links probed" +
      (f", {total_skipped} link(s) left unprobed by the cap" if total_skipped else "") +
      f" -> {out}")
sys.exit(1 if failed else 0)
PYEOF
