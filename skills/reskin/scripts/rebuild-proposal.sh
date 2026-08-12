#!/usr/bin/env bash
# rebuild-proposal.sh — rebuild one proposal's preview FROM ITS DIRECTORY in the site repo
# (ADR 0045: being rebuildable from the directory is the definition of done).
#
# What one run does, in order:
#   1. fetch the repo (read-only deploy key) and check out `proposal/<slug>` — or `main`
#      when the branch does not exist yet (a backfilled proposal lives there)
#   2. rebuild the proposal's schema from the site's (make-variant --replace)
#   3. replay proposals/<slug>/jobs/*.json in name order, filling the client block from
#      the stack's own env — the repo never carries credentials
#   4. copy proposals/<slug>/files/* onto the shared webroot (paths relative to webroot)
#   5. verify the homepage answers through the proposal's own header, and write a
#      build manifest (commit + jobs hash) the bar can later self-report from
#
# Usage:
#   rebuild-proposal.sh --label <label> --slug <slug> --repo git@github.com:Org/site.git
#                       [--ref proposal/<slug>]
set -euo pipefail

LABEL="" SLUG="" REPO="" REF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --slug) SLUG="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$LABEL" ] && [ -n "$SLUG" ] && [ -n "$REPO" ] || {
  echo "usage: rebuild-proposal.sh --label <l> --slug <s> --repo <git-url> [--ref <ref>]" >&2
  exit 2
}
echo "$SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]{0,30}$' || { echo "bad slug: $SLUG" >&2; exit 2; }

DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKOUT="/srv/tracy/repos/$LABEL"
export GIT_SSH_COMMAND="ssh -i /root/.ssh/tracy_repo_ed25519 -o StrictHostKeyChecking=accept-new"

# --- 1. the repo, at the ref that owns this proposal -------------------------
mkdir -p "$(dirname "$CHECKOUT")"
if [ ! -d "$CHECKOUT/.git" ]; then
  git clone --quiet --filter=blob:none "$REPO" "$CHECKOUT"
fi
git -C "$CHECKOUT" fetch --quiet origin
WANT="${REF:-proposal/$SLUG}"
if git -C "$CHECKOUT" rev-parse --verify -q "origin/$WANT" >/dev/null; then
  git -C "$CHECKOUT" checkout --quiet --force "origin/$WANT"
else
  # A proposal backfilled straight onto main has no branch yet; main is then its home.
  echo "ref origin/$WANT not found — falling back to origin/main"
  git -C "$CHECKOUT" checkout --quiet --force origin/main
fi
COMMIT=$(git -C "$CHECKOUT" rev-parse HEAD)

PDIR="$CHECKOUT/proposals/$SLUG"
[ -d "$PDIR" ] || { echo "refused: $PDIR does not exist at $COMMIT" >&2; exit 3; }

# --- 2. a fresh schema: every rebuild starts from the site, not from the last build ---
bash "$DIR/make-variant.sh" --db "$LABEL-db-1" --slug "$SLUG" --replace

# --- 3. replay the jobs, oldest first ---------------------------------------
set -a; . "/srv/tracy/$LABEL/.env"; set +a
PREFIX=$(docker exec "$LABEL-web-1" grep -m1 dbprefix /var/www/html/configuration.php | sed "s/.*'\(.*\)'.*/\1/")
JOBS_HASH=""
shopt -s nullglob
for JOB in "$PDIR"/jobs/*.json; do
  echo "--- replay $(basename "$JOB")"
  python3 - "$JOB" "$LABEL" "$SLUG" "$PREFIX" <<'PYEOF'
import json, os, sys
job_path, label, slug, prefix = sys.argv[1:5]
job = json.load(open(job_path))
job["client"] = {
    "db": f"{label}-db-1", "web": f"{label}-web-1", "prefix": prefix,
    "pass": os.environ["DB_PASSWORD"], "host": f"{label}.tracy.ai",
    "port": os.environ["HOST_PORT"], "variant": slug,
}
json.dump(job, open("/tmp/rebuild-job.json", "w"))
PYEOF
  bash "$DIR/fill-block.sh" /tmp/rebuild-job.json
  JOBS_HASH=$(cat "$PDIR"/jobs/*.json | sha256sum | cut -c1-16)
done
rm -f /tmp/rebuild-job.json

# --- 4. the file half, onto the shared webroot ------------------------------
if [ -d "$PDIR/files" ]; then
  # Paths inside files/ are relative to the webroot; the webroot is the bind mount.
  cp -R "$PDIR/files/." "/srv/tracy/$LABEL/webroot/"
  echo "files: copied $(find "$PDIR/files" -type f | wc -l) file(s) onto the webroot"
fi

# --- 5. prove it, and say what was built ------------------------------------
docker exec "$LABEL-web-1" sh -c 'rm -rf /var/www/html/cache/* 2>/dev/null; true'
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Host: $LABEL.tracy.ai" -H "X-Tracy-Variant: $SLUG" -H "X-Forwarded-Proto: https" \
  "http://127.0.0.1:$HOST_PORT/")
MANIFEST="/opt/tracy-fleet/reskin/out/build-$LABEL-$SLUG.json"
printf '{"label":"%s","slug":"%s","commit":"%s","jobsHash":"%s","homepage":%s}\n' \
  "$LABEL" "$SLUG" "$COMMIT" "$JOBS_HASH" "$CODE" > "$MANIFEST"
echo "rebuild-proposal: $SLUG built from $COMMIT (jobs $JOBS_HASH) — homepage $CODE -> $MANIFEST"
[ "$CODE" = "200" ]
