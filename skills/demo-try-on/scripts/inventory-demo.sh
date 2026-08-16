#!/usr/bin/env bash
#
# What the demo offers: every slot that carries content, and how much each one wants.
#
#   inventory-demo.sh --demo <label> [--pretty]
#
# This is the right-hand side of the artifact map. `position`, `module` and `wants` come from
# here and are not the mapper's to edit — if `wants` looks wrong, this file is wrong.
#
# ## Read from the running demo, not from the template's files
#
# 🔒 The two disagree. `ja_teline_v/etc/layout/magazine-home.ini` declares `home-1` and `home-2`;
# the demo puts nothing in either and runs its front page on `news-home` (7 modules),
# `news-health`, `news-sport`, `news-tech`, `news-world`. The .ini says what the template CAN
# have; the demo says what JoomlArt actually built. Planning against the .ini fills positions the
# template's own demo leaves empty.
#
# ## Only slots that can take a category
#
# 🔒 Taking "whatever module the demo runs here" was not enough either: it offered `sidebar`
# (Popular Tags) and `sidebar-1` (a finance widget) as content slots. Neither reads articles. A
# position counts only when the module in it can be pointed at a category.

set -euo pipefail

DEMO=""; PRETTY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --demo) DEMO="$2"; shift 2 ;;
    --pretty) PRETTY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DEMO" ] || { echo "need --demo <label>" >&2; exit 2; }

ROOT="/srv/tracy/$DEMO/webroot"
[ -d "$ROOT" ] || { echo "no demo at $ROOT" >&2; exit 1; }

PASS=$(grep -m1 '^DB_PASSWORD=' "/srv/tracy/$DEMO/.env" | cut -d= -f2-)
PREFIX=$(grep -m1 'dbprefix' "$ROOT/configuration.php" | sed "s/.*= *'\([^']*\)'.*/\1/")
DBNAME=$(grep -m1 'public \$db ' "$ROOT/configuration.php" | sed "s/.*= *'\([^']*\)'.*/\1/")

# `-r` (raw) throughout: batch mode escapes backslashes, and ACM params are JSON with JSON
# escaped inside them — read as text they arrive unparseable.
#
# And `to_base64` wraps at 76 characters, so its newlines have to go BEFORE the row is assembled.
# 🔒 Stripping them after the fact does not work: raw mode emits them literally, so one module's
# row arrives as twenty lines and every field but the first is lost.
q() { docker exec "${DEMO}-db-1" mariadb -uroot -p"$PASS" -N -B -r "$DBNAME" -e "$1" 2>/dev/null; }

CONTENT_MODULES="'mod_ja_acm','mod_articles_category','mod_articles_news','mod_articles_latest','mod_articles_popular','mod_articles_archive'"
CHROME='^(topbar|off-canvas|header|footer|breadcrumb|debug|navhelper|mainnav|banner|acy|menu|search|login)'

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

# One row per content module: position, module, title, base64 params. Ordered as the demo orders
# them, because that order is a design decision — the first block on a page is the loudest.
q "select concat(position, '|', module, '|', replace(title,'|','/'), '|', replace(replace(to_base64(params), '\n', ''), '\r', ''))
     from ${PREFIX}modules
    where published = 1 and client_id = 0 and position <> ''
      and module in ($CONTENT_MODULES)
    order by position, ordering;" | grep -vE "^($(echo "$CHROME" | sed 's/^\^(//; s/)$//'))" > "$WORK/rows" || true

# Template styles say which layouts exist and which one is the site default — a try-on has to
# know which shell it is dressing.
q "select concat(id, '|', coalesce(title,''), '|', coalesce(home,'0'))
     from ${PREFIX}template_styles order by id;" > "$WORK/styles" || true

python3 - "$WORK" "$DEMO" "$PRETTY" "$PREFIX" <<'PY'
import base64, json, os, re, sys

work, demo, pretty = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
prefix = sys.argv[4] if len(sys.argv) > 4 else ""

def decode(b64):
    try:
        return json.loads(base64.b64decode(b64).decode("utf-8"))
    except Exception:
        return {}

# How many items a block renders.
#
# Every module type keeps this in its own key, and an ACM block keeps it inside `jatools-config`,
# a JSON document serialised INSIDE the params JSON. Rather than learn a format JoomlArt owns and
# can change, walk the whole tree and add up the counts that are there — leading + intro + links
# is how these blocks are actually built, and the sum is what the slot consumes.
COUNT_KEYS = re.compile(r"(featured_leading|featured_intro|featured_links|^count$|\[count\]|num_leading|num_intro)", re.I)

def wants(node, depth=0):
    if depth > 8:
        return 0
    total = 0
    if isinstance(node, dict):
        for k, v in node.items():
            if COUNT_KEYS.search(k):
                vals = v if isinstance(v, list) else [v]
                for item in vals:
                    try:
                        # Capped. 🔒 The demo's `whatsnew` ticker asks for 99 — that is "take
                        # everything", not an appetite, and left uncapped it doubled the whole
                        # inventory's total on its own. A block wanting more than two dozen items
                        # is configured to drain a category, and for planning purposes 24 is the
                        # honest number.
                        total += min(int(str(item)), 24)
                    except (TypeError, ValueError):
                        pass
            else:
                total += wants(v, depth + 1)
    elif isinstance(node, list):
        for item in node:
            total += wants(item, depth + 1)
    elif isinstance(node, str) and node.strip().startswith("{"):
        try:
            total += wants(json.loads(node), depth + 1)
        except Exception:
            pass
    return total

# Which ACM block a module runs — the demo names it in `jatools-config[":type"]`, e.g.
# "ja_teline_v:news-featured". Worth carrying: it is the name of the shape the content lands in.
def block_of(params, module=""):
    """Tên kiểu block, hoặc tên module khi khe không do ACM dựng.

    🔒 Trả None là để lại một trường mà mọi người đọc phải tự đoán nghĩa. Khe của
    `mod_articles_popular` hay `mod_articles_news` vẫn là khe thật, chỉ không phải ACM — và trên
    JA Stratum có 3 khe như thế trong 24. Một `null` ở đó làm hỏng mọi thứ in ra bảng, mà điều
    nó muốn nói chỉ là "khe này không phải block ACM".
    """
    cfg = params.get("jatools-config")
    if isinstance(cfg, str):
        try:
            cfg = json.loads(cfg)
        except Exception:
            return None
    if isinstance(cfg, dict):
        t = cfg.get(":type")
        if isinstance(t, str) and ":" in t:
            return t.split(":", 1)[1]
    # Không phải ACM: tên module là câu trả lời đọc được nhất cho "khe này là gì".
    return module or "unknown"

slots, seen = [], {}
for line in open(os.path.join(work, "rows")):
    line = line.rstrip("\n")
    if not line:
        continue
    parts = line.split("|", 3)
    if len(parts) < 4:
        continue
    position, module, title, b64 = parts
    params = decode(b64)
    n = wants(params)
    # Several modules can share a position; the slot's appetite is all of them together.
    if position in seen:
        idx = seen[position]
        slots[idx]["wants"] += n
        slots[idx]["modules"] += 1
        continue
    seen[position] = len(slots)
    slots.append({
        "position": position,
        "module": module,
        "block": block_of(params, module),
        "title": title,
        "wants": n,
        "modules": 1,
    })

styles = []
for line in open(os.path.join(work, "styles")):
    line = line.rstrip("\n")
    if not line:
        continue
    sid, title, home = (line.split("|") + ["", ""])[:3]
    styles.append({"id": sid, "title": title, "default": home not in ("0", "")})

out = {
    "demo": demo,
    # 🔒 The table prefix, because generate-fill needs it and nothing else tells the agent what it
    # is. Left out once: the agent guessed `j4_demo`, the real one was `jos_`, and the SQL died on
    # "Table 'j4_demotags' doesn't exist" AFTER the try-on was already on the demo — so the run
    # ended with client articles in place and nothing generated to fill the rest.
    "prefix": prefix,
    "slots": sorted(slots, key=lambda s: (-s["wants"], s["position"])),
    "styles": styles,
    "totals": {
        "slots": len(slots),
        "articles_wanted": sum(s["wants"] for s in slots),
    },
}
print(json.dumps(out, ensure_ascii=False, indent=2 if pretty else None))
PY
