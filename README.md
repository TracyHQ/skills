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
  "skillPath": "skills/refund-audit",
  "platforms": ["woocommerce"]
}
```

- `namespace`, `slug`: lowercase kebab-case.
- `gitUrl`: `https://github.com/{owner}/{repo}`, no userinfo/port/query/fragment.
- `ref`: branch, tag, or SHA (defaults to `main`).
- `skillPath`: path, relative to the repo root, to the directory containing `SKILL.md`.
- `platforms`: what the skill runs on. Optional, defaults to `[]` — see below.

### `platforms` — what it runs on, not what it does

`platforms` is a closed vocabulary. Anything else fails validation on the PR:

| Value | Platform |
|---|---|
| `wordpress` | WordPress |
| `woocommerce` | WooCommerce |
| `joomla` | Joomla |
| `shopify` | Shopify |

It is deliberately separate from the `tags:` in your `SKILL.md`. Tags say what a skill **does**
(`security`, `wp-cli`, `maintenance`); `platforms` says what it **runs on**. They were the same
list once, and every client had to recover the second from the first by intersecting against a
hardcoded set of four names — so `Joomla!`, `joomla-6` and a skill with no platform tag at all
were indistinguishable from a correct record until a filter row looked wrong to someone.

It lives in the record rather than in `SKILL.md` for a reason that matters when the skill is not
yours: **a record points at a repo Tracy does not own.** A classification only the source repo
can set is one nobody here can correct. This one sits next to `tier` — Tracy's judgment, in
Tracy's file.

Omitting it is legal; a skill may genuinely target no platform. It is not silent, though: the
build names the slug in a warning, because the alternative is a record that quietly vanishes from
every platform filter and is only ever noticed as a gap in someone's UI.

Declaring more than one is fine — a skill that spans WordPress and WooCommerce lists both.

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
`namespace`/`slug`/`gitUrl`/`ref`/`skillPath` coordinates, and the `tier` and `platforms` labels
are Tracy's compilation and classification, so they are **CC BY 4.0**. But `displayName`,
`description`, and `tags` are copied verbatim from the third-party author's own `SKILL.md`, and
`submittedBy` is a third-party person's name — none of that is Tracy's to license. Those fields
carry whatever license the source repository named in `gitUrl` already carries. See
[`LICENSE-DATA`](./LICENSE-DATA) for the full breakdown.

`platforms` falls on Tracy's side of that line precisely because it is not copied from anyone —
it is a classification made here, which is also why it can be corrected here.

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

