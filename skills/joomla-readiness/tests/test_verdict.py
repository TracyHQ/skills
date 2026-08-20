#!/usr/bin/env python3
"""Guards on the verdict engine: three levels, and the ways each one lies.

Runs without pytest:  python3 tests/test_verdict.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from profile_types import OwnedProduct, SiteProfile  # noqa: E402
from verdict import decide  # noqa: E402

_RESULTS = []


def check(name, cond):
    _RESULTS.append((name, bool(cond)))


def _p(name, j6, kind="template", src="catalog", note="", when="2026-01-01"):
    return OwnedProduct(title=name, product=name, kind=kind, last_download=when,
                        j6=j6, j6_source=src, j6_note=note or f"{name}: {j6}")


def _profile(products, version="5.4.7", hops=None, read=None):
    return SiteProfile(user_id=1, email="a@b.c", domain="example.org",
                       joomla_version=version, version_measured_at="2026-08-17",
                       products=list(products), hops_to_six=hops, extensions_read=read,
                       unseen=["Third-party extensions installed on the site."])


def test_one_discontinued_product_decides_the_whole_verdict():
    v = decide(_profile([_p("JA Vega", "available"),
                         _p("Ameritage Medical", "discontinued", src="brand")]))
    check("one dead product means replacement needed", v.level == "must_replace")


def test_unknown_never_rounds_up_to_ready():
    """Rounding unknown up to "probably fine" is the behaviour that white-screened ten sites."""
    v = decide(_profile([_p("JA Vega", "available"),
                         _p("Ad Agency Pro", "unknown", kind="extension",
                            src="declared")]))
    check("unknown drags the verdict to work needed", v.level == "work_needed")
    check("unknown is named", any("Ad Agency Pro" in b for b in v.blockers))


def test_all_available_is_ready():
    v = decide(_profile([_p("JA Vega", "available"), _p("JA Alpha", "available")]))
    check("everything is ready", v.level == "ready")


def test_every_level_carries_its_own_scope_limit():
    """Ready is the level most easily read as "nothing to worry about". The scope line matters
    more here than at the other two."""
    for products, expect in ((
            [_p("JA Vega", "available")], "ready"),
            ([_p("JA Vega", "none")], "work_needed"),
            ([_p("X", "discontinued", src="brand")], "must_replace")):
        v = decide(_profile(products))
        check(f"{expect}: the scope line is there", v.scope_line.strip() != "")
        check(f"{expect}: it says what it was computed over",
              "looked at" in v.scope_line.lower())


def test_blockers_list_only_what_blocks_not_the_whole_inventory():
    """One real account produced 112 products. Pouring all of them into blockers means nothing
    is a blocker."""
    products = [_p(f"JA Fine {i}", "available") for i in range(40)]
    products.append(_p("JA Megafilter", "none", kind="extension", src="declared"))
    v = decide(_profile(products))
    check("only blockers are listed", len(v.blockers) == 1)
    check("the right thing blocks", "JA Megafilter" in v.blockers[0])


def test_blockers_are_ordered_severest_first():
    v = decide(_profile([_p("A", "unknown", kind="extension", src="declared"),
                         _p("B", "none"),
                         _p("C", "discontinued", src="brand")]))
    check("it fails at the right place", v.blockers[0].startswith("C") or "C" in v.blockers[0])
    check("three levels present", len(v.blockers) == 3)


def test_a_dead_brand_gets_advice_and_never_an_invented_template_name():
    """discontinued-products.md names no specific replacement template. Inventing one is the
    dangerous kind of wrong: it reads as a recommendation somebody checked."""
    v = decide(_profile([_p("Ameritage Medical", "discontinued", src="brand",
                            note="Shape5: ngung phat trien tu 06/2025.")]))
    steps = " ".join(v.next_steps).lower()
    check("it does not send the customer to a catalog", "browse our catalog" not in steps)
    check("a concrete offer to advise is made", "migration" in steps or "advise" in steps)


def test_a_joomla_3_site_is_told_it_is_a_multi_hop_move():
    """Measured 2026-08-18: a customer asking about Joomla 6 while running Joomla 3.x. Three to
    six is not one jump, and a report silent about that is a wrong report."""
    v = decide(_profile([_p("JA Vega", "available")], version="3.10.12"))
    check("it may not be called ready", v.level != "ready")
    joined = " ".join(v.blockers + v.next_steps).lower()
    check("it says more than one hop", "joomla 3" in joined)


def test_an_undetected_joomla_version_is_not_treated_as_fine():
    v = decide(_profile([_p("JA Vega", "available")], version=""))
    check("an unmeasured version can never be ready", v.level != "ready")


def test_many_products_failing_for_one_reason_collapse_into_one_line():
    """Measured 2026-08-18: a Shape5 account produced 105 blocker lines, 103 of them the same
    sentence. That is not a list of blockers any more, it is an inventory."""
    dead = [_p(f"S5 Template {i}", "discontinued", src="brand",
               note="Shape5: discontinued at the June 2025 consolidation.")
            for i in range(103)]
    v = decide(_profile(dead + [_p("JA Megafilter", "none", kind="extension",
                                   src="declared", note="No Joomla 6 build yet.")]))
    check("repeated causes collapse", len(v.blockers) <= 3)
    joined = " ".join(v.blockers)
    check("the count is still stated", "103" in joined)
    check("the brand is still named", "Shape5" in joined)
    check("other blockers are not swallowed", "JA Megafilter" in joined)


def test_a_handful_of_blockers_are_still_listed_one_by_one():
    """Collapsing is there to rescue a long list. With three, naming each one is more useful."""
    v = decide(_profile([_p("A", "none"), _p("B", "none"), _p("C", "none")]))
    joined = " ".join(v.blockers)
    for name in ("A", "B", "C"):
        check(f"{name} is still named", name in joined)


def test_the_untested_caveat_is_said_once_not_on_every_row():
    """A derived row needs a caveat: not published is NOT the same as will break. But putting it
    on every row gave one real customer the same thirty words eleven times. That is the
    "105 blocker lines, 103 identical" defect in new clothes. Say it once, under what to do
    next."""
    v = decide(_profile([_p(f"P{i}", "none", src="derived",
                            note=f"JoomlArt has not published a Joomla 6 build. "
                                 f"Latest release in the catalog: {i} Jan 2023.")
                         for i in range(1, 12)]))
    hits = [s for s in v.next_steps if "not been tested" in s]
    check("the caveat appears exactly once", len(hits) == 1)
    check("it says untested, not broken", "known to fail" in hits[0])
    for line in v.blockers:
        check("blocker lines no longer carry the caveat", "not been tested" not in line)


def test_no_derived_row_means_no_such_caveat():
    """With no derived row, do not add a note that applies to nothing."""
    v = decide(_profile([_p("JA Vega", "none", src="catalog")]))
    check("no derived row means no caveat", 
          not any("not been tested" in s for s in v.next_steps))


def test_a_replacement_is_named_from_what_the_customer_already_owns():
    """Q15: "a replacement recommendation must name a template, not say go and look at our
    catalog." Picking one of the 88 templates that have a Joomla 6 build would be inventing
    a recommendation nobody checked. A template the customer ALREADY BOUGHT that ALREADY has
    a Joomla 6 build is not invented: it is specific, it comes from their own data, and the
    licence is already theirs."""
    v = decide(_profile([_p("Ameritage Medical", "discontinued", src="brand"),
                         _p("JA Vega", "available"),
                         _p("JA Teline V", "available")]))
    steps = " ".join(v.next_steps)
    check("a specific name is given", "JA Vega" in steps or "JA Teline V" in steps)
    check("it says they already own it", "already" in steps.lower())


def test_no_owned_replacement_means_no_invented_one():
    """With no ready template in their hands, invent nothing. The old offer still stands, and it
    still names nobody."""
    v = decide(_profile([_p("Ameritage Medical", "discontinued", src="brand"),
                         _p("JA Old", "none")]))
    steps = " ".join(v.next_steps)
    check("no name is invented", "JA Old" not in steps)
    check("the offer is still there", "migration service" in steps)


def test_only_a_template_counts_as_a_replacement_for_a_template():
    """A component with a Joomla 6 build does not replace a dead template, and neither does a
    framework: on real accounts this sentence offered "T4 Framework" and "GK Framework" as
    somewhere to start replacing a template."""
    v = decide(_profile([_p("Ameritage Medical", "discontinued", src="brand"),
                         _p("JA Megafilter", "available", kind="extension"),
                         _p("T4 Framework", "available", kind="framework")]))
    steps = " ".join(v.next_steps)
    check("an extension is not offered as a replacement", "JA Megafilter" not in steps)
    check("a framework is not offered as a replacement", "T4 Framework" not in steps)


def test_the_default_scope_wording_still_reads_right_at_one_and_at_many():
    """The internal report keeps the catalog wording, and it has to survive the same fix."""
    one = decide(_profile([_p("JA Vega", "available")])).scope_line
    many = decide(_profile([_p("JA Vega", "available"), _p("JA Teline V", "none")])).scope_line
    check("singular", "the 1 JoomlArt product on this account." in one)
    check("plural", "the 2 JoomlArt products on this account." in many)


def test_a_site_already_running_joomla_6_is_not_told_it_is_not_ready():
    """Found by running the skill against ten real customer sites on 2026-08-20. Two of them
    were on Joomla 6.1.2 and were told "Some of what you run is not ready for Joomla 6 yet",
    which is false by inspection: the extensions in that sentence are installed on a site that
    is running Joomla 6.

    A site already on 6 has answered the question by running. The registry's silence about an
    extension is the absence of a reading; the site running it on Joomla 6 is a reading."""
    v = decide(_profile([_p("Mystery", j6="unknown", src="unlisted")], version="6.1.2"))
    check("not called unready", v.level == "ready")
    check("and the headline says so", "already" in v.headline.lower())


def test_a_site_already_on_six_is_not_told_to_plan_an_upgrade():
    """The ready branch offers "You can plan the upgrade. Take a full backup first." To a site
    already on 6 that is advice to do nothing, dressed as a next step."""
    v = decide(_profile([_p("K2", j6="available")], version="6.1.2"))
    check("no upgrade to plan", not any("plan the upgrade" in s for s in v.next_steps))


def test_a_site_already_on_six_still_names_what_nobody_has_published_a_verdict_for():
    """Being on 6 answers "does it run", not "is it maintained". Dropping the count would make
    this the one report that quietly discards the half it did not recognise."""
    v = decide(_profile([_p("Mystery", j6="unknown", src="unlisted")], version="6.1.2"))
    check("still counted", any("Mystery" in b or "1" in b for b in v.blockers + v.next_steps))


def test_a_discontinued_product_still_matters_on_a_site_already_at_six():
    """Running today is not being maintained tomorrow. This one keeps the full treatment."""
    v = decide(_profile([_p("JA Old", j6="discontinued")], version="6.1.2"))
    check("still must replace", v.level == "must_replace")


def test_reading_no_extensions_at_all_is_not_a_clean_bill_of_health():
    """Found on 2026-08-20 by running the chain on real sites. A site whose extensions could not
    be read produced "Everything we checked has a Joomla 6 build", which is true in the way that
    matters least: nothing was checked. `read_state` already warns about it and the warning
    reaches `unseen`, but the verdict overrode it with the one word a customer reads first."""
    v = decide(_profile([], version="5.4.8"))
    check("not ready", v.level != "ready")
    check("and says why", any("no extensions" in b.lower() or "nothing" in b.lower()
                              for b in v.blockers))


def test_the_headline_does_not_describe_what_was_never_read():
    """The blocker told the truth while the headline said "Some of what you run is not ready for
    Joomla 6 yet" about a site nothing had been read from. The headline is the line a customer
    reads first and often the only one, so it cannot be the one that overclaims."""
    v = decide(_profile([], version="5.4.8"))
    check("no claim about what they run", "what you run" not in v.headline.lower())
    check("says the reading failed", "could not" in v.headline.lower()
          or "not read" in v.headline.lower())


def test_a_site_on_six_with_nothing_read_still_says_nothing_was_read():
    """Being on Joomla 6 is a real reading and stays. Having read no extensions is also real."""
    v = decide(_profile([], version="6.1.3"))
    check("still already there", "already" in v.headline.lower())
    check("but names the gap", any("no extensions" in b.lower() or "nothing" in b.lower()
                                   for b in v.blockers))


def test_a_site_two_hops_away_is_not_told_to_plan_one_upgrade():
    """A Joomla 5.2 site must reach 5.4 before the update server offers it a 6. SKILL.md says
    saying "upgrade to Joomla 6" without saying how many upgrades is telling somebody the job is
    smaller than it is, and the rule only covered Joomla 3 and 4."""
    v = decide(_profile([_p("K2", j6="available")], version="5.2.5", hops=2))
    check("the number of upgrades is stated",
          any("two" in b.lower() or "2 " in b for b in v.blockers))
    check("not offered as one", not any("You can plan the upgrade" in s for s in v.next_steps))


def test_a_site_one_hop_away_is_left_alone():
    v = decide(_profile([_p("K2", j6="available")], version="5.4.8", hops=1))
    check("ready", v.level == "ready")
    check("no staging lecture", not any("stage" in b.lower() for b in v.blockers))


def test_a_site_that_runs_only_joomla_itself_is_not_a_failed_read():
    """Two different findings wore the same sentence. "The read returned nothing" and "the read
    returned rows and none of them were third-party" are opposite pieces of news, and the second
    one is good news: a site running only Joomla itself has nothing that can block an upgrade.

    Found 2026-08-20 by walking the shapes real sites actually produce."""
    v = decide(_profile([], version="5.4.8", read=41))
    check("not reported as a failed read", "could not read" not in v.headline.lower())
    check("and not blocked by an absence",
          not any("no extensions could be read" in b.lower() for b in v.blockers))


def test_a_read_that_returned_nothing_at_all_still_says_so():
    check("still named", "could not read" in decide(_profile([], version="5.4.8", read=0)).headline.lower())


def main():
    for fn in (test_one_discontinued_product_decides_the_whole_verdict,
               test_unknown_never_rounds_up_to_ready,
               test_all_available_is_ready,
               test_every_level_carries_its_own_scope_limit,
               test_blockers_list_only_what_blocks_not_the_whole_inventory,
               test_blockers_are_ordered_severest_first,
               test_many_products_failing_for_one_reason_collapse_into_one_line,
               test_a_handful_of_blockers_are_still_listed_one_by_one,
               test_a_dead_brand_gets_advice_and_never_an_invented_template_name,
               test_a_joomla_3_site_is_told_it_is_a_multi_hop_move,
               test_an_undetected_joomla_version_is_not_treated_as_fine,
               test_the_default_scope_wording_still_reads_right_at_one_and_at_many,
               test_a_replacement_is_named_from_what_the_customer_already_owns,
               test_no_owned_replacement_means_no_invented_one,
               test_only_a_template_counts_as_a_replacement_for_a_template,
               test_the_untested_caveat_is_said_once_not_on_every_row,
               test_no_derived_row_means_no_such_caveat,
               test_a_site_already_running_joomla_6_is_not_told_it_is_not_ready,
               test_a_site_already_on_six_is_not_told_to_plan_an_upgrade,
               test_a_site_already_on_six_still_names_what_nobody_has_published_a_verdict_for,
               test_a_discontinued_product_still_matters_on_a_site_already_at_six,
               test_reading_no_extensions_at_all_is_not_a_clean_bill_of_health,
               test_a_site_on_six_with_nothing_read_still_says_nothing_was_read,
               test_a_site_two_hops_away_is_not_told_to_plan_one_upgrade,
               test_a_site_one_hop_away_is_left_alone,
               test_the_headline_does_not_describe_what_was_never_read,
               test_a_site_that_runs_only_joomla_itself_is_not_a_failed_read,
               test_a_read_that_returned_nothing_at_all_still_says_so):
        fn()
    for name, ok in _RESULTS:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    passed = sum(1 for _, ok in _RESULTS if ok)
    print(f"\n{passed}/{len(_RESULTS)} passed")
    sys.exit(0 if passed == len(_RESULTS) else 1)


if __name__ == "__main__":
    main()
