# Fixture — joomlart.com × ja_stratum

The fill-block jobs that dressed the joomlart.com working copy in JA Stratum on 2026-08-12,
kept here so the dress can be **replayed** rather than remembered. A re-migrate rebuilds the
fleet container from a fresh archive and wipes everything the reskin wrote; these files plus
the scripts in the parent directory are what make that a non-event.

## Replay order

```
scan-demo.sh          --db <stratum-db>  --web <stratum-web>  --prefix stratum_ ...
scan-client-site.sh   --db <client-db>   --web <client-web>   --prefix ja_ ...   # FREEZE this output
scan-extensions.sh    --demo <pattern-library> --client <content-inventory>
install-demo-frame.sh --template ja_stratum --style-default-id 174 --style-home-id 173 --home-menu-id <home>
sync-extensions.sh    --only "mod_ja_acm,com_finder,finder" --index
port-assets.sh        --patterns <pattern-library>
fill-block.sh         job-mcp-grid.json      # then the rest, any order
fill-block.sh         job-home.json
fill-block.sh         job-home-pricing.json
fill-block.sh         job-footer-columns.json
fill-block.sh         job-footer-dedup.json
design-qa.sh --expect expect-fixture.json
layout-qa.sh   --baseline write
responsive-qa.sh --mode reference   # against the DEMO, once
responsive-qa.sh --mode compare     # against the dressed copy
```

**IDs are environment-specific.** Every job names container IDs, passwords, menu IDs and
article IDs of the copy it was written against. A fresh clone re-imports the client's own
database, so menu/article IDs survive, but container names and passwords do not — update the
`client` / `source` blocks before replaying.

## Not in these files

Two edits were made outside fill-block and must be redone by hand (or folded into a script):

1. **Brand tint + display caps** — appended to `templates/ja_stratum/css/darkmode.css` under a
   `TRACY RESKIN TINT` marker (`--stratum-primary: #007AFF` and friends, plus a `max-height`
   cap on listing images). `undress.sh` strips from that marker down.
2. **Old-skin layout families** — menu items still pinned to a `ja_v5` style need their
   `article_layout` set from the style's own family (Portfolio → `ja_v5:portfolio`, Docs →
   `ja_v5:documentation`, T4 Builder → `ja_v5:t4-blocks`, everything else → `ja_v5:blog`).
   See traps 37/39 in `tracy-docs/reskin/README.md`.
