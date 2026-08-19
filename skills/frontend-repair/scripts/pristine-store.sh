#!/usr/bin/env bash
# pristine-store — the host-local store of vendor-original packages, plus the
# resolver that answers with a pristine reference or an honest miss (D-38).
#
# Resolution order is fixed and never guesses (D-38):
#   1. Joomla core     -> the store, else the vendor's official release archive
#                         on github.com/joomla/joomla-cms for that exact version,
#                         cached into the store. This is the only fetch the
#                         resolver is allowed to make.
#   2. JA template     -> the store only, seeded from the external ja-products
#                         quickstart store. Never fetched at run time.
#   3. anything else   -> honest miss: a part + reason the caller reports as an
#                         `unavailable` entry. Never a substitute reference.
# A version that is not in the store is a miss; a near version is not a pristine
# reference for another version, and a mislabelled package is not one either.
#
# Store layout, created on demand (pristine_store_init, or any resolve):
#   <store>/core/<version>/                 extracted Joomla core full package
#   <store>/templates/<element>/<version>/  extracted pristine template tree
#   <store>/downloads/                      cached vendor zips, vendor file names
# <element> is the template element as the copy records it (ja_teline_v), not
# the vendor's catalog slug. <store> defaults to PRISTINE_STORE_DIR_DEFAULT
# below; maintainers point it elsewhere with --package-dir (script-side only,
# never reachable from the agent surface — D-50).
# Bulk-seeding the store is operational work, not this script's job: an empty
# or partial store is safe, because every unseeded part comes back as a miss.
#
# Sourced as a library by the override-diff (C1 ticket 07):
#   source "$SCRIPT_DIR/pristine-store.sh"
#   if pristine_resolve core joomla "$JOOMLA_VERSION"; then
#     : diff against "$PRISTINE_PATH"
#   else
#     envelope_unavailable "$PRISTINE_MISS_PART" "$PRISTINE_MISS_REASON"
#   fi
# The miss carries exactly the two fields envelope_unavailable takes, so a miss
# lands in the envelope unchanged, in the caller's own words about nothing.
# Core fetching is on by default. A sourced caller that must stay offline sets
# PRISTINE_ALLOW_FETCH=0 before its first resolve; every uncached version then
# comes back as a miss instead of a download. The runnable path spells the same
# kill-switch --no-fetch.
#
# Run directly for one lookup printing one JSON document:
#   pristine-store.sh --kind core --name joomla --version 5.4.7
# Sourced as a library it needs no other lib and sets no shell flags; the
# runnable path sources json-helpers.sh for _jstr, and result-envelope.sh ahead
# of it because _jstr calls that file's JSON-escape helper. Nothing else from
# either file is used here.

PRISTINE_STORE_DIR_DEFAULT="/opt/tracy-fleet/diagnostics/packages"

# Callers may set these before the first resolve.
PRISTINE_STORE_DIR="${PRISTINE_STORE_DIR:-$PRISTINE_STORE_DIR_DEFAULT}"
# Fetching is on by default for core; a maintainer testing offline turns it off.
PRISTINE_ALLOW_FETCH="${PRISTINE_ALLOW_FETCH:-1}"

# Answers of the last resolve. PRISTINE_PATH is set only on a hit, the two miss
# fields only on a miss, so a stale value from an earlier part can never be read
# as this part's answer.
PRISTINE_PATH=""
PRISTINE_SOURCE=""
PRISTINE_VERSION=""
PRISTINE_MISS_PART=""
PRISTINE_MISS_REASON=""

# A version reaches a download URL and a directory name, so it is matched
# against a safe pattern before either. Same for the element of a template.
_PS_VERSION_RE='^[0-9]+(\.[0-9]+){1,3}(-[A-Za-z0-9][A-Za-z0-9.]*)?$'
_PS_ELEMENT_RE='^[A-Za-z0-9][A-Za-z0-9._-]*$'

# Temp trees a run has created inside the store. The runnable path installs an
# EXIT trap over this list, so a run killed between extraction and the swap
# leaves no .tmp-core-* tree behind. Sourced as a library the script installs no
# trap in the caller's shell; there the explicit cleanups on every failure path
# below are the whole story.
_PS_TEMP_DIRS=()

_ps_cleanup_temp_dirs() {
  local d
  for d in ${_PS_TEMP_DIRS[@]+"${_PS_TEMP_DIRS[@]}"}; do
    [[ -n "$d" ]] && rm -rf "$d"
  done
  return 0
}

# ---------- store layout ----------

pristine_store_init() {
  local store="${1:-$PRISTINE_STORE_DIR}"
  mkdir -p "$store/core" "$store/templates" "$store/downloads" 2>/dev/null
}

# True when the directory exists and holds at least one entry. An empty
# directory left behind by a failed extraction is not a reference.
_ps_dir_has_content() {
  local dir="$1"
  [[ -d "$dir" ]] || return 1
  local entry
  for entry in "$dir"/* "$dir"/.[!.]*; do
    [[ -e "$entry" ]] && return 0
  done
  return 1
}

# ---------- answers ----------

_ps_hit() {
  PRISTINE_PATH="$1"
  PRISTINE_SOURCE="$2"
  PRISTINE_VERSION="$3"
  PRISTINE_MISS_PART=""
  PRISTINE_MISS_REASON=""
  return 0
}

_ps_miss() {
  PRISTINE_MISS_PART="$1"
  PRISTINE_MISS_REASON="$2"
  PRISTINE_PATH=""
  PRISTINE_SOURCE=""
  PRISTINE_VERSION=""
  return 1
}

# ---------- reading a package's own words ----------

# The text of the first <tag> in an XML file, empty when the file or the tag
# cannot be read. Both manifests a pristine reference is judged by are read
# through here, so the reading lives in one place.
_ps_first_tag_value() {
  local file="$1" tag="$2"
  [[ -f "$file" ]] || return 0
  grep -o "<$tag>[^<]*</$tag>" "$file" 2>/dev/null \
    | head -n 1 | sed -e "s/<$tag>//" -e "s|</$tag>||" || true
}

# ---------- Joomla core ----------

# The version in the package's own manifest, empty when it cannot be read.
_ps_core_manifest_version() {
  _ps_first_tag_value "$1/administrator/manifests/files/joomla.xml" version
}

# Downloads the official full package for one exact version and caches it into
# the store. Prints nothing; answers through _ps_hit / _ps_miss.
_ps_fetch_core() {
  local version="$1" part="$2" store="$3"
  local url="https://github.com/joomla/joomla-cms/releases/download/${version}/Joomla_${version}-Stable-Full_Package.zip"
  local zip="$store/downloads/Joomla_${version}-Stable-Full_Package.zip"
  local target="$store/core/$version"

  if ! command -v curl >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
    _ps_miss "$part" "Joomla core $version is not in the package store and cannot be fetched: curl and unzip are both required on the host"
    return 1
  fi

  if ! pristine_store_init "$store" || [[ ! -w "$store/downloads" ]]; then
    _ps_miss "$part" "Joomla core $version is not in the package store and the store at $store is not writable, so it cannot be cached"
    return 1
  fi

  # Re-use an already cached zip only when the archive itself checks out. A
  # partial one from an interrupted run is discarded rather than trusted,
  # because a non-empty file proves nothing about the bytes inside it.
  if [[ -s "$zip" ]] && ! unzip -tqq "$zip" >/dev/null 2>&1; then
    rm -f "$zip"
  fi

  # --max-time 600 where the sibling scripts use 60: this is a ~100 MB archive,
  # and a slow link is not a reason to report the version as missing.
  if [[ ! -s "$zip" ]] && ! curl -fsSL --max-time 600 -o "$zip" "$url" 2>/dev/null; then
    rm -f "$zip"
    _ps_miss "$part" "Download of the official Joomla $version full package failed ($url) — the version may not exist upstream, or the host has no route to it"
    return 1
  fi

  # Extract beside the target and move into place, so a half-extracted tree is
  # never visible under core/<version> to the next run.
  local tmp
  tmp="$(mktemp -d "$store/.tmp-core-XXXXXX" 2>/dev/null || true)"
  if [[ -z "$tmp" ]]; then
    _ps_miss "$part" "Cannot create a temporary directory inside the package store at $store"
    return 1
  fi
  _PS_TEMP_DIRS+=("$tmp")

  if ! unzip -oq "$zip" -d "$tmp" 2>/dev/null; then
    rm -rf "$tmp"
    rm -f "$zip"
    _ps_miss "$part" "The downloaded package for Joomla $version could not be extracted; the cached file was discarded"
    return 1
  fi

  # Version-exact or nothing: the URL asked for one version, and only the
  # package's own manifest can confirm the bytes agree.
  local found
  found="$(_ps_core_manifest_version "$tmp")"
  if [[ -z "$found" ]]; then
    rm -rf "$tmp"
    _ps_miss "$part" "The downloaded package for Joomla $version carries no readable manifest, so its version cannot be confirmed"
    return 1
  fi
  if [[ "$found" != "$version" ]]; then
    rm -rf "$tmp"
    _ps_miss "$part" "The official package downloaded for Joomla $version reports version $found; a mismatched reference is not a pristine reference"
    return 1
  fi

  # Step the old tree aside rather than deleting it first: a swap that fails
  # half way must leave the previously cached copy intact, not an empty slot.
  local old=""
  if [[ -e "$target" ]]; then
    old="$target.replaced.$$"
    rm -rf "$old"
    if ! mv "$target" "$old" 2>/dev/null; then
      rm -rf "$tmp"
      _ps_miss "$part" "Joomla $version was downloaded but the copy already cached at $target could not be moved aside, so it was left untouched"
      return 1
    fi
  fi

  if ! mv "$tmp" "$target" 2>/dev/null; then
    rm -rf "$tmp"
    if [[ -n "$old" ]]; then
      mv "$old" "$target" 2>/dev/null || true
    fi
    _ps_miss "$part" "Joomla $version was downloaded but could not be cached into $target"
    return 1
  fi

  if [[ -n "$old" ]]; then
    rm -rf "$old"
  fi

  _ps_hit "$target" "joomla-official-download" "$version"
}

_ps_resolve_core() {
  local version="$1"
  local part="core:$version"
  local store="$PRISTINE_STORE_DIR"

  if [[ ! "$version" =~ $_PS_VERSION_RE ]]; then
    _ps_miss "core:unknown" "No usable Joomla core version was read from the copy (got: ${version:-empty}), so no reference can be resolved"
    return 1
  fi

  local cached="$store/core/$version"
  if _ps_dir_has_content "$cached"; then
    local found
    found="$(_ps_core_manifest_version "$cached")"
    if [[ -z "$found" ]]; then
      _ps_miss "$part" "The stored reference at $cached carries no readable manifest, so its version cannot be confirmed"
      return 1
    fi
    if [[ "$found" != "$version" ]]; then
      _ps_miss "$part" "The stored reference at $cached reports Joomla version $found, not $version; a mismatched reference is not a pristine reference"
      return 1
    fi
    _ps_hit "$cached" "store" "$version"
    return 0
  fi

  if [[ "$PRISTINE_ALLOW_FETCH" != "1" ]]; then
    _ps_miss "$part" "Joomla core $version is not in the package store and fetching is disabled for this run"
    return 1
  fi

  _ps_fetch_core "$version" "$part" "$store"
}

# ---------- JA templates ----------

# The template a stored tree actually declares, empty when unreadable. The
# ja-products store has measured mislabelled packages, so the name inside the
# package decides, not the directory it was filed under.
_ps_template_declared_element() {
  _ps_first_tag_value "$1/templateDetails.xml" name
}

# The versions of one template the store does hold — named in the miss, so the
# reader learns whether this is a coverage gap or a version gap.
_ps_template_stored_versions() {
  local dir="$1"
  local entry names=""
  [[ -d "$dir" ]] || return 0
  for entry in "$dir"/*; do
    [[ -d "$entry" ]] || continue
    names="${names:+$names, }$(basename "$entry")"
  done
  printf '%s' "$names"
}

_ps_resolve_template() {
  local element="$1" version="$2"
  local part="template:$element:$version"
  local store="$PRISTINE_STORE_DIR"

  if [[ ! "$element" =~ $_PS_ELEMENT_RE ]]; then
    _ps_miss "template:unknown" "No usable template name was read from the copy (got: ${element:-empty}), so no reference can be resolved"
    return 1
  fi
  if [[ ! "$version" =~ $_PS_VERSION_RE ]]; then
    _ps_miss "template:$element:unknown" "The copy records no usable version for template $element (got: ${version:-empty}), and a template reference is only pristine for one exact version"
    return 1
  fi

  local dir="$store/templates/$element/$version"
  if ! _ps_dir_has_content "$dir"; then
    local held
    held="$(_ps_template_stored_versions "$store/templates/$element")"
    if [[ -n "$held" ]]; then
      _ps_miss "$part" "The package store holds template $element at version(s) $held, not $version; a different version is not a pristine reference for this one"
    else
      _ps_miss "$part" "No pristine reference in the package store for template $element $version. Template references are seeded from the ja-products quickstart store, which covers 75 of 176 JA templates and not every version of those (figures from ADR 0059, unverified against GitHub); third-party templates are not covered at all"
    fi
    return 1
  fi

  local declared
  declared="$(_ps_template_declared_element "$dir")"
  if [[ -z "$declared" ]]; then
    _ps_miss "$part" "The stored reference at $dir carries no readable manifest, so the template it holds cannot be confirmed"
    return 1
  fi
  if [[ "$declared" != "$element" ]]; then
    _ps_miss "$part" "The stored reference at $dir declares template $declared, not $element; a mislabelled package is not a pristine reference (the ja-products store has measured mislabelled packages)"
    return 1
  fi

  _ps_hit "$dir" "store" "$version"
}

# ---------- the resolver ----------

# pristine_resolve <kind> <name> <version>
#   kind: core | template | anything else (third-party extension, unknown part)
# Returns 0 with PRISTINE_PATH / PRISTINE_SOURCE / PRISTINE_VERSION set,
# or 1 with PRISTINE_MISS_PART / PRISTINE_MISS_REASON set.
pristine_resolve() {
  local kind="${1:-}" name="${2:-}" version="${3:-}"

  pristine_store_init "$PRISTINE_STORE_DIR" || true

  case "$kind" in
    core)
      _ps_resolve_core "$version"
      ;;
    template)
      _ps_resolve_template "$name" "$version"
      ;;
    *)
      # Third-party extensions and anything else the order does not cover: the
      # honest miss is the whole answer, and the reason says why, not "failed".
      _ps_miss "${kind:-unknown}:${name:-unknown}:${version:-unknown}" "No pristine source covers ${kind:-this part} ${name:-} ${version:-}: the locked resolution order covers Joomla core and JA templates only"
      ;;
  esac
}

# ---------- runnable path ----------

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  # Guarded only on the runnable path: this file is sourced as a library, so
  # these flags must not leak into callers.
  set -euo pipefail

  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  source "$SCRIPT_DIR/result-envelope.sh"
  source "$SCRIPT_DIR/json-helpers.sh"

  # Only here, never in a sourced caller's shell: a half-extracted tree must not
  # survive a run that is killed mid-fetch.
  trap _ps_cleanup_temp_dirs EXIT

  usage() {
    echo "Usage: pristine-store.sh --kind <core|template|other> --name <name> --version <version> [--package-dir <path>] [--no-fetch]" >&2
    echo "       pristine-store.sh --init [--package-dir <path>]" >&2
  }

  KIND=""
  NAME=""
  VERSION=""
  INIT_ONLY=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --kind|--name|--version|--package-dir)
        # A bare flag would otherwise die on an unbound $2 with no answer
        # printed at all, which reads the same as "no reference exists".
        if [ $# -lt 2 ]; then
          usage
          exit 2
        fi
        case "$1" in
          --kind) KIND="$2" ;;
          --name) NAME="$2" ;;
          --version) VERSION="$2" ;;
          --package-dir) PRISTINE_STORE_DIR="$2" ;;
        esac
        shift 2
        ;;
      --no-fetch) PRISTINE_ALLOW_FETCH=0; shift ;;
      --init) INIT_ONLY=1; shift ;;
      *) echo "Unknown flag: $1" >&2; exit 2 ;;
    esac
  done

  if (( INIT_ONLY == 1 )); then
    # An unwritable path must not exit silent: silence reads the same as
    # success to whoever runs this, so the failure gets its own JSON document
    # and a nonzero exit. "created" says what actually happened, so a second
    # --init on an existing store does not claim to have made one.
    PS_INIT_EXISTED=1
    for PS_INIT_SUBDIR in core templates downloads; do
      [[ -d "$PRISTINE_STORE_DIR/$PS_INIT_SUBDIR" ]] || PS_INIT_EXISTED=0
    done

    if ! pristine_store_init "$PRISTINE_STORE_DIR" \
      || [[ ! -d "$PRISTINE_STORE_DIR/core" ]] \
      || [[ ! -d "$PRISTINE_STORE_DIR/templates" ]] \
      || [[ ! -d "$PRISTINE_STORE_DIR/downloads" ]]; then
      printf '{"store":%s,"created":false,"error":%s}\n' \
        "$(_jstr "$PRISTINE_STORE_DIR")" \
        "$(_jstr "The package store at $PRISTINE_STORE_DIR could not be created; the path is not writable by this user")"
      exit 1
    fi

    if (( PS_INIT_EXISTED == 1 )); then
      printf '{"store":%s,"created":false}\n' "$(_jstr "$PRISTINE_STORE_DIR")"
    else
      printf '{"store":%s,"created":true}\n' "$(_jstr "$PRISTINE_STORE_DIR")"
    fi
    exit 0
  fi

  if [[ -z "$KIND" || -z "$VERSION" ]]; then
    usage
    exit 2
  fi
  if [[ "$KIND" == "template" && -z "$NAME" ]]; then
    usage
    exit 2
  fi

  if pristine_resolve "$KIND" "$NAME" "$VERSION"; then
    printf '{"status":"found","kind":%s,"name":%s,"version":%s,"path":%s,"source":%s,"store":%s}\n' \
      "$(_jstr "$KIND")" "$(_jstr "$NAME")" "$(_jstr "$PRISTINE_VERSION")" \
      "$(_jstr "$PRISTINE_PATH")" "$(_jstr "$PRISTINE_SOURCE")" "$(_jstr "$PRISTINE_STORE_DIR")"
  else
    printf '{"status":"miss","kind":%s,"name":%s,"version":%s,"unavailable":{"part":%s,"reason":%s},"store":%s}\n' \
      "$(_jstr "$KIND")" "$(_jstr "$NAME")" "$(_jstr "$VERSION")" \
      "$(_jstr "$PRISTINE_MISS_PART")" "$(_jstr "$PRISTINE_MISS_REASON")" "$(_jstr "$PRISTINE_STORE_DIR")"
  fi
fi

# ---------- demo run ----------
# Two lookups against a scratch store, the hit and the miss the override-diff
# will meet. Both print one JSON document and exit 0: a miss is an answer, not
# a failure, and only a usage error (exit 2) prints nothing.
#
# Setup:
#   STORE=/tmp/pristine-demo
#   bash pristine-store.sh --init --package-dir "$STORE"
#
# 1. Joomla core against a store that does not hold it yet. The demo passes
#    --no-fetch on purpose: without it this exact command downloads a ~100 MB
#    vendor archive, which is not something to trigger by reading a comment.
#      bash pristine-store.sh --kind core --name joomla --version 5.4.7 \
#        --package-dir "$STORE" --no-fetch
#    {"status":"miss","kind":"core","name":"joomla","version":"5.4.7",
#     "unavailable":{"part":"core:5.4.7","reason":"Joomla core 5.4.7 is not in
#     the package store and fetching is disabled for this run"},
#     "store":"/tmp/pristine-demo"}
#    Drop --no-fetch on a host that is meant to fetch and the same command
#    answers {"status":"found",...,"source":"joomla-official-download"}, caching
#    the tree; every later run of it answers with "source":"store" instead.
#
# 2. Miss — a template the store was never seeded with. Part and reason are
#    what the override-diff puts straight into its `unavailable` entry:
#      bash pristine-store.sh --kind template --name ja_teline_v --version 1.2.3 \
#        --package-dir "$STORE"
#    {"status":"miss","kind":"template","name":"ja_teline_v","version":"1.2.3",
#     "unavailable":{"part":"template:ja_teline_v:1.2.3","reason":"No pristine
#     reference in the package store for template ja_teline_v 1.2.3. Template
#     references are seeded from the ja-products quickstart store, which covers
#     75 of 176 JA templates and not every version of those (figures from ADR
#     0059, unverified against GitHub); third-party templates are not covered at
#     all"},"store":"/tmp/pristine-demo"}
#
# Both lookups above answer, so an unseeded store is safe rather than silent.
# --init answers too, including when it cannot do its job:
#   bash pristine-store.sh --init --package-dir /unwritable
#   {"store":"/unwritable","created":false,"error":"The package store at
#    /unwritable could not be created; the path is not writable by this user"}
# and exits 1, so no caller mistakes a store that was never made for one that
# was. On a store that already exists it prints "created":false and exits 0.
