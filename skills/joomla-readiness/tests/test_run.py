#!/usr/bin/env python3
"""The front door, and the three arguments it stops anybody forgetting.

`run()` exists because the composition it replaces had four steps and three silently optional
arguments, each of which changes what a customer is told and none of which raises when left
out. These checks are mostly about the forgetting, not the arithmetic.

Runs without pytest:  python3 tests/test_run.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from catalog import Catalog  # noqa: E402
from run import run  # noqa: E402

_RESULTS = []


def check(name, cond):
    _RESULTS.append((name, bool(cond)))


_CAT = Catalog(
    records={"k2": {"slug": "k2", "title": "K2",
                    "platformData": {"joomla": {"isJ6": True}}}},
    observed_at="2026-08-04T10:44:48Z", source="file")

_K2 = {"name": "K2", "element": "com_k2", "type": "component",
       "version": "2.11.1", "enabled": True}


def test_php_reaches_the_answer_without_the_caller_remembering_it():
    """The whole reason this module exists. Hand-composed, `php=` was an argument you could
    forget, and forgetting it made the report claim PHP had never been looked at."""
    out = run({"joomla": "5.4.8", "php": "8.2", "extensions": [_K2]}, _CAT)
    check("the instruction is there", any("8.3" in s for s in out["next_steps"]))
    check("and it leads", "PHP" in out["next_steps"][0])


def test_packages_reach_the_answer_too():
    """Forgotten, one product is eight unknowns in the count the report is built around."""
    reading = {"joomla": "5.4.8", "extensions": [
        dict(_K2, name="Xmap - K2 Plugin", type="plugin", group="xmap")],
        "packages": [{"name": "Xmap Package", "element": "xmap", "version": "2.3.3",
                      "children": [{"type": "plugin", "element": "com_k2", "group": "xmap"}]}]}
    out = run(reading, _CAT)
    check("the plugin is a part, not a product", out["counts"]["part"] == 1)


def test_the_crawl_date_travels_with_the_answer():
    """A verdict is exactly as fresh as the crawl behind it, and the registry is re-crawled by
    hand. An answer that cannot say when would be a claim about the world."""
    out = run({"joomla": "5.4.8", "extensions": [_K2]}, _CAT)
    check("dated", out["registry_observed_at"] == "2026-08-04T10:44:48Z")


def test_a_reading_with_no_version_key_is_refused_rather_than_guessed():
    """A missing key and an unreadable version are different answers, and only the tool that
    read the site can tell them apart. Defaulting one to the other puts a verdict in front of a
    customer that nobody measured."""
    try:
        run({"extensions": [_K2]}, _CAT)
        check("refused", False)
    except ValueError:
        check("refused", True)


def test_an_unreadable_version_is_carried_rather_than_refused():
    """Empty is a real reading: the tool answered and said it could not tell."""
    out = run({"joomla": "", "extensions": [_K2]}, _CAT)
    check("answered", out["level"] != "ready")
    check("and says which part failed",
          any("which Joomla version" in b for b in out["blockers"]))


def test_absent_php_and_packages_are_allowed():
    out = run({"joomla": "5.4.8", "extensions": [_K2]}, _CAT)
    check("no crash", out["level"] == "ready")
    check("and PHP is named as unseen",
          any("PHP" in u for u in out["not_looked_at"]))


def test_the_wrong_shape_is_refused_rather_than_coerced():
    for bad in ({"joomla": "5.4.8", "extensions": "K2"},
                {"joomla": "5.4.8", "extensions": [], "packages": {}}):
        try:
            run(bad, _CAT)
            check(f"refused {list(bad)}", False)
        except ValueError:
            check(f"refused {list(bad)}", True)


def main():
    for fn in (test_php_reaches_the_answer_without_the_caller_remembering_it,
               test_packages_reach_the_answer_too,
               test_the_crawl_date_travels_with_the_answer,
               test_a_reading_with_no_version_key_is_refused_rather_than_guessed,
               test_an_unreadable_version_is_carried_rather_than_refused,
               test_absent_php_and_packages_are_allowed,
               test_the_wrong_shape_is_refused_rather_than_coerced):
        fn()
    for name, ok in _RESULTS:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    passed = sum(1 for _, ok in _RESULTS if ok)
    print(f"\n{passed}/{len(_RESULTS)} passed")
    sys.exit(0 if passed == len(_RESULTS) else 1)


if __name__ == "__main__":
    main()
