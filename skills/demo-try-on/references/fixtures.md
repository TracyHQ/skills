# Fixtures

A fixture is a real client copy plus a real demo copy that a full try-on has been run against,
end to end, including taking it off again. Everything in `spec.md` was found on one.

Numbers here are measured, not estimated. When they go stale, re-measure rather than adjust.

---

## Fixture 1 — a training marketplace × `JA Teline V`

The first one, and the source of traps 1–10. The customer is not named here and their
prose is not reproduced: this repository is public, and a fixture is useful for its measurements
rather than its identity. The full artefacts stay on the fleet host.

| | fleet label |
|---|---|
| Client | a customer copy (label withheld) |
| Demo | `ja-teline-v.demo.joomlart.com` |

Joomla with Guru LMS, a training marketplace. Prefix `sgsre_` client-side, `jos_` demo-side —
never assume they match.

### What the client has

| | |
|---|---|
| Published articles | **28** |
| Categories holding articles | 5 |
| Languages | 3 — `*` 12 · `fr-FR` 10 · `en-GB` 6 |
| Published `mod_custom` | **16** (16k characters) |
| Prose blocks recovered from them | **32**, of which **20** carry a body |
| Distinct image files | **8** (28 articles "have an image" — they reuse them) |
| Other components | `mod_guru_courses`, `mod_articles_categories`, `mod_articles_latest` |

Two things about this site that make it a good fixture rather than a convenient one:

- **"Our Blog" is flagged `en-GB` and holds four `fr-FR` articles.** Trap 2 lives here.
- **Its images are JoomlArt sample photos** (`images/joomlart/blog/item-1.jpg` …), not photographs
  of the business. Real for the pipeline's purposes; worth knowing before quoting "8 client
  images" as evidence of anything.

### What the demo wants

| | |
|---|---|
| Content slots | **19** |
| Article seats across them | **208** |
| Published articles | 442, of which **101 featured (23%)** |
| Distinct images | 324 |
| ACM blocks | 33 · `show_front: only` on 4, `show` on 27 |
| Front page, undressed | **320194 bytes** — the number `take-off.sh` restores to |

### What a run produces (en-GB)

| | |
|---|---|
| Slots with a client source | **3 of 19** — the rest are `fill: empty` |
| Articles copied from the client | 16 |
| Articles seated from custom modules | 10 |
| Articles generated | **64** |
| Total above the offset | **90** |
| Featured marked | 21 |
| Images cropped to the demo's 1.30 ratio | 8, at 878×675 |
| Front page, dressed | 189806 bytes |
| Try-on articles visible on the front page | 14 of 90 |

Name-based pairing between the two sides matches **0 of 5** categories. That is not a bug in the
matcher; it is the finding that justifies a human deciding the map.

### Files

`examples/fixture-1-training-marketplace/` holds the real artefacts from this run — inventory, map, brief,
the `fill.json` an agent wrote against that brief, the category bridge, and the head of the
emitted SQL. Read them before writing new ones; they are what the formats actually look like.

### Reproducing

```sh
inventory-client.sh --client <client-label>          > inventory-client.json
inventory-demo.sh   --demo   <demo-label> > inventory-demo.json
propose-map.mjs --client … --demo … --language en-GB                > artifact-map.json
apply-map.sh --demo … --client … --map artifact-map.json --dry-run   # read this before the real one
apply-map.sh --demo … --client … --map artifact-map.json
build-image-set.sh --client … --demo … --map … --apply
generate-fill.mjs --map … --client …                                 > brief.json
#   agent writes fill.json against brief.json
generate-fill.mjs --map … --client … --fill fill.json \
                  --categories /srv/tracy/<demo>/try-on-categories.tsv --emit sql --prefix jos_
verify-try-on.sh --demo … --map artifact-map.json
take-off.sh --demo …                                                 # always, when finished
```

The demo runs behind Cloudflare Access, so read it through the container
(`-H 'X-Forwarded-Proto: https'`) and never through the public URL. See trap 3.
