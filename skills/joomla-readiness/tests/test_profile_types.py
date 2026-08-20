#!/usr/bin/env python3
"""The defaults on SiteProfile, which are load-bearing rather than tidy.

Three fields were added to this dataclass during 2026-08-20, and each one changes what a
customer is told. Their defaults are what keeps a caller that knows nothing about them from
being handed a different answer than it used to get:

    php_note         ""     a read that never saw PHP says nothing, rather than guessing
    hops_to_six      None   nobody counted, so the verdict falls back to reasoning from the major
    extensions_read  None   nobody counted, so an empty product list still reads as an empty read

A default that drifts here is silent: nothing raises, the report simply starts saying something
else. So the defaults are pinned.

Runs without pytest:  python3 tests/test_profile_types.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from profile_types import OwnedProduct, SiteProfile, joomla_major  # noqa: E402

_RESULTS = []


def check(name, cond):
    _RESULTS.append((name, bool(cond)))


def _bare():
    """Only the fields a caller has always had to supply."""
    return SiteProfile(user_id=1, email="a@b.c", domain="example.org",
                       joomla_version="5.4.8", version_measured_at="2026-08-20")


def test_a_caller_that_knows_nothing_new_gets_the_old_answer():
    p = _bare()
    check("no PHP sentence invented", p.php_note == "")
    check("hops not counted", p.hops_to_six is None)
    check("extensions not counted", p.extensions_read is None)


def test_none_and_zero_are_different_answers_for_what_was_read():
    """Zero means the read came back empty. None means nobody counted. Collapsing them tells a
    site that runs only Joomla itself that the tool failed."""
    counted_zero = SiteProfile(user_id=1, email="", domain="", joomla_version="",
                               version_measured_at="", extensions_read=0)
    check("zero is a count", counted_zero.extensions_read == 0)
    check("and not the same as uncounted", _bare().extensions_read is None)


def test_the_products_list_is_not_shared_between_profiles():
    """A mutable default on a dataclass is shared by every instance. Two customers' reports
    would accumulate each other's products, and nothing would raise."""
    a, b = _bare(), _bare()
    a.products.append(OwnedProduct(title="K2", product="K2", kind="component",
                                   last_download="", j6="available", j6_source="registry",
                                   j6_note="x"))
    check("the other profile is untouched", b.products == [])
    check("and so is its unseen list", b.unseen == [])


def test_the_scope_wording_defaults_to_the_catalog_reading():
    """This module is shared by two readings of a site. The defaults belong to the one that
    predates this skill, so adding a field here cannot silently reword the other."""
    p = _bare()
    check("one", "JoomlArt product" in p.scope_one)
    check("many", "JoomlArt products" in p.scope_many)


def test_the_major_is_read_from_the_version_rather_than_assumed():
    check("5.4.8", joomla_major("5.4.8") == 5)
    check("3.10.12", joomla_major("3.10.12") == 3)
    check("6.1.3", joomla_major("6.1.3") == 6)
    check("nothing readable is None", joomla_major("") is None)


def main():
    for fn in (test_a_caller_that_knows_nothing_new_gets_the_old_answer,
               test_none_and_zero_are_different_answers_for_what_was_read,
               test_the_products_list_is_not_shared_between_profiles,
               test_the_scope_wording_defaults_to_the_catalog_reading,
               test_the_major_is_read_from_the_version_rather_than_assumed):
        fn()
    for name, ok in _RESULTS:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    passed = sum(1 for _, ok in _RESULTS if ok)
    print(f"\n{passed}/{len(_RESULTS)} passed")
    sys.exit(0 if passed == len(_RESULTS) else 1)


if __name__ == "__main__":
    main()
