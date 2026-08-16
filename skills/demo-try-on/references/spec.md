# Traps

Every entry here cost a debugging session. They are written down because each one **succeeded
loudly and failed silently** — the script printed progress, the counts agreed, and the page was
wrong. That is the shape of every bug this skill has produced so far, and it is the shape to
expect from the next one.

Numbered in the order they were found. Companion to `reskin`'s own list, which reached 51.

---

## 1 · Client content is not only in `#__content`

**Cost:** briefing 12 articles that the client had already written.

The first fixture reads 28 published articles — and 16 published `mod_custom` modules holding
16k characters. Its hero, its feature list, its call to action, all in modules. An inventory that
counts articles alone reports "28 articles, mostly untranslated" about a site with plenty to say.

`inventory-client.sh` now reads both.

**What does NOT travel: the HTML.** The fixture's markup is built from its own template's classes
(`gru-hero`, `sub-intro`, `col-lg-4`) and Teline V has nowhere to put it anyway — its front page
is 33 `mod_ja_acm` blocks reading categories, against 5 incidental custom modules. Only the prose
travels: heading + paragraph pairs, seated as articles.

**Also inventory what you refuse to read.** The fixture runs Guru LMS; its courses live in tables
this skill has never seen. `other_components` names them. Naming is useful, guessing is not.

---

## 2 · A category's language flag says nothing about what is inside it

**Cost:** a block that promised 4 articles and rendered 0, with nothing in the run reporting it.

The fixture has a category titled **"Our Blog", flagged `en-GB`, holding four `fr-FR` articles**.
Counting the category's own total offered it to an English try-on. `apply-map.sh` then selected on
the *article's* language — correctly — and copied nothing.

Count per **article** language. `*` counts as a match: Joomla means "shows in every language".

A category with zero usable articles is not a source at all, so it is dropped rather than offered
with a warning.

---

## 3 · Never `curl -L` at a demo container

**Cost:** two checks that graded the wrong document and reported ✓ on a demo that had not been
touched.

Joomla is set to force SSL, so `/` answers `301 → https://<label>.tracy.ai/`. Following that
leaves the container: the request goes out to Cloudflare Access and comes back with a **sign-in
page, 33KB**, which passes a size check and contains none of the demo's articles.

Send `-H 'X-Forwarded-Proto: https'` instead — Joomla treats the hop as already done, and the
request stays inside the container. The floor is **50KB**, not 5KB; the real front page is 320KB.

---

## 4 · `fulltext` is a MySQL keyword

**Cost:** three categories created, zero articles copied, and a script that printed
`→ category 900100` for each of them.

Unbackticked, the whole `INSERT` is a syntax error. Combined with `|| true` — see trap 5 — nothing
said so.

---

## 5 · `|| true` on a write hides the failure it was added to tolerate

The idiom is fine on a delete that may match nothing. On an `INSERT` it converts a broken run into
a successful-looking one, and the failure surfaces one step later as a symptom nobody attributes
to it ("3 categories created and empty").

A write that fails stops the run and names the row.

---

## 6 · `docker exec` needs `-i` to reach a script's stdin

**Cost:** `cropped 0 images`, and no error anywhere.

`build-image-set.sh` pipes the image list into a PHP one-liner reading `STDIN`. Without `-i` the
stream is empty and the loop runs zero times. The `tar` on the line above had `-i`; the PHP call
did not.

---

## 7 · `access` defaults to 0, and 0 is visible to nobody

**Cost:** 90 articles in the database, every count correct, every block empty.

Joomla numbers viewing levels from **1 (Public)**. The column has no useful default, so an
`INSERT` that omits it produces rows that exist, join correctly, count correctly, and render to
no one.

Both `apply-map.sh` and `generate-fill.mjs` set `access = 1` explicitly.

---

## 8 · Filling a category is not enough for a `show_front: only` block

**Cost:** a front page still 40% short after the articles were in place.

ACM blocks carry `show_front`, and `only` means *featured articles and nothing else*. The fixture
demo uses `only` on 4 modules and `show` on 27. A try-on that fills categories and marks nothing
featured leaves those four blocks empty.

The demo itself runs **101 featured out of 442 (23%)**, so both scripts mark **4 per created
category** — enough for a `featured_leading: 4` + `featured_intro: 3` block, without flooding.

---

## 9 · An article id in the client database means something else in the demo

**Cost:** would have inserted 74 articles into JoomlArt's own categories while the three created
ones stayed empty. Caught before it ran, by looking at the emitted SQL.

`slot.source.id` is the obvious catid to reach for and it is always wrong: it names a category in
the **client** database. On the demo that id belongs to whatever JoomlArt has there — a real
category, so the SQL succeeds.

`apply-map.sh` writes `try-on-categories.tsv` (position → the id it created in the demo).
`generate-fill.mjs` **refuses to emit SQL without it**. Refusing is the only way this failure gets
seen; every softer option ends in articles that landed somewhere real and wrong.

---

## 10 · Taking the clothes off means five tables, not two

**Cost:** `ERROR 1062 ... for key 'uc_ItemnameTagid'` on the second try-on, which stopped mariadb
mid-file and left a half-dressed demo that every count reported as fine.

Deleting `content` and `categories` leaves `contentitem_tag_map`, `content_frontpage` and the
`try-on-generated` tag behind. They carry unique keys, so the next run collides with its own
leftovers.

Delete the dependent rows **before** the articles, while the id range still describes them, and
count all five when reporting what is left.

---

## 11 · A demo wears one try-on per schema, and the schema is the whole mechanism

**Cost:** three consecutive runs that collided with each other, one of them stopping halfway with
`could not copy article 3`.

Everything here writes above one ID offset. In a single database that means the second run finds
the category it wants to create already there, the article ids taken, and stops — leaving a demo
that is neither the old try-on nor the new one.

The fix is not coordination, it is **a schema per try-on** (ADR 0044): `joomla_<slug>` beside the
demo's own, same webroot, same container, different data. `configuration.php` grows a constructor
that reads `X-Tracy-Variant` and points `$db` at it; with no header nothing changes, so the site
runs exactly as before and the mechanism fails safe.

Then one demo serves several try-ons at once, `take-off` is `drop database`, and traps 7, 8 and 10
stop being reachable at all — there is no shared row left to collide over.

---

## 12 · One snapshot file per demo is one file too few

**Cost:** the original demo silently lost 9 modules' worth of settings — front page down from
320KB to 159KB, no error anywhere.

`try-on-snapshot.json` was keyed by demo. The moment a second try-on ran on a different schema of
the same demo, it overwrote the first one's snapshot, and the take-off that followed restored the
wrong module params. The modules kept pointing at categories that had been deleted, so every block
they fed rendered empty.

Key it by try-on: `try-on-snapshot-<variant>.json`. And when a snapshot is already lost, a clean
variant schema of the same demo is the way back — its `#__modules` still hold the original params.

---

## 13 · A parameter with no stated source is a parameter that gets guessed

**Cost:** a finished try-on with nothing generated — the page kept the demo's own articles in 16
of 19 slots, and looked like the skill had simply done a bad job.

`SKILL.md` asked for `--prefix <the demo's table prefix>` without saying where to read it.
`inventory-demo.sh` knew it and did not report it, so the agent supplied `j4_demo` against a demo
running `jos_`. The SQL failed on `Table 'j4_demotags' doesn't exist` — after `apply` had already
run, which is the worst ordering: the client's articles were in, the generated ones never came,
and nothing in the result said why.

Every value a step needs comes out of a step before it. If a script knows something the agent must
pass on, it prints it.

---

## Known limit — not a bug

A try-on covers the slots the client has content for. The fixture: **3 of 19**. Teline V has 19
content slots; the client has 3 usable categories, so 16 are marked `fill: empty` and keep the
demo's own articles.

That contradicts decision 1 of the skill ("gaps are filled with generated content, never left, and
never left as the demo's"), and closing it means generating for slots with no client source at all
— roughly 160 more articles for this fixture. Deliberately not done yet.

`verify-try-on.sh` names the count so the failure reads as a known limit rather than a mystery.
