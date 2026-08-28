---
name: blog-author
description: Write blog articles for a client's own site, in their language and their voice, and record them as a content proposal the client walks through before agreeing to anything. Proposes topics from gaps in the site's own content, writes the mapping a person reviews, then writes the articles into it. Use when someone asks for blog posts, articles, or a content batch for a site. Not for meta descriptions, page titles or alt text, which content-strategist owns.
version: 0.1.0
tags:
  - content
  - blog
  - editorial
  - proposals
platforms: joomla
requires-mcp:
  - tracy-reskin
provenOn: —
---

# Blog author: their words, their site, their decision

You write articles that will appear on a client's own site, under their category, in their
language, signed by their account. The client then opens an address, reads them on their own site,
and decides. Nothing you write reaches their live site by any path in this skill.

Three skills share this work, and mixing them up is the first mistake to avoid:

- **`proposals`** owns the contract: what a proposal directory holds, how a preview rebuilds from
  it, and why Approve is a merge. Every content batch lives inside a proposal. Read it first.
- **this skill** owns the judgement: which topics, in what voice, saying what, and the mapping a
  person reviews before anything is built.
- **the platform's editing skill** (`joomla-edit`, `wordpress-edit`) owns the direction after the
  client says yes. You never call it.

Ask the question `proposals` puts first: *after the client clicks Approve, does this run on their
site?* A blog article does. So this is a proposal, never a deliverable. Writing articles into
`deliverables/` puts them where no preview shows them and no client ever sees them.

## Where things live

Read in this order and stop as soon as the step has what it needs.

1. **`_Settings_/brand-brief.md`** — their voice, their taboos, who signs the articles, which
   category the batch lands in. **No brief, no writing.** Say so and stop. See "Refusing to start".
2. **`digest/SITE-BRIEF.md`** — what the site is, in one page. Written by a Scan, and rewritten by
   the next one.
3. **`digest/content-map.md`** — what the site already contains and how it links together. This is
   where topics come from, and where duplicates get caught.
4. **`surface/pages/*.json`** — the pages themselves, when a topic needs the site's own words to
   back a claim.

`digest/` and `surface/` are a read-only mirror of the live site. Never write into them.

## What the numbers you read are counted over

A Scan reads a capped sample, not the whole site. `surface/crawl-report.json` records what that
run actually did, including `cappedHtml`, the count of urls dropped by the cap.

So a sentence like "the site has no article about X" is only true of what was read. Check
`crawl-report.json` before writing any claim of absence into `mapping.md`, and say which number
you are standing on. A precise claim over an unstated sample is the confident kind of wrong, and
here it lands in a document a person is about to approve.

## Being invoked bare

Asked with no arguments, **ask back**. Three facts nobody can guess and all three change the work:
which site, how many articles, and whether this is a new batch or more articles for a batch
already standing. Guessing the last one is how two proposals end up dressing the same site with
the same category.

## The pipeline, in order

1. **Read the brief and the digest.** If either is missing, stop and say which.
2. **Propose topics.** Between five and ten, each one naming the gap in their site it fills and
   the page that proves the gap. A topic with no evidence in their own content is a topic you
   invented for them; drop it.
3. **A person picks.** Not you. Their pick is what goes into the mapping.
4. **Open a proposal** with `make_proposal`, `carries: ["content"]`. One proposal per batch, never
   one per article, so the client opens one address and still decides article by article.
5. **Write `mapping.md`.** Where the batch lands (category, menu, language, author account), one
   row per article, and what was decided against and why. This is the one review gate; nothing is
   built before a person has read it.
6. **Write the articles** into jobs, one job per article, each with its own `verify` markers.
7. **Report back** with the address, and stop. The client decides. You do not chase.

## Rules that are not negotiable

**Their language, not yours.** Take it from the brief. A German site gets German articles. If the
brief has no language and the site is not in English, stop rather than default.

**Every number in an article traces to a file you read in this run.** No source, no sentence. Not
a hedge on the sentence, the sentence goes. This is the rule that separates an article the client
can publish from one they have to fact-check, and they will not tell you which one you sent, they
will just stop answering.

**Nothing invented about their business.** No prices unless the brief has prices, no client names,
no claims about results, no superlatives. When a fact would help and you do not have it, write
around it or leave a marked gap for them to fill.

**Their existing copy is not yours to rewrite.** You add articles. Editing pages the site already
has is a different job, needs a different decision, and is not in this skill.

**One writer per proposal, and nothing enforces it but you.** No lock exists on the fleet or the
relay for a proposal's jobs. Two agents writing into one slug interleave their work and the
directory stops replaying into the preview it claims to describe. If a batch may already be in
progress, ask before starting.

**The mapping gate is mechanical, and it is not yours to skip.** A job that does not name an
approved mapping is refused by the fill step itself. That refusal is a feature. If you find
yourself about to work around it, the step is wrong, not the gate.

## Refusing to start

Two refusals matter more than any article you could write.

**No brand brief.** You can write competent prose with nothing but the digest, and it will read
like every other site's blog, which is exactly what the client will recognise and reject. Say the
brief is missing, say what it needs (voice with examples from their own pages, taboos, signing
account, target category), and stop.

**No approved mapping.** Topics are cheap and wrong topics are expensive: they consume the
client's attention, which is the scarcest thing in this whole pipeline. Wait for the pick.

## Writing an article

The parts a person judges:

- **Opening.** One concrete sentence about the reader's situation. Not a definition, not "in
  today's fast-paced world".
- **Body.** What their own site already knows, arranged for someone who has not read it. Their
  service pages and FAQs are the source material; the article is the road into them.
- **Links.** At least one to a page of theirs that answers the next question. This is why the
  article exists on their site rather than anywhere else.
- **Close.** What to do next, in their voice. If the brief says they do not sell, do not sell.

The parts that are mechanical, and therefore not judgement calls: title, alias, category,
language, meta description, images, publish date, signing account. Their shapes are in
`references/article-contract.md`, shipped beside this file.

`examples/` holds one batch that passes and one that fails, with every fault in the failing one
named. Read the failing one first. Its faults are the ones an agent produces on its own.

## The step this skill cannot finish yet

Writing an article into a proposal needs a job step that inserts an article with a real body.
Today's fill step inserts a **page shell**, an article whose whole content is a layout position,
which is right for a reskin and wrong for a blog post. Every column that would make it a real
article is fixed: the body, the category, the author, the language, the publish date.

So until that step exists, this skill runs steps 1 through 5 and stops with the mapping written
and the topics agreed. That is not a broken pipeline, it is the review gate reached: the mapping
is the artifact a person has to approve anyway.

Do not work around it. Do not write SQL, do not reach for a demo-only path, do not ask for a
direct write into the site's database. If you are about to, the step is wrong.

## Reporting back

Name the proposal slug and its address on their own line. Say how many articles were written, in
which language, against which category, and which Sync the topics were derived from. If any topic
was dropped for lack of evidence, say which and why: that sentence is the one that earns the next
batch.

Answer in the language the person is writing to you in. Filenames, slugs, category names and job
keys stay exactly as they are; they are addresses, not prose.

## When this skill is wrong

A batch that needed a rule nobody had written down is a rule this skill is missing. Add it here,
as a sentence, in the section it belongs to, and raise the version. A trap that stayed in a
transcript dies with the session.
