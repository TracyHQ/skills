"""The PHP half of the chain, and the one person who can move it.

Joomla's update server enforces the version chain with signed metadata. Nothing enforces the
PHP chain except PHP refusing to run, and the readiness report never said a word about it.

## What this asks for, and what it deliberately does not

Each Joomla line has a documented minimum PHP. A hop needs the TARGET's minimum, because the
updater checks it before it starts. That is the whole question this module answers.

    -> 4.4    PHP 7.2.5
    -> 5.4    PHP 8.1
    -> 6.1    PHP 8.3

It says nothing about a maximum, and that is a correction rather than an omission. The first
version of this module treated the set of PHP versions the Joomla project builds images for as
a validity range, and flagged anything above it. Measured against 553 live JoomlArt customer
sites on 2026-08-20, that rule fired on 16 sites that were serving perfectly well, including
**Joomla 3.10 running on PHP 8.1, 8.2, 8.3 and 8.5**. A rule that calls a working site broken
would have had us tell customers to change something that was fine, on a live site, on our word.

So: the site tells us what it runs on, and reality outranks the table. We ask for a minimum and
never for a ceiling.

## Why one rung at a time

A customer handed three PHP changes will make them at once. Asking only for the next hop's
minimum keeps the ladder honest by construction: 7.2.5, then 8.1, then 8.3, each requested when
the hop that needs it is the next thing to happen.

## Why the customer, and not us

On the fleet PHP is a tag: change `WEB_IMAGE`, rebuild the container. Host-in-place has no such
lever, because PHP lives with the hosting provider (ADR 0051 keeps the site there, and
`08-J6-Upgrade/SPEC-v2.md` measures who that leaves stuck). This module produces an instruction
for a human and a way to check afterwards whether they carried it out. It never pretends to have
done it itself.

Measured on the same 553 sites, PHP read exactly on 138: 51% were already at 8.3 or better, 23%
were at 8.0-8.2 and need one click in their own panel, and 24% were at 7.x or below, where the
question stops being "which button" and becomes "does this host offer 8.3 at all".
"""
from __future__ import annotations

from upgrade_path import CHAIN, chain_to_six  # noqa: F401  (CHAIN re-exported deliberately)

#: The documented minimum PHP for each release line, from Joomla's own requirements. A line is
#: absent when nothing new is required to reach it: the point update inside a major that brings
#: a 5.2 site to 5.4 runs on whatever the site already runs on.
#:
#: Minimums only. See the module docstring for why there is no maximum here.
PHP_MIN: dict[str, str] = {
    "4.4": "7.2.5",
    "5.4": "8.1",
    "6.1": "8.3",
}


def _num(php: str) -> list[int]:
    return [int(x) for x in str(php).split(".") if x.isdigit()]


def _line(version: str) -> str:
    """`5.4.8` becomes `5.4`. A release behind its own launch point resolves to that launch
    point, because that is the hop it can actually make. Anything unreadable raises."""
    parts = str(version or "").split(".")
    if len(parts) < 2 or not all(p.isdigit() for p in parts[:2]):
        raise ValueError(f"unreadable Joomla version: {version!r}")
    line = f"{parts[0]}.{parts[1]}"
    if line in CHAIN:
        return line
    major = parts[0]
    for known in CHAIN:
        if known.split(".")[0] == major:
            return known
    raise ValueError(f"no chain data for Joomla {version}")


def php_for_hop(current: str, target: str) -> str:
    """The PHP this hop needs, or ValueError if it is not a hop.

    Empty string when the hop needs nothing new: a point update inside one major changes no PHP
    requirement, and asking a customer to touch PHP for it would be noise on a live site.
    """
    here, there = _line(current), _line(target)
    step = CHAIN.index(there) - CHAIN.index(here)
    if step == 0:
        # 5.2 -> 5.4 and 3.9 -> 3.10: a real hop with a real snapshot, and no PHP question.
        return ""
    if step != 1:
        raise ValueError(
            f"Joomla {here} to {there} is not one hop; the chain is {' -> '.join(CHAIN)}")
    return PHP_MIN.get(there, "")


def php_plan(joomla: str, php: str = "") -> list[dict]:
    """Every hop this site must make, and the PHP each one needs.

    A plan, not an instruction: it exists so a report can show the whole road. What the customer
    is actually asked to do comes from `next_step`, one rung at a time.
    """
    here = _line(joomla)
    out, at = [], here
    for target in chain_to_six(joomla):
        needed = php_for_hop(at, target)
        out.append({
            "from": at,
            "to": target,
            "php": needed,
            # Unknown PHP is not "no change needed". It is a reading that failed, and the plan
            # says so rather than filling it in with an assumption a customer would act on.
            "change_needed": False if not needed else (None if not php
                                                       else _num(php) < _num(needed)),
        })
        at = target
    return out


#: Named because a customer looking at their own panel needs a word to search for, not a menu
#: path we cannot see. Hosts rename and reskin these, so the sentence says so.
_GUIDANCE = (
    "Set PHP to {php} or higher for this site, then tell us and we will check before going "
    "further.\n"
    "cPanel calls this MultiPHP Manager. Plesk calls it PHP Settings. DirectAdmin and most "
    "CloudLinux panels call it Select PHP Version. Labels vary between hosts, so if none of "
    "those appear, your host's support can set it in a minute.\n"
    "If the highest your host offers is below {php}, tell us that instead: it changes what we "
    "can do rather than how long it takes."
)


def next_step(joomla: str, php: str = "") -> dict:
    """The one thing to do now. Never the ladder.

    Four answers, and two of them are refusals to move. Every way this can be unclear is a way
    a live site gets broken by a confident instruction.
    """
    here = _line(joomla)
    remaining = chain_to_six(joomla)
    if not remaining:
        return {"action": "done", "joomla": here}

    target = remaining[0]
    needed = php_for_hop(here, target)

    if not needed:
        return {"action": "upgrade", "to": target, "php": php}

    if not php:
        return {"action": "php_unknown", "for_hop": target, "php": needed,
                "why": "The site\'s PHP could not be read, so nothing may be asked of the "
                       "customer yet. Read it again rather than assuming."}

    if _num(php) < _num(needed):
        return {"action": "ask_customer", "php": needed, "from_php": php, "for_hop": target,
                "guidance": _GUIDANCE.format(php=needed)}

    return {"action": "upgrade", "to": target, "php": php}
