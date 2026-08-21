# Writing a skill

`registry/README.md` covers submitting a **record** that points at a skill elsewhere. This file
covers writing one that lives here.

Rules come from Anthropic's `skill-creator` (vendored at `skills/skill-creator/`), from
`/doctor`, and from `mattpocock/skills` — 38 skills Tracy Desk already vendors from. Nothing
below is invented.

## Anatomy

```
skill-name/
├── SKILL.md          required
├── scripts/          executable code
├── references/       docs loaded only when needed
├── assets/           files that end up in the output
├── examples/         worked fixtures        (Tracy addition)
└── __tests__/        vitest specs           (Tracy addition)
```

## The three budgets

A skill loads in three stages. The later it loads, the more room it has.

**1. `name` + `description` — ~100 words.**
In context for every session, before anything triggers. This budget is *shared*: the listing gets
~1% of the context window, and once the sum exceeds it entries are truncated — routing degrades
for every skill, not just the long one.

**2. SKILL.md body — under 500 lines.**
Loads when the skill triggers. A ceiling, not a target: where it binds, move detail into
`references/` and point at it from SKILL.md, saying when to read it.

**3. `scripts/`, `references/`, `assets/` — no limit.**
Load on demand, and a script may never load at all. A reference over 300 lines needs a table of
contents.

Measured 2026-08-21. Across the 38 skills in `mattpocock/skills`, the median SKILL.md is 74 lines
and the longest 140; the median description is 24 words and the longest 69. **Not one of the 38
exceeds a threshold.** Here the medians are 153 lines and 68 words, three bodies are over 500
lines and two descriptions over 100 words — the longest of each being 1,063 lines and 304 words.

## Frontmatter

Required — `bin/validate.ts` rejects a record without them:

- **`name`** — kebab-case, matching the directory
- **`description`** — what it does *and when to use it*; this is what routes a request here
- **`version`** — semver, bumped when behaviour changes
- **`provenOn`** — where it has actually run, or `—`

Optional: `platforms` (closed vocabulary, see `registry/README.md`), `requires-mcp`, `tags`.

There is no `requires-skill` key — nothing reads one, including Tracy Desk's installer. If your
skill needs another, say so in the text.

## What no checker can read for you

- **A past-tense sentence is a claim about code.** Grep before relying on one.
- **An exclusion justified by "another check covers that"** is only as true as the other check.
- **A condition no input can satisfy** reads exactly like a working one. Write down the input
  that would trip each branch; if you cannot, the branch is decoration.
- **A cap that reports nothing** reads as full coverage. Every `slice`, `head` and `LIMIT` should
  say what it dropped.
- **A constant borrowed from another tool** is calibrated for that tool's architecture.

## Before the PR

```
pnpm check-skill      the claims your text makes
pnpm check-scripts    everything you ship parses
pnpm test
pnpm validate         frontmatter and record
node scripts/check-language.mjs
```

CI runs all of these on every pull request and `main` requires them; it cannot run on a direct
push, which is why direct pushes are blocked.

**A gate you have never seen fail is not yet trusted.** Adding a check means breaking something
on purpose, watching it fail with a message that names the thing, then watching it go green.
