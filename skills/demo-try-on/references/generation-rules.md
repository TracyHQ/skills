# Generation rules — what fills the gap, and how it stays recognisable

A demo is dressed for a site that does not exist. 🔒 First fixture: the demo carried **324
distinct images** and its front page ran seven ACM blocks eating 4–7 articles each; the client had
**28 articles and 8 distinct images**. The shortfall is not an edge case. It is the normal case,
and this file is how it is filled.

Three options existed. Leaving blocks empty makes the page look unfinished, which defeats the
purpose — the client is looking at this to judge a template. Leaving the demo's own content in
place shows JoomlArt's articles on a page presented as the client's, which nobody would accept.
So: **generate the shortfall, and make every generated thing findable afterwards.**

---

## 1. The marker — decided, not left to the implementer

Every generated row carries **all three** of these. They are not alternatives; each answers a
different question.

| Where | Value | Answers |
|---|---|---|
| `#__content.note` | `try-on:generated` | "Is this row generated?" — visible in the admin list, invisible to visitors |
| Tag | `try-on-generated` | "Show me all of them" — one query, one bulk delete |
| ID above the offset | this skill's own range | "Undo everything" — what `take-off.sh` restores against |

### What is deliberately NOT used

**`created_by_alias`.** Setting it to something like "Demo Try-On" would print the marker on the
front end, under every generated headline. Tempting, because it is the most honest possible
signal — and wrong here, because it wrecks the one thing a try-on is for. A client cannot judge
whether a template suits them while half the page carries a byline explaining itself.

The honesty is not dropped, it moves: **the report says the counts** (see the skill's *Reporting
back*), and the admin can see `try-on:generated` on every row. What the visitor's eye gets is a
page that looks like a page.

### The rule that makes the marker worth having

> A generated row that reaches the database without all three markers is a defect, not a
> shortcut. Six months later nobody can tell which words were the client's, and the try-on has
> quietly become their content.

---

## 2. How much to generate

Only what a slot asks for. The block's own params say how many items it renders —
`featured_leading: 4`, `featured_intro: 3` — and `inventory-demo.json` carries that number.

- A slot mapped to a client category **with enough articles**: generate nothing.
- A slot mapped to a client category **short by N**: generate N, in that category's subject.
- A slot marked `generate` in the map: generate the full count.

Never generate to make a number look better. An extra article nobody asked for is an extra row
somebody has to delete.

---

## 3. Text — what may be invented, and what may not

Generated copy takes its **subject, vocabulary and register** from the client's own content
(`digest/` and `inventory-client.json`). A training centre's generated article reads like the
training centre wrote it.

### Never invent

- **Numbers presented as fact** — enrolment figures, prices, dates, percentages, "since 1998"
- **Named people** — staff, customers, authors, quoted experts
- **Testimonials or reviews** — a fabricated endorsement is not a placeholder, it is a lie with a
  name attached
- **Credentials, awards, accreditations, partner logos**
- **Contact details** — an address or phone number that resolves to a real place is worse than
  an obviously fake one
- **Events with a date and place**

### Safe to invent

- Topic-appropriate prose that makes no factual claim
- Headlines in the client's subject area, phrased as description rather than announcement
- Category-level framing: "what our learners work on", not "our 400 learners in 2026"

The test before writing a sentence: **if the client published this unchanged, would it be
false?** If yes, do not write it.

---

## 4. Images — the half that is easy to forget

🔒 The first fixture had **8 distinct images for 28 articles** — the same photo repeated across a
front page designed for 324. Generating only text and reusing those eight produces exactly the
unfinished look the generation was supposed to prevent.

### Ratio and size come from the demo, measured

`image-fit.sh` reads the ratio the demo's own images cluster around and the smallest width it
ships. Generated images match that ratio and are **not narrower** than the demo's narrowest.
Never invent a target ratio — JoomlArt changes blocks, and a hard-coded number goes stale
silently.

### Never depict

- **Recognisable people** — no faces presented as staff, learners or customers
- **The client's logo, or anything resembling it** — the real logo is copied from the client
  side, never redrawn
- **Text of any kind** — generated lettering renders as convincing gibberish, and a page of it is
  the fastest way to look fake
- **Real places, buildings or landmarks** identifiable as somewhere specific
- **Competitor or third-party branding**

### Prefer

Abstract, textural or environmental imagery in the client's subject area. A training centre gets
desks, light, materials, hands at work — not portraits.

### Where they go

`images/_try-on/`. Never into the client's own media directories in the demo copy, and never
overwriting anything: a generated file that lands on top of a real one cannot be undone by
deleting rows.

---

## 5. The logo is copied, never generated

The client's logo travels from the client side as a file. If it is missing or unusable, the slot
carries the demo's own placeholder mark and **the report says so** — a generated logo is a
fabricated identity, which is a different category of wrong from a generated photo.

---

## 6. What the report must say

The skill's *Reporting back* section gives the shape. The numbers that must appear:

- blocks carrying client content, and how many articles each
- blocks carrying generated content
- image slots filled from the client, and image slots generated
- anything left empty, and why

Rounding up, merging the two counts, or describing generated content as "sample content" without
saying it was generated — all of these turn a fitting room into a showroom, and the client finds
out later.
