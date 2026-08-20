#!/usr/bin/env bash
# diag-db-schema-check — Read-only database schema-drift check for a working copy.
# Usage: diag-db-schema-check.sh --label <site-label>
# Invokes Joomla's own schema engine (Joomla\CMS\Schema\ChangeSet — the class
# behind the admin Database-fix screen) against each extension recorded in
# #__schemas, and reports the tables/columns that the copy's database is missing
# or has drifted on. READ-ONLY (D-10/D-12 class): it only ever calls the check
# side (ChangeSet::check() -> SHOW/SELECT); it never calls fix(), never runs an
# update query, never writes. Acts on the copy's own containers only (D-04).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/result-envelope.sh"
source "$SCRIPT_DIR/json-helpers.sh"

usage() {
  echo "Usage: diag-db-schema-check.sh --label <site-label>" >&2
}

# ---------- arg parsing ----------

LABEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --label)
      # A bare --label would die on an unbound $2 before any envelope exists,
      # breaking the one-JSON-document contract (ID-5).
      if [ $# -lt 2 ]; then usage; exit 2; fi
      LABEL="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$LABEL" ]]; then usage; exit 2; fi

WEBROOT="/srv/tracy/$LABEL/webroot"
CONFIG="$WEBROOT/configuration.php"
WEB_CONTAINER="${LABEL}-web-1"

envelope_init "diag-db-schema-check" "$LABEL"

if [[ ! -d "$WEBROOT" ]]; then
  envelope_error "Webroot not found: /srv/tracy/$LABEL/webroot"
  envelope_emit
  exit 0
fi

if [[ ! -f "$CONFIG" ]]; then
  envelope_error "configuration.php not found in webroot"
  envelope_emit
  exit 0
fi

# ---------- the read-only schema-check program, run inside the web container ----------
# The copy's PHP runtime is the only place Joomla's schema engine can be
# bootstrapped and pointed at the copy's own database (via configuration.php).
# The program is fed on stdin so nothing is written into the copy's webroot.
# Contract: it prints a first status line, then (only when ok) the findings
# object as one JSON document. It bootstraps the framework, acquires a database
# driver, enumerates #__schemas, and for each extension runs ChangeSet::check().
# Vintage handling (D-08): the ChangeSet class and the framework bootstrap are
# uniform across Joomla 3.9 / 4 / 5; where the class is absent (an unsupported
# vintage) or the driver cannot be acquired, it reports honest unavailability
# rather than a silent wrong "no drift".

read -r -d '' SCHEMA_CHECK_PHP <<'PHP' || true
<?php
error_reporting(0);
ini_set('display_errors', '0');

// Line 1 of stdout is the status; findings (json) follow only when ok.
function out_status($s, $reason = '') {
    fwrite(STDOUT, $reason === '' ? $s . "\n" : $s . "\t" . $reason . "\n");
}

try {
    $base = isset($argv[1]) ? rtrim($argv[1], '/') : '';
    if ($base === '' || !is_file($base . '/configuration.php')) {
        out_status('unavailable', 'Joomla webroot not found inside container');
        exit(0);
    }

    if (!defined('_JEXEC')) {
        define('_JEXEC', 1);
    }
    define('JPATH_BASE', $base . '/administrator');

    $defines = JPATH_BASE . '/includes/defines.php';
    $framework = JPATH_BASE . '/includes/framework.php';
    if (!is_file($defines) || !is_file($framework)) {
        out_status('unavailable', 'Joomla framework bootstrap not found (unexpected layout)');
        exit(0);
    }
    require_once $defines;
    require_once $framework;

    // Joomla's own schema engine. Uniform namespace across 3.9/4/5; its absence
    // means this vintage is outside the supported range (D-08) -> honest report.
    if (!class_exists('Joomla\\CMS\\Schema\\ChangeSet')) {
        $ver = class_exists('Joomla\\CMS\\Version') ? (new Joomla\CMS\Version())->getShortVersion() : (defined('JVERSION') ? JVERSION : 'unknown');
        out_status('unavailable', 'Joomla schema-check API (ChangeSet) not available for version ' . $ver);
        exit(0);
    }

    // Acquire a database driver. Container service first (4/5), Factory::getDbo
    // as the fallback (3.x). Read-only use only.
    $db = null;
    try {
        if (class_exists('Joomla\\CMS\\Factory') && method_exists('Joomla\\CMS\\Factory', 'getContainer')
            && interface_exists('Joomla\\Database\\DatabaseInterface')) {
            $db = Joomla\CMS\Factory::getContainer()->get('Joomla\\Database\\DatabaseInterface');
        }
    } catch (\Throwable $e) {
        $db = null;
    }
    if ($db === null && class_exists('Joomla\\CMS\\Factory') && method_exists('Joomla\\CMS\\Factory', 'getDbo')) {
        try { $db = Joomla\CMS\Factory::getDbo(); } catch (\Throwable $e) { $db = null; }
    }
    if ($db === null) {
        out_status('unavailable', 'Database driver could not be acquired from the copy configuration');
        exit(0);
    }

    $jver = 'unknown';
    if (class_exists('Joomla\\CMS\\Version')) {
        try { $jver = (new Joomla\CMS\Version())->getShortVersion(); } catch (\Throwable $e) {}
    } elseif (defined('JVERSION')) {
        $jver = JVERSION;
    }

    // Enumerate every extension that records a schema version. This is exactly
    // the set the admin Database-fix screen drives from (#__schemas), core
    // (com_admin) included. SELECT only.
    $rows = [];
    try {
        $query = $db->getQuery(true)
            ->select('s.extension_id, s.version_id, e.name, e.type, e.element, e.folder, e.client_id')
            ->from($db->quoteName('#__schemas', 's'))
            ->join('INNER', $db->quoteName('#__extensions', 'e')
                . ' ON ' . $db->quoteName('e.extension_id') . ' = ' . $db->quoteName('s.extension_id'));
        $db->setQuery($query);
        $rows = $db->loadObjectList();
    } catch (\Throwable $e) {
        out_status('unavailable', 'Could not read #__schemas from the copy database: ' . $e->getMessage());
        exit(0);
    }
    if (!is_array($rows)) {
        $rows = [];
    }

    // Resolve an extension's on-disk root from its type/client_id, then its
    // schema-update folder from the manifest's <schemapath> (falling back to
    // the conventional sql/updates/<dbtype> layout). Absence of a folder is
    // recorded honestly as "skipped", never a false clean result.
    $resolveRoot = function ($row) use ($base) {
        $el = (string) $row->element;
        $client = (int) $row->client_id;
        switch ((string) $row->type) {
            case 'component':
                return $base . '/administrator/components/' . $el;
            case 'module':
                return ($client === 1 ? $base . '/administrator/modules/' : $base . '/modules/') . $el;
            case 'plugin':
                return $base . '/plugins/' . (string) $row->folder . '/' . $el;
            case 'template':
                return ($client === 1 ? $base . '/administrator/templates/' : $base . '/templates/') . $el;
            case 'library':
                return $base . '/libraries/' . $el;
            case 'file':
            case 'package':
            default:
                return $base . '/administrator/components/' . $el;
        }
    };

    $schemaPathFromManifest = function ($root) {
        if (!is_dir($root)) {
            return null;
        }
        foreach (glob($root . '/*.xml') ?: [] as $xml) {
            $data = @file_get_contents($xml);
            if ($data === false || strpos($data, '<schemas') === false) {
                continue;
            }
            $prev = libxml_use_internal_errors(true);
            $sx = @simplexml_load_string($data);
            libxml_use_internal_errors($prev);
            if ($sx === false || !isset($sx->schemas)) {
                continue;
            }
            foreach ($sx->schemas->schemapath as $sp) {
                $type = (string) $sp['type'];
                if ($type === 'mysql' || $type === 'mysqli' || $type === '') {
                    $p = trim((string) $sp);
                    if ($p !== '') {
                        return $p;
                    }
                }
            }
        }
        return null;
    };

    $resolveFolder = function ($root) use ($schemaPathFromManifest) {
        $rel = $schemaPathFromManifest($root);
        // Candidates are PARENT folders. ChangeSet::getInstance appends the
        // running server's type segment itself ('mysql') and returns [] when it
        // is absent, so we hand it the parent — mirroring Joomla core, which
        // passes the parent and array_pop()s a trailing db-type from the
        // manifest schemapath. The concrete <parent>/mysql/*.sql must exist
        // first (rigid per D-20), so a resolvable folder is never a silent
        // false-clean.
        $parents = [];
        if ($rel !== null) {
            $abs = $root . '/' . ltrim($rel, '/');
            $leaf = basename($abs);
            $parents[] = in_array($leaf, ['mysql', 'mysqli', 'postgresql', 'sqlazure', 'sqlsrv'], true)
                ? dirname($abs) : $abs;
        }
        $parents[] = $root . '/sql/updates';
        foreach ($parents as $parent) {
            if (is_dir($parent . '/mysql') && count(glob($parent . '/mysql/*.sql') ?: []) > 0) {
                return $parent;
            }
        }
        return null;
    };

    // How a single errored ChangeItem names the object that drifted. queryType
    // is the DDL class; msgElements carries the table/column the check missed.
    $itemToDrift = function ($item) {
        $qt = isset($item->queryType) ? (string) $item->queryType : '';
        $me = (isset($item->msgElements) && is_array($item->msgElements)) ? array_values($item->msgElements) : [];
        $table = null;
        $column = null;
        switch ($qt) {
            case 'CREATE_TABLE':
            case 'ADD_INDEX':
            case 'DROP_INDEX':
                $table = isset($me[0]) ? $me[0] : null;
                break;
            case 'ADD_COLUMN':
            case 'CHANGE_COLUMN_TYPE':
            case 'DROP_COLUMN':
                $table = isset($me[0]) ? $me[0] : null;
                $column = isset($me[1]) ? $me[1] : null;
                break;
            default:
                $table = isset($me[0]) ? $me[0] : null;
                break;
        }
        return [
            'queryType' => $qt !== '' ? $qt : null,
            'table'     => $table,
            'column'    => $column,
            'elements'  => array_map('strval', $me),
        ];
    };

    // A #__schemas extension that could not be checked, recorded honestly
    // (never silently counted clean). Shared by both skip sites below.
    $skip = function ($row, $reason) {
        return [
            'extensionId' => (int) $row->extension_id,
            'name'        => (string) $row->name,
            'type'        => (string) $row->type,
            'reason'      => $reason,
        ];
    };

    $extensions = [];
    $skipped = [];
    $drifted = 0;
    $checked = 0;

    foreach ($rows as $row) {
        $root = $resolveRoot($row);
        $folder = $resolveFolder($root);
        if ($folder === null) {
            $skipped[] = $skip($row, 'no schema-update folder resolved on disk');
            continue;
        }

        try {
            $changeset = Joomla\CMS\Schema\ChangeSet::getInstance($db, $folder);
            // check() runs the read-only check query of every change item and
            // returns the ones whose object is missing/changed. It never fixes.
            $errors = $changeset->check();
            $schemaVersion = null;
            if (method_exists($changeset, 'getSchema')) {
                try { $schemaVersion = $changeset->getSchema(); } catch (\Throwable $e) {}
            }
        } catch (\Throwable $e) {
            $skipped[] = $skip($row, 'schema check failed: ' . $e->getMessage());
            continue;
        }

        $checked++;
        $drift = [];
        if (is_array($errors)) {
            foreach ($errors as $item) {
                $drift[] = $itemToDrift($item);
            }
        }
        if (count($drift) > 0) {
            $drifted++;
        }

        $extensions[] = [
            'extensionId'     => (int) $row->extension_id,
            'name'            => (string) $row->name,
            'type'            => (string) $row->type,
            'element'         => (string) $row->element,
            'folderChecked'   => $folder,
            'schemaVersion'   => $schemaVersion,
            'dbSchemaVersion' => ($row->version_id !== null ? (string) $row->version_id : null),
            'driftCount'      => count($drift),
            'drift'           => $drift,
        ];
    }

    $findings = [
        'joomlaVersion'        => $jver,
        'extensions'           => $extensions,
        'extensionsChecked'    => $checked,
        'driftedExtensionCount'=> $drifted,
        'skipped'              => $skipped,
        'skippedCount'         => count($skipped),
        'countedFrom'          => 'Joomla ChangeSet::check() over each #__schemas extension schema-update folder (read-only; core com_admin included)',
    ];

    out_status('ok');
    fwrite(STDOUT, json_encode($findings, JSON_UNESCAPED_SLASHES) . "\n");
    exit(0);
} catch (\Throwable $e) {
    out_status('error', 'schema check bootstrap failed: ' . $e->getMessage());
    exit(0);
}
PHP

# ---------- run the check ----------

FINDINGS='null'

run_schema_check() {
  # A cheap liveness probe first, so a dead container fails fast and honestly.
  if ! docker exec "$WEB_CONTAINER" php -v >/dev/null 2>&1; then
    envelope_unavailable "dbSchemaCheck" "site web container not accessible: $WEB_CONTAINER"
    return 0
  fi

  # Locate the Joomla webroot inside the container (the host webroot is bind-
  # mounted, but the container path is not the host path).
  local ct_webroot
  ct_webroot=$(docker exec "$WEB_CONTAINER" sh -c \
    'for d in /var/www/html /var/www/webroot /var/www /app /usr/src/joomla; do [ -f "$d/configuration.php" ] && { printf %s "$d"; break; }; done' \
    2>/dev/null || true)
  if [[ -z "$ct_webroot" ]]; then
    envelope_unavailable "dbSchemaCheck" "Joomla webroot not locatable inside $WEB_CONTAINER"
    return 0
  fi

  local out status_line rest
  out=$(printf '%s' "$SCHEMA_CHECK_PHP" \
    | docker exec -i "$WEB_CONTAINER" php -d display_errors=0 -d error_reporting=0 /dev/stdin "$ct_webroot" \
    2>/dev/null || true)

  if [[ -z "$out" ]]; then
    envelope_unavailable "dbSchemaCheck" "schema-check program returned no output in $WEB_CONTAINER"
    return 0
  fi

  status_line=$(printf '%s\n' "$out" | head -n1)
  rest=$(printf '%s\n' "$out" | tail -n +2)

  case "$status_line" in
    ok)
      # The program emits a fully-formed, correctly-escaped findings object.
      if [[ -z "$rest" ]]; then
        envelope_unavailable "dbSchemaCheck" "schema-check reported ok but returned no findings"
        return 0
      fi
      # Guard the single-valid-JSON contract (ID-5): a stream truncated mid-write
      # would splice a malformed document into the envelope. Re-parse the findings
      # with the container's own PHP (the tooling already in use here — no new
      # dependency) and require a JSON object before trusting it; otherwise report
      # an honest error instead of emitting broken JSON.
      if ! printf '%s' "$rest" \
          | docker exec -i "$WEB_CONTAINER" php -d display_errors=0 -d error_reporting=0 -r \
            '$d = json_decode(stream_get_contents(STDIN)); exit((json_last_error() === JSON_ERROR_NONE && is_object($d)) ? 0 : 1);' \
          >/dev/null 2>&1; then
        envelope_error "schema-check findings were not valid JSON (truncated or malformed output from $WEB_CONTAINER)"
        return 0
      fi
      FINDINGS="$rest"
      ;;
    error*)
      envelope_error "${status_line#error$'\t'}"
      ;;
    unavailable*)
      envelope_unavailable "dbSchemaCheck" "${status_line#unavailable$'\t'}"
      ;;
    *)
      envelope_unavailable "dbSchemaCheck" "unrecognized schema-check status: $(_collapse_ws "$status_line")"
      ;;
  esac
}

run_schema_check

# ---------- assemble findings ----------
# On any non-ok path FINDINGS stays null and the reason lives in unavailable[]
# (or error), so "could not check" is never reported as a real "no drift".

if [[ "$FINDINGS" == "null" ]]; then
  envelope_set_findings '{"dbSchemaCheck":null}'
else
  envelope_set_findings "$FINDINGS"
fi
envelope_emit

# ---------- smoke-run ----------
# Command (kind 6):
#   bash diag-db-schema-check.sh --label <site-label>
#
# Sources: docker exec into ${LABEL}-web-1 (php -v liveness probe; a webroot
# locate loop; then the read-only schema-check program fed on stdin). The
# program bootstraps the copy's own Joomla framework, acquires a database
# driver from configuration.php (the copy's DB, D-04 — never the live site),
# reads #__schemas + #__extensions (SELECT only), and for each recorded
# extension runs Joomla\CMS\Schema\ChangeSet::check(), whose per-item check
# queries are SHOW/SELECT. It never calls fix() and issues no write statement.
# No off-host network.
#
# Expected top-level envelope keys:
#   schemaVersion ("1.0"), kind ("diag-db-schema-check"), label, startedAt,
#   finishedAt, status ("ok"|"error"), findings, unavailable, error
#
# findings keys (status=ok, check ran):
#   .joomlaVersion            string (the copy's short Joomla version)
#   .extensions[]             one per #__schemas extension a folder resolved for:
#                             {extensionId, name, type, element, folderChecked,
#                              schemaVersion, dbSchemaVersion, driftCount,
#                              drift[]}
#   .extensions[].drift[]     {queryType, table, column, elements[]} — one per
#                             errored ChangeItem: the table/column the copy's DB
#                             is missing or has drifted on. queryType is the DDL
#                             class (CREATE_TABLE, ADD_COLUMN, CHANGE_COLUMN_TYPE,
#                             ADD_INDEX, ...); column is null for table-level
#                             drift; elements[] is the raw msgElements.
#   .extensionsChecked        int (bound: #__schemas rows with a resolved folder)
#   .driftedExtensionCount    int (bound: extensionsChecked)
#   .skipped[]                {extensionId, name, type, reason} — a #__schemas
#                             extension whose schema folder could not be resolved
#                             or whose check errored; recorded, never silently
#                             counted clean
#   .skippedCount             int
#   .countedFrom              string
#
# findings when the check could not run:
#   {"dbSchemaCheck": null}   with a matching unavailable[] entry naming why
#                             (container down, webroot not locatable, no output,
#                             ChangeSet API absent for the vintage (D-08), or DB
#                             driver unacquirable). Never a false "no drift".
#
# Error cases (status "error", exit 0). The two host-side paths exit before any
# findings are set, so findings stays {}; only the program's own error path
# leaves findings {"dbSchemaCheck":null}:
#   Webroot missing        -> findings {}, error "Webroot not found: /srv/tracy/<label>/webroot"
#   Config missing         -> findings {}, error "configuration.php not found in webroot"
#   Program bootstrap threw -> findings {"dbSchemaCheck":null}, error = the program's own reason
#   Findings not valid JSON -> findings {"dbSchemaCheck":null}, error names a truncated/malformed container stream
#
# Argument errors (no envelope, exit 2):
#   --label missing / unknown flag
#
# Missing-table drift verification (feeds ticket 11 smoke deployment):
#   On a copy carrying a page-builder extension whose schema declares a page
#   table (the real BDW class of case), run once for the baseline, then drop
#   that one table on the COPY's database only and run again:
#     bash diag-db-schema-check.sh --label <label>
#     # (drop the builder page table on the copy's db container, then:)
#     bash diag-db-schema-check.sh --label <label>
#   The first run reports that extension with driftCount 0; the second reports
#   it with driftCount >= 1 and a drift entry whose queryType is CREATE_TABLE and
#   whose table names the dropped page table. The table is named; the copy's
#   database is only ever read.
