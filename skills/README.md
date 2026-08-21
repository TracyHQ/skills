# Writing a skill

`registry/README.md` covers submitting a **record** that points at a skill somewhere else. This
file is the other job: writing a skill that lives here, under `skills/`.

None of what follows is invented. Every rule comes from one of three places that already exist,
and the numbers were measured against this repo on 2026-08-21.

---

## Where the rules come from

**Anthropic's `skill-creator`**, vendored at `skills/skill-creator/`, defines the anatomy and the
loading model. It is the closest thing to a specification any of this has.

**`/doctor`**, the Claude Code health check, contributes one rule about descriptions that turns
out to matter more than it looks.

**`mattpocock/skills`** — 38 skills that Tracy Desk already vendors 41 entries from, per its
`skills-lock.json`. A corpus this repo has already decided to ship to users is a corpus worth
measuring against, and it conforms to every threshold below without a single exception.

---

## Anatomy

```
skill-name/
├── SKILL.md          required
│   ├── YAML frontmatter
│   └── Markdown instructions
├── scripts/          executable code for deterministic or repetitive work
├── references/       documents loaded into context only when needed
├── assets/           files that end up in the output (templates, icons, fonts)
├── examples/         worked fixtures — a Tracy addition, not in the spec
└── __tests__/        vitest specs — a Tracy addition, not in the spec
```

The first four names come from `skill-creator`. `examples/` and `__tests__/` are ours; they are
listed here so the next person picks the same names rather than inventing a third. One skill
already writes `tests/` instead of `__tests__/`, which is what a convention nobody wrote down
looks like from the inside.

---

## Progressive disclosure, and the three budgets

A skill loads in three stages, and each stage costs something different.

| Stage | When it loads | Budget |
|---|---|---|
| `name` + `description` | **always**, for every session | ~100 words |
| SKILL.md body | when the skill triggers | under 500 lines |
| `scripts/`, `references/`, `assets/` | on demand; scripts need never load at all | no limit |

**The description budget is shared, not yours.** `/doctor` states that the skill listing is
allocated roughly 1% of the context window, and that when the summed descriptions exceed it,
entries are **truncated** and skill routing degrades. A description three times longer than the
guideline does not merely make that skill verbose — it eats into the budget every other skill
needs to be findable. This is the one rule where writing more actively harms work that is not
yours.

**Under 500 lines is a ceiling, not a target.** Where it starts to bind, the answer is another
layer of hierarchy — move detail into `references/` and point at it from SKILL.md, saying when
to read it — not tighter prose.

**A reference over 300 lines needs a table of contents**, because it is read by something
scanning for one section, not from the top.

### Measured, so the numbers are not aspirational

| | mattpocock (38 skills) | this repo (21 skills) |
|---|---|---|
| SKILL.md, median | 74 lines | 153 lines |
| SKILL.md, longest | 140 lines | **1,063 lines** |
| description, median | 24 words | 68 words |
| description, longest | 69 words | **304 words** |
| over any threshold | **0 of 38** | 3 bodies, 2 descriptions |

The corpus this repo already ships to users clears every threshold, 38 times out of 38, and its
longest skill is shorter than this repo's median plus a little. That is the evidence the limits
are livable rather than merely stated.

---

## Frontmatter

Enforced by `bin/validate.ts` — a record fails to merge without them:

| Key | |
|---|---|
| `name` | kebab-case, matching the directory |
| `description` | what it does **and when to use it**; this is what routes a request to the skill |
| `version` | semver; bump it when behaviour changes |
| `provenOn` | where it has actually run, or `—` if nowhere yet |

Optional, honoured by the index and the installer:

| Key | |
|---|---|
| `platforms` | closed vocabulary; see `registry/README.md` |
| `requires-mcp` | MCP servers the skill needs; carried into the published index |
| `tags` | what it does, as opposed to what it runs on |

`tags` appears on 4 of 21 skills. The four enforced keys appear on 21 of 21. Nothing else
distinguishes them, which is the plainest available evidence that **a convention nobody enforces
is not a convention.**

There is no `requires-skill`. One was invented here, enforced by a linter written alongside it,
and read by nothing — not `frontmatter.ts`, not the published index, not Tracy Desk's
`SkillService`, which resolves `requiresMcp` and has no concept of a skill needing a skill. If
your skill depends on another, **say so in the text**: the person installing it is the only thing
between the pair and a dead gate.

---

## What no checker can read for you

`check-skill` verifies the claims a skill makes about itself — a file it names exists, a flag it
shows is accepted somewhere, an environment variable something provides. Those are the mechanical
half. The failures below all passed every gate this repo has, and each one is a real incident.

**Every sentence written in the past tense is a claim about code.** Three SKILL.md files stated
that every QA gate accepted `--variant`; two of five accepted it nowhere and sent its header
never, so a run against a proposal graded the live site and reported a pass. A trap log said a
script "now recognises" a grid format; the string had never appeared in any commit. Both survived
months of reading. Grep before relying on one.

**An exclusion justified by "another check covers that" is only as true as the other check.**
Three separate places skipped CSS background images, each because one of the others would catch
it. None did, and a dead hero passed every gate green.

**A condition no input can satisfy reads exactly like a working one.** A rule required all of a
demo's container bands to be missing; every template has a full-bleed band, so the failure could
never fire. Write down the input that would trip each branch. If you cannot, the branch is
decoration.

**A cap that reports nothing reads as full coverage.** A link check took the first forty hrefs
alphabetically and said nothing about the rest. Every `slice`, `head` and `LIMIT` needs to say
what it dropped.

**A constant borrowed from another tool is calibrated for that tool's architecture.** A per-pixel
threshold taken from a library where it was the only gate sat behind a second gate here, making
both loose; a page whose header was repainted outright reported zero pixels changed.

---

## Before you open the PR

- `pnpm check-skill` — the claims your text makes
- `pnpm check-scripts` — everything you ship parses
- `pnpm test` — including your own
- `pnpm validate` — frontmatter and record
- `node scripts/check-language.mjs` — the public surface is English, commit messages included

CI runs all of these on every pull request, and `main` requires them. It cannot run on a direct
push, which is not a hypothetical: two skills reached `main` that way, through two of eight gates,
and broke publishing for six hours.

**A gate you have never seen fail is not yet trusted.** If you add a check, break something on
purpose, watch it fail with a message that names the thing, unbreak it, watch it go green. Every
threshold quoted above was set that way, and one of them was wrong until somebody did it.
