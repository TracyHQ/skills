# Submit your skill

This folder is the submission queue. Add one JSON file, open a pull request, and once it merges your
skill appears in the public index at `https://registry.tracy.ai/skills/index.json` and becomes
installable from Tracy Desktop.

Your skill stays in **your** repo. All that lives here is a record pointing at it.

You do not need to ask permission first, and you do not need a Tracy account.

## The file

One file per skill, at `registry/<namespace>/<slug>.json`:

```
registry/acme/invoice-audit.json
```

```json
{
  "namespace": "acme",
  "slug": "invoice-audit",
  "gitUrl": "https://github.com/acme/our-skills",
  "ref": "main",
  "skillPath": "skills/invoice-audit"
}
```

| Field | |
|---|---|
| `namespace` | the GitHub owner behind `gitUrl`, and it must match the folder name |
| `slug` | lowercase kebab-case, and it must match the file name |
| `gitUrl` | `https://github.com/{owner}/{repo}` — nothing else |
| `ref` | branch, tag or commit SHA |
| `skillPath` | path to the folder holding `SKILL.md`, relative to the repo root |

You declare only **where** the skill lives. Everything shown to users — display name, description,
star count, last commit — is read from your repo at build time, so it cannot drift from reality and
you never have to update it here.

## Namespaces are proven, not claimed

`namespace` must be the GitHub owner of `gitUrl`, compared case-insensitively. `acme` may publish
records pointing at `github.com/acme/...` and nothing else.

Nobody can take a name that is not theirs, and there is no application step — whoever controls the
GitHub org controls the namespace.

## What CI checks, and what it does not

- `pnpm validate` — pure structural rules, no network: the schema, the path matching the record, the
  namespace matching the owner
- `pnpm build-index` — confirms `SKILL.md` really exists at `skillPath` in the ref you declared

Both must pass before a record can merge. Run them yourself first:

```bash
pnpm install
pnpm validate
```

**Nothing here executes your skill.** It is read as text and hashed, never run.

## After it merges

The index rebuilds and publishes automatically:

```
https://registry.tracy.ai/skills/index.json
https://registry.tracy.ai/skills/acme/invoice-audit.json
```

To change or remove your record later, open another pull request against the same file. It is yours.

If you edit the skill in your own repo afterwards, the next build picks it up — no pull request
needed here.

## The rest

Trust tiers, licensing and attribution are covered in the [repository README](../README.md).

## Questions

Open an issue. If something on this page was unclear enough that you had to guess, that is worth an
issue too.
