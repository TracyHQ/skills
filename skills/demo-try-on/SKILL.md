---
name: demo-try-on
description: Put a client's real content INTO a template demo's working copy, so they can see their own site wearing that template without anything being built. The mirror of reskin - here the demo is the destination and the client site is read-only reference (content, images, logo). Gaps the client cannot fill are generated and marked as generated. Use when someone asks what their site would look like in a template, wants to preview a template with their own content, or is choosing between templates.
version: 0.1.0
platforms: joomla
requires-mcp:
  - tracy-site
provenOn: a training marketplace x JA Teline V — full run, en-GB: 3 of 19 slots sourced, 26 client articles seated, 64 generated, 8 images cropped, taken off back to the byte
---

# Demo Try-On — their words, the demo's clothes

You take a client's real content and put it **into a demo's working copy**, so the client sees
their own site wearing that template. Nothing is built. Nothing is written to the client's site.
The demo copy is the fitting room: they try it on, look, and only then decide.

This is the **mirror of `reskin`**, and the direction is the whole difference:

| | `reskin` | this skill |
|---|---|---|
| Written to | the **client's** working copy | the **demo's** working copy |
| Borrowed from | the demo — frame, blocks, assets | the client — articles, images, logo |
| Client's site | working copy is modified | **read only, always** |
| Cost of a mistake | a client copy to restore | a demo copy to re-provision |

That asymmetry is why this skill exists. Reskin has to decide which module goes in which
position and hope it looks like the demo. Here the demo **already** looks like itself — every
module configured, every position filled, the megamenu seeded, the ACM blocks tuned by JoomlArt.
You are not arranging anything. You are swapping what is inside.

The full spec, including the traps this skill's rules come from, ships at `references/spec.md`.
Read it before your first run.

## The one thing that decides the result

A demo is dressed for a site that does not exist. It has more of everything than a real client
does. 🔒 Measured on the first fixture: the demo carried **324 distinct images**; the client had
**8** — for 28 articles, because articles reused them. The demo's front page alone runs seven ACM
blocks eating 4–7 articles each; the client had 28 articles across three languages.

So the question is never "does the content fit". It never fits. The question is **what fills the
gap**, and this skill answers it one way:

> **Generate the shortfall, and mark everything generated as generated.**

Not leave blocks empty — an empty block is what makes a page look unfinished, and the client is
looking at this to decide whether the template is worth buying. Not leave the demo's own content
in place either — showing JoomlArt's articles on a page presented as the client's site is the one
outcome nobody would accept.

`references/generation-rules.md` owns how. The rule that cannot be broken: **anything generated
carries a marker in the database**, so six months later nobody has to guess which words were the
client's. A try-on that cannot be told apart from real content has stopped being a try-on.

## Where things live

Read in this order, and stop when what you are about to do is answered.

1. **`out/inventory-client.json`** — everything the client side offers: categories with counts,
   articles with image/length/language, menu tree, authors, tags. Produced by
   `inventory-client.sh`. It is also the **reference snapshot** — never rewritten during a run.
2. **`out/inventory-demo.json`** — the demo's slots: which positions carry content modules, what
   each module reads, how many items a block wants, image ratios. Produced by
   `inventory-demo.sh`.
3. **`out/artifact-map.json`** — the mapping, and the only file a person has to read before
   anything is written. Drafted by `propose-map.mjs`, corrected by you, gated by `apply-map.sh`.
4. **`out/image-fit.txt`** — which client images will survive the demo's frames. From
   `image-fit.sh`.
5. **`references/spec.md`** — go here when something breaks, not before. Ten traps so far, and
   every one of them produced a run that looked successful.
   **`references/artifact-map.md`** is the format; read it once before your first mapping.
   **`references/fixtures.md`** is what a full run measures against a real pair.
   **`examples/fixture-1-training-marketplace/`** holds the real artefacts from that run — read them rather
   than guessing at the formats.

## Reaching the scripts and the site

The scripts run on the **fleet host** and act on the working copies' containers. They never
touch a live site — and in this skill they never touch the client's copy either, in any
direction. If a script here is about to write to the client side, that is a bug, not a decision.

Deploy the toolkit before the first run:

```
ssh <host> 'mkdir -p /opt/tracy-fleet/demo-try-on'
scp <skill-dir>/scripts/* <host>:/opt/tracy-fleet/demo-try-on/
ssh <host> 'chmod +x /opt/tracy-fleet/demo-try-on/*.sh'
```

Both sides are Sites in Tracy, so their labels come from `tools/fleet-map.sh`. You need two:
`--client <label>` and `--demo <label>`. Everything else — container names, table prefix,
database password — the scripts read from the stack that is actually running, never from a
remembered value.

## The pipeline, in order

**1 · Inventory both sides.**
```
inventory-client.sh --client <label> > out/inventory-client.json
inventory-demo.sh   --demo <label>   > out/inventory-demo.json
```
Read both before mapping. The client inventory is the snapshot `take-off.sh` restores against;
do not rewrite it.

**2 · Measure the images.**
```
image-fit.sh --site <client> --demo <demo>          # and --crop when it says to
```
Do this before mapping, not after. Whether the client's images survive changes which blocks are
worth filling with their content and which are better generated.

**3 · Draft the mapping.**
```
propose-map.mjs --client out/inventory-client.json --demo out/inventory-demo.json \
                > out/artifact-map.json
```
The draft is mechanical: biggest category into the block that wants the most articles. It says so
on every row. 🔒 A name-based pairing matched **0 of 5** on the first fixture — a template says
`news-health`, a site says `Learner Stories`, and nothing but a reader connects them.

**4 · Correct the mapping. This is your job.**
Open `out/artifact-map.json`, read it against the client's `digest/`, and move rows. You decide
which category belongs where, which language ships, and which slots get generated content. The
script cannot know that "Learner Stories" is the heart of a training site and "Others" is a
dumping ground.

**5 · Put it on.**
```
apply-map.sh --demo <label> --client <label> --map out/artifact-map.json --dry-run
apply-map.sh --demo <label> --client <label> --map out/artifact-map.json
```
Read the dry run first — it names every position it will touch and every count it will act on.
Writes to the demo copy only. Every row it creates sits above this skill's ID offset, a different
offset from `reskin`'s, so two skills on one host never erase each other.

It also writes `/srv/tracy/<demo>/try-on-categories.tsv`, mapping each position to the category id
it created. Step 7 cannot run without it, and that is deliberate — see spec §9.

**6 · Crop the client's photos.**
```
build-image-set.sh --client <label> --demo <label> --map out/artifact-map.json --apply
```
Two halves. The client's real photos are cropped to the demo's measured ratio and land in
`images/_try-on/`. The images that must be generated get a brief instead — they cannot be made
before the article they sit beside exists, and the brief asks for a bounded pool per category
rather than one image per article. 🔒 One-to-one would have meant 74 pictures for 24 seats.

**7 · Write what is missing.**

Two passes, because a script cannot write the prose.
```
generate-fill.mjs --map out/artifact-map.json --client out/inventory-client.json   # the brief
#   you write fill.json against that brief
generate-fill.mjs --map … --client … --fill fill.json \
                  --categories /srv/tracy/<demo>/try-on-categories.tsv \
                  --emit sql --prefix <demo prefix> | mariadb …
```
The brief subtracts what the client already wrote: prose recovered from their custom modules is
seated first, and only the remainder is yours to write. On the first fixture that was 74 → 64.
Every generated row carries its marker. See `references/generation-rules.md`.

**8 · Look at it, against the demo.**
```
verify-try-on.sh --demo <label> --map out/artifact-map.json
```
The question is "does it still look like this template", so the comparison is with the demo as it
shipped — not with the client's old site. A try-on that ends up looking like the site they
already have has failed at the only thing it was for.

**9 · Take it off.**
```
take-off.sh --demo <label>
```
Everything above the offset goes. Cheap by design, and it has to stay cheap: a fitting room where
clothes cannot come off is a shop that has sold you something.

## Rules that are not negotiable

**The client's site and its working copy are read-only.** Both. This skill reads content, images
and logo; it writes to the demo copy and nowhere else.

**Generated content is marked, always.** No exception for "it is just a preview". Previews get
kept, forwarded, and screenshotted into proposals.

**The demo's own content leaves.** Any article, image or menu item still showing JoomlArt's words
after step 6 is a defect — the client is looking at a page presented as theirs.

**You never write SQL.** If you are about to, stop: either a script owns that step or the step is
wrong.

**One language per run, unless the map says otherwise.** 🔒 The first fixture had `*` 12,
`fr-FR` 10, `en-GB` 6 against a single-language demo. Mapping all three at once produces a page
where a third of the blocks are in a language the visitor did not choose.

## Reporting back

Say what was mapped, what was generated, and what stayed empty — in that order, with counts. The
person reading it is deciding whether to buy a template, so the honest shape of the answer is:

> 3 of 7 front-page blocks carry your content (17 + 4 + 4 articles). 4 blocks carry generated
> content, marked as such. Your 8 images cover 12 of 31 image slots; the rest are generated.

Never present a try-on as if it were the client's site fully rendered. It is a fitting room
mirror, and saying so is what makes it useful.

## When something breaks

`references/spec.md` has the trap list. Before going there, check the two failures that account
for most of them:

- **A block renders demo content.** The map missed a slot. `apply-map.sh --dry-run` prints every
  slot it will touch; diff that against `inventory-demo.json`.
- **A block renders empty.** The generation step was skipped for a slot the map marked
  `generate`, or the client category it points at has fewer articles than the block wants. The
  count is in `inventory-demo.json`; the map is where the fix goes.
