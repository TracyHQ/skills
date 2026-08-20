#!/usr/bin/env bash
# diag-override-diff — customization finder for a working copy.
# Usage: diag-override-diff.sh --label <site-label> [--package-dir <host path>]
#
# Compares every template tree the copy carries (site and administrator
# templates, plus their media/templates/ asset trees) against the pristine
# reference of the installed version, resolved only through pristine-store.sh
# (D-38 order; this script never invents its own source). Template overrides
# (html/), T3-style local/ trees and custom CSS all live inside those trees, so
# one comparison per tree covers them.
#
# Read-only on the copy (D-10): it opens files, never writes to the copy. The
# only writes anywhere are the package store's own caching, inside the store.
#
# Reference misses are first-class results (D-38): a part with no resolvable
# reference lands in unavailable[] with the resolver's own reason, its files are
# still listed as "no-reference", and every other part is still diffed. Coverage
# is always stated, never implied.
#
# --package-dir is a maintainer flag for testing against a scratch store; the
# agent surface never passes it (D-50). Fetch-on-miss is the resolver's default
# (D-58); a run that must stay offline exports PRISTINE_ALLOW_FETCH=0.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/result-envelope.sh"
source "$SCRIPT_DIR/json-helpers.sh"
source "$SCRIPT_DIR/envelope-exit-guard.sh"
source "$SCRIPT_DIR/joomla-copy-db.sh"
source "$SCRIPT_DIR/pristine-store.sh"

usage() {
  echo "Usage: diag-override-diff.sh --label <site-label> [--package-dir <host path>]" >&2
}

# ---------- arg parsing ----------

SAFE_ARG_RE='^[A-Za-z0-9._:/@-]+$'
LABEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --label)
      # A bare --label would otherwise die on an unbound $2, before any
      # envelope exists, breaking the one-JSON-document contract (ID-5).
      if [ $# -lt 2 ]; then usage; exit 2; fi
      LABEL="$2"
      shift 2
      ;;
    --package-dir)
      if [ $# -lt 2 ]; then usage; exit 2; fi
      PRISTINE_STORE_DIR="$2"
      shift 2
      ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$LABEL" ]]; then
  usage
  exit 2
fi

if [[ ! "$LABEL" =~ $SAFE_ARG_RE ]]; then
  echo "Invalid --label value: must match $SAFE_ARG_RE" >&2
  usage
  exit 2
fi

WEBROOT="/srv/tracy/$LABEL/webroot"
CONFIG="$WEBROOT/configuration.php"
DB_CONTAINER="${LABEL}-db-1"

# Per-part cap on listed file entries. The counts beside the list always state
# the true total, so a capped list never reads as a complete one.
FILE_ENTRY_CAP=200

# ---------- one envelope, whatever happens after init ----------

# emit_envelope_once / on_exit / TEMP_FILES come from envelope-exit-guard.sh.
# Nothing is written to the copy, so an abort cannot leave it half-changed; a
# run killed mid-fetch can leave a partial cached zip inside the store (temp
# extraction dirs are cleaned by the trap below).
ENVELOPE_ABORT_NOTE="the copy was not touched; the package store may hold a partial cached zip"
trap 'on_exit; _ps_cleanup_temp_dirs' EXIT

envelope_init "diag-override-diff" "$LABEL"
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

# ---------- file fingerprints ----------

# Identity is decided by cmp (exact, no tool needed). The hash is evidence
# carried beside each suspect file, so a missing hash tool costs the
# fingerprints but never the classification.
HASH_CMD=""
HASH_ALGO="none"
if command -v sha256sum >/dev/null 2>&1; then
  HASH_CMD="sha256sum"
  HASH_ALGO="sha256"
elif command -v shasum >/dev/null 2>&1; then
  HASH_CMD="shasum -a 256"
  HASH_ALGO="sha256"
else
  envelope_unavailable "fileHashes" "Neither sha256sum nor shasum is available on the host, so suspect files carry no fingerprint; the identical/modified/added classification is unaffected"
fi

hash_file() {
  [[ -z "$HASH_CMD" ]] && { printf 'null'; return 0; }
  local h
  h=$($HASH_CMD "$1" 2>/dev/null | awk '{print $1}') || true
  if [[ -z "$h" ]]; then printf 'null'; else _jstr "$h"; fi
}

file_bytes() {
  local n
  n=$(wc -c < "$1" 2>/dev/null | tr -d ' ') || true
  if [[ -z "$n" ]]; then printf 'null'; else _jnum "$n"; fi
}

is_text() {
  [[ ! -s "$1" ]] && return 0
  LC_ALL=C grep -Iq . "$1" 2>/dev/null
}

# ---------- Joomla version ----------

JOOMLA_VERSION=""
MANIFEST="$WEBROOT/administrator/manifests/files/joomla.xml"
if [[ -f "$MANIFEST" ]]; then
  JOOMLA_VERSION=$(grep -oP '<version>\K[^<]+' "$MANIFEST" 2>/dev/null || true)
fi

# ---------- template inventory from the copy's DB (optional enrichment) ----------

# Versions come from the DB; the parts themselves are enumerated from disk
# below, so a DB that will not answer costs the version (and with it some
# references), never the file comparison.
INV_CLIENTS=()
INV_ELEMENTS=()
INV_VERSIONS=()

load_template_inventory() {
  if ! db_bootstrap; then
    envelope_unavailable "templateVersions" "$DB_BOOTSTRAP_ERROR; template versions are unknown, so only core-shipped templates can be referenced"
    return 0
  fi

  local query="SELECT client_id, element, \
    CASE WHEN manifest_cache LIKE '%\"version\":\"%' \
      THEN SUBSTRING_INDEX(SUBSTRING_INDEX(manifest_cache, '\"version\":\"', -1), '\"', 1) \
      ELSE '' END \
    FROM ${DB_PREFIX}extensions WHERE type='template' ORDER BY client_id, element"

  local rc=0 data
  data=$(db_query "$query") || rc=$?
  if (( rc != 0 )); then
    envelope_unavailable "templateVersions" "DB query failed (container not running or SQL error); template versions are unknown, so only core-shipped templates can be referenced"
  elif [[ -n "$data" ]]; then
    # Read over db_rows: a template with an empty version column would
    # otherwise collapse under tab-as-whitespace and shift the fields after it.
    local cid element version
    while IFS=$'\x1f' read -r cid element version; do
      [[ -z "$element" ]] && continue
      INV_CLIENTS+=("$cid")
      INV_ELEMENTS+=("$element")
      INV_VERSIONS+=("$version")
    done < <(db_rows "$data")
  fi
}

load_template_inventory

lookup_version() {
  # lookup_version <client_id> <element> -> prints the recorded version, or ""
  local want_client="$1" want_element="$2" i=0
  while (( i < ${#INV_ELEMENTS[@]} )); do
    if [[ "${INV_ELEMENTS[$i]}" == "$want_element" && "${INV_CLIENTS[$i]}" == "$want_client" ]]; then
      printf '%s' "${INV_VERSIONS[$i]}"
      return 0
    fi
    i=$(( i + 1 ))
  done
  printf ''
}

# ---------- pristine core reference ----------

CORE_REF=""
CORE_REF_SOURCE="null"
CORE_REF_VERSION="null"

if [[ -n "$JOOMLA_VERSION" ]]; then
  if pristine_resolve core joomla "$JOOMLA_VERSION"; then
    CORE_REF="$PRISTINE_PATH"
    CORE_REF_SOURCE=$(_jstr "$PRISTINE_SOURCE")
    CORE_REF_VERSION=$(_jstr "$PRISTINE_VERSION")
  else
    envelope_unavailable "$PRISTINE_MISS_PART" "$PRISTINE_MISS_REASON"
  fi
else
  envelope_unavailable "core:unknown" "Manifest file missing or unreadable, so the installed Joomla version is unknown and no core reference can be resolved"
fi

# ---------- one part: compare a copy tree against a reference tree ----------

P_COMPARED=0
P_IDENTICAL=0
P_MODIFIED=0
P_ADDED=0
P_NOREF=0
P_MISSING=0
P_LISTED=0
P_FILES=()
P_MISSING_FILES=()
P_WALK_FAILED=0

file_entry() {
  # file_entry <relative path> <status> <copy file> [reference file]
  local rel="$1" status="$2" copy_f="$3" ref_f="${4:-}"
  (( P_LISTED >= FILE_ENTRY_CAP )) && return 0
  local item='{'
  item+="\"path\":$(_jstr "$rel")"
  item+=",\"status\":$(_jstr "$status")"
  item+=",\"copyBytes\":$(file_bytes "$copy_f")"
  item+=",\"hash\":$(hash_file "$copy_f")"
  if [[ -n "$ref_f" ]]; then
    item+=",\"referenceBytes\":$(file_bytes "$ref_f")"
    if is_text "$copy_f" && is_text "$ref_f"; then
      local d added removed
      d=$(diff -U0 "$ref_f" "$copy_f" 2>/dev/null || true)
      added=$(printf '%s\n' "$d" | grep -Ec '^\+($|[^+])' || true)
      removed=$(printf '%s\n' "$d" | grep -Ec '^-($|[^-])' || true)
      item+=",\"addedLines\":$(_jnum "$added"),\"removedLines\":$(_jnum "$removed")"
    else
      # A binary file is reported as changed without a line summary rather
      # than counted as if it had lines.
      item+=",\"addedLines\":null,\"removedLines\":null"
    fi
  fi
  item+='}'
  P_FILES+=("$item")
  P_LISTED=$(( P_LISTED + 1 ))
}

compare_tree() {
  # compare_tree <copy dir> <reference dir, empty when none resolved>
  local copy_dir="$1" ref_dir="$2"
  P_COMPARED=0; P_IDENTICAL=0; P_MODIFIED=0; P_ADDED=0; P_NOREF=0; P_MISSING=0
  P_LISTED=0; P_FILES=(); P_MISSING_FILES=(); P_WALK_FAILED=0

  local listing="" walk_rc=0
  listing=$(cd "$copy_dir" && LC_ALL=C find . -type f | sed 's|^\./||' | LC_ALL=C sort) || walk_rc=$?
  if (( walk_rc != 0 )); then
    P_WALK_FAILED=1
  fi

  local rel
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    P_COMPARED=$(( P_COMPARED + 1 ))
    if [[ -z "$ref_dir" ]]; then
      P_NOREF=$(( P_NOREF + 1 ))
      file_entry "$rel" "no-reference" "$copy_dir/$rel"
    elif [[ -f "$ref_dir/$rel" ]]; then
      if cmp -s "$copy_dir/$rel" "$ref_dir/$rel"; then
        P_IDENTICAL=$(( P_IDENTICAL + 1 ))
      else
        P_MODIFIED=$(( P_MODIFIED + 1 ))
        file_entry "$rel" "modified" "$copy_dir/$rel" "$ref_dir/$rel"
      fi
    else
      P_ADDED=$(( P_ADDED + 1 ))
      file_entry "$rel" "added" "$copy_dir/$rel"
    fi
  done < <(printf '%s\n' "$listing")

  [[ -z "$ref_dir" ]] && return 0

  # Files the vendor ships that the copy no longer has. Not a suspect edit of
  # the same kind, so they are counted and listed apart from the four statuses.
  local ref_listing="" ref_walk_rc=0
  ref_listing=$(cd "$ref_dir" && LC_ALL=C find . -type f | sed 's|^\./||' | LC_ALL=C sort) || ref_walk_rc=$?
  if (( ref_walk_rc != 0 )); then
    P_WALK_FAILED=1
  fi

  local mlisted=0
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    if [[ ! -f "$copy_dir/$rel" ]]; then
      P_MISSING=$(( P_MISSING + 1 ))
      if (( mlisted < FILE_ENTRY_CAP )); then
        P_MISSING_FILES+=("$(_jstr "$rel")")
        mlisted=$(( mlisted + 1 ))
      fi
    fi
  done < <(printf '%s\n' "$ref_listing")
}

# ---------- part enumeration and comparison ----------

PART_JSON=()
PARTS_COMPARED=0
PARTS_UNAVAILABLE=0
TOTAL_FILES=0
TOTAL_MODIFIED=0
TOTAL_ADDED=0
TOTAL_NOREF=0
TOTAL_MISSING=0

run_part() {
  # run_part <part name> <client: site|administrator> <element>
  #          <path relative to webroot> <kind: template|media>
  local part="$1" client="$2" element="$3" rel_path="$4" kind="$5"
  local copy_dir="$WEBROOT/$rel_path"
  [[ -d "$copy_dir" ]] || return 0

  local ref_dir="" ref_source="null" ref_version="null" resolved="false"

  # 1) The core package, when it ships this very path (Joomla's own templates
  #    and their media trees).
  if [[ -n "$CORE_REF" && -d "$CORE_REF/$rel_path" ]]; then
    ref_dir="$CORE_REF/$rel_path"
    ref_source="$CORE_REF_SOURCE"
    ref_version="$CORE_REF_VERSION"
    resolved="true"
  elif [[ "$kind" == "template" ]]; then
    # 2) A third-party template tree: ask the resolver, with whatever version
    #    the copy records. An empty version is handed over as-is so the miss
    #    reason is the resolver's own, not this script's guess.
    local version
    version=$(lookup_version "$( [[ "$client" == "site" ]] && echo 0 || echo 1 )" "$element")
    if pristine_resolve template "$element" "$version"; then
      if [[ -d "$PRISTINE_PATH/$rel_path" ]]; then
        ref_dir="$PRISTINE_PATH/$rel_path"
      else
        ref_dir="$PRISTINE_PATH"
      fi
      ref_source=$(_jstr "$PRISTINE_SOURCE")
      ref_version=$(_jstr "$PRISTINE_VERSION")
      resolved="true"
    else
      # When the core reference was resolved but does not ship this template
      # directory, prefix the resolver's reason with that fact.
      if [[ -n "$CORE_REF" ]]; then
        envelope_unavailable "$PRISTINE_MISS_PART" "the resolved core package $JOOMLA_VERSION does not ship $rel_path; $PRISTINE_MISS_REASON"
      else
        envelope_unavailable "$PRISTINE_MISS_PART" "$PRISTINE_MISS_REASON"
      fi
    fi
  else
    # 3) A media tree for a template the core package does not ship: the locked
    #    resolution order covers no such reference.
    envelope_unavailable "$part" "No pristine reference covers $rel_path: the locked resolution order holds core packages and JA template trees, neither of which ships this asset tree"
  fi

  compare_tree "$copy_dir" "$ref_dir"

  if (( P_WALK_FAILED )); then
    envelope_unavailable "$part" "the tree under $rel_path could not be fully walked (permission or I/O error), so its counts cover only the readable files"
  fi

  if [[ "$resolved" == "true" ]]; then
    PARTS_COMPARED=$(( PARTS_COMPARED + 1 ))
  else
    PARTS_UNAVAILABLE=$(( PARTS_UNAVAILABLE + 1 ))
  fi
  TOTAL_FILES=$(( TOTAL_FILES + P_COMPARED ))
  TOTAL_MODIFIED=$(( TOTAL_MODIFIED + P_MODIFIED ))
  TOTAL_ADDED=$(( TOTAL_ADDED + P_ADDED ))
  TOTAL_NOREF=$(( TOTAL_NOREF + P_NOREF ))
  TOTAL_MISSING=$(( TOTAL_MISSING + P_MISSING ))

  local compared_from="all files under $rel_path in the copy, recursive"
  if (( P_WALK_FAILED )); then
    compared_from="readable files under $rel_path in the copy — the walk failed partway"
  fi

  local listed_from="non-identical files under $rel_path, listed up to $FILE_ENTRY_CAP of $(( P_MODIFIED + P_ADDED + P_NOREF ))"
  local item='{'
  item+="\"part\":$(_jstr "$part")"
  item+=",\"kind\":$(_jstr "$kind")"
  item+=",\"client\":$(_jstr "$client")"
  item+=",\"element\":$(_jstr "$element")"
  item+=",\"copyPath\":$(_jstr "$rel_path")"
  item+=",\"referenceResolved\":$resolved"
  item+=",\"referenceSource\":$ref_source"
  item+=",\"referenceVersion\":$ref_version"
  item+=",\"filesCompared\":$(_jnum "$P_COMPARED")"
  item+=",\"comparedFrom\":$(_jstr "$compared_from")"
  item+=",\"identical\":$(_jnum "$P_IDENTICAL")"
  item+=",\"modified\":$(_jnum "$P_MODIFIED")"
  item+=",\"added\":$(_jnum "$P_ADDED")"
  item+=",\"noReference\":$(_jnum "$P_NOREF")"
  item+=",\"missingFromCopy\":$(_jnum "$P_MISSING")"
  item+=",\"files\":$(_join_json_array "${P_FILES[@]+"${P_FILES[@]}"}")"
  item+=",\"filesListed\":$(_jnum "$P_LISTED")"
  item+=",\"filesListedFrom\":$(_jstr "$listed_from")"
  item+=",\"missingFromCopyFiles\":$(_join_json_array "${P_MISSING_FILES[@]+"${P_MISSING_FILES[@]}"}")"
  item+='}'
  PART_JSON+=("$item")
}

enumerate_client() {
  # enumerate_client <site|administrator> <templates dir relative to webroot>
  #                  <media dir relative to webroot>
  local client="$1" tpl_root="$2" media_root="$3"
  [[ -d "$WEBROOT/$tpl_root" ]] || return 0
  local dir element
  while IFS= read -r dir; do
    [[ -z "$dir" ]] && continue
    element=$(basename "$dir")
    run_part "$client-template:$element" "$client" "$element" "$tpl_root/$element" "template"
    if [[ -d "$WEBROOT/$media_root/$element" ]]; then
      run_part "$client-template-media:$element" "$client" "$element" "$media_root/$element" "media"
    fi
  done < <(find "$WEBROOT/$tpl_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | LC_ALL=C sort)
}

enumerate_client "site" "templates" "media/templates/site"
enumerate_client "administrator" "administrator/templates" "media/templates/administrator"

if (( PARTS_COMPARED == 0 && PARTS_UNAVAILABLE == 0 )); then
  envelope_unavailable "templateTrees" "No template directory was found under the copy's templates/ or administrator/templates/, so there was nothing to compare"
fi

# ---------- findings ----------

FINDINGS='{'
FINDINGS+="\"joomlaVersion\":$( [[ -n "$JOOMLA_VERSION" ]] && _jstr "$JOOMLA_VERSION" || printf 'null')"
FINDINGS+=",\"referenceStore\":$(_jstr "$PRISTINE_STORE_DIR")"
FINDINGS+=",\"coreReferenceSource\":$CORE_REF_SOURCE"
FINDINGS+=",\"coreReferenceVersion\":$CORE_REF_VERSION"
FINDINGS+=",\"hashAlgo\":$(_jstr "$HASH_ALGO")"
FINDINGS+=",\"parts\":$(_join_json_array "${PART_JSON[@]+"${PART_JSON[@]}"}")"
FINDINGS+=",\"summary\":{"
FINDINGS+="\"partsCompared\":$(_jnum "$PARTS_COMPARED")"
FINDINGS+=",\"partsUnavailable\":$(_jnum "$PARTS_UNAVAILABLE")"
FINDINGS+=",\"filesCompared\":$(_jnum "$TOTAL_FILES")"
FINDINGS+=",\"modified\":$(_jnum "$TOTAL_MODIFIED")"
FINDINGS+=",\"added\":$(_jnum "$TOTAL_ADDED")"
FINDINGS+=",\"noReference\":$(_jnum "$TOTAL_NOREF")"
FINDINGS+=",\"missingFromCopy\":$(_jnum "$TOTAL_MISSING")"
FINDINGS+=",\"countedFrom\":$(_jstr "every template tree found in the copy; parts without a reference are counted in noReference and listed in unavailable[]")"
FINDINGS+='}}'

envelope_set_findings "$FINDINGS"
emit_envelope_once

# ---------- smoke-run ----------
# Seed one reference offline before running, so the diff logic itself is
# exercised (an empty store only proves the miss path). The store is plain
# directories, so seeding = copying an already-extracted pristine tree:
#
#   mkdir -p /tmp/scratch-store/core
#   cp -R <extracted pristine Joomla tree for the copy's version> \
#     /tmp/scratch-store/core/<version>
#   PRISTINE_ALLOW_FETCH=0 bash diag-override-diff.sh --label <site-label> \
#     --package-dir /tmp/scratch-store
#
# Empty-store variant (miss path only):
#   PRISTINE_ALLOW_FETCH=0 bash diag-override-diff.sh --label <site-label> \
#     --package-dir /tmp/scratch-store
#
# Sources: files under /srv/tracy/<label>/webroot (read-only); the site's db
# container (<label>-db-1) over docker exec for template versions; the package
# store on the host (default /opt/tracy-fleet/diagnostics/packages) for
# references. The store may fetch a missing core package unless
# PRISTINE_ALLOW_FETCH=0; nothing is ever written to the copy.
#
# Expected top-level envelope keys:
#   schemaVersion ("1.0"), kind ("diag-override-diff"), label, startedAt,
#   finishedAt, status ("ok"|"error"), findings, unavailable, error
#
# findings keys (status=ok):
#   .joomlaVersion           string | null
#   .referenceStore          string (store dir this run used)
#   .coreReferenceSource     string | null   ("store" | "joomla-official-download")
#   .coreReferenceVersion    string | null   (the reference version diffed against)
#   .hashAlgo                "sha256" | "none"
#   .parts[]                 one per template tree and per template media tree:
#                            {part, kind ("template"|"media"), client
#                             ("site"|"administrator"), element, copyPath,
#                             referenceResolved bool, referenceSource,
#                             referenceVersion, filesCompared, comparedFrom,
#                             identical, modified, added, noReference,
#                             missingFromCopy, files[], filesListed,
#                             filesListedFrom, missingFromCopyFiles[]}
#   .parts[].files[]         {path, status ("modified"|"added"|"no-reference"),
#                             copyBytes, hash, and for "modified" also
#                             referenceBytes, addedLines, removedLines
#                             (null lines for binary files)}
#   .summary                 {partsCompared, partsUnavailable, filesCompared,
#                             modified, added, noReference, missingFromCopy,
#                             countedFrom}
#
# Identical files are counted, not listed — the list is the suspect list. Each
# part lists at most 200 non-identical files while its counts always state the
# true totals, so a capped list never reads as a complete one.
#
# Error cases (status "error", findings {}, exit 0):
#   Webroot missing            -> "Webroot not found: ..."
#   Config missing             -> "configuration.php not found in webroot"
#
# Other cases (status "ok", the run still reports what it could measure):
#   Empty store, no fetch      -> every part unresolved: files listed as
#                                 "no-reference", one unavailable[] entry per
#                                 part carrying the resolver's own reason
#   Seeded core only           -> core-shipped templates diffed, third-party
#                                 template trees in unavailable[]
#   DB unreachable             -> "templateVersions" in unavailable[];
#                                 core-shipped templates still diff, third-party
#                                 ones cannot be referenced
#   Manifest unreadable        -> "core:unknown" in unavailable[]; no core
#                                 reference, so no part resolves through it
#   No hash tool on the host   -> "fileHashes" in unavailable[], hashAlgo
#                                 "none", classification unaffected
