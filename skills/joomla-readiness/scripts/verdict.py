"""Three levels, and the discipline that keeps each one honest.

The customer opens the PDF wanting one thing: do I have to worry. Three levels answer
that, and each maps to exactly one next action. No score: nothing here measures
finely enough to tell 62 from 71, and a fabricated number is the first thing an
agency will test.

Two rules do most of the work:

  * `unknown` never rounds up. A product nobody has confirmed drags the verdict down
    to "work needed". Rounding it to "probably fine" is the behaviour that
    white-screened ten customer sites.
  * the scope limit travels with the level, in the same object, so a renderer cannot
    print the verdict without printing what it was computed over. That matters most
    at "ready", which is the level most easily read as "nothing to worry about".
"""
from __future__ import annotations

from dataclasses import dataclass, field

# One definition, shared, so the profile and the verdict cannot disagree about whether
# the version is known.
from profile_types import joomla_major as _joomla_major

READY = "ready"
WORK_NEEDED = "work_needed"
MUST_REPLACE = "must_replace"

# Severest first. This ordering decides both the level and the order of the blocker
# list, so there is one place to change if the policy ever moves.
_SEVERITY = {"discontinued": 0, "unknown": 1, "none": 2, "planned": 3, "available": 9}

_BLOCKING = ("discontinued", "unknown", "none", "planned")

_HEADLINE = {
    READY: "Everything we checked has a Joomla 6 build.",
    WORK_NEEDED: "Some of what you run is not ready for Joomla 6 yet.",
    MUST_REPLACE: "Part of your site is built on a product that has been discontinued.",
}


@dataclass(frozen=True)
class Verdict:
    level: str
    headline: str
    scope_line: str
    blockers: list[str] = field(default_factory=list)
    next_steps: list[str] = field(default_factory=list)


def _scope_line(profile) -> str:
    n = len(profile.products)
    subject = getattr(profile, "scope_one" if n == 1 else "scope_many", None) or (
        f"JoomlArt product{'' if n == 1 else 's'} on this account")
    where = f"the {n} {subject}"
    # No date here. The clause that used to sit at the end read "against the catalog as
    # of <date>" while the value it printed was the site crawl date, mislabelling one
    # measurement as the other. It never fired, because the site inventory has no such
    # column, so the fault sat waiting rather than showing. The footer carries both real
    # dates, each under its own name.
    limit = getattr(profile, "scope_limit",
                    "It does not cover third-party extensions, which we could not see.")
    return f"This verdict is calculated only over what we looked at: {where}. {limit}"


#: Above this many products sharing one cause, list the cause once with a count
#: instead of repeating it. A real Shape5 account produced 105 blocker lines, 103 of
#: them the same sentence: that is an inventory, not a list of blockers. Below it,
#: naming each product is more useful than counting them.
_COLLAPSE_AT = 4


def _collapse(blocking: list) -> list[str]:
    """One line per product, unless many products fail for the same reason."""
    groups: dict[str, list] = {}
    for p in blocking:
        groups.setdefault(p.j6_note or p.j6, []).append(p)

    lines: list[str] = []
    for note, items in groups.items():
        if len(items) < _COLLAPSE_AT:
            lines.extend(f"{p.product}: {note}" for p in items)
            continue
        shown = ", ".join(p.product for p in items[:3])
        lines.append(f"{len(items)} products, including {shown}: {note}")
    return lines


def decide(profile) -> Verdict:
    blocking = [p for p in profile.products if p.j6 in _BLOCKING]
    blocking.sort(key=lambda p: (_SEVERITY.get(p.j6, 5), p.product))

    # Only what blocks. A real account produced 112 products; listing all of them under
    # "blockers" would mean nothing is a blocker.
    blockers = _collapse(blocking)
    next_steps: list[str] = []

    major = _joomla_major(profile.joomla_version)

    if any(p.j6 == "discontinued" for p in blocking):
        level = MUST_REPLACE
    elif blocking:
        level = WORK_NEEDED
    else:
        level = READY

    # A Joomla 3 or 4 site is not one upgrade away from 6 whatever its products say,
    # and a report silent about that is a wrong report. Seen on a real account today:
    # a customer asking about Joomla 6 while running 3.10.
    if major is not None and major < 5:
        if level == READY:
            level = WORK_NEEDED
        blockers.insert(0, (
            f"This site runs Joomla {profile.joomla_version}. Moving to Joomla 6 from "
            f"Joomla {major} is a staged migration, not a single upgrade, and it has to "
            "be planned as one regardless of which products are ready."))
        next_steps.append(
            "Plan the move in stages rather than as one upgrade. Our migration service "
            "does exactly this and can quote for it.")

    # No detected version is not a clean bill of health either.
    if not profile.joomla_version:
        if level == READY:
            level = WORK_NEEDED
        blockers.insert(0, (
            "We could not determine which Joomla version this site runs, so nothing "
            "below is stated relative to a specific version."))

    if any(p.j6 == "discontinued" for p in blocking):
        # The spec asks for a replacement named to the template, not "see our catalog".
        # Picking one of the 88 templates that have a Joomla 6 build would be inventing
        # a recommendation nobody checked. A template the customer already bought, that
        # already has a Joomla 6 build, is specific without being invented: it comes
        # from their own account and they already hold the licence.
        # Templates only. A framework is not a replacement for a template, and on a
        # real account this sentence offered "T4 Framework" as somewhere to start.
        owned = [p.product for p in profile.products
                 if p.j6 == "available" and p.kind == "template"]
        move = ""
        if owned:
            named = ", ".join(sorted(owned)[:3])
            move = (f" You already have {named} on this account, and {'they have' if len(owned) > 1 else 'it has'} "
                    "a Joomla 6 build, so that is the cheapest place to start.")
        next_steps.append(
            "The discontinued products above have no Joomla 6 build and will not get "
            "one. Moving to a currently maintained JoomlArt template is the way "
            f"forward.{move} We will advise on which one fits your site rather than "
            "guess from a list, and our migration service can carry out the move.")

    ours = [p for p in blocking if p.j6 == "unknown" and p.j6_source != "unlisted"]
    theirs = [p for p in blocking if p.j6 == "unknown" and p.j6_source == "unlisted"]
    if ours:
        next_steps.append(
            "For anything marked as being confirmed above, we are checking with the "
            "product team and will follow up. Please do not upgrade on the assumption "
            "that it is ready.")
    if theirs:
        next_steps.append(
            "Some of what is installed is not in the public extension directory, so nobody "
            "has published a Joomla 6 status for it. Ask whoever supplied it, or ask us and "
            "we will check it for you. Please do not upgrade on the assumption that it is "
            "ready.")

    # Said here rather than on each row, and said at all because these rows have no
    # person behind them: the catalog shows no Joomla 6 build was ever published, which
    # is not the same finding as somebody having tested it and found it broken.
    if any(p.j6_source == "derived" for p in blocking):
        next_steps.append(
            "Where we have not published a Joomla 6 build, it has not been tested "
            "against Joomla 6 either way. Treat those products as unproven rather "
            "than as known to fail; ask us and we will check the ones you depend on.")

    # "Wait for the release" is only advice when a release is coming. Told to somebody
    # whose template was last built in 2014 it is advice to wait forever, and this line
    # used to say it to both groups at once.
    if any(p.j6 == "planned" for p in blocking):
        next_steps.append(
            "Where a Joomla 6 build is announced but not out, wait for it before "
            "upgrading the site.")

    if any(p.j6 == "none" for p in blocking):
        next_steps.append(
            "Where there is no Joomla 6 build, none has been announced either. Ask us "
            "about the options: some of these can be replaced with a maintained "
            "product, some may run as they are, and we will tell you which is which "
            "rather than leave you to find out on the live site.")

    if level == READY:
        next_steps.append(
            "You can plan the upgrade. Take a full backup first, and upgrade on a "
            "staging copy before the live site.")

    return Verdict(level=level, headline=_HEADLINE[level],
                   scope_line=_scope_line(profile),
                   blockers=blockers, next_steps=next_steps)
