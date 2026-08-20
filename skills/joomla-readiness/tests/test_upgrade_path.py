#!/usr/bin/env python3
"""The chain a site has to walk, and the state it arrives in.

Two things this file pins. The chain, because Joomla's update server enforces it with signed
metadata and a report that says "upgrade to 6" without saying "through three majors" is telling
somebody the job is smaller than it is. And the bridge from what a site reports to the verdict
rules, because those rules cost real customers to learn and must not be rewritten for a new
input shape.

Runs without pytest:  python3 tests/test_upgrade_path.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "scripts"))

from upgrade_path import chain_to_six, profile_from_state  # noqa: E402
from verdict import decide  # noqa: E402

_RESULTS = []


def check(name, cond):
    _RESULTS.append((name, bool(cond)))


def _row(name, state="matched", isJ6=None, element="", kind="component"):
    return {"name": name, "element": element or f"com_{name.lower()}", "type": kind,
            "version": "1.0", "enabled": True, "state": state,
            "match": name.lower() if state == "matched" else None, "isJ6": isJ6}


def _state(version, rows, warnings=None):
    counts = {"total": len(rows), "core": sum(1 for r in rows if r["state"] == "core"),
              "matched": sum(1 for r in rows if r["state"] == "matched"),
              "unrecognised": sum(1 for r in rows if r["state"] == "unrecognised")}
    return {"core": {"version": version, "known": bool(version)}, "extensions": rows,
            "counts": counts, "warnings": warnings or []}


def test_the_chain_is_the_one_the_update_server_allows():
    check("from 3.10", chain_to_six("3.10.12") == ["4.4", "5.4", "6.1"])
    check("from 4.4", chain_to_six("4.4.14") == ["5.4", "6.1"])
    check("from 5.4", chain_to_six("5.4.8") == ["6.1"])


def test_a_site_behind_its_own_launch_point_has_an_extra_hop():
    """5.2 cannot reach 6 directly: only 5.4.x may. Reaching 5.4 first is a point update inside
    one major, and it is still a hop with its own snapshot."""
    check("from 5.2", chain_to_six("5.2.0") == ["5.4", "6.1"])
    check("from 3.9", chain_to_six("3.9.0") == ["3.10", "4.4", "5.4", "6.1"])


def test_a_site_already_there_has_no_chain():
    check("from 6.1", chain_to_six("6.1.3") == [])


def test_an_unreadable_version_gives_no_chain_rather_than_a_guess():
    """Half the sites this will meet report no version at all. Inventing a starting point is
    how a customer is told a three-hop job is one hop."""
    for v in ("", "unknown", "4+", None):
        check(f"no chain from {v!r}", chain_to_six(v) is None)


def test_an_unrecognised_extension_reaches_the_verdict_as_unknown():
    """The registry covers what it covers. Something it has never heard of is unknown, and
    unknown never rounds up: that rule is why this bridge exists rather than a fresh verdict."""
    v = decide(profile_from_state(_state("5.4.8", [_row("Mystery", state="unrecognised")])))
    check("not ready", v.level != "ready")
    check("named in the blockers", any("Mystery" in b for b in v.blockers))


def test_an_extension_the_registry_says_is_ready_does_not_block():
    v = decide(profile_from_state(_state("5.4.8", [_row("K2", isJ6=True)])))
    check("ready", v.level == "ready")


def test_an_extension_the_registry_says_is_not_ready_blocks():
    v = decide(profile_from_state(_state("5.4.8", [_row("K2", isJ6=False)])))
    check("work needed", v.level == "work_needed")


def test_core_extensions_are_not_carried_into_the_verdict():
    """A site holds around a hundred of them and they move with the core. Listing them would
    bury the handful that matter."""
    p = profile_from_state(_state("5.4.8", [_row("com_content", state="core"),
                                            _row("K2", isJ6=True)]))
    check("only the third party", [x.product for x in p.products] == ["K2"])


def test_a_site_on_joomla_three_is_told_it_is_a_staged_migration():
    v = decide(profile_from_state(_state("3.10.12", [_row("K2", isJ6=True)])))
    check("not ready", v.level != "ready")
    check("says staged", any("staged" in b.lower() for b in v.blockers))


def test_no_version_never_reads_as_ready():
    v = decide(profile_from_state(_state("", [_row("K2", isJ6=True)])))
    check("not ready", v.level != "ready")


def test_the_warnings_the_state_carried_survive_into_the_profile():
    """The count of what could not be matched is the honest limit of this whole skill. Losing
    it in the bridge would be the quietest way to overstate the answer."""
    p = profile_from_state(_state("5.4.8", [_row("Mystery", state="unrecognised")],
                                  warnings=["1 of 1 installed extensions are not in the registry"]))
    check("carried into unseen", any("not in the registry" in u for u in p.unseen))


def test_the_scope_line_names_what_was_actually_looked_at():
    """The verdict rules are reused; the words are not. Read from a customer's own site, these
    are third-party extensions, not JoomlArt products, and the first run of this path told a
    customer it had examined "the 4 JoomlArt products on this account" when not one of K2,
    JomSocial or Akeeba Backup is JoomlArt's."""
    v = decide(profile_from_state(_state("5.4.8", [_row("K2", isJ6=False)])))
    check("does not claim they are JoomlArt's", "JoomlArt product" not in v.scope_line)
    check("says what it read", "installed" in v.scope_line.lower())


def test_it_does_not_repeat_the_old_blind_spot_it_no_longer_has():
    """The internal report could not see third-party extensions and said so. This path reads
    them from the site and looks them up in a public registry of 5,604, so repeating that
    sentence would understate the answer rather than overstate it, which is still wrong."""
    v = decide(profile_from_state(_state("5.4.8", [_row("K2", isJ6=False)])))
    check("no stale blind-spot claim",
          "does not cover third-party" not in v.scope_line.lower())


def test_an_extension_nobody_lists_is_not_the_product_team_s_to_confirm():
    """"We are checking with the product team" is JoomlArt talking about JoomlArt's own
    products. For somebody's in-house module that is a promise to the wrong person."""
    v = decide(profile_from_state(_state("5.4.8", [_row("Mystery", state="unrecognised")])))
    steps = " ".join(v.next_steps).lower()
    check("no promise from the wrong team", "product team" not in steps)
    check("still says what to do", any(s.strip() for s in v.next_steps))


def test_the_scope_line_is_grammatical_at_one_and_at_many():
    """The first version of this pluralised by appending "s" to the whole phrase, which reads
    fine for "JoomlArt product" and produced "the 4 extension installed on this sites" here.
    Substring assertions missed it; the sentence has to be read."""
    one = decide(profile_from_state(_state("5.4.8", [_row("K2", isJ6=False)]))).scope_line
    many = decide(profile_from_state(_state("5.4.8", [
        _row("K2", isJ6=False), _row("JomSocial", isJ6=False)]))).scope_line
    check("singular reads right", "the 1 extension installed on this site." in one)
    check("plural reads right", "the 2 extensions installed on this site." in many)
    check("no stray plural on the tail", "sites" not in one and "sites" not in many)


def test_a_publisher_declaration_is_not_reported_as_a_directory_reading():
    """The registry is a measurement of the public directory. A publisher declaring the status
    of its own product is a different kind of claim, and the note printed to the customer must
    not dress one as the other. "The extension directory records no Joomla 6 build" is false
    about a record that the directory never listed and the vendor supplied."""
    state = {"core": {"version": "5.4.8"}, "extensions": [
        {"name": "JA Megafilter", "type": "plugin", "state": "matched",
         "isJ6": False, "evidence": "declared"},
    ]}
    p = profile_from_state(state)
    row = p.products[0]
    check("a declaration is sourced to the publisher", row.j6_source == "vendor")
    check("the note does not claim the directory", "directory" not in row.j6_note.lower())
    check("the note says who declared it", "publisher" in row.j6_note.lower())
    check("the reading itself survives", row.j6 == "none")


def test_an_observed_reading_still_says_the_directory():
    state = {"core": {"version": "5.4.8"}, "extensions": [
        {"name": "K2", "type": "component", "state": "matched",
         "isJ6": False, "evidence": "observed"},
    ]}
    row = profile_from_state(state).products[0]
    check("an observed reading is still the directory", row.j6_source == "registry")
    check("and still says so", "directory" in row.j6_note.lower())


def test_a_part_of_a_package_does_not_reach_the_customer_as_a_product():
    """The package is already in the list and already carries the verdict. Printing its seven
    plugins beside it would show a customer seven more things to worry about, all of them the
    one thing they already read one line up."""
    rows = [_row("Xmap Package", state="matched", isJ6=True, element="xmap"),
            dict(_row("Xmap - Kunena Plugin", state="part", kind="plugin"),
                 part_of="Xmap Package")]
    p = profile_from_state(_state("5.4.8", rows))
    titles = [x.title for x in p.products]
    check("the package is the product", titles == ["Xmap Package"])


def test_a_site_whose_php_was_read_stops_being_told_php_was_not_looked_at():
    """The tier-2 read returns PHP. The report said "we did not look at it" anyway, which is a
    limit the reader is entitled to believe and this one was false."""
    p = profile_from_state(_state("5.4.8", [_row("K2", isJ6=True)]), php="8.3")
    check("no longer claims PHP was unseen",
          not any("PHP version the site runs" in u for u in p.unseen))


def test_php_that_was_not_read_is_still_named_as_unseen():
    p = profile_from_state(_state("5.4.8", [_row("K2", isJ6=True)]))
    check("still named", any("PHP" in u for u in p.unseen))


def test_the_report_never_tells_a_three_hop_site_to_jump_to_php_83():
    """The old sentence said "Joomla 6 needs 8.3 or newer" to every site including a 3.10 that
    has two majors to cross first. A customer acting on it moves PHP two rungs early."""
    p = profile_from_state(_state("3.10.12", [_row("K2", isJ6=True)]), php="5.6")
    check("asks for the next hop's minimum", "7.2.5" in p.php_note)
    check("and not the destination's", "8.3" not in p.php_note)


def test_a_site_already_clear_is_not_asked_to_touch_php():
    p = profile_from_state(_state("5.4.8", [_row("K2", isJ6=True)]), php="8.3")
    check("nothing to say", p.php_note == "")


def test_a_site_past_the_end_of_the_chain_says_nothing_about_php():
    p = profile_from_state(_state("6.1.3", [_row("K2", isJ6=True)]), php="8.3")
    check("done is quiet", p.php_note == "")


def main():
    for fn in (test_a_publisher_declaration_is_not_reported_as_a_directory_reading,
               test_an_observed_reading_still_says_the_directory,
               test_the_chain_is_the_one_the_update_server_allows,
               test_a_site_behind_its_own_launch_point_has_an_extra_hop,
               test_a_site_already_there_has_no_chain,
               test_an_unreadable_version_gives_no_chain_rather_than_a_guess,
               test_an_unrecognised_extension_reaches_the_verdict_as_unknown,
               test_an_extension_the_registry_says_is_ready_does_not_block,
               test_an_extension_the_registry_says_is_not_ready_blocks,
               test_core_extensions_are_not_carried_into_the_verdict,
               test_a_site_on_joomla_three_is_told_it_is_a_staged_migration,
               test_no_version_never_reads_as_ready,
               test_the_warnings_the_state_carried_survive_into_the_profile,
               test_the_scope_line_names_what_was_actually_looked_at,
               test_it_does_not_repeat_the_old_blind_spot_it_no_longer_has,
               test_an_extension_nobody_lists_is_not_the_product_team_s_to_confirm,
               test_the_scope_line_is_grammatical_at_one_and_at_many,
               test_a_part_of_a_package_does_not_reach_the_customer_as_a_product,
               test_a_site_whose_php_was_read_stops_being_told_php_was_not_looked_at,
               test_php_that_was_not_read_is_still_named_as_unseen,
               test_the_report_never_tells_a_three_hop_site_to_jump_to_php_83,
               test_a_site_already_clear_is_not_asked_to_touch_php,
               test_a_site_past_the_end_of_the_chain_says_nothing_about_php):
        fn()
    for name, ok in _RESULTS:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    passed = sum(1 for _, ok in _RESULTS if ok)
    print(f"\n{passed}/{len(_RESULTS)} passed")
    sys.exit(0 if passed == len(_RESULTS) else 1)


if __name__ == "__main__":
    main()
