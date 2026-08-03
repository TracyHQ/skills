# Tracy Skills Registry

A public registry for skills that Tracy Desk can load. The registry only holds **records that
point to** the repo containing the skill — it does not hold the skill's content. The source of
truth for each skill still lives in the GitHub repo owned by whoever submitted it.

## How to submit a skill

Your skill stays in your own repo. All you add here is a record pointing at it.

1. **[Create `registry/<namespace>/<slug>.json`](https://github.com/TracyHQ/skills/new/main/registry)**
   — `<namespace>` must be the name (case-insensitive) of the **GitHub owner** behind `gitUrl`.
   CI rejects a record whose namespace does not match the owner, so you can only publish under a
   name you already control.
2. **Propose the change.** If you do not have write access here, GitHub forks the repo for you
   when you save — you do not need to fork anything by hand.

`validate.yml` then runs `pnpm validate` (structural checks, no network access) and
`pnpm build-index` (checks that `SKILL.md` really exists in the declared repo). Both must pass
before the record can be merged.

Once merged, the next build publishes your skill to
[`registry.tracy.ai/skills/index.json`](https://registry.tracy.ai/skills/index.json), and it
becomes installable from Tracy Desktop.

### A complete example record

```json
{
  "namespace": "tracyhq",
  "slug": "refund-audit",
  "gitUrl": "https://github.com/TracyHQ/skills",
  "ref": "main",
  "skillPath": "skills/refund-audit"
}
```

- `namespace`, `slug`: lowercase kebab-case.
- `gitUrl`: `https://github.com/{owner}/{repo}`, no userinfo/port/query/fragment.
- `ref`: branch, tag, or SHA (defaults to `main`).
- `skillPath`: path, relative to the repo root, to the directory containing `SKILL.md`.

## The three tiers

- **`listed`** — the default. The record is valid and `SKILL.md` fetches successfully, but no
  one at Tracy has reviewed it yet.
- **`curated`** — a maintainer reviewed the content at a specific `contentHash` (see
  `curation/<namespace>/<slug>.json`).
- **`quarantined`** — removed from the public index. A manual decision that does not auto-heal
  based on hash.

**Warning:** `curated` is pinned to the `SKILL.md` content at review time, not to the repo's
name. If `SKILL.md` changes after review (the repo keeps accepting PRs as normal), the record
**falls back to `listed`** on the next build — CI warns about this demotion, it does not happen
silently.

## Licence — dual, and here is the boundary

This repo is dual-licensed. The split is **data** versus **the code that produces it**, which
does not fall neatly along directory lines — so the table names each part explicitly instead
of leaving you to infer it.

| Path | Licence | File |
|---|---|---|
| `src/`, `bin/`, `scripts/`, `.github/` | **MIT** | [`LICENSE`](./LICENSE) |
| `schema/` — generated from `src/record.ts`, Tracy's own structure | **MIT** | [`LICENSE`](./LICENSE) |
| `registry/`, `curation/` — Tracy's compilation and curation decisions | **CC BY 4.0** | [`LICENSE-DATA`](./LICENSE-DATA) |
| `dist/skills/` | **mixed** — see below | — |

`dist/skills/` carries two different authors' work. The record's presence in the index, the
`namespace`/`slug`/`gitUrl`/`ref`/`skillPath` coordinates, and the `tier` label are Tracy's
compilation and classification, so they are **CC BY 4.0**. But `displayName`, `description`,
and `tags` are copied verbatim from the third-party author's own `SKILL.md`, and `submittedBy`
is a third-party person's name — none of that is Tracy's to license. Those fields carry
whatever license the source repository named in `gitUrl` already carries. See
[`LICENSE-DATA`](./LICENSE-DATA) for the full breakdown.

### Attribution — copy this line

```
Data: Tracy Skills Registry (https://registry.tracy.ai), CC BY 4.0.
```

### Why CC BY rather than CC0 or ODbL

**Not CC0.** The `tier` classification and curation review are this registry's only real
differentiator over an unfiltered crawl of `SKILL.md` files — CC BY turns every reuse into a
citation of Tracy's judgment; CC0 gives away the credit as well, and credit is the only thing
coming back.

**Not ODbL.** Share-alike on data is legally murky enough that many companies ban ODbL
datasets outright. It would strangle the very thing publishing is for: being integrated by
someone.

### What this licence cannot grant

The records point to third-party skills and the organizations that authored them. Names,
logos, and trademarks of the listed skills and their organizations belong to their respective
owners; this licence covers Tracy's compilation, classification and structure, not the things
it indexes.

### Revocation does not reach copies already distributed

Removing a record from the registry, or moving it to `quarantined`, stops Tracy from
distributing it going forward. It does not revoke the CC BY licence already granted on copies
distributed before that point — CC BY grants are irrevocable.

