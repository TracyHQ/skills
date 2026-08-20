#!/usr/bin/env python3
"""NOTE: this is the published skill's copy. It is shorter than the one in
JoomlArt-26/joomlart-joomla-ops by seven checks, and deliberately so: that repo's `catalog.py`
carries a publisher-declarations layer (`merge_facts`, `load_facts`) which this skill does not
and should not have. A public skill reading the public registry has no vendor to speak for, and
shipping the machinery with no data behind it is the inert-duplicate problem that layer's own
contract warns about.

Guards on the extension catalog loader.

The catalog answers "does this third-party extension run on Joomla 6" for the 5,604
Joomla extensions in the Tracy platform registry. Two things it must never do: come
back empty when the network failed, and hide how old the data is.

Runs without pytest:  python3 tests/test_catalog.py
"""
import gzip
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from catalog import CatalogUnavailable, load_catalog  # noqa: E402

_RESULTS = []


def check(name, cond):
    _RESULTS.append((name, bool(cond)))


_K2 = {
    "name": "joomla/k2", "slug": "k2", "title": "K2", "platform": "joomla",
    "platformData": {"joomla": {"joomlaVersions": ["30"], "isJ3": True,
                                "isJ4": False, "isJ5": False, "isJ6": False}},
}
_AKEEBA = {
    "name": "joomla/akeeba-backup", "slug": "akeeba-backup", "title": "Akeeba Backup",
    "platform": "joomla",
    "platformData": {"joomla": {"joomlaVersions": ["30", "40", "50", "60"],
                                "isJ6": True}},
}


def _snapshot(records=(_K2, _AKEEBA), observed_at="2026-08-04T06:00:50Z"):
    d = Path(tempfile.mkdtemp())
    (d / "index.json").write_text(json.dumps(
        {"platforms": [{"platform": "joomla", "observedAt": observed_at}]}),
        encoding="utf-8")
    body = "\n".join(json.dumps(r) for r in records).encode()
    (d / "records.ndjson.gz").write_bytes(gzip.compress(body))
    return str(d)


def _fetch_ok(url, headers, timeout):
    """Stands in for the live registry, and records the headers so a test can check the User-Agent."""
    _fetch_ok.seen = headers
    if url.endswith("index.json"):
        return json.dumps(
            {"platforms": [{"platform": "joomla",
                            "observedAt": "2026-08-04T06:00:50Z"}]}).encode()
    return gzip.compress("\n".join(json.dumps(r) for r in (_K2, _AKEEBA)).encode())


def _fetch_403(url, headers, timeout):
    raise OSError("HTTP Error 403: Forbidden")


def test_a_failed_fetch_raises_instead_of_returning_nothing():
    """Returning an empty set reads upstream as "no extension runs on Joomla 6". Raise
    instead, using the error class this whole module exists to hand upward."""
    try:
        load_catalog(fetch=_fetch_403, snapshot=None)
        check("a broken fetch raises rather than returning empty", False)
    except CatalogUnavailable as e:
        check("a broken fetch raises rather than returning empty", True)
        check("the error says what was tried", "403" in str(e))


def test_the_measurement_date_travels_with_the_data():
    c = load_catalog(fetch=_fetch_ok)
    check("it carries the measurement date", c.observed_at == "2026-08-04T06:00:50Z")
    check("the source is named", c.source == "registry")


def test_a_user_agent_is_always_sent():
    """registry.tracy.ai answers 403 to urllib's default User-Agent. Hit for real on
    2026-08-18; without a UA the loader dies on a machine where nobody expects it to."""
    load_catalog(fetch=_fetch_ok)
    ua = (getattr(_fetch_ok, "seen", {}) or {}).get("User-Agent", "")
    check("a user agent is sent", ua != "")
    check("the user agent is not python's default", "python-urllib" not in ua.lower())


def test_the_snapshot_is_used_when_the_network_fails_and_says_so():
    c = load_catalog(fetch=_fetch_403, snapshot=_snapshot())
    check("it falls back to the snapshot", c.source == "snapshot")
    check("there is still data", "k2" in c.records)
    check("the snapshot keeps its date", c.observed_at == "2026-08-04T06:00:50Z")


def test_the_known_abandoned_extension_reads_as_abandoned():
    """K2 is the classic thing blocking a JoomlArt customer's migration. If the loader turns
    it into isJ6 true, or loses it, everything downstream is wrong with it."""
    c = load_catalog(fetch=_fetch_ok)
    k2 = c.records["k2"]["platformData"]["joomla"]
    check("K2 does not run on Joomla 6", k2["isJ6"] is False)
    check("K2 stopped at Joomla 3", k2["joomlaVersions"] == ["30"])


def test_a_snapshot_that_is_missing_is_not_silently_empty():
    try:
        load_catalog(fetch=_fetch_403, snapshot="/khong/ton/tai")
        check("an incomplete record still raises", False)
    except CatalogUnavailable:
        check("an incomplete record still raises", True)


def test_absent_from_the_directory_is_not_the_same_as_no_joomla_6():
    """VirtueMart, one of Joomla's largest e-commerce extensions, is NOT in the registry: it
    ships from virtuemart.net rather than through the JED. Checked for real on 2026-08-18.
    If a caller reads None as "does not run on Joomla 6", the report convicts a perfectly
    healthy product."""
    c = load_catalog(fetch=_fetch_ok)
    check("absence returns None", c.joomla("virtuemart") is None)
    check("different from an explicit isJ6 false", c.joomla("k2") is not None
          and c.joomla("k2")["isJ6"] is False)






def _facts_dir(tmp: str) -> str:
    """A declaration on disk, written here rather than read from whatever the skill happens to
    ship. A test that asserts against shipped data passes or fails for reasons that have
    nothing to do with the code under test, and goes quietly wrong the day that data moves
    upstream."""
    d = Path(tmp) / "facts"
    d.mkdir(parents=True, exist_ok=True)
    (d / "acme-widget.json").write_text(json.dumps(
        {"slug": "acme-widget", "title": "Acme Widget",
         "platformData": {"joomla": {"isJ6": False}}}), encoding="utf-8")
    return str(d)





def main():
    test_a_failed_fetch_raises_instead_of_returning_nothing()
    test_the_measurement_date_travels_with_the_data()
    test_a_user_agent_is_always_sent()
    test_the_snapshot_is_used_when_the_network_fails_and_says_so()
    test_the_known_abandoned_extension_reads_as_abandoned()
    test_absent_from_the_directory_is_not_the_same_as_no_joomla_6()
    test_a_snapshot_that_is_missing_is_not_silently_empty()
    for name, ok in _RESULTS:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    passed = sum(1 for _, ok in _RESULTS if ok)
    print(f"\n{passed}/{len(_RESULTS)} passed")
    sys.exit(0 if passed == len(_RESULTS) else 1)


if __name__ == "__main__":
    main()
