#!/usr/bin/env bash
# scan-client-site.sh — build the Content inventory (so ruot) of a client site's
# working copy.
#
# Reads the client copy's containers and emits one JSON document with everything
# the Reskin pipeline needs from the client side: menu trees with per-item flags
# (style pins, old-template layouts, externals), content mines, UI-relevant
# extensions, the SEO/router stack, a link check over the main menu (the seed of
# the canonical URL map), real-copy CSS vocabulary, branding facts, and render
# config (sef/htaccess/cache/tz). Read-only: never writes to the site.
#
# Spec: tracy-docs/reskin/README.md
#
# Usage:
#   scan-client-site.sh --db <db-container> --web <web-container> --prefix <p> \
#     --pass <db-root-pass> --host <public-host> --port <loopback-port> \
#     [--out /path/content-inventory.json]
set -euo pipefail

DB="" WEB="" PREFIX="" PASS="" HOST="" PORT="" OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --web) WEB="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --pass) PASS="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DB" ] && [ -n "$WEB" ] && [ -n "$PREFIX" ] && [ -n "$PASS" ] && [ -n "$HOST" ] && [ -n "$PORT" ] || {
  echo "usage: scan-client-site.sh --db <ctr> --web <ctr> --prefix <p> --pass <pw> --host <h> --port <n> [--out f]" >&2
  exit 2
}
OUT="${OUT:-/opt/tracy-fleet/reskin/out/content-inventory.json}"
mkdir -p "$(dirname "$OUT")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The site names its own database in configuration.php, exactly where $dbprefix already comes
# from. This line used to say `joomla` — true of the fleet's own stacks, and silently wrong
# anywhere else, which reads as "the script is broken" rather than "it asked the wrong database".
DBNAME=$(docker exec "$WEB" grep -m1 "public .db = " /var/www/html/configuration.php | sed "s/.*= *'\\([^']*\\)'.*/\\1/")
[ -n "$DBNAME" ] || { echo "could not read the database name from $WEB:/var/www/html/configuration.php" >&2; exit 1; }
sql() { docker exec "$DB" mariadb -uroot -p"$PASS" "$DBNAME" -N -B -e "$1" 2>/dev/null; }
B64="REPLACE(TO_BASE64(%s), CHAR(10), '')"

sql "SELECT id, menutype, title, level, published, template_style_id, path, type, home, $(printf "$B64" link) FROM ${PREFIX}menu WHERE client_id=0 AND id>1" > "$TMP/menus.tsv"
sql "SELECT c.id, c.title, c.level, COUNT(a.id) FROM ${PREFIX}categories c LEFT JOIN ${PREFIX}content a ON a.catid=c.id AND a.state=1 WHERE c.extension='com_content' AND c.published=1 GROUP BY c.id" > "$TMP/cats.tsv"
sql "SELECT id, title, catid, hits FROM ${PREFIX}content WHERE state=1 ORDER BY hits DESC LIMIT 15" > "$TMP/top_articles.tsv"
sql "SELECT extension_id, type, element, IFNULL(folder,''), client_id, enabled, $(printf "$B64" manifest_cache) FROM ${PREFIX}extensions" > "$TMP/extensions.tsv"
sql "SELECT id, $(printf "$B64" "CONCAT(introtext, \`fulltext\`)") FROM ${PREFIX}content WHERE state=1 ORDER BY hits DESC LIMIT 30" > "$TMP/copy.tsv"
sql "SELECT NOW(), UTC_TIMESTAMP()" > "$TMP/tz.tsv"
sql "SHOW TABLES LIKE '%sh404%'" > "$TMP/sh404.tsv"
sql "SELECT id, home, title FROM ${PREFIX}template_styles WHERE client_id=0" > "$TMP/styles.tsv"

docker exec "$WEB" sh -c '
  grep -E "public [\$](sitename|sef|sef_rewrite|caching|force_ssl|error_reporting|live_site|offset) = " /var/www/html/configuration.php | sed "s/^[[:space:]]*/CFG /"
  [ -f /var/www/html/.htaccess ] && echo "HTACCESS yes" || echo "HTACCESS no"
  find /var/www/html/images /var/www/html/templates -maxdepth 3 -iname "*logo*" -type f 2>/dev/null | head -10 | sed "s/^/LOGO /"
  for f in favicon.ico apple-touch-icon.png; do [ -f "/var/www/html/$f" ] && echo "ICON $f"; done
' > "$TMP/web.txt" 2>/dev/null || true

# Link check over ALL published component items (seed of the canonical URL map):
# loopback with the public Host header, no redirect following — the status IS the
# fact. When the SEF path fails, probe the non-SEF link too: 200 there means the
# CONTENT exists and only the ROUTE is missing (trap 12 in the spec) — two very
# different findings for the mapping.
: > "$TMP/links.tsv"
while IFS=$'\t' read -r id menutype title level published style path type home linkb64; do
  [ "$published" = "1" ] || continue
  link="$(printf '%s' "$linkb64" | base64 -d 2>/dev/null || true)"
  # Only component items make a page of their own; alias/heading/url items are
  # navigation structure and curling their path only manufactures fake 404s.
  if [ "$type" != "component" ]; then
    printf '%s\t%s\t/%s\t%s\t-\t-\n' "$id" "$menutype" "$path" "$type" >> "$TMP/links.tsv"; continue
  fi
  case "$link" in
    http*) printf '%s\t%s\t%s\texternal\t-\t-\n' "$id" "$menutype" "$link" >> "$TMP/links.tsv"; continue ;;
    ''|'#') printf '%s\t%s\t%s\tplaceholder\t-\t-\n' "$id" "$menutype" "$link" >> "$TMP/links.tsv"; continue ;;
  esac
  # The home item routes "/" — its stored path is an internal alias, not a URL.
  if [ "$home" = "1" ]; then url="/"; else url="/$path"; fi
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' \
    -H "Host: $HOST" -H "X-Forwarded-Proto: https" "http://127.0.0.1:$PORT$url" || echo 000)
  nonsef="-"
  if [ "$code" -ge 400 ] 2>/dev/null; then
    nonsef=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H "Host: $HOST" \
      -H "X-Forwarded-Proto: https" "http://127.0.0.1:$PORT/$link" || echo 000)
  fi
  printf '%s\t%s\t%s\tinternal\t%s\t%s\n' "$id" "$menutype" "$url" "$code" "$nonsef" >> "$TMP/links.tsv"
done < "$TMP/menus.tsv"

# The copy's sitemap is one of the three sources of the canonical URL map.
curl -s -m 20 -H "Host: $HOST" -H "X-Forwarded-Proto: https" \
  "http://127.0.0.1:$PORT/sitemap.xml" > "$TMP/sitemap.xml" || true
curl -s -m 15 -H "Host: $HOST" -H "X-Forwarded-Proto: https" \
  "http://127.0.0.1:$PORT/" > "$TMP/home.html" || true

python3 - "$TMP" "$OUT" "$PREFIX" "$HOST" <<'PYEOF'
import base64, csv, json, re, sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

tmp, out, prefix, host = sys.argv[1:5]

def rows(name):
    try:
        with open(f"{tmp}/{name}") as f:
            return [r for r in csv.reader(f, delimiter="\t") if r]
    except FileNotFoundError:
        return []

def b64(s):
    try:
        return base64.b64decode(s).decode("utf-8", "replace")
    except Exception:
        return ""

cfg, htaccess, logos, icons = {}, None, [], []
for line in open(f"{tmp}/web.txt"):
    line = line.rstrip("\n")
    if line.startswith("CFG "):
        m = re.search(r"\$(\w+) = '?([^';]*)'?;", line)
        if m: cfg[m.group(1)] = m.group(2)
    elif line.startswith("HTACCESS "): htaccess = line.endswith("yes")
    elif line.startswith("LOGO "): logos.append(line[5:])
    elif line.startswith("ICON "): icons.append(line[5:])

old_layout = re.compile(r"[?&]layout=([a-z0-9_]+):")
menus_by_type, style_pins, socials = defaultdict(list), [], set()
SOCIAL = re.compile(r"https?://(?:www\.)?(facebook|twitter|x\.com|youtube|github|linkedin|instagram)[^\s\"']*", re.I)
for r in rows("menus.tsv"):
    link = b64(r[9])
    item = {"id": int(r[0]), "title": r[2], "level": int(r[3]), "published": r[4] == "1",
            "path": r[6], "type": r[7], "home": r[8] == "1", "link": link,
            "style_pin": int(r[5] or 0) or None,
            "old_layout": (old_layout.search(link).group(1) if old_layout.search(link) else None),
            "external": link.startswith("http"),
            "esurl": "#esurl#" in link,
            "placeholder": link.strip() in ("#", "")}
    menus_by_type[r[1]].append(item)
    if item["style_pin"]: style_pins.append({"menu_id": item["id"], "style": item["style_pin"]})
    m = SOCIAL.search(link)
    if m: socials.add(m.group(0))

links = []
for r in rows("links.tsv"):
    status = int(r[4]) if r[4].isdigit() else None
    nonsef = int(r[5]) if r[5].isdigit() else None
    l = {"menu_id": int(r[0]), "menutype": r[1], "url": r[2], "kind": r[3],
         "status": status, "nonsef_status": nonsef}
    # Trap 12: a failing SEF path whose non-SEF twin answers is a ROUTE problem,
    # not missing content — the mapping fixes those very differently.
    if status and status >= 400:
        l["diagnosis"] = "route-missing" if (nonsef and nonsef < 400) else "content-missing"
    links.append(l)

ext, seo = [], []
menu_components = set()
for items in menus_by_type.values():
    for i in items:
        m = re.search(r"option=(com_[a-z0-9_]+)", i["link"])
        if m: menu_components.add(m.group(1))
SEOPAT = re.compile(r"sef|seo|sh404|route", re.I)
for r in rows("extensions.tsv"):
    typ, el, folder, client, enabled = r[1], r[2], r[3], r[4], r[5] == "1"
    try:
        ver = json.loads(b64(r[6]) or "{}").get("version")
    except Exception:
        ver = None
    reason = None
    if typ == "component" and el in menu_components: reason = "menu-linked"
    elif typ == "module" and client == "0": reason = "front-module"
    elif typ == "plugin" and folder in ("content", "system", "fields"): reason = "render-plugin"
    elif typ == "template" and client == "0": reason = "template"
    # Inventory lists EVERYTHING that exists — `reason` is a label, not a filter.
    # The extension diff needs full presence data to tell "absent" from
    # "present but not UI-relevant" (core components burned us here once).
    ext.append({"type": typ, "element": el, "folder": folder or None,
                "version": ver, "enabled": enabled, "reason": reason})
    if typ == "plugin" and (SEOPAT.search(el) or SEOPAT.search(folder)):
        seo.append({"element": el, "folder": folder, "enabled": enabled})

classes, icons_fa, style_blocks, inline_colors = Counter(), set(), 0, 0
for r in rows("copy.tsv"):
    body = b64(r[1])
    for cl in re.findall(r'class="([^"]+)"', body):
        for tok in cl.split(): classes[tok] += 1
    icons_fa.update(re.findall(r"fa[srlb]? fa-[a-z0-9-]+", body))
    style_blocks += len(re.findall(r"<style", body, re.I))
    inline_colors += len(re.findall(r"(?:color|background)\s*:\s*#[0-9a-fA-F]{3,6}", body))

now_utc = rows("tz.tsv")
tz_offset_min = None
if now_utc:
    from datetime import datetime as dt
    try:
        a = dt.fromisoformat(now_utc[0][0]); b = dt.fromisoformat(now_utc[0][1])
        tz_offset_min = int((a - b).total_seconds() // 60)
    except Exception:
        pass

try:
    html = open(f"{tmp}/home.html").read()
except FileNotFoundError:
    html = ""
m = re.search(r'<html[^>]*lang="([^"]+)"', html)
lang = m.group(1) if m else None

def meta(prop):
    m = re.search(r'(?:property|name)="%s" content="([^"]*)"' % re.escape(prop), html)
    return m.group(1) if m else None
org = re.search(r'"@type":"Organization"[^}]*?"name":"([^"]*)"', html)
render = {"og_site_name": meta("og:site_name"), "og_image": meta("og:image"),
          "org_schema_name": org.group(1) if org else None,
          "form_actions": sorted(set(re.findall(r'<form[^>]*action="([^"]*)"', html)))}

try:
    sm = open(f"{tmp}/sitemap.xml").read()
except FileNotFoundError:
    sm = ""
sitemap_urls = re.findall(r"<loc>([^<]+)</loc>", sm)

doc = {
  "meta": {"kind": "content-inventory", "host": host, "prefix": prefix,
           "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")},
  "config": {"sitename": cfg.get("sitename"), "sef": cfg.get("sef"),
             "sef_rewrite": cfg.get("sef_rewrite"), "htaccess": htaccess,
             "caching": cfg.get("caching"), "force_ssl": cfg.get("force_ssl"),
             "error_reporting": cfg.get("error_reporting"),
             "db_tz_offset_min": tz_offset_min},
  "menus": {k: v for k, v in menus_by_type.items()},
  # Client footers usually already carry a proper legal set (trap 19) — surface
  # any menutype holding 2+ legal-looking items so the chrome mapping snaps to it.
  "legal_menus": [k for k, v in menus_by_type.items()
                  if sum(1 for i in v if i["published"] and re.search(
                      r"terms|privacy|refund|licen[cs]e|cookie|legal|contact",
                      i["title"], re.I)) >= 2],
  "style_pins": style_pins,
  "styles": [{"id": int(r[0]), "default": r[1] == "1", "title": r[2]} for r in rows("styles.tsv")],
  "content_mines": {
    "categories": [{"id": int(r[0]), "title": r[1], "level": int(r[2]), "articles": int(r[3])}
                   for r in rows("cats.tsv") if int(r[3]) > 0],
    "top_articles": [{"id": int(r[0]), "title": r[1], "catid": int(r[2]), "hits": int(r[3])}
                     for r in rows("top_articles.tsv")],
  },
  "extensions_ui": sorted(ext, key=lambda e: (e["type"], e["element"])),
  "seo_stack": {"plugins": seo,
                "sh404_tables": [r[0] for r in rows("sh404.tsv")],
                "sitemap": {"url_count": len(sitemap_urls),
                            "sample": sitemap_urls[:50]}},
  "link_check": links,
  "real_copy_css": {"top_classes": classes.most_common(30),
                    "fa_icons": sorted(icons_fa),
                    "style_blocks": style_blocks,
                    "inline_colors": inline_colors,
                    "sampled_articles": len(rows("copy.tsv"))},
  "branding": {"sitename": cfg.get("sitename"), "logo_candidates": logos,
               "icons": icons, "social_urls": sorted(socials)},
  "render": render,
  "a11y_quick": {"html_lang": lang},
}
with open(out, "w") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1)
bad = [l for l in links if l["kind"] == "internal" and (l["status"] or 0) >= 400]
print(f"content-inventory: {sum(len(v) for v in doc['menus'].values())} menu items across "
      f"{len(doc['menus'])} menutypes, {len(doc['content_mines']['categories'])} categories, "
      f"{len(ext)} ui-extensions, link_check {len(links)} items ({len(bad)} >=400) -> {out}")
PYEOF
