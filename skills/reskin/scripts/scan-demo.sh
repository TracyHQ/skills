#!/usr/bin/env bash
# scan-demo.sh — build the Pattern library (so khuon) of a template demo/quickstart.
#
# Reads a demo's containers (DB + webroot) and emits one JSON document describing
# everything the Reskin pipeline needs from the mold side: pages, blocks and their
# JSON shapes, styles (default vs home), UI-relevant extensions with versions,
# asset list, css libraries, chrome (header/menu/footer), and the branding
# deny-list. Read-only: never writes to the site.
#
# Spec: ../references/spec.md
#
# Usage:
#   scan-demo.sh --db <db-container> --web <web-container> --prefix <tblprefix> \
#                --pass <db-root-pass> [--out /path/pattern-library.json]
set -euo pipefail

DB="" WEB="" PREFIX="" PASS="" OUT="" HOST="" PORT=""
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
[ -n "$DB" ] && [ -n "$WEB" ] && [ -n "$PREFIX" ] && [ -n "$PASS" ] || {
  echo "usage: scan-demo.sh --db <ctr> --web <ctr> --prefix <p> --pass <pw> [--out f]" >&2
  exit 2
}
OUT="${OUT:-/opt/tracy-fleet/reskin/out/pattern-library.json}"
mkdir -p "$(dirname "$OUT")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The site names its own database in configuration.php, exactly where $dbprefix already comes
# from. This line used to say `joomla` — true of the fleet's own stacks, and silently wrong
# anywhere else, which reads as "the script is broken" rather than "it asked the wrong database".
DBNAME=$(docker exec "$WEB" grep -m1 "public .db = " /var/www/html/configuration.php | sed "s/.*= *'\\([^']*\\)'.*/\\1/")
[ -n "$DBNAME" ] || { echo "could not read the database name from $WEB:/var/www/html/configuration.php" >&2; exit 1; }
sql() { docker exec "$DB" mariadb -uroot -p"$PASS" "$DBNAME" -N -B -e "$1" 2>/dev/null; }
# TO_BASE64 wraps lines every 76 chars; strip the newlines so TSV stays one row per row.
B64="REPLACE(TO_BASE64(%s), CHAR(10), '')"

sql "SELECT id, home, title, $(printf "$B64" params) FROM ${PREFIX}template_styles WHERE client_id=0" > "$TMP/styles.tsv"
sql "SELECT id, menutype, title, level, published, template_style_id, path, $(printf "$B64" link) FROM ${PREFIX}menu WHERE client_id=0 AND id>1" > "$TMP/menus.tsv"
sql "SELECT id, title, module, position, published, $(printf "$B64" params) FROM ${PREFIX}modules WHERE client_id=0" > "$TMP/modules.tsv"
sql "SELECT moduleid, menuid FROM ${PREFIX}modules_menu" > "$TMP/modules_menu.tsv"
sql "SELECT extension_id, type, element, IFNULL(folder,''), client_id, enabled, $(printf "$B64" manifest_cache) FROM ${PREFIX}extensions" > "$TMP/extensions.tsv"
sql "SELECT id, title, alias, $(printf "$B64" introtext) FROM ${PREFIX}content WHERE introtext LIKE '%loadposition%'" > "$TMP/shell_articles.tsv"

# Webroot facts: template dirs, css files, darkmode, asset manifests.
docker exec "$WEB" sh -c '
  for d in /var/www/html/templates/*/; do
    [ -f "$d/templateDetails.xml" ] || continue
    echo "TPL $(basename "$d")"
    ls "$d/css" 2>/dev/null | sed "s/^/CSS /"
    [ -f "$d/joomla.asset.json" ] && echo "ASSETJSON $(basename "$d")"
  done
  grep -o "Font Awesome [0-9][^ ]*" -r /var/www/html/media/vendor/fontawesome-free/css/all.min.css 2>/dev/null | head -1 | sed "s/^/FA /"
  grep -o "Bootstrap v[0-9.]*" /var/www/html/media/vendor/bootstrap/css/bootstrap.min.css 2>/dev/null | head -1 | sed "s/^/BS /"
  grep -E "public [\$]sitename = " /var/www/html/configuration.php | sed "s/^[[:space:]]*/SITENAME /"
' > "$TMP/web.txt" 2>/dev/null || true

# Rendered-page facts (og/schema/newsletter form) when the copy answers HTTP.
if [ -n "$HOST" ] && [ -n "$PORT" ]; then
  curl -s -m 15 -H "Host: $HOST" -H "X-Forwarded-Proto: https" \
    "http://127.0.0.1:$PORT/" > "$TMP/home.html" || true
fi

python3 - "$TMP" "$OUT" "$PREFIX" <<'PYEOF'
import base64, csv, json, re, sys
from collections import defaultdict
from datetime import datetime, timezone

tmp, out, prefix = sys.argv[1], sys.argv[2], sys.argv[3]

def rows(name):
    with open(f"{tmp}/{name}") as f:
        return [r for r in csv.reader(f, delimiter="\t") if r]

def b64(s):
    try:
        return base64.b64decode(s).decode("utf-8", "replace")
    except Exception:
        return ""

def params_json(raw):
    try:
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}

asset_refs = set()
styles = []
for r in rows("styles.tsv"):
    p = params_json(b64(r[3]))
    # A template's logo, footer logo and favicon live in STYLE params, not in any
    # block — miss them and the dressed site renders a broken logo (Teline, 12/08).
    for value in p.values():
        if isinstance(value, str) and re.search(r"\.(?:png|jpe?g|svg|webp|ico|gif)$", value, re.I):
            asset_refs.add(value.lstrip("/"))
    # Joomla's `home` column marks the site DEFAULT style — nothing to do with a
    # home-page style, which this pipeline also talks about. Rename to avoid it.
    styles.append({"id": int(r[0]), "default": r[1] == "1", "title": r[2],
                   "t4_layout": p.get("layout") or p.get("t4_layout")})

menus, menu_by_id = [], {}
for r in rows("menus.tsv"):
    link = b64(r[7])
    m = {"id": int(r[0]), "menutype": r[1], "title": r[2], "level": int(r[3]),
         "published": r[4] == "1", "style": int(r[5] or 0), "path": r[6], "link": link,
         "article_id": None, "layout": None, "placeholder": link.strip() in ("#", "")}
    a = re.search(r"option=com_content&view=article&id=(\d+)", link)
    if a: m["article_id"] = int(a.group(1))
    lay = re.search(r"[?&]layout=([A-Za-z0-9_:]+)", link)
    if lay: m["layout"] = lay.group(1)
    menus.append(m); menu_by_id[m["id"]] = m

assign = defaultdict(list)
for r in rows("modules_menu.tsv"):
    assign[int(r[0])].append(int(r[1]))

blocks, shapes, logo_fields, hardcoded = [], {}, [], []
domains = set()
for r in rows("modules.tsv"):
    if r[4] != "1":
        continue
    raw = b64(r[5]); p = params_json(raw)
    acm = None
    cfg = p.get("jatools-config")
    if cfg:
        try:
            inner = json.loads(cfg)
            acm = inner.get(":type")
            if acm and acm not in shapes:
                sec = acm.split(":")[-1]
                body = inner.get(sec, {})
                # Field names alone leave the copywriter blind (trap 18): keep a
                # truncated demo value per field so real copy is written to size.
                def trunc(v):
                    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
                    return s[:80]
                shapes[acm] = {"example_module": int(r[0]),
                               "fields": sorted(body.keys()) if isinstance(body, dict) else [],
                               "examples": ({k: trunc(v) for k, v in body.items()}
                                            if isinstance(body, dict) else {})}
        except Exception:
            pass
    for img in re.findall(r"images/[A-Za-z0-9_/.\\-]+\.(?:jpe?g|png|webp|svg|avif|gif)", raw):
        asset_refs.add(img.replace("\\/", "/"))
    for f in re.findall(r'"([a-z-]+\[[a-z-]*(?:logo|image|img|avatar)[a-z-]*\][^"]*)"', raw):
        logo_fields.append({"module": int(r[0]), "field": f})
    # `&` may be stored as `&amp;` or `&` inside params, so anchor on the
    # com_content mention and accept any junk (except a closing quote) before id=.
    # JSON may escape slashes (`article\/95`) and `&` as `&amp;` — accept both.
    for h in re.findall(r"(?:option=com_content[^\"']{0,200}?[&;?]id=|article\\?/)(\d+)", raw):
        hardcoded.append({"module": int(r[0]), "title": r[1], "article_id": int(h)})
    for d in re.findall(r"https?://([A-Za-z0-9.-]+)", raw):
        domains.add(d)
    b = {"id": int(r[0]), "title": r[1], "module": r[2], "position": r[3],
         "acm_type": acm, "menus": sorted(assign.get(int(r[0]), []))}
    # A menu module's params say which menutype feeds it — the footer-column
    # binding the mapping needs.
    if r[2] == "mod_menu" and p.get("menutype"):
        b["bound_menutype"] = p["menutype"]
    blocks.append(b)

# Pages: published component menu items + the positions their article shell loads
# and the modules assigned to them, grouped by position.
shell_pos = {}
for r in rows("shell_articles.tsv"):
    shell_pos[int(r[0])] = re.findall(r"\{loadposition ([A-Za-z0-9_-]+)", b64(r[3]))

by_menu_pos = defaultdict(lambda: defaultdict(list))
for b in blocks:
    for mid in b["menus"]:
        by_menu_pos[mid][b["position"]].append(b["id"])

pages = []
for m in menus:
    if not m["published"] or m["placeholder"]:
        continue
    pages.append({**m,
                  "shell_positions": shell_pos.get(m["article_id"] or -1, []),
                  "modules_by_position": dict(by_menu_pos.get(m["id"], {}))})

# UI-relevant extensions: menu-linked components, positioned modules,
# render plugins, templates. Version from manifest_cache.
ext = []
menu_components = {re.search(r"option=(com_[a-z0-9_]+)", m["link"]).group(1)
                   for m in menus if re.search(r"option=(com_[a-z0-9_]+)", m["link"])}
positioned_modules = {b["module"] for b in blocks if b["position"]}
for r in rows("extensions.tsv"):
    typ, el, folder, client, enabled = r[1], r[2], r[3], r[4], r[5] == "1"
    man = params_json(b64(r[6]))
    ver = man.get("version")
    reason = None
    if typ == "component" and el in menu_components: reason = "menu-linked"
    elif typ == "module" and el in positioned_modules and client == "0": reason = "positioned-module"
    elif typ == "plugin" and folder in ("content", "system", "fields"): reason = "render-plugin"
    elif typ == "template" and client == "0": reason = "template"
    if reason:
        ext.append({"type": typ, "element": el, "folder": folder or None,
                    "version": ver, "enabled": enabled, "reason": reason})

# Webroot facts.
tpl, css_files, fa, bs, sitename, assetjson = None, [], None, None, None, []
for line in open(f"{tmp}/web.txt"):
    line = line.rstrip("\n")
    if line.startswith("TPL "): tpl = line[4:]
    elif line.startswith("CSS "): css_files.append(line[4:])
    elif line.startswith("FA "): fa = line[3:]
    elif line.startswith("BS "): bs = line[3:]
    elif line.startswith("ASSETJSON "): assetjson.append(line[10:])
    elif line.startswith("SITENAME "):
        m = re.search(r"'(.*)'", line); sitename = m.group(1) if m else None

HDR = re.compile(r"head|logo|nav|off-canvas|banner-top|top-bar", re.I)
FOOT = re.compile(r"foot", re.I)
menutypes = defaultdict(int)
for m in menus:
    if m["published"]: menutypes[m["menutype"]] += 1

namespaces = defaultdict(int)
for a in asset_refs:
    parts = a.split("/")
    namespaces["/".join(parts[:2]) if len(parts) > 2 else parts[0]] += 1

doc = {
  "meta": {"kind": "pattern-library", "template": tpl, "prefix": prefix,
           "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")},
  "styles": [{**s, "pinned_by": [m["id"] for m in menus if m["style"] == s["id"]]} for s in styles],
  "pages": pages,
  "blocks": blocks,
  "block_shapes": shapes,
  "extensions_ui": sorted(ext, key=lambda e: (e["type"], e["element"])),
  "assets": {"refs": sorted(asset_refs), "namespaces": dict(namespaces)},
  "css_libraries": {"template_css": css_files, "darkmode": "darkmode.css" in css_files,
                    "fontawesome": fa, "bootstrap": bs, "joomla_asset_json": assetjson},
  "chrome": {
    "header_modules": [b for b in blocks if HDR.search(b["position"] or "")],
    "footer_modules": [b for b in blocks if FOOT.search(b["position"] or "")],
    "menutypes": dict(menutypes),
    "placeholder_items": [{"id": m["id"], "menutype": m["menutype"], "title": m["title"]}
                          for m in menus if m["published"] and m["placeholder"]],
    "hardcoded_article_ids": hardcoded,
  },
  "branding_denylist": {
    "sitename": sitename,
    "name_tokens": [t for t in {sitename, (tpl or "").replace("ja_", "")} if t],
    "domains": sorted(domains),
    "logo_fields": logo_fields,
  },
  "a11y": {"darkmode_css": "darkmode.css" in css_files, "baseline": None},
}

# Rendered-page facts, when a homepage HTML was fetched.
try:
    html = open(f"{tmp}/home.html").read()
except FileNotFoundError:
    html = ""
if html:
    def meta(prop):
        m = re.search(r'(?:property|name)="%s" content="([^"]*)"' % re.escape(prop), html)
        return m.group(1) if m else None
    org = re.search(r'"@type":"Organization"[^}]*?"name":"([^"]*)"', html)
    doc["render"] = {
        "og_site_name": meta("og:site_name"), "og_image": meta("og:image"),
        "html_lang": (re.search(r'<html[^>]*lang="([^"]+)"', html) or [None, None])[1],
        "org_schema_name": org.group(1) if org else None,
        "form_actions": sorted(set(re.findall(r'<form[^>]*action="([^"]*)"', html))),
    }
with open(out, "w") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1)
print(f"pattern-library: {len(pages)} pages, {len(blocks)} blocks, "
      f"{len(shapes)} shapes, {len(ext)} ui-extensions, {len(asset_refs)} assets -> {out}")
PYEOF
