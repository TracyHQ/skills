#!/usr/bin/env bash
#
# What the client side offers, and the snapshot `take-off.sh` restores against.
#
#   inventory-client.sh --client <label> [--pretty]
#
# READ ONLY. This script opens the client's working copy and writes nothing to it, in any
# direction. If a later step is about to write to the client side, that is a bug — the whole
# point of this skill is that the client's site is reference material, not a destination.
#
# Produced once at the start of a run and then left alone: the mapper reads it, `apply-map.sh`
# validates against it, and `take-off.sh` treats it as the record of what was true before.

set -euo pipefail

CLIENT=""; PRETTY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --client) CLIENT="$2"; shift 2 ;;
    --pretty) PRETTY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$CLIENT" ] || { echo "need --client <label>" >&2; exit 2; }

ROOT="/srv/tracy/$CLIENT/webroot"
[ -d "$ROOT" ] || { echo "no client copy at $ROOT" >&2; exit 1; }

PASS=$(grep -m1 '^DB_PASSWORD=' "/srv/tracy/$CLIENT/.env" | cut -d= -f2-)
PREFIX=$(grep -m1 'dbprefix' "$ROOT/configuration.php" | sed "s/.*= *'\([^']*\)'.*/\1/")
DBNAME=$(grep -m1 'public \$db ' "$ROOT/configuration.php" | sed "s/.*= *'\([^']*\)'.*/\1/")
q() { docker exec "${CLIENT}-db-1" mariadb -uroot -p"$PASS" -N -B -r "$DBNAME" -e "$1" 2>/dev/null; }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

# Categories carry the count that decides everything downstream: a slot wanting 7 articles from a
# category holding 4 is the difference between `fill: client` and `fill: mixed`.
q "select concat(c.id,'|',replace(c.title,'|','/'),'|',count(a.id),'|',coalesce(c.language,'*'),'|',
        coalesce(a.language,'*'))
     from ${PREFIX}categories c
     join ${PREFIX}content a on a.catid = c.id and a.state = 1
    where c.extension = 'com_content'
    group by c.id, a.language order by count(a.id) desc;" > "$WORK/categories"

# Per-article facts the map and the image step both need. Image presence is read from the JSON
# column, not counted as "field non-empty" — 🔒 the first fixture reported 28/28 that way and had
# 8 distinct files behind them, because articles reuse images.
q "select concat(a.id,'|',a.catid,'|',coalesce(a.language,'*'),'|',
        char_length(a.title),'|',
        case when a.images like '%image_intro\":\"_%' or a.images like '%image_fulltext\":\"_%' then '1' else '0' end,'|',
        replace(substring_index(replace(replace(a.images,'\"image_intro\":\"',''),'\\\\\\\\/','/'),'\"',1),'|','/'))
     from ${PREFIX}content a where a.state = 1;" > "$WORK/articles"

q "select concat(coalesce(language,'*'),'|',count(*)) from ${PREFIX}content
    where state = 1 group by language order by count(*) desc;" > "$WORK/languages"

# Custom modules — the half a content inventory misses if it only reads articles.
#
# 🔒 On the first fixture the site had 28 articles and 18 published `mod_custom` blocks, and the
# headlines on its own front page — "Accédez aisement aux cours en ligne", "Formation A la Carte!"
# — were in the modules, not in `#__content`. Reading articles alone means generating replacements
# for words the client already wrote.
#
# Content travels base64'd: it is HTML with quotes and newlines, and a `|`-joined row would shred.
q "select concat(id,'|',replace(coalesce(title,''),'|','/'),'|',coalesce(position,''),'|',
        coalesce(language,'*'),'|',char_length(coalesce(content,'')),'|',
        replace(replace(to_base64(coalesce(content,'')),'\n',''),'\r',''))
     from ${PREFIX}modules
    where published = 1 and client_id = 0 and module = 'mod_custom'
      and char_length(coalesce(content,'')) > 40
    order by char_length(content) desc;" > "$WORK/custom"

# Which non-core components hold content. Not read — 🔒 the fixture runs Guru LMS, whose courses
# live in tables this script has never seen. Naming them is useful; guessing their schema is not.
q "select concat(rpad(module,28,' '),count(*)) from ${PREFIX}modules
    where published = 1 and client_id = 0
      and module not in ('mod_custom','mod_menu','mod_login','mod_footer','mod_languages',
                         'mod_finder','mod_search','mod_breadcrumbs','mod_banners')
    group by module order by count(*) desc;" > "$WORK/other_modules"

# The menu tells the mapper what the site is FOR — a training centre's tree reads differently
# from a shop's, and that reading is the part no count can give.
q "select concat(m.id,'|',replace(m.title,'|','/'),'|',m.level,'|',coalesce(m.link,''))
     from ${PREFIX}menu m
    where m.published = 1 and m.client_id = 0 and m.menutype <> 'main'
    order by m.lft limit 60;" > "$WORK/menu"

q "select concat(u.id,'|',replace(u.name,'|','/'),'|',count(a.id))
     from ${PREFIX}users u join ${PREFIX}content a on a.created_by = u.id and a.state = 1
    group by u.id order by count(a.id) desc limit 20;" > "$WORK/authors"

# The logo is copied, never generated (see references/generation-rules.md §5), so the inventory
# has to say whether one exists at all.
LOGOS=$(cd "$ROOT" && find images templates -maxdepth 4 -iname '*logo*' \
  \( -iname '*.png' -o -iname '*.svg' -o -iname '*.jpg' -o -iname '*.webp' \) 2>/dev/null | head -10 || true)

python3 - "$WORK" "$CLIENT" "$PRETTY" <<PY
import json, os, sys
work, client, pretty = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
logos = """$LOGOS""".split()

def rows(name, n):
    out = []
    path = os.path.join(work, name)
    if not os.path.exists(path):
        return out
    for line in open(path):
        line = line.rstrip("\n")
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < n:
            continue
        out.append(parts)
    return out

# Counted per ARTICLE language, not per category language.
#
# 🔒 The fixture has a category titled "Our Blog" flagged en-GB whose four articles are every one
# of them fr-FR. Reporting it as "4 articles" sent the en-GB mapper straight at it, and apply-map
# selected on the article's language and copied nothing — a slot promised content and delivered an
# empty block, with no step in between saying why.
_cats = {}
for r in rows("categories", 5):
    cid = int(r[0])
    row = _cats.setdefault(cid, {"id": cid, "title": r[1], "language": r[3],
                                 "articles": 0, "by_language": {}})
    row["articles"] += int(r[2])
    row["by_language"][r[4]] = row["by_language"].get(r[4], 0) + int(r[2])
categories = sorted(_cats.values(), key=lambda c: -c["articles"])

# A custom module is a content source in its own right: a headline plus a body somebody wrote.
# The chars count is what decides whether it can carry a block: a 60-character module is a
# button, a 900-character one is a section.
import base64 as _b64, re as _re, html as _html

def _text(fragment):
    """Tags out, entities decoded, whitespace collapsed."""
    return _re.sub(r"\s+", " ", _html.unescape(_re.sub(r"<[^>]+>", " ", fragment or ""))).strip()
custom = []
for r in rows("custom", 6):
    try:
        body = _b64.b64decode(r[5]).decode("utf-8", "replace")
    except Exception:
        body = ""
    # The HTML is NOT carried forward. 🔒 The fixture's modules are built out of the client's own
    # template classes (gru-hero, sub-intro, col-lg-4); pasted into Teline V they render as broken
    # layout, and Teline V has nowhere to paste them anyway — its front page is 33 ACM blocks
    # reading categories, against 5 incidental custom modules.
    #
    # What survives is the prose: heading + paragraph pairs, which are the client's own words about
    # their own business and can be seated in a block the way an article is. Every pair recovered
    # here is one fewer article somebody has to invent.
    blocks = []
    for m in _re.finditer(
            r"<h([1-6])[^>]*>(.*?)</h\1>\s*(?:<p[^>]*>(.*?)</p>)?", body, _re.S | _re.I):
        head = _text(m.group(2))
        para = _text(m.group(3) or "")
        if len(head) < 8 or head.lower() in ("follow us:",):
            continue
        blocks.append({"heading": head, "body": para})
    custom.append({"id": int(r[0]), "title": r[1], "position": r[2],
                   "language": r[3], "chars": int(r[4]), "blocks": blocks})

articles, images = [], set()
for r in rows("articles", 6):
    path = r[5].split("#")[0].strip()
    if r[4] == "1" and path:
        images.add(path)
    articles.append({"id": int(r[0]), "catid": int(r[1]), "language": r[2],
                     "title_len": int(r[3]), "has_image": r[4] == "1"})

out = {
    "client": client,
    "categories": categories,
    "languages": [{"language": r[0], "articles": int(r[1])} for r in rows("languages", 2)],
    "menu": [{"id": int(r[0]), "title": r[1], "level": int(r[2]), "link": r[3]}
             for r in rows("menu", 4)],
    "authors": [{"id": int(r[0]), "name": r[1], "articles": int(r[2])} for r in rows("authors", 3)],
    "custom_modules": custom,
    "other_components": [line.strip() for line in
                         (open(os.path.join(work, "other_modules")).read().splitlines()
                          if os.path.exists(os.path.join(work, "other_modules")) else []) if line.strip()],
    "logos": logos,
    "totals": {
        "articles": len(articles),
        "categories_with_articles": len(categories),
        # Two numbers, deliberately. "Articles carrying an image" is what a SQL count gives and it
        # flatters the site; "distinct image files" is what the demo's blocks actually consume.
        "articles_with_image": sum(1 for a in articles if a["has_image"]),
        "distinct_images": len(images),
        "languages": len(set(a["language"] for a in articles)),
        # Counted beside articles on purpose: the two together are what the client actually
        # published, and one without the other understates them.
        "custom_modules": len(custom),
        "custom_module_chars": sum(c["chars"] for c in custom),
        # The number that actually changes the plan: prose the client already wrote, seatable in a
        # block without inventing anything.
        "custom_blocks": sum(len(c["blocks"]) for c in custom),
        "custom_blocks_with_body": sum(1 for c in custom for b in c["blocks"] if b["body"]),
    },
}
print(json.dumps(out, ensure_ascii=False, indent=2 if pretty else None))
PY
