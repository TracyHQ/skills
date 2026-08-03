# Tracy Skills Registry

A public registry for skills that Tracy Desk can load. The registry only holds **records that
point to** the repo containing the skill — it does not hold the skill's content. The source of
truth for each skill still lives in the GitHub repo owned by whoever submitted it.

## How to submit a skill

1. Fork this repo.
2. Add a file at `registry/<namespace>/<slug>.json`, where `<namespace>` must be the name
   (case-insensitive) of the **GitHub owner** behind `gitUrl` — CI rejects a record whose
   namespace does not match the owner.
3. Open a PR. `validate.yml` runs `pnpm validate` (structural checks, no network access) and
   `pnpm build-index` (checks that `SKILL.md` actually exists in the declared repo).

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

## Related documentation

Architecture decision for this registry:
[ADR 0014](https://github.com/TracyHQ/tracy-docs/blob/main/adr/0014-registry-skill-cong-khai-git-tinh.md).
