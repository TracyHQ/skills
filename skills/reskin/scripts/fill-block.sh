#!/usr/bin/env bash
# fill-block.sh — the workhorse of the Reskin pipeline. Takes ONE declarative
# job file (JSON, authored by the mapping agent) and applies it to a client
# working copy: page shell + menu item + ACM/module blocks with real copy.
#
# The agent never writes SQL. Every mechanical trap learned on the reference pair is
# owned here (spec: tracy-docs/reskin/README.md, traps 8-10, 12, 16, 20, 22-25):
#   - params written via FROM_BASE64, inner JSON serialized RAW UTF-8
#   - article shells get publish_up NULL and an alias that IS the public URL
#   - menu items: nested-set append, `layout=fullwidth` inside the LINK
#   - forSEF rows purged after any link/alias change, then re-warmed
#   - Joomla cache cleared after writes
#   - immediate render verify (markers present, demo strings absent,
#     no literal {loadposition}) — a failed verify exits nonzero
#
# Job schema (all IDs are final client-side IDs, offset already applied):
# {
#  "client": {"db":"...","web":"...","prefix":"ja_","pass":"...","host":"...","port":"8084"},
#  "source": {"db":"...","prefix":"stratum_","pass":"..."},          // demo DB for source modules
#  "page": {                                                         // optional
#    "article_id":3084, "title":"Joomla MCP", "alias":"joomla-mcp",
#    "position":"features-page",
#    "menu":{"id":913,"mode":"repoint"|"create","parent_id":1,
#            "menutype":"mainmenu","style_id":174}
#  },
#  "modules":[{"id":1228,"title":"[Stratum] ...","position":"features-page",
#              "ordering":1,"source_module":228,"menus":[913],
#              "set":{"features-grid[title]":["..."],
#                     "features-grid[data]":{"features-grid[data][title]":["..."]}}}],
#  "purge_sef_like":["joomla-mcp%"],                                 // extra purges
#  "verify":{"path":"/joomla-mcp","markers":["..."],"forbid":["THE STACK"]}
# }
#
# Usage: fill-block.sh <job.json>
set -euo pipefail
JOB="${1:-}"
[ -f "$JOB" ] || { echo "usage: fill-block.sh <job.json>" >&2; exit 2; }

python3 - "$JOB" <<'PYEOF'
import base64, html as htmlmod, json, re, subprocess, sys, urllib.request

job = json.load(open(sys.argv[1]))

# The pipeline's one human gate, made mechanical. A job that names no approved
# mapping is a job whose decisions nobody reviewed — and an advisory step is a
# step an agent skips under pressure (it happened, 12/08: a login form landed on
# a dressed homepage because the mapping step was skipped from memory).
if not str(job.get("mapping", "")).strip():
    raise SystemExit(
        "refused: this job names no mapping.\n"
        "  Add \"mapping\": \"<path or note naming the approved mapping>\" once the\n"
        "  decisions in it have been reviewed by a person. Every block, every chrome\n"
        "  slot, and every client module the new template's positions would surface\n"
        "  belongs in that document before anything is written.")

C = job["client"]

def sql_on(db, pw, q):
    r = subprocess.run(["docker", "exec", db, "mariadb", "-uroot", f"-p{pw}", "joomla", "-N", "-B", "-e", q],
                       capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL failed: {r.stderr[-400:]}\n--- query: {q[:200]}")
    return r.stdout.strip()

def sql(q): return sql_on(C["db"], C["pass"], q)
P = C["prefix"]

def q1(s):  # single-quote a SQL literal
    return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'") + "'"

def b64_of(db, pw, prefix, table, col, where):
    return sql_on(db, pw, f"SELECT REPLACE(TO_BASE64({col}), CHAR(10), '') FROM {prefix}{table} WHERE {where}")

def write_params_b64(obj):
    # Trap 24: ACM chokes on \uXXXX — inner AND outer JSON go out as raw UTF-8.
    return base64.b64encode(json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()).decode()

def deep_set(body, overrides):
    for k, v in overrides.items():
        if isinstance(v, dict) and isinstance(body.get(k), dict):
            deep_set(body[k], v)
            # keep `rows` honest after parallel-array edits
            lens = [len(x) for x in body[k].values() if isinstance(x, list)]
            if "rows" in body[k] and lens:
                body[k]["rows"] = max(lens)
        else:
            body[k] = v

# ---------- page shell + menu ----------
page = job.get("page")
if page and page["menu"].get("mode") == "set":
    m = page["menu"]
    if m.get("link"):
        sql(f"UPDATE {P}menu SET link={q1(m['link'])} WHERE id={m['id']}")
    for key, value in (m.get("params") or {}).items():
        sql(f"UPDATE {P}menu SET params=JSON_SET(params, '$.{key}', {q1(value)}) WHERE id={m['id']}")
    if m.get("style_id"):
        sql(f"UPDATE {P}menu SET template_style_id={m['style_id']} WHERE id={m['id']}")
    page = None
if page:
    alias, aid = page["alias"], page["article_id"]
    taken = sql(f"SELECT id FROM {P}content WHERE alias={q1(alias)} AND id!={aid}")
    if taken:
        raise SystemExit(f"alias '{alias}' already belongs to article {taken} — trap 22b: the alias IS the public URL, pick deliberately")
    intro = "{loadposition %s}" % page["position"]
    sql(f"INSERT INTO {P}content (id, asset_id, title, alias, introtext, `fulltext`, state, catid, created, created_by, created_by_alias, modified, modified_by, publish_up, publish_down, images, urls, attribs, version, ordering, metakey, metadesc, access, hits, metadata, featured, language, note) "
        f"SELECT {aid}, 0, {q1(page['title'])}, {q1(alias)}, {q1(intro)}, '', 1, 9, '2026-08-01 00:00:00', MIN(id), '', '2026-08-01 00:00:00', 0, NULL, NULL, '{{}}', '{{}}', '{{}}', 1, 0, '', '', 1, 0, '{{}}', 0, '*', '' FROM {P}users "
        f"ON DUPLICATE KEY UPDATE introtext=VALUES(introtext), alias=VALUES(alias), title=VALUES(title), publish_up=NULL")

    m = page["menu"]
    link = f"index.php?option=com_content&view=article&id={aid}&layout=fullwidth"  # trap 10: layout lives in the LINK
    if m["mode"] == "repoint":
        sql(f"UPDATE {P}menu SET link={q1(link)}, template_style_id={m['style_id']} WHERE id={m['id']}")
    elif m["mode"] == "create":
        if not sql(f"SELECT id FROM {P}menu WHERE id={m['id']}"):
            parent = m.get("parent_id", 1)
            level = 1 if parent == 1 else int(sql(f"SELECT level FROM {P}menu WHERE id={parent}")) + 1
            ppath = "" if parent == 1 else sql(f"SELECT path FROM {P}menu WHERE id={parent}") + "/"
            comp = sql(f"SELECT extension_id FROM {P}extensions WHERE element='com_content' AND type='component'")
            sql(f"SET @r := (SELECT rgt FROM (SELECT rgt FROM {P}menu WHERE id={parent}) x); "
                f"UPDATE {P}menu SET rgt=rgt+2 WHERE rgt>=@r; UPDATE {P}menu SET lft=lft+2 WHERE lft>@r; "
                f"INSERT INTO {P}menu (id, menutype, title, alias, note, path, link, type, published, parent_id, level, component_id, checked_out, checked_out_time, browserNav, access, img, template_style_id, params, lft, rgt, home, language, client_id, publish_up, publish_down) "
                f"VALUES ({m['id']}, {q1(m['menutype'])}, {q1(page['title'])}, {q1(alias)}, '', {q1(ppath + alias)}, {q1(link)}, 'component', 1, {parent}, {level}, {comp}, NULL, NULL, 0, 1, '', {m['style_id']}, "
                f"'{{\"menu_text\":1,\"menu_show\":\"1\",\"layout\":\"_:fullwidth\",\"show_page_heading\":0}}', @r, @r+1, 0, '*', 0, NULL, NULL)")
    elif m["mode"] == "set":
        # Point an existing menu item at whatever the mold's own page uses — a component
        # layout plus its params. Teline's home is a category rendered through a `blank`
        # layout whose only job is to print one module position, named by the menu item's
        # `load_position`; without this the page has nothing to show. Generic on purpose:
        # the job supplies link and params, the script owns the write.
        if m.get("link"):
            sql(f"UPDATE {P}menu SET link={q1(m['link'])} WHERE id={m['id']}")
        for key, value in (m.get("params") or {}).items():
            sql(f"UPDATE {P}menu SET params=JSON_SET(params, '$.{key}', {q1(value)}) WHERE id={m['id']}")
        if m.get("style_id"):
            sql(f"UPDATE {P}menu SET template_style_id={m['style_id']} WHERE id={m['id']}")
    else:
        raise SystemExit(f"unknown menu.mode {m['mode']!r}")
    # Trap 22a: forSEF keeps routing by stale nonsef until told otherwise.
    sql(f"DELETE FROM {P}forsef_urls WHERE sef LIKE {q1(alias + '%')}")
    sql(f"DELETE FROM {P}forsef_redirects WHERE source LIKE {q1(alias + '%')}")

# ---------- template styles ----------
# A template's logo, favicon and footer branding live in STYLE params, not in any
# block. Porting the mold's logo files makes them load; it does not make them right —
# the client's brand belongs here (branding has no placeholder tier).
for st in job.get("styles", []):
    for key, value in st["set"].items():
        sql(f"UPDATE {P}template_styles SET params=JSON_SET(params, '$.{key}', {q1(value)}) WHERE id={st['id']}")

# ---------- modules ----------
S = job.get("source")
for mod in job.get("modules", []):
    # A block whose fields have no real source is dropped, never left wearing
    # demo copy (mapping rule: no source -> no block).
    if mod.get("unpublish"):
        sql(f"UPDATE {P}modules SET published=0 WHERE id={mod['id']}")
        continue
    if "source_module" in mod:
        raw = base64.b64decode(b64_of(S["db"], S["pass"], S["prefix"], "modules", "params", f"id={mod['source_module']}")).decode()
    else:
        raw = base64.b64decode(b64_of(C["db"], C["pass"], P, "modules", "params", f"id={mod['id']}")).decode()
    params = json.loads(raw)
    inner_raw = params.get("jatools-config")
    if inner_raw is not None and mod.get("set"):
        inner = json.loads(inner_raw)
        sec = inner[":type"].split(":")[-1]
        deep_set(inner[sec], mod["set"])
        params["jatools-config"] = json.dumps(inner, separators=(",", ":"), ensure_ascii=False)
    elif mod.get("set"):
        deep_set(params, mod["set"])
    b = write_params_b64(params)
    module_el = mod.get("module", "mod_ja_acm")
    # mod_custom rows carry their HTML in `content`; base64 keeps quoting out of SQL.
    cb = base64.b64encode(mod.get("content", "").encode()).decode()
    sql(f"INSERT INTO {P}modules (id, asset_id, title, note, content, ordering, position, published, module, access, showtitle, params, client_id, language) "
        f"VALUES ({mod['id']}, 0, {q1(mod['title'])}, '', FROM_BASE64('{cb}'), {mod.get('ordering', 1)}, {q1(mod['position'])}, 1, {q1(module_el)}, 1, 0, FROM_BASE64('{b}'), 0, '*') "
        f"ON DUPLICATE KEY UPDATE params=FROM_BASE64('{b}'), position=VALUES(position), ordering=VALUES(ordering), title=VALUES(title), module=VALUES(module), content=VALUES(content), published=1")
    for menuid in mod.get("menus", []):
        sql(f"INSERT IGNORE INTO {P}modules_menu (moduleid, menuid) VALUES ({mod['id']}, {menuid})")

for like in job.get("purge_sef_like", []):
    sql(f"DELETE FROM {P}forsef_urls WHERE sef LIKE {q1(like)}")

subprocess.run(["docker", "exec", C["web"], "sh", "-c", "rm -rf /var/www/html/cache/* 2>/dev/null; true"], check=False)

# ---------- immediate render verify (the write-then-grep law) ----------
v = job.get("verify")
if v:
    def fetch(path):
        req = urllib.request.Request(f"http://127.0.0.1:{C['port']}{path}",
                                     headers={"Host": C["host"], "X-Forwarded-Proto": "https"})
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, htmlmod.unescape(r.read().decode("utf-8", "replace"))
    # Trap 22c: forSEF learns a URL only when some page BUILDS it — warm via home.
    try: fetch("/")
    except Exception: pass
    status, body = fetch(v["path"])
    problems = []
    if status != 200: problems.append(f"status={status}")
    if "{loadposition" in body: problems.append("literal {loadposition} in output")
    for mk in v.get("markers", []):
        if mk not in body: problems.append(f"missing marker: {mk!r}")
    for fb in v.get("forbid", []):
        if fb in body: problems.append(f"forbidden string present: {fb!r}")
    if problems:
        print("VERIFY FAILED " + v["path"])
        for p in problems: print("  -", p)
        raise SystemExit(1)
    print(f"verify OK {v['path']} ({len(v.get('markers', []))} markers)")
print("fill-block: job applied")
PYEOF
