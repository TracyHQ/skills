# Writing a skill

`registry/README.md` covers submitting a **record** that points at a skill elsewhere. This file covers writing one that lives here.

Rules come from Anthropic's `skill-creator` (vendored at `skills/skill-creator/`), from `/doctor`, and from `mattpocock/skills`.

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
In context for every session, before anything triggers. This budget is *shared*: the listing gets ~1% of the context window, and once the sum exceeds it entries are truncated — routing degrades for every skill, not just the long one.

**2. SKILL.md body — under 500 lines.**
Loads when the skill triggers. A ceiling, not a target: where it binds, move detail into `references/` and point at it from SKILL.md, saying when to read it.

**3. `scripts/`, `references/`, `assets/` — no limit.**
Load on demand, and a script may never load at all. A reference over 300 lines needs a table of contents.

Measured against `mattpocock/skills`: across 38 skills the median SKILL.md is 74 lines and the median description 24 words, and not one exceeds a threshold above.

## Frontmatter

Required — `bin/validate.ts` rejects a record without them:

- **`name`** — kebab-case, matching the directory
- **`description`** — what it does *and when to use it*; this is what routes a request here
- **`version`** — semver, bumped when behaviour changes
- **`provenOn`** — where it has actually run, or `—`

Optional: `platforms` (closed vocabulary, see `registry/README.md`), `requires-mcp`, `tags`.

There is no `requires-skill` key — nothing reads one, including Tracy Desk's installer. If your skill needs another, say so in the text.

## What no checker can read for you

- **A past-tense sentence is a claim about code.** Grep before relying on one.
- **An exclusion justified by "another check covers that"** is only as true as the other check.
- **A condition no input can satisfy** reads exactly like a working one. Write down the input that would trip each branch; if you cannot, the branch is decoration.
- **A cap that reports nothing** reads as full coverage. Every `slice`, `head` and `LIMIT` should say what it dropped.
- **A constant borrowed from another tool** is calibrated for that tool's architecture.

## Before the PR

```
pnpm check-skill      the claims your text makes
pnpm check-scripts    everything you ship parses
pnpm test
pnpm validate         frontmatter and record
node scripts/check-language.mjs
```

CI runs all of these on every pull request and `main` requires them. It cannot run on a direct push, which is why direct pushes are blocked.

**A gate you have never seen fail is not yet trusted.** Adding a check means breaking something on purpose, watching it fail with a message that names the thing, then watching it go green.
