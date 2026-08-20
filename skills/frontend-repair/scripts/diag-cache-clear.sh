#!/usr/bin/env bash
# diag-cache-clear — the phase-3 hygiene step for a working copy.
# Usage: diag-cache-clear.sh --label <site-label>
#
# Clears the copy's Joomla cache (site + administrator) and the T3/T4 template
# framework asset-regeneration dirs, then reports exactly what was cleared with
# entry counts and on-disk sizes measured BEFORE removal. One run, one envelope.
#
# Hygiene ONLY, never a diagnostic (D-12): the corpus carries zero staff
# prescriptions of cache-clear as a diagnosis; the skill runs this at phase 3 to
# remove stale cache as a confounder, then re-checks. This script therefore does
# not decide anything — it clears, counts, and reports.
#
# Copy-only writes (D-04): it deletes only within the copy's own cache dirs and
# the T3/T4 asset dirs, all under /srv/tracy/<label>/webroot. A cache location
# that a config points outside the webroot is reported, never touched. The Joomla
# guard stubs (index.html, .htaccess) at the top of each dir are left in place.
#
# Safe when already empty (or absent): still a valid "ok" envelope with
# zero-count findings — an empty copy is a clean copy, not an error.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/result-envelope.sh"
source "$SCRIPT_DIR/json-helpers.sh"
source "$SCRIPT_DIR/envelope-exit-guard.sh"

usage() {
  echo "Usage: diag-cache-clear.sh --label <site-label>" >&2
}

# A run by hand reaches the same webroot the fleet gate feeds it, so it holds
# itself to the same shape the gate enforces.
SAFE_ARG_RE='^[A-Za-z0-9._:/@-]+$'

# ---------- arg parsing ----------

LABEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --label)
      # "Called wrong" (exit 2, no JSON) is deliberately distinct from "ran but
      # failed" (exit 0, envelope with status "error"): a bare flag means no run
      # ever happened, so there is nothing to report on, and emitting an envelope
      # would break the one-JSON-document contract (ID-5).
      if [ $# -lt 2 ]; then usage; exit 2; fi
      LABEL="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$LABEL" ]]; then usage; exit 2; fi
if [[ ! "$LABEL" =~ $SAFE_ARG_RE ]]; then
  echo "Invalid --label value: must match $SAFE_ARG_RE" >&2
  usage
  exit 2
fi

WEBROOT="/srv/tracy/$LABEL/webroot"
CONFIG="$WEBROOT/configuration.php"

# Per-location cap on listed removed-entry names. The counts beside the list
# always state the true total, so a capped list never reads as a complete one.
ENTRY_LIST_CAP=200

# ---------- one envelope, whatever happens after init ----------

# emit_envelope_once / on_exit / TEMP_FILES / ENVELOPE_READY come from
# envelope-exit-guard.sh. This script does delete, so a mid-run abort could
# leave a location half-cleared; the note tells the reading agent so.
ENVELOPE_ABORT_NOTE="one or more cache/asset locations may be partly cleared; re-running is safe (idempotent hygiene)"
trap on_exit EXIT

envelope_init "diag-cache-clear" "$LABEL"
ENVELOPE_READY=1

if [[ ! -d "$WEBROOT" ]]; then
  envelope_error "Webroot not found: /srv/tracy/$LABEL/webroot"
  emit_envelope_once
  exit 0
fi

if [[ ! -f "$CONFIG" ]]; then
  envelope_error "configuration.php not found in webroot"
  emit_envelope_once
  exit 0
fi

# ---------- resolve the site cache location (config may relocate it) ----------
# Joomla's global $cache_path, when set, moves the site cache off the default
# webroot/cache. We honour it only when it still resolves inside the copy's
# webroot; a path that points elsewhere is recorded as skipped and left
# untouched (copy-only, D-04). The admin cache is not relocatable by this var,
# so it stays at administrator/cache.

CFG_CACHE_PATH=""
# head -n1: a commented-out duplicate $cache_path line in configuration.php would
# otherwise feed a multiline value into the path logic below.
CFG_CACHE_PATH=$(grep -oP "public\s+\\\$cache_path\s*=\s*'\K[^']*" "$CONFIG" 2>/dev/null | head -n1 || true)

SITE_CACHE="$WEBROOT/cache"
SITE_CACHE_NOTE=""
if [[ -n "$CFG_CACHE_PATH" ]]; then
  local_candidate=""
  if [[ "$CFG_CACHE_PATH" == /* ]]; then
    local_candidate="$CFG_CACHE_PATH"
  else
    # A relative cache_path is anchored at the site root, the way Joomla reads it.
    local_candidate="$WEBROOT/$CFG_CACHE_PATH"
  fi
  # Lexical-only by design (no realpath — the configured path is treated as
  # untrusted data, and D-04 bounds the delete scope to the copy webroot only).
  # Normalize the candidate — strip trailing '/' runs and a trailing '/.' — so
  # cache_path values '.', './', or an absolute path equal to the webroot all
  # collapse to $WEBROOT and land in the reject branch below. Without this the
  # '$WEBROOT/*' containment glob accepts them (the '*' matches empty), and
  # SITE_CACHE would become the webroot itself — clear_location would then
  # rm -rf every top-level webroot entry.
  normalized_candidate="$local_candidate"
  while [[ "$normalized_candidate" == */ ]]; do
    normalized_candidate="${normalized_candidate%/}"
  done
  if [[ "$normalized_candidate" == */. ]]; then
    normalized_candidate="${normalized_candidate%/.}"
    while [[ "$normalized_candidate" == */ ]]; do
      normalized_candidate="${normalized_candidate%/}"
    done
  fi
  if [[ "$CFG_CACHE_PATH" == *".."* ]]; then
    SITE_CACHE_NOTE="configured cache_path contains '..'; using the default webroot/cache instead and not touching the configured path"
    envelope_unavailable "siteCache:configured" "configured cache_path ($CFG_CACHE_PATH) contains '..'; not touched (copy-only, D-04)"
  elif [[ -z "$normalized_candidate" || "$normalized_candidate" == "$WEBROOT" ]]; then
    SITE_CACHE_NOTE="configured cache_path resolves to the copy webroot itself; using webroot/cache and leaving the configured path untouched"
    envelope_unavailable "siteCache:configured" "configured cache_path ($CFG_CACHE_PATH) resolves to the copy webroot itself; not touched (copy-only, D-04)"
  elif [[ "$normalized_candidate/" == "$WEBROOT"/* ]]; then
    SITE_CACHE="$normalized_candidate"
  else
    SITE_CACHE_NOTE="configured cache_path resolves outside the copy webroot; using webroot/cache and leaving the configured path untouched"
    envelope_unavailable "siteCache:configured" "configured cache_path ($CFG_CACHE_PATH) resolves outside the copy webroot; not touched (copy-only, D-04)"
  fi
fi

# ---------- per-location clear ----------
# Each location is cleared by removing its top-level entries (recursively),
# leaving the directory itself and its Joomla guard stubs in place, so the copy
# is left with exactly the empty-but-present cache dirs Joomla expects.

# Set by clear_location for the caller to fold into findings.
L_PRESENT=false
L_ENTRIES=0
L_REMOVED=0
L_FAILED=0
L_BYTES=0
L_NAMES=()

_dir_bytes_of() {
  # Best-effort on-disk size (KiB blocks -> bytes) of one path; 0 when du can't
  # read it, so a size we could not take never inflates the freed total.
  local p="$1" kb
  kb=$(du -sk "$p" 2>/dev/null | awk '{print $1}') || true
  [[ "$kb" =~ ^[0-9]+$ ]] || { printf '0'; return 0; }
  printf '%s' "$(( kb * 1024 ))"
}

clear_location() {
  # clear_location <part-name> <absolute dir>
  local part="$1" dir="$2"
  L_PRESENT=false; L_ENTRIES=0; L_REMOVED=0; L_FAILED=0; L_BYTES=0; L_NAMES=()

  # Absent (or never created) is a clean copy, not a miss: present:false,
  # zero counts, no unavailable entry.
  if [[ ! -e "$dir" ]]; then
    return 0
  fi
  if [[ ! -d "$dir" ]]; then
    envelope_unavailable "$part" "expected a directory at $dir but found a non-directory; not touched"
    return 0
  fi
  # Guard the delete scope once more at the point of action: require the dir to
  # be a strict subdirectory of $WEBROOT (at least one path component below it).
  # The webroot itself, and paths equal to it after stripping trailing '/' runs,
  # must be rejected — the '$WEBROOT/*' containment glob accepts them because
  # '*' matches empty.
  local dir_norm="$dir"
  while [[ "$dir_norm" == */ ]]; do
    dir_norm="${dir_norm%/}"
  done
  if [[ "$dir_norm" == "$WEBROOT" || "$dir_norm/" != "$WEBROOT"/* ]]; then
    envelope_unavailable "$part" "$dir is outside the copy webroot; not touched (copy-only, D-04)"
    return 0
  fi

  L_PRESENT=true

  local entry name
  # NUL-separated read so filenames containing newlines don't split into
  # multiple loop iterations (would produce bogus L_ENTRIES counts and lose the
  # link between name and rm result). Iteration order is filesystem order —
  # smoke assertions check set membership, not order.
  while IFS= read -r -d '' entry; do
    [[ -z "$entry" ]] && continue
    name="$(basename "$entry")"
    # Leave the guard stubs Joomla ships at the top of a cache dir; removing them
    # would be touching files that are not cache and are not regenerated.
    if [[ "$name" == "index.html" || "$name" == ".htaccess" ]]; then
      continue
    fi
    L_ENTRIES=$(( L_ENTRIES + 1 ))
    # Measure before removal — that is the size the reader asked for.
    L_BYTES=$(( L_BYTES + $(_dir_bytes_of "$entry") ))
    if rm -rf -- "$entry" 2>/dev/null; then
      L_REMOVED=$(( L_REMOVED + 1 ))
      # removed[] lists only successful removals — the "removed from" label at
      # line 220 and the smoke doc's "top-level entry names removed" both name
      # this list as the successes; failed entries surface via entriesFailed
      # and the unavailable[] entry below.
      if (( ${#L_NAMES[@]} < ENTRY_LIST_CAP )); then
        L_NAMES+=("$(_jstr "$name")")
      fi
    else
      L_FAILED=$(( L_FAILED + 1 ))
    fi
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -print0 2>/dev/null)

  if (( L_FAILED > 0 )); then
    envelope_unavailable "$part" "$L_FAILED of $L_ENTRIES entries under $dir could not be removed (permission or I/O error); the rest were cleared"
  fi
}

# ---------- run every location ----------

LOC_JSON=()
LOCATIONS_CLEARED=0
LOCATIONS_ABSENT=0
TOTAL_ENTRIES=0
TOTAL_REMOVED=0
TOTAL_FAILED=0
TOTAL_BYTES=0

run_location() {
  # run_location <part-name> <absolute dir>
  local part="$1" dir="$2"
  clear_location "$part" "$dir"

  if [[ "$L_PRESENT" == "true" ]]; then
    LOCATIONS_CLEARED=$(( LOCATIONS_CLEARED + 1 ))
  else
    LOCATIONS_ABSENT=$(( LOCATIONS_ABSENT + 1 ))
  fi
  TOTAL_ENTRIES=$(( TOTAL_ENTRIES + L_ENTRIES ))
  TOTAL_REMOVED=$(( TOTAL_REMOVED + L_REMOVED ))
  TOTAL_FAILED=$(( TOTAL_FAILED + L_FAILED ))
  TOTAL_BYTES=$(( TOTAL_BYTES + L_BYTES ))

  local listed_from="top-level entries removed from $dir, listed up to $ENTRY_LIST_CAP of $L_ENTRIES"
  local item='{'
  item+="\"part\":$(_jstr "$part")"
  item+=",\"path\":$(_jstr "$dir")"
  item+=",\"present\":$L_PRESENT"
  item+=",\"entries\":$(_jnum "$L_ENTRIES")"
  item+=",\"entriesRemoved\":$(_jnum "$L_REMOVED")"
  item+=",\"entriesFailed\":$(_jnum "$L_FAILED")"
  item+=",\"bytesOnDisk\":$(_jnum "$L_BYTES")"
  item+=",\"removed\":$(_join_json_array "${L_NAMES[@]+"${L_NAMES[@]}"}")"
  item+=",\"listedFrom\":$(_jstr "$listed_from")"
  item+='}'
  LOC_JSON+=("$item")
}

# The two Joomla caches, then the T3 and T4 framework asset-regeneration dirs
# (top-level webroot dirs the frameworks rebuild on the next page load).
run_location "siteCache"  "$SITE_CACHE"
run_location "adminCache" "$WEBROOT/administrator/cache"
run_location "t3Assets"   "$WEBROOT/t3-assets"
run_location "t4Assets"   "$WEBROOT/t4-assets"

# ---------- findings ----------

FINDINGS='{'
FINDINGS+="\"webroot\":$(_jstr "$WEBROOT")"
FINDINGS+=",\"siteCachePath\":$(_jstr "$SITE_CACHE")"
if [[ -n "$SITE_CACHE_NOTE" ]]; then
  FINDINGS+=",\"siteCacheNote\":$(_jstr "$SITE_CACHE_NOTE")"
fi
FINDINGS+=",\"locations\":$(_join_json_array "${LOC_JSON[@]+"${LOC_JSON[@]}"}")"
FINDINGS+=",\"summary\":{"
FINDINGS+="\"locationsCleared\":$(_jnum "$LOCATIONS_CLEARED")"
FINDINGS+=",\"locationsAbsent\":$(_jnum "$LOCATIONS_ABSENT")"
FINDINGS+=",\"entriesRemoved\":$(_jnum "$TOTAL_REMOVED")"
FINDINGS+=",\"entriesFailed\":$(_jnum "$TOTAL_FAILED")"
FINDINGS+=",\"bytesOnDisk\":$(_jnum "$TOTAL_BYTES")"
FINDINGS+=",\"countedFrom\":$(_jstr "the copy's site cache, administrator cache, and the t3-assets/t4-assets dirs; sizes are du-measured on-disk bytes taken before removal; absent locations are counted, not cleared")"
FINDINGS+='}}'

envelope_set_findings "$FINDINGS"
emit_envelope_once

# ---------- smoke-run ----------
# Command (kind 7):
#   bash diag-cache-clear.sh --label <site-label>
#
# Sources: the host filesystem under /srv/tracy/<label>/webroot only. It reads
# $cache_path from configuration.php (to honour a relocated site cache that is
# still inside the webroot), then removes the top-level entries under the site
# cache, administrator/cache, t3-assets and t4-assets — leaving each directory
# and its index.html/.htaccess guard stubs in place. No container exec, no DB,
# no off-host network. Nothing outside those four locations is touched.
#
# Expected top-level envelope keys:
#   schemaVersion ("1.0"), kind ("diag-cache-clear"), label, startedAt,
#   finishedAt, status ("ok"|"error"), findings, unavailable, error
#
# findings keys (status=ok):
#   .webroot          string (the copy webroot acted on)
#   .siteCachePath    string (site cache dir cleared — default webroot/cache, or
#                     the configured cache_path when it resolves inside webroot)
#   .siteCacheNote    string (present only when a configured cache_path was
#                     rejected for being outside the webroot or containing '..')
#   .locations[]      one per location, in order siteCache, adminCache,
#                     t3Assets, t4Assets:
#                     {part, path, present bool, entries, entriesRemoved,
#                      entriesFailed, bytesOnDisk, removed[], listedFrom}
#   .locations[].removed[]  top-level entry names successfully removed (rm-failed
#                     entries surface via entriesFailed and unavailable[], not
#                     here), up to 200; the counts beside it always state the
#                     true total; iteration order is filesystem order
#   .summary          {locationsCleared, locationsAbsent, entriesRemoved,
#                      entriesFailed, bytesOnDisk, countedFrom}
#
# Already-empty / absent copy (still status "ok"): every location reports
# present=false or entries 0, entriesRemoved 0, bytesOnDisk 0; summary counts
# are zero. An empty copy is a clean copy, not an error.
#
# Partial-permission case (status "ok"): a location whose entries the host user
# cannot remove reports entriesFailed > 0 and lands one unavailable[] entry
# naming how many of how many could not be removed; the rest are still cleared.
#
# Configured-cache-rejected (status "ok"): findings.siteCacheNote is set and one
# unavailable[] entry ("siteCache:configured") records that the configured path
# was left untouched (copy-only, D-04); the default webroot/cache is cleared
# instead. Rejected values: any cache_path containing '..', a path that resolves
# outside the copy webroot, and a path that resolves to the copy webroot itself
# (cache_path '.', './', or an absolute path equal to the webroot, with or
# without trailing slashes) — the last group must be rejected because the
# lexical containment glob '$WEBROOT/*' otherwise accepts them and SITE_CACHE
# would become the webroot itself.
#
# Partial-permission removed[] semantics: with 3 entries where 1 rm fails, the
# location reports entries:3, entriesRemoved:2, entriesFailed:1, removed[] lists
# the 2 successes only, and unavailable[] carries the "1 of 3 entries" line.
#
# Error cases (status "error", findings {}, exit 0):
#   Webroot missing  -> "Webroot not found: /srv/tracy/<label>/webroot"
#   Config missing   -> "configuration.php not found in webroot"
#
# Argument errors (no envelope, exit 2):
#   --label missing / unknown flag / --label failing the safe-arg pattern
#
# Cleared-cache verification (for the post-deploy smoke run):
#   Seed a cache entry on the copy, then clear:
#     mkdir -p /srv/tracy/<label>/webroot/cache/com_example
#     head -c 4096 /dev/zero > /srv/tracy/<label>/webroot/cache/com_example/x.php
#     bash diag-cache-clear.sh --label <label>
#   The run reports the siteCache location with entries >= 1, a matching
#   entriesRemoved, bytesOnDisk >= 4096, and "com_example" among removed[]; a
#   second run reports the same location with entries 0. The cache dir itself
#   still exists after both runs; nothing under the webroot outside the four
#   named locations changes.
