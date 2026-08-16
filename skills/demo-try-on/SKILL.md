---
name: demo-try-on
description: Put a client's real content INTO a template demo's working copy, so they can see their own site wearing that template without anything being built. The mirror of reskin - here the demo is the destination and the client site is read-only reference (content, images, logo). Gaps the client cannot fill are generated and marked as generated. Use when someone asks what their site would look like in a template, wants to preview a template with their own content, or is choosing between templates.
version: 0.3.1
platforms: joomla
requires-mcp:
  - tracy-demo-try-on
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

## How you reach the two sides

Through the **`tracy-demo-try-on` tools**. Not ssh, not a shell recipe — and the reason is
narrower than "tools are tidier".

This skill writes to a working copy that **is not the site you belong to**. Tracy authorises your
seat against your own site and fills that label in itself; the destination is a separate argument.
So you never name a destination label at all. You name a **template** — `ja-teline-v` — the desk
turns that into a host and then a label, and the fleet refuses any destination that is not a
JoomlArt demo copy. Three narrowings, in three places, because the obvious version of this feature
would let one customer's agent write into another customer's copy.

Everything else follows from the same rule: container names, table prefix and database password
are read on the fleet from the stack that is actually running. You hold decisions; you never hold
credentials, and you never learn a host name.

Two scripts stay on your side because they touch no database and need no secret:
`propose-map.mjs` and `generate-fill.mjs`. Run them locally, feed their output to the tools.

## The pipeline, in order

**1 · Read both sides.**
```
read_sites(template: "ja-teline-v")
```
Save what comes back as `out/inventory-client.json` and `out/inventory-demo.json` — the later
steps read files, and the client inventory is the snapshot `take_off` restores against. Read both
before mapping anything.

**2 · Measure the images.**
```
fit_images(template: "ja-teline-v", map: <the draft map>, apply: false)
```
Before mapping, not after: whether the client's photographs survive the demo's frames changes
which blocks are worth filling with their content and which are better generated. Come back with
`apply: true` once the map is settled.

**3 · Draft the mapping.**
```
propose-map.mjs --client out/inventory-client.json --demo out/inventory-demo.json \
                --language <the language you are shipping> > out/artifact-map.json
```
Runs on your side — it reads two files and writes a third, and needs nothing from the fleet. The
draft is mechanical: biggest category into the block that wants the most articles, and it says so
on every row. 🔒 A name-based pairing matched **0 of 5** on the first fixture — a template says
`news-health`, a site says `Learner Stories`, and nothing but a reader connects them.

**4 · Correct the mapping. This is your job.**
Open `out/artifact-map.json`, read it against the client's `digest/`, and move rows. You decide
which category belongs where, which language ships, and which slots get generated content. No
script knows that "Learner Stories" is the heart of a training site and "Others" is a dumping
ground.

**5 · Put it on.**
```
try_on(template: "ja-teline-v", map: <map>, dry_run: true)     ← read this first
try_on(template: "ja-teline-v", map: <map>)
```
The dry run names every position it will touch and every count it will act on. A count that
disagrees with the map stops the run rather than filling a block with nothing.

Writes to the demo copy only. Every row sits above this skill's ID offset — a different offset
from `reskin`'s, so two skills on one host never erase each other.

**Keep the `position → category id` table it prints.** Step 6 cannot run without it, and that is
deliberate: the obvious category id to use is the client's, which on the demo names something
else entirely (spec §9).

**6 · Write what is missing.**

Two passes, because no script can write the prose.
```
generate-fill.mjs --map out/artifact-map.json --client out/inventory-client.json
#   ↑ the brief: how many articles per slot, in what subject, at what length
#   you write out/fill.json against it
generate-fill.mjs --map … --client … --fill out/fill.json \
                  --categories out/try-on-categories.tsv \
                  --emit sql --prefix <the demo's table prefix> > out/fill.sql

write_missing(template: "ja-teline-v", sql: <contents of out/fill.sql>)
```
Write the table you kept from step 5 into `out/try-on-categories.tsv` first.

The brief subtracts what the client already wrote: prose recovered from their custom modules is
seated before anything is generated, and only the remainder is yours. On the first fixture that
was 74 → 64. Every generated row carries its marker — see `references/generation-rules.md`.

**7 · Crop the photographs.**
```
fit_images(template: "ja-teline-v", map: <map>, apply: true)
```
Now, not earlier: the images that have to be *generated* must match articles that now exist. The
client's real photos are cropped to the demo's measured ratio and land in `images/_try-on/`; the
rest come back as a brief asking for a bounded pool per category. 🔒 One image per article would
have meant 74 pictures for 24 seats.

**8 · Look at it, against the demo.**
```
check_try_on(template: "ja-teline-v", map: <map>)
```
The question is "does it still look like this template", so the comparison is with the demo as it
shipped — not with the client's old site. A try-on that ends up looking like the site they
already have has failed at the only thing it was for.

Then look at the page yourself. The check cannot tell you whether it is *good*.

**9 · Take it off.**
```
take_off(template: "ja-teline-v")
```
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

**Answer in the language the person is writing in** (ADR 0053 §7). Template names, fleet labels,
slugs, position names and file names stay as they are — they are addresses, not prose, and
translating one makes it wrong. The address you hand back is one of those: print it verbatim.

## When something breaks

`references/spec.md` has the trap list. Before going there, check the two failures that account
for most of them:

- **A block renders demo content.** The map missed a slot. `apply-map.sh --dry-run` prints every
  slot it will touch; diff that against `inventory-demo.json`.
- **A block renders empty.** The generation step was skipped for a slot the map marked
  `generate`, or the client category it points at has fewer articles than the block wants. The
  count is in `inventory-demo.json`; the map is where the fix goes.

Every failure that surprised you becomes a numbered trap in `references/spec.md`, with the fix
folded into the script that owns the step — the way `reskin` grew its 51. A trap that stays in the
transcript dies with the session, and the next person pays for it again.
