#!/usr/bin/env python3
"""The PHP half of the chain, and the customer who has to move it.

Joomla's update server enforces the version chain with signed metadata. Nothing enforces the
PHP chain except PHP refusing to run, and the readiness report never said a word about it.

The rule that makes this worth a module rather than a sentence: a hop runs in ONE process on
ONE PHP, producing the next version from the current one, so it needs a PHP **both** ends
support. Too low and the updater refuses before it starts. Too high and the site that is
still running dies before the upgrade begins.

    -> 4.4   PHP 7.2.5        -> 5.4   PHP 8.1        -> 6.1   PHP 8.3

So "set PHP to 8.3, it is what Joomla 6 needs" is wrong advice for every site that is not
already at 5.4, and it is the advice a helpful person gives. Asking only for the next hop's
minimum keeps the ladder honest by construction.

The first version of this module also enforced a MAXIMUM, taken from the PHP versions the
Joomla project builds images for. Measured against 553 live customer sites it flagged 16 that
were serving perfectly well, including Joomla 3.10 on PHP 8.1, 8.2, 8.3 and 8.5. Reality
outranks the table: these tests assert a floor and never a ceiling.

Runs without pytest:  python3 tests/test_php_step.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "scripts"))

from php_step import next_step, php_for_hop, php_plan  # noqa: E402

_RESULTS = []


def check(name, cond):
    _RESULTS.append((name, bool(cond)))


def test_each_hop_asks_for_the_target_s_documented_minimum():
    check("3.10 to 4.4 wants 7.2.5", php_for_hop("3.10.12", "4.4") == "7.2.5")
    check("4.4 to 5.4 wants 8.1", php_for_hop("4.4.14", "5.4") == "8.1")
    check("5.4 to 6.1 wants 8.3", php_for_hop("5.4.8", "6.1") == "8.3")


def test_a_point_update_inside_one_major_asks_for_no_php_at_all():
    """5.2 to 5.4 is a real hop with a real snapshot and no new PHP requirement. Asking a
    customer to touch PHP for it is noise on a live site, and 54 of the surveyed sites are
    exactly this shape."""
    check("5.2 to 5.4 wants nothing", php_for_hop("5.2.1", "5.4") == "")
    check("3.9 to 3.10 wants nothing", php_for_hop("3.9.23", "3.10") == "")
    step = next_step("5.2.1", "8.2")
    check("so it says upgrade, not ask", step["action"] == "upgrade")


def test_a_php_above_what_the_table_builds_for_is_not_called_broken():
    """Measured 2026-08-20: Joomla 3.10 is serving on 8.1, 8.2, 8.3 and 8.5 across real
    customer sites, and Joomla 4.4 on 8.4. A rule that calls those broken would have us tell a
    customer to change something that works, on their live site, on our word."""
    for joomla, php in (("3.10.12", "8.3"), ("4.4.14", "8.4"), ("5.4.8", "8.4")):
        check(f"Joomla {joomla} on PHP {php} is left alone",
              next_step(joomla, php)["action"] == "upgrade")


def test_a_hop_the_update_server_forbids_is_refused_not_priced():
    """Refused rather than answered, because the caller's next move is to take a snapshot and
    start. Finding out then costs a site."""
    for bad in (("3.10.12", "5.4"), ("4.4.14", "6.1")):
        try:
            php_for_hop(*bad)
            check(f"{bad} refused", False)
        except ValueError:
            check(f"{bad} refused", True)


def test_the_plan_climbs_rather_than_jumping_to_the_destination():
    """A site on 3.10 needs 7.2.5 first, not 8.3, even though 8.3 is what the destination
    wants. Handed all three at once a customer makes all three at once."""
    plan = php_plan("3.10.12", "7.4")
    check("three hops", len(plan) == 3)
    check("the first hop asks for 7.2.5, not 8.3", plan[0]["php"] == "7.2.5")
    check("and the ladder climbs", [s["php"] for s in plan] == ["7.2.5", "8.1", "8.3"])


def test_a_site_already_high_enough_is_not_asked_to_touch_anything():
    plan = php_plan("5.4.8", "8.3")
    check("one hop", len(plan) == 1)
    check("nothing to change", plan[0]["change_needed"] is False)


def test_the_next_step_is_one_step_and_not_the_whole_ladder():
    """A customer given three PHP changes at once will make them at once, and the last two are
    premature. This site needs 7.2.5 to reach 4.4, and is told 7.2.5, not 8.3."""
    step = next_step("3.10.12", "5.6")
    check("asks the customer", step["action"] == "ask_customer")
    check("for 7.2.5 only", step["php"] == "7.2.5")
    check("and says which hop it buys", step["for_hop"] == "4.4")


def test_a_php_that_already_clears_the_next_hop_is_not_disturbed():
    """A 3.10 site on PHP 7.4 clears Joomla 4.4's minimum of 7.2.5. Under the previous model it
    was told to change PHP anyway, which is a live site touched for nothing. Six of the surveyed
    sites are exactly this."""
    check("left alone", next_step("3.10.12", "7.4")["action"] == "upgrade")


def test_a_site_already_on_the_right_php_is_told_to_upgrade_not_to_wait():
    step = next_step("5.4.8", "8.3")
    check("go", step["action"] == "upgrade")
    check("to 6.1", step["to"] == "6.1")


def test_a_site_already_at_six_is_finished():
    check("nothing left", next_step("6.1.3", "8.3")["action"] == "done")


def test_an_unknown_php_is_a_question_not_an_assumption():
    """Guessing here produces advice a customer acts on. The honest answer is that the reading
    failed, and the fix is to read it again rather than to proceed."""
    step = next_step("5.4.8", "")
    check("asked, not assumed", step["action"] == "php_unknown")


def test_the_guidance_names_the_place_without_inventing_a_menu_path():
    step = next_step("5.4.8", "8.2")
    text = step["guidance"]
    check("names the version wanted", "8.3" in text)
    check("names cPanel's tool", "MultiPHP" in text)
    check("names Plesk's", "PHP Settings" in text)
    check("admits labels vary", "vary" in text.lower() or "host" in text.lower())
    check("says what to do when the host cannot go that high", "highest" in text.lower())


def test_a_version_the_table_never_heard_of_is_refused():
    try:
        php_plan("nonsense", "8.3")
        check("refused", False)
    except ValueError:
        check("refused", True)


def main():
    for fn in (test_each_hop_asks_for_the_target_s_documented_minimum,
               test_a_point_update_inside_one_major_asks_for_no_php_at_all,
               test_a_php_above_what_the_table_builds_for_is_not_called_broken,
               test_a_hop_the_update_server_forbids_is_refused_not_priced,
               test_the_plan_climbs_rather_than_jumping_to_the_destination,
               test_a_site_already_high_enough_is_not_asked_to_touch_anything,
               test_the_next_step_is_one_step_and_not_the_whole_ladder,
               test_a_php_that_already_clears_the_next_hop_is_not_disturbed,
               test_a_site_already_on_the_right_php_is_told_to_upgrade_not_to_wait,
               test_a_site_already_at_six_is_finished,
               test_an_unknown_php_is_a_question_not_an_assumption,
               test_the_guidance_names_the_place_without_inventing_a_menu_path,
               test_a_version_the_table_never_heard_of_is_refused):
        fn()
    for name, ok in _RESULTS:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    passed = sum(1 for _, ok in _RESULTS if ok)
    print(f"\n{passed}/{len(_RESULTS)} passed")
    sys.exit(0 if passed == len(_RESULTS) else 1)


if __name__ == "__main__":
    main()
