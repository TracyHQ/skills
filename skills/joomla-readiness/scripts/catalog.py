"""The third-party extension catalog: does this extension run on Joomla 6?

JoomlArt's own catalog answers for JoomlArt products. It says nothing about the
hundreds of other extensions a real Joomla site runs, and those are what actually
block a migration: K2 has stopped customers moving off Joomla 3 for years.

The Tracy platform registry covers that: 5,604 Joomla extensions, 99.89% of the
Joomla Extensions Directory, each carrying `isJ3`..`isJ6` and `joomlaVersions`.

Two rules shape this module, and both exist because of the same failure:

  * **A failed fetch raises.** It never returns an empty catalog. An empty catalog
    reads downstream as "no extension supports Joomla 6", which is a confident wrong
    answer produced by a network error.
  * **The measurement date travels with the data.** The registry is re-crawled by
    hand: its own README lists "no `schedule:` in the publish workflow" as an open
    question: so a reader has to be told how old this is, and the report prints it.
"""
from __future__ import annotations

import gzip
import json
import urllib.request
from dataclasses import dataclass
from pathlib import Path

REGISTRY_ROOT = "https://registry.tracy.ai/platform"
# The manifest lives at the platform root and carries observedAt per marketplace;
# the records live under the platform folder. Two different paths, kept apart here
# rather than patched together at the call site.
INDEX_URL = f"{REGISTRY_ROOT}/index.json"
RECORDS_URL = f"{REGISTRY_ROOT}/joomla/records.ndjson.gz"

# registry.tracy.ai answers 403 to urllib's default User-Agent. Hit for real on
# 2026-08-18; without this the loader dies on a machine where nobody expects it to.
USER_AGENT = "joomlart-joomla-ops/0.1 (+https://www.joomlart.com)"


class CatalogUnavailable(RuntimeError):
    """Neither the registry nor a snapshot could be read. Deliberately fatal."""


@dataclass(frozen=True)
class Catalog:
    records: dict[str, dict]   # slug -> record
    observed_at: str           # ISO instant the registry says it measured
    source: str                # "registry" | "snapshot"

    def joomla(self, slug: str) -> dict | None:
        """The joomla block for one slug, or None. Callers must handle None as
        'not in the directory', which is a real answer and often the important one."""
        rec = self.records.get(slug)
        return ((rec or {}).get("platformData") or {}).get("joomla")


def _http_fetch(url: str, headers: dict, timeout: int) -> bytes:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _parse_records(blob: bytes) -> dict[str, dict]:
    text = gzip.decompress(blob).decode("utf-8")
    out: dict[str, dict] = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("slug"):
            out[rec["slug"]] = rec
    return out


def _observed_at(blob: bytes) -> str:
    payload = json.loads(blob.decode("utf-8"))
    for p in payload.get("platforms", []):
        if p.get("platform") == "joomla":
            return str(p.get("observedAt") or "")
    return ""


def _from_snapshot(snapshot: str) -> Catalog:
    d = Path(snapshot)
    records = _parse_records((d / "records.ndjson.gz").read_bytes())
    observed = _observed_at((d / "index.json").read_bytes())
    if not records:
        raise CatalogUnavailable(f"snapshot at {snapshot} has no records")
    return Catalog(records=records, observed_at=observed, source="snapshot")


def load_catalog(*, snapshot: str | None = None, timeout: int = 60,
                 fetch=None) -> Catalog:
    """The live registry, falling back to a snapshot. Never returns empty.

    `fetch` is injectable so the rules above can be tested without a network; nothing
    in production passes it.
    """
    fetch = fetch or _http_fetch
    headers = {"User-Agent": USER_AGENT}
    live_error: Exception | None = None

    try:
        index = fetch(INDEX_URL, headers, timeout)
        blob = fetch(RECORDS_URL, headers, timeout)
        records = _parse_records(blob)
        if records:
            return Catalog(records=records, observed_at=_observed_at(index),
                           source="registry")
        live_error = CatalogUnavailable("registry returned zero records")
    except Exception as e:      # noqa: BLE001 - any transport failure falls back
        live_error = e

    if snapshot:
        try:
            return _from_snapshot(snapshot)
        except CatalogUnavailable:
            raise
        except Exception as e:  # noqa: BLE001
            raise CatalogUnavailable(
                f"registry failed ({live_error}) and snapshot at {snapshot} "
                f"could not be read ({e})") from e

    raise CatalogUnavailable(
        f"registry unreachable and no snapshot given: {live_error}")
