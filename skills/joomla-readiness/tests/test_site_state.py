#!/usr/bin/env python3
"""What a site says about itself, and how little of it can be matched.

The registry is keyed by JED listing slug. A site reports Joomla element names. There is no
shared key between them, and it is not a small gap:

    k2            -> com_k2         the slug happens to be the element
    akeeba-backup -> com_akeeba     close, and not equal
    jomsocial     -> com_community  no textual relationship at all

So this module's job is not to match everything. It is to match what can be matched, and to
make the size of what could not be matched impossible to miss. A report that quietly drops the
half it did not recognise is the failure mode here.

Runs without pytest:  python3 tests/test_site_state.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                       / "scripts"))

from site_state import classify, read_state  # noqa: E402

_RESULTS = []


def check(name, cond):
    _RESULTS.append((name, bool(cond)))


def _ext(name, element, type_="component", version="1.0.0", enabled=True):
    return {"name": name, "element": element, "type": type_,
            "version": version, "enabled": enabled}


_REGISTRY = {
    "k2": {"slug": "k2", "title": "K2",
           "platformData": {"joomla": {"isJ6": False, "isJ5": True}}},
    "jomsocial": {"slug": "jomsocial", "title": "JomSocial",
                  "platformData": {"joomla": {"isJ6": True, "isJ5": True}}},
}


def test_a_slug_that_happens_to_be_the_element_matches():
    row = classify(_ext("K2", "com_k2"), _REGISTRY, core_version="5.4.7")
    check("k2 matches on its element", row["match"] == "k2")
    check("it carries the Joomla 6 verdict", row["isJ6"] is False)


def test_a_product_whose_element_is_nothing_like_its_slug_still_matches_by_name():
    """JomSocial installs as com_community. The element route cannot find it; the human name
    can, and that is the only reason this product is answerable at all."""
    row = classify(_ext("JomSocial", "com_community"), _REGISTRY, core_version="5.4.7")
    check("jomsocial matches on its name", row["match"] == "jomsocial")
    check("the verdict is right", row["isJ6"] is True)


def test_something_in_neither_is_unrecognised_not_guessed():
    row = classify(_ext("Some Widget", "com_somewidget"), _REGISTRY, core_version="5.4.7")
    check("nothing is guessed", row["match"] is None)
    check("the state is unrecognised", row["state"] == "unrecognised")
    check("no verdict is invented", row["isJ6"] is None)


def test_core_extensions_are_named_as_core_not_as_unknown():
    """A Joomla site carries around a hundred core extensions. Reporting them as unrecognised
    would bury the handful that matter under noise the customer cannot act on. Core moves with
    the core: its Joomla 6 status is the upgrade's, not a lookup's."""
    row = classify(_ext("com_content", "com_content", version="5.4.7"),
                   _REGISTRY, core_version="5.4.7")
    check("recognised as core", row["state"] == "core")
    check("it does not count as unknown", row["match"] is None and row["isJ6"] is None)


def test_a_third_party_sharing_the_core_version_is_still_read_as_core():
    """Documented rather than fixed: the version test is the only signal the component gives
    us, and a third party that ships '5.4.7' will be read as core. It is rare, and the safe
    direction: a core row says nothing, where a wrong verdict would say something false."""
    row = classify(_ext("Coincidence", "com_coincidence", version="5.4.7"),
                   _REGISTRY, core_version="5.4.7")
    check("read as core, and written down", row["state"] == "core")


def test_a_disabled_extension_is_still_reported(): 
    """Disabled today, enabled by whoever inherits the site tomorrow. It is installed, so it
    is part of what an upgrade has to survive."""
    row = classify(_ext("K2", "com_k2", enabled=False), _REGISTRY, core_version="5.4.7")
    check("it is still reported", row["match"] == "k2")
    check("it says the extension is disabled", row["enabled"] is False)


def test_the_state_counts_what_it_could_not_recognise():
    """The number that must never be quiet."""
    state = read_state(version="5.4.7", extensions=[
        _ext("com_content", "com_content", version="5.4.7"),
        _ext("K2", "com_k2"),
        _ext("Some Widget", "com_somewidget"),
        _ext("Another", "com_another"),
    ], registry=_REGISTRY)
    check("the core count is right", state["counts"]["core"] == 1)
    check("the matched count is right", state["counts"]["matched"] == 1)
    check("the unrecognised count is right", state["counts"]["unrecognised"] == 2)


def test_no_version_means_no_conclusion_about_the_core():
    """Relay-only mode: list_extensions works, but the relay's own capability service says it
    cannot tell J4 from J5+, so joomlaVersion stays unknown. Extensions can still be answered;
    the core cannot, and the report has to say which."""
    state = read_state(version="", extensions=[_ext("K2", "com_k2")], registry=_REGISTRY)
    check("no conclusion about the core", state["core"]["version"] == "")
    check("it says it does not know", state["core"]["known"] is False)
    check("extensions are still answered", state["counts"]["matched"] == 1)


def test_an_empty_site_is_not_a_clean_bill_of_health():
    state = read_state(version="5.4.7", extensions=[], registry=_REGISTRY)
    check("it says nothing could be read", state["counts"]["total"] == 0)
    check("a warning is present", any("nothing" in w.lower() or "no extensions" in w.lower()
                             for w in state["warnings"]))


def test_a_name_two_products_share_resolves_to_unknown_not_to_whichever_came_first():
    """Measured on the live registry 2026-08-19: 4 titles and 5 slugs are shared by two
    different products, "Count Down" against "Countdown", "Custom CSS" against "CustomCSS",
    "Backdoor" against "AdminExile". Eight records, 0.2%, and the index was picking whichever
    was seen first and saying nothing.

    Rare is not the same as harmless. The rule this whole skill runs on is that a wrong verdict
    is worse than an honest unknown, and "two products answer to this name, so we cannot tell
    which one you have" is exactly an honest unknown."""
    registry = {
        "count-down": {"slug": "count-down", "title": "Count Down",
                       "platformData": {"joomla": {"isJ6": True}}},
        "countdown": {"slug": "countdown", "title": "Countdown",
                      "platformData": {"joomla": {"isJ6": False}}},
    }
    row = classify(_ext("Countdown", "mod_countdown"), registry, core_version="5.4.7")
    check("does not pick one of them", row["match"] is None)
    check("reported as unrecognised", row["state"] == "unrecognised")
    check("no verdict invented", row["isJ6"] is None)


def test_an_unambiguous_name_still_resolves():
    """The guard must not cost the 99.8% that are fine."""
    row = classify(_ext("K2", "com_k2"), _REGISTRY, core_version="5.4.7")
    check("still matches", row["match"] == "k2")


def test_a_core_extension_with_no_version_is_still_core():
    """The rule used to be "its version equals the core's", and that was inferred rather than
    checked. Joomla's own install SQL settles it: every one of the 248 core rows in 6.1.3 ships
    with `manifest_cache` empty, so their version reads as null and not one of them would have
    matched. The authoritative name is checked first.

    Getting this wrong is not a small mistake. A Joomla 6 site carries 248 core extensions, 156
    of them plugins. Missing them floods the report with rows a customer can do nothing about
    and buries the handful that matter."""
    row = classify(_ext("com_content", "com_content", version=None),
                   _REGISTRY, core_version="6.1.3")
    check("recognised without a version", row["state"] == "core")


def test_core_is_recognised_across_the_whole_chain():
    """A site being read might be on any of 3.10, 4.4, 5.4 or 6.1, and the core list moved
    between them: 25 names in Joomla 3 are gone by Joomla 4, and Joomla 6 has 65 that Joomla 4
    did not. The union of all four is what a reader needs."""
    for name in ("com_mailto", "plg_system_log", "mod_articles_news", "com_wrapper"):
        row = classify(_ext(name, name, version=None), _REGISTRY, core_version="")
        check(f"{name} is core", row["state"] == "core")


def test_a_third_party_extension_is_not_swallowed_by_the_core_list():
    """The other direction, and the worse one: a core list that is too eager hides the very
    products an upgrade breaks."""
    row = classify(_ext("K2", "com_k2"), _REGISTRY, core_version="5.4.7")
    check("K2 is not core", row["state"] == "matched")


def test_the_version_rule_still_catches_what_the_list_does_not_name():
    """The list is the four releases we read. A core extension from a version not in it, or one
    renamed since, still matches the core's own version, so both signals are kept."""
    row = classify(_ext("com_something_new", "com_something_new", version="7.0.0"),
                   _REGISTRY, core_version="7.0.0")
    check("version rule still applies", row["state"] == "core")


def test_the_core_rows_named_by_a_title_rather_than_a_key_are_core_too():
    """Three of Joomla 6's core rows carry a human title where the rest carry a language key:
    "Joomla! Platform", "PHPass" and "English (en-GB) Language Pack". Their elements are
    `joomla`, `phpass` and `pkg_en-GB`, which are far too generic to put in a list matched by
    name alone: a third-party plugin with element `joomla` would be swallowed, and swallowing
    third-party products is the failure direction that hides what an upgrade breaks.

    Matched on type and element together instead, which no third-party component or module can
    collide with."""
    for name, element, kind in (("Joomla! Platform", "joomla", "library"),
                                ("PHPass", "phpass", "library"),
                                ("English (en-GB) Language Pack", "pkg_en-GB", "package")):
        row = classify(_ext(name, element, type_=kind, version=None), _REGISTRY, core_version="")
        check(f"{name} is core", row["state"] == "core")


def test_a_third_party_sharing_a_core_element_under_another_type_is_not_swallowed():
    """The pair is what makes this safe. A component called `joomla` is not the core library."""
    row = classify(_ext("Some Joomla Thing", "joomla", type_="component"),
                   _REGISTRY, core_version="")
    check("not swallowed", row["state"] != "core")


def test_the_unrecognised_count_is_measured_against_what_could_be_looked_up():
    """Run for real against a Joomla 5.4.8 core plus four third-party extensions, the warning
    read "1 of 249 installed extensions are not in the public registry". 249 counts the 245 core
    rows, which were never going to be looked up: the honest denominator is the four that could
    be. One in four is the real proportion, and one in 249 makes the gap look like rounding.

    Understating uncertainty is the same class of mistake as overstating a verdict."""
    rows = [_ext(f"com_core{i}", f"com_core{i}", version="5.4.8") for i in range(20)]
    rows += [_ext("K2", "com_k2"), _ext("Mystery", "com_mystery")]
    state = read_state(version="5.4.8", extensions=rows, registry=_REGISTRY)
    warning = " ".join(state["warnings"])
    check("counts against the lookups, not the install", "1 of 2" in warning)
    check("does not use the whole install as the denominator", "of 22" not in warning)


def test_a_site_where_everything_matched_says_nothing_about_gaps():
    state = read_state(version="5.4.8", extensions=[_ext("K2", "com_k2")], registry=_REGISTRY)
    check("no gap warning", not any("registry" in w and "unknown" in w for w in state["warnings"]))


def test_the_row_shape_this_reads_is_the_one_the_component_returns():
    """Copied from the component's own test fixture, claude-cowork
    `joomla/cowork/tests/run.php`, where `extension.list` is checked against exactly this row:

        ['name' => 'Claude Cowork', 'type' => 'component',
         'element' => 'com_claudecowork', 'version' => '0.3.0', 'enabled' => true]

    Pinned here rather than left as something read once. The shape crossing this boundary is an
    agreement between two repositories in two languages, and the day it changes this should go
    red rather than a customer receiving an empty report.
    """
    row = classify({"name": "Claude Cowork", "type": "component",
                    "element": "com_claudecowork", "version": "0.3.0", "enabled": True},
                   _REGISTRY, core_version="5.4.7")
    check("every field is read without error", row["element"] == "com_claudecowork")
    check("the type survives", row["type"] == "component")
    check("the enabled flag survives", row["enabled"] is True)


def test_a_version_of_null_is_read_rather_than_crashing():
    """The component returns null when a manifest cache is missing or unreadable, and its own
    comment says such a row still belongs in the list: the caller asked what is installed, not
    what is fully described."""
    row = classify({"name": "Half Described", "type": "module", "element": "mod_half",
                    "version": None, "enabled": False}, _REGISTRY, core_version="5.4.7")
    check("no crash on a null version", row["state"] == "unrecognised")
    check("disabled is carried", row["enabled"] is False)


def test_a_plugin_whose_element_names_a_component_does_not_inherit_that_component_s_verdict():
    """Found on joomlart.com, the first real site this was run against. Xmap ships plugins that
    add support for other products, and they are installed as `plugins/xmap/com_k2`, so the
    element really is `com_k2`. Stripping `com_` off it and looking up `k2` handed an Xmap
    plugin K2's Joomla 6 verdict. Three of the fourteen matches on that site were this.

    The plugin's Joomla 6 status is Xmap's business, not K2's. A type prefix is only stripped
    when it agrees with the row's own type."""
    registry = {"k2": {"slug": "k2", "title": "K2",
                       "platformData": {"joomla": {"isJ6": False}}}}
    row = classify(_ext("plg_xmap_com_k2", "com_k2", type_="plugin"), registry, core_version="")
    check("does not borrow K2's verdict", row["match"] is None)
    check("reported as unknown", row["state"] == "unrecognised")


def test_a_component_whose_element_names_a_component_still_matches():
    """The rule must not cost the case it was built for. com_osmap is a component, its element
    carries the component prefix, and osmap is in the registry."""
    registry = {"osmap": {"slug": "osmap", "title": "OSMap",
                          "platformData": {"joomla": {"isJ6": True}}}}
    row = classify(_ext("com_osmap", "com_osmap", type_="component"), registry, core_version="")
    check("still matches", row["match"] == "osmap")


def test_a_module_element_is_stripped_for_a_module():
    registry = {"ja-promo-bar": {"slug": "ja-promo-bar", "title": "JA Promo Bar",
                                 "platformData": {"joomla": {"isJ6": False}}}}
    row = classify(_ext("mod_japromobar", "mod_japromobar", type_="module"),
                   registry, core_version="")
    check("module prefix stripped", row["match"] == "ja-promo-bar")


def test_a_piece_named_after_its_product_is_matched_to_that_product():
    """Measured on joomlart.com. A Joomla product ships many pieces and the directory lists only
    the product, so sh404SEF appears as eight rows and RSForm! Pro as six. Their manifest names
    lead with the product name, which Joomla copies into `#__extensions.name`:

        sh404sef - Similar urls plugin
        RSForm! Pro Module

    Seven rows on that site were reachable this way and none of them ambiguous. The rule demands
    the whole product title as a prefix, not a fragment of one: matching on stems was measured
    too and produced `plg_obrss_content` to `content-ajax` and `com_easydiscuss` to
    `easydiscuss-signature`, an add-on standing in for the product it extends."""
    registry = {"sh404sef": {"slug": "sh404sef", "title": "sh404SEF",
                             "platformData": {"joomla": {"isJ6": False}}}}
    row = classify(_ext("sh404sef - Similar urls plugin", "sh404sefsimilarurls", type_="plugin"),
                   registry, core_version="")
    check("matched to the product", row["match"] == "sh404sef")
    check("carries the product's verdict", row["isJ6"] is False)


def test_the_longest_matching_title_wins():
    """A vendor with several products has several titles sharing a start. The most specific one
    is the right answer, and the shortest would hand a piece the wrong sibling's verdict."""
    registry = {
        "akeeba": {"slug": "akeeba", "title": "Akeeba",
                   "platformData": {"joomla": {"isJ6": True}}},
        "akeeba-ticket-system": {"slug": "akeeba-ticket-system", "title": "Akeeba Ticket System",
                                 "platformData": {"joomla": {"isJ6": False}}},
    }
    row = classify(_ext("Akeeba Ticket System plugin", "atsplugin", type_="plugin"),
                   registry, core_version="")
    check("the specific product wins", row["match"] == "akeeba-ticket-system")


def test_two_products_with_the_same_title_still_refuse():
    """The ambiguity rule holds on this route too."""
    registry = {
        "count-down": {"slug": "count-down", "title": "Countdown",
                       "platformData": {"joomla": {"isJ6": True}}},
        "countdown": {"slug": "countdown", "title": "Countdown",
                      "platformData": {"joomla": {"isJ6": False}}},
    }
    row = classify(_ext("Countdown Module", "mod_cd", type_="module"), registry, core_version="")
    check("refuses rather than picks", row["match"] is None)


def test_a_short_title_is_not_a_prefix_worth_trusting():
    """A two or three letter title matches half the names on a site. 154 registry slugs start
    with `sj` and 142 with `aa`, so a short title is a coincidence generator."""
    registry = {"sj": {"slug": "sj", "title": "SJ", "platformData": {"joomla": {"isJ6": True}}}}
    row = classify(_ext("SJ Something Entirely Else", "sjelse", type_="module"),
                   registry, core_version="")
    check("too short to trust", row["match"] is None)


def test_a_matched_row_carries_where_its_answer_came_from():
    """A verdict read from the public directory and a verdict the publisher declared are not
    the same claim, and the customer is entitled to know which one they are reading. The
    record already carries `provenance`; the row has to carry it too or the distinction dies
    here and the report says "the directory records" about a vendor's own say-so."""
    reg = {"k2": {"slug": "k2", "title": "K2",
                  "platformData": {"joomla": {"isJ6": False}},
                  "provenance": {"*": {"source": "extensions.joomla.org",
                                       "evidence": "observed"}}}}
    row = classify(_ext("K2", "com_k2"), registry=reg, core_version="")
    check("an observed verdict is marked observed", row.get("evidence") == "observed")

    reg2 = {"ja-megafilter": {"slug": "ja-megafilter", "title": "JA Megafilter",
                              "platformData": {"joomla": {"isJ6": False}},
                              "provenance": {"*": {"source": "joomlart.com",
                                                   "evidence": "declared"}}}}
    row2 = classify(_ext("JA Megafilter", "jamegafilter", type_="plugin"), registry=reg2, core_version="")
    check("a declared verdict is marked declared", row2.get("evidence") == "declared")


def test_a_record_without_provenance_does_not_claim_to_be_observed():
    """Absent provenance means nobody said where it came from. Defaulting that to "observed"
    would manufacture authority the record never claimed."""
    reg = {"k2": {"slug": "k2", "title": "K2",
                  "platformData": {"joomla": {"isJ6": False}}}}
    row = classify(_ext("K2", "com_k2"), registry=reg, core_version="")
    check("no provenance means no claim", not row.get("evidence"))


def _pkg(name, element, children, version="1.0.0"):
    return {"name": name, "element": element, "version": version, "children": children}


#: Xmap as it really ships, read off joomlart.com: one component and seven per-product plugins,
#: every one of them a separate row in `#__extensions` and a separate unknown in the report.
_XMAP = _pkg("Xmap Package", "xmap", [
    {"type": "component", "element": "com_xmap"},
    {"type": "plugin", "element": "com_k2", "group": "xmap"},
    {"type": "plugin", "element": "com_kunena", "group": "xmap"},
], version="2.3.3")


def test_a_piece_a_package_declares_is_folded_into_that_package():
    """Eight rows on a site, one product. Joomla installs a package by unpacking its parts into
    the same tables everything else lives in, so the parts look like eight independent products
    to anything reading that table. Xmap's own manifest says otherwise, and it is the authority
    on what Xmap ships."""
    exts = [_ext("Xmap - Kunena Plugin", "com_kunena", type_="plugin"),
            _ext("XMAP_PLUGIN_K2", "com_k2", type_="plugin")]
    for e in exts:
        e["group"] = "xmap"
    state = read_state(version="5.4.8", extensions=exts, registry={}, packages=[_XMAP])
    parts = [r for r in state["extensions"] if r["state"] == "part"]
    check("both plugins are read as parts", len(parts) == 2)
    check("and each names the product it belongs to",
          all(r.get("part_of") == "Xmap Package" for r in parts))


def test_a_package_is_read_as_a_row_of_its_own():
    """The parts stop speaking for themselves, so something has to speak for them. Without the
    package as a row the site would report a product it holds as nothing at all."""
    state = read_state(version="5.4.8", extensions=[], registry={}, packages=[_XMAP])
    names = [r["name"] for r in state["extensions"]]
    check("the package is in the list", "Xmap Package" in names)
    check("carrying its own version",
          [r for r in state["extensions"] if r["name"] == "Xmap Package"][0]["version"] == "2.3.3")


def test_a_package_answers_for_its_parts():
    """One lookup, one verdict, spoken once. Before this the registry was asked eight times
    about a product it lists once, missed on all eight, and the report said eight unknowns."""
    reg = {"xmap": {"slug": "xmap", "title": "Xmap Package",
                    "platformData": {"joomla": {"isJ6": True}}}}
    exts = [dict(_ext("Xmap - Kunena Plugin", "com_kunena", type_="plugin"), group="xmap")]
    state = read_state(version="5.4.8", extensions=exts, registry=reg, packages=[_XMAP])
    pkg = [r for r in state["extensions"] if r["name"] == "Xmap Package"][0]
    check("the package itself matches", pkg["state"] == "matched")
    check("and carries the Joomla 6 verdict", pkg["isJ6"] is True)
    check("its parts claim no verdict of their own",
          all(r["isJ6"] is None for r in state["extensions"] if r["state"] == "part"))


def test_the_unknown_count_stops_counting_one_product_many_times():
    """The count is the headline the report is built around, so counting seven plugins of one
    unknown product as seven unknown products overstates the problem sevenfold."""
    exts = [dict(_ext("Xmap - Kunena Plugin", "com_kunena", type_="plugin"), group="xmap"),
            dict(_ext("XMAP_PLUGIN_K2", "com_k2", type_="plugin"), group="xmap"),
            _ext("Something Else Entirely", "com_else")]
    state = read_state(version="5.4.8", extensions=exts, registry={}, packages=[_XMAP])
    counts = state["counts"]
    check("the two plugins are counted as parts", counts["part"] == 2)
    check("Xmap and the other product are the two unknowns", counts["unrecognised"] == 2)
    check("the warning counts lookups, not parts",
          "2 of 2 non-core extensions" in " ".join(state["warnings"]))


def test_a_row_the_package_does_not_claim_is_left_alone():
    """`com_k2` under Xmap's group is Xmap's. K2's own component is not, and folding it in
    would hand one product's row to another. This is the same mistake in the other direction
    as the one `_strip_type` already guards."""
    exts = [_ext("K2", "com_k2", type_="component"),
            dict(_ext("Xmap - K2 Plugin", "com_k2", type_="plugin"), group="xmap")]
    state = read_state(version="5.4.8", extensions=exts, registry={}, packages=[_XMAP])
    by_type = {r["type"]: r for r in state["extensions"] if r["name"] != "Xmap Package"}
    check("Xmap's plugin is folded in", by_type["plugin"]["state"] == "part")
    check("K2's own component is not", by_type["component"]["state"] != "part")


def test_a_core_row_a_package_declares_stays_core():
    """Joomla ships Weblinks and Search as packages of its own. Their parts are core, and a
    core row makes no claim a package could improve on."""
    core_pkg = _pkg("Search Package", "search",
                    [{"type": "plugin", "element": "content", "group": "search"}])
    exts = [dict(_ext("Content", "content", type_="plugin", version="5.4.8"), group="search")]
    state = read_state(version="5.4.8", extensions=exts, registry={}, packages=[core_pkg])
    row = [r for r in state["extensions"] if r["name"] == "Content"][0]
    check("core wins over the fold", row["state"] == "core")


def test_a_site_read_without_package_manifests_is_unchanged():
    """The packages come from a second read that not every route can make. Where it is missing
    the module has to behave exactly as it did before, not worse."""
    exts = [_ext("K2", "com_k2")]
    reg = {"k2": {"slug": "k2", "title": "K2", "platformData": {"joomla": {"isJ6": False}}}}
    state = read_state(version="5.4.8", extensions=exts, registry=reg)
    check("still matched", state["extensions"][0]["state"] == "matched")
    check("and no parts appear from nowhere", state["counts"]["part"] == 0)


def main():
    for fn in (test_a_matched_row_carries_where_its_answer_came_from,
               test_a_record_without_provenance_does_not_claim_to_be_observed,
               test_a_slug_that_happens_to_be_the_element_matches,
               test_a_product_whose_element_is_nothing_like_its_slug_still_matches_by_name,
               test_something_in_neither_is_unrecognised_not_guessed,
               test_core_extensions_are_named_as_core_not_as_unknown,
               test_a_third_party_sharing_the_core_version_is_still_read_as_core,
               test_a_disabled_extension_is_still_reported,
               test_the_state_counts_what_it_could_not_recognise,
               test_no_version_means_no_conclusion_about_the_core,
               test_an_empty_site_is_not_a_clean_bill_of_health,
               test_a_name_two_products_share_resolves_to_unknown_not_to_whichever_came_first,
               test_an_unambiguous_name_still_resolves,
               test_a_core_extension_with_no_version_is_still_core,
               test_core_is_recognised_across_the_whole_chain,
               test_a_third_party_extension_is_not_swallowed_by_the_core_list,
               test_the_version_rule_still_catches_what_the_list_does_not_name,
               test_the_core_rows_named_by_a_title_rather_than_a_key_are_core_too,
               test_a_third_party_sharing_a_core_element_under_another_type_is_not_swallowed,
               test_the_unrecognised_count_is_measured_against_what_could_be_looked_up,
               test_a_site_where_everything_matched_says_nothing_about_gaps,
               test_the_row_shape_this_reads_is_the_one_the_component_returns,
               test_a_version_of_null_is_read_rather_than_crashing,
               test_a_plugin_whose_element_names_a_component_does_not_inherit_that_component_s_verdict,
               test_a_component_whose_element_names_a_component_still_matches,
               test_a_module_element_is_stripped_for_a_module,
               test_a_piece_named_after_its_product_is_matched_to_that_product,
               test_the_longest_matching_title_wins,
               test_two_products_with_the_same_title_still_refuse,
               test_a_short_title_is_not_a_prefix_worth_trusting,
               test_a_piece_a_package_declares_is_folded_into_that_package,
               test_a_package_is_read_as_a_row_of_its_own,
               test_a_package_answers_for_its_parts,
               test_the_unknown_count_stops_counting_one_product_many_times,
               test_a_row_the_package_does_not_claim_is_left_alone,
               test_a_core_row_a_package_declares_stays_core,
               test_a_site_read_without_package_manifests_is_unchanged):
        fn()
    for name, ok in _RESULTS:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    passed = sum(1 for _, ok in _RESULTS if ok)
    print(f"\n{passed}/{len(_RESULTS)} passed")
    sys.exit(0 if passed == len(_RESULTS) else 1)


if __name__ == "__main__":
    main()
