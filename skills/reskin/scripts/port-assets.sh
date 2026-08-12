#!/usr/bin/env bash
# port-assets.sh — copy the demo images that ACM block params reference into
# the client working copy (spec §6). The pattern library's asset list decides
# WHAT moves; only whole demo namespaces are copied and existing client files
# are NEVER overwritten (--skip-old-files) — the client's media is sacred.
# After the copy, every ref from the asset list is probed over HTTP: a 404
# here means a block will render a broken image, so the probe is the gate.
#
# Usage:
#   port-assets.sh --source-web <demo-web-ctr> --client-web <client-web-ctr> \
#                  --patterns stratum-pattern-library.json \
#                  --host <public-host> --port <loopback-port> [--dry-run]
set -euo pipefail

SW="" CW="" PAT="" HOST="" PORT="" DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --source-web) SW="$2"; shift 2 ;;
    --client-web) CW="$2"; shift 2 ;;
    --patterns) PAT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$SW" ] && [ -n "$CW" ] && [ -f "$PAT" ] && [ -n "$HOST" ] && [ -n "$PORT" ] || {
  echo "usage: port-assets.sh --source-web <c> --client-web <c> --patterns <json> --host <h> --port <n> [--dry-run]" >&2
  exit 2
}

NAMESPACES=$(python3 -c "
import json
pat=json.load(open('$PAT'))
print(' '.join(sorted(pat['assets']['namespaces'].keys())))")
[ -n "$NAMESPACES" ] || { echo "pattern library lists no asset namespaces — nothing to port"; exit 0; }
echo "namespaces: $NAMESPACES"

for ns in $NAMESPACES; do
  if [ "$DRY" = 1 ]; then
    echo "DRY: would copy /var/www/html/$ns from $SW into $CW (--skip-old-files)"
    continue
  fi
  docker exec "$SW" sh -c "tar -C /var/www/html -cf /tmp/assets-port.tar '$ns'"
  docker cp "$SW:/tmp/assets-port.tar" /tmp/assets-port.tar
  docker cp /tmp/assets-port.tar "$CW:/tmp/assets-port.tar"
  # --skip-old-files: never clobber a client file that happens to share a path.
  docker exec "$CW" sh -c "tar -C /var/www/html --skip-old-files -xf /tmp/assets-port.tar && rm /tmp/assets-port.tar"
  rm -f /tmp/assets-port.tar
  echo "ported $ns"
done

[ "$DRY" = 1 ] && { echo "port-assets: DRY RUN"; exit 0; }

# Gate: every referenced asset must answer over HTTP on the client copy.
python3 - "$PAT" "$HOST" "$PORT" <<'PYEOF'
import json, sys, urllib.request

pat, host, port = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
bad = []
for ref in pat["assets"]["refs"]:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/{ref}",
                                 headers={"Host": host, "X-Forwarded-Proto": "https"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception:
        code = 0
    if code != 200:
        bad.append(f"{ref} -> {code}")
for b in bad:
    print("MISSING", b)
print(f"port-assets: {len(pat['assets']['refs']) - len(bad)}/{len(pat['assets']['refs'])} refs answer 200")
sys.exit(1 if bad else 0)
PYEOF
