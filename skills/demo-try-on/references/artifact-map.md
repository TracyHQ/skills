# The artifact map — the one file a person reads before anything is written

`propose-map.mjs` drafts it. You correct it. `apply-map.sh` refuses to run without it.

It exists because the pairing it records is the part no script can do. 🔒 First fixture: matching
by name paired **0 of 5** client categories to demo positions — a template says `news-health`, a
site says `Learner Stories`, and only a reader connects them. Everything mechanical happens
around this file; the judgement happens in it.

---

## Shape

```json
{
  "client": "fixture-1-client",
  "demo": "fixture-1-demo",
  "language": "fr-FR",
  "slots": [
    {
      "position": "news-home",
      "module": "mod_ja_acm",
      "wants": 7,
      "fill": "client",
      "source": { "type": "category", "id": 2, "title": "Others", "articles": 17 },
      "generate": 0,
      "why": "largest category; block wants 7 and it has 17"
    },
    {
      "position": "news-science",
      "module": "mod_ja_acm",
      "wants": 6,
      "fill": "mixed",
      "source": { "type": "category", "id": 10, "title": "Learner Stories", "articles": 4 },
      "generate": 2,
      "why": "the site's own voice belongs here; short by 2"
    },
    {
      "position": "news-sport",
      "module": "mod_ja_acm",
      "wants": 6,
      "fill": "empty",
      "source": null,
      "generate": 0,
      "why": "a training centre has no sport desk; leaving it off is truer than filling it"
    }
  ]
}
```

## Fields

| Field | Meaning |
|---|---|
| `language` | One per run. 🔒 The first fixture had `*` 12 / `fr-FR` 10 / `en-GB` 6 against a single-language demo; mapping all three at once produces a page where a third of the blocks are in a language the visitor did not pick |
| `position` · `module` · `wants` | Read from `inventory-demo.json`. Not yours to edit — if `wants` looks wrong, the inventory is wrong |
| `fill` | `client` · `mixed` · `generated` · `empty` — see below |
| `source` | Which client artifact feeds it. `null` when `fill` is `generated` or `empty` |
| `generate` | How many items to invent. Must be `0` when `fill` is `client` or `empty` |
| `why` | One sentence, in your words. `apply-map.sh` does not read it; the next person does |

### The four `fill` values

**`client`** — the category has at least `wants` articles. Nothing is invented.

**`mixed`** — real content first, generated items after, `generate` = the shortfall. This is the
common case and the reason the skill exists.

**`generated`** — the block is worth showing but no client category belongs in it. The whole slot
is invented, under `generation-rules.md`.

**`empty`** — the block is left unassigned and does not render. **This is a legitimate answer**,
and the draft will rarely choose it. A training centre has no sport desk; a page that admits that
is more convincing than one that invents one.

---

## What the draft gets right, and where it is reliably wrong

`propose-map.mjs` orders client categories by article count and fills demo slots in the order the
demo declares them. It writes its reasoning into `why` so you can see it was mechanical.

Three things it cannot know, and they are what you are for:

**Which category deserves the front.** The draft puts the biggest one first. On the first fixture
that was `Others` — 17 articles, 61% of the site, and a dumping ground. `Learner Stories` had 4
and was the heart of the business. The draft cannot read that; you can.

**Which slots should stay empty.** The draft fills what it can and marks the rest `empty` only
when it runs out of sources. Deciding a slot is *wrong for this client* is a judgement.

**Whether a category survives translation.** `NOTRE BLOG` (2) and `Our Blog` (4) are the same
desk in two languages. The draft sees two categories.

---

## The gate

`apply-map.sh` refuses to run when:

- `language` is missing, or articles outside it are referenced
- a slot has `fill: "client"` and `source.articles < wants`
- a slot has `fill: "mixed"` and `generate` does not equal `wants - source.articles`
- a `source.id` does not exist in `inventory-client.json`
- any `why` is empty

The last one is not bureaucracy. A row nobody could explain is a row nobody checked, and this
file is the only checkpoint between an inventory and a database write.

---

## Editing it

Move rows, change `source`, flip `fill`, adjust `generate`. Keep `position`, `module` and `wants`
as the inventory produced them.

Re-run `propose-map.mjs` and your edits are gone — it writes the file whole. Draft once, then own
it; if the inventory changed enough to need a new draft, diff the two rather than regenerating
over your work.
