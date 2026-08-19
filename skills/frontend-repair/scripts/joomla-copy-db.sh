#!/usr/bin/env bash
# Shared working-copy database access for C1 diagnostic scripts.
# One concern: reaching the copy's own database container (D-04 — never the
# live site) and reading rows back out of it.
# Source order: source result-envelope.sh FIRST when the caller reports the
# bootstrap reason through an envelope. Sourced as a library, so it sets no
# shell flags.
#
# Caller contract:
#   CONFIG=<path to the copy's configuration.php>
#   DB_CONTAINER=<the copy's db container name>
#   db_bootstrap || { envelope_error "$DB_BOOTSTRAP_ERROR"; …; }
# db_bootstrap sets DB_PREFIX and DB_NAME on success.

DB_BOOTSTRAP_ERROR=""

cfg_val() {
  grep -oP "public \\\$${1}\s*=\s*'\K[^']+" "$CONFIG" 2>/dev/null || true
}

# The fleet injects DB_PREFIX into the job environment; configuration.php is the
# fallback for copies started outside that path. The db service publishes no
# host port, so the database name is read from the container's own environment
# rather than from a host-side connection.
db_bootstrap() {
  DB_PREFIX="${DB_PREFIX:-}"
  if [[ -z "$DB_PREFIX" ]]; then
    DB_PREFIX=$(cfg_val dbprefix)
  fi
  if [[ -z "$DB_PREFIX" ]]; then
    DB_BOOTSTRAP_ERROR="Cannot determine DB table prefix from environment or configuration.php"
    return 1
  fi

  DB_NAME=$(docker exec "$DB_CONTAINER" printenv MARIADB_DATABASE 2>/dev/null || true)
  DB_NAME="${DB_NAME%%$'\r'}"
  if [[ -z "$DB_NAME" ]]; then
    DB_BOOTSTRAP_ERROR="DB container not accessible: $DB_CONTAINER"
    return 1
  fi
  return 0
}

# The root password is expanded inside the container from its own environment,
# so it never appears in a host argument list or process listing.
# No -i, and stdin closed: `mariadb -e` reads no standard input, while a child
# that holds stdin open drains whatever the caller is reading from. Callers that
# run a query inside `while read … done < <(db_rows …)` would otherwise lose
# every row after the first.
db_query() {
  docker exec "$DB_CONTAINER" sh -c \
    'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -B "$1" -e "$2"' _ "$DB_NAME" "$1" \
    </dev/null 2>/dev/null
}

# Batch-client rows arrive tab-separated, and tab is IFS whitespace: `read`
# would collapse consecutive tabs and shift every field after an empty column
# (a component has no folder, a style may have no title). Re-delimiting with
# ASCII US (unit separator, \037) keeps empty columns empty. US rather than SOH:
# bash 3.2 reserves \001 internally and its `read` will not split on it.
#   while IFS=$'\x1f' read -r a b c; do … done < <(db_rows "$data")
# The replacement byte is written in octal, which every tr reads the same way;
# \x1f is a GNU extension that BSD tr takes for a literal "x" followed by "1f".
db_rows() {
  printf '%s\n' "$1" | tr '\t' '\037'
}
