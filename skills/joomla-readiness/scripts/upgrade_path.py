#!/usr/bin/env python3
"""How far a site is from Joomla 6, and how what it reports reaches the verdict rules.

Two small pieces, and both exist so that something already learned is not learned again.

**The chain.** Joomla's update server will not let a site skip a major. Its signed TUF metadata
matches the running version against a regex per package: a 6.x package is offered only to
`5.4`, a 5.x package only to `4.4`, and `3.10` goes straight to `4.4`. So the road is
`3.10 -> 4.4 -> 5.4 -> 6.1` and there is no way round it. A report that says "upgrade to 6"
without saying "through three majors" is telling somebody the job is smaller than it is.

The executable version of this, with the PHP each hop runs on, lives in tracy-fleet's
`php_matrix.py`. This copy is for describing the road, not walking it, so it carries only the
order.

**The bridge.** `site_state` describes what a site reports; `verdict` decides what to tell the
customer. The verdict rules were learned from real reports going wrong, `unknown` never rounds
up, silence is never "fine", a level always carries its scope, and rewriting them for a new
input shape is how a hard-won rule gets quietly dropped. So the new shape is translated into
the old one instead.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from profile_types import OwnedProduct, SiteProfile  # noqa: E402

#: The launch points, in order. From update.joomla.org/cms/targets.json, where a 6.x package
#: matches `(6\.[0-4])|^(5\.4)` and a 5.x package matches `(5\.[0-4])|^(4\.4)`.
CHAIN = ("3.10", "4.4", "5.4", "6.1")


def _line(version) -> str | None:
    """`5.4.8` becomes `5.4`; `5.2.0` becomes the Joomla 5 launch point it must reach first.

    None for anything unreadable. Half the sites this will meet report no version at all, and
    inventing a starting point is how a customer is told a three-hop job is one hop.
    """
    parts = str(version or "").split(".")
    if len(parts) < 2 or not all(p.isdigit() for p in parts[:2]):
        return None
    exact = f"{parts[0]}.{parts[1]}"
    if exact in CHAIN:
        return exact
    for known in CHAIN:
        if known.split(".")[0] == parts[0]:
            return known
    return None


def chain_to_six(version) -> list | None:
    """Every release line this site must pass through to reach Joomla 6, or None.

    A site at a launch point starts from the next one. A site behind its own launch point has
    that first: reaching 5.4 from 5.2 is a point update inside one major, and it is still a hop
    with its own snapshot and its own way of failing.
    """
    line = _line(version)
    if line is None:
        return None
    parts = str(version).split(".")
    at_launch = f"{parts[0]}.{parts[1]}" == line
    return list(CHAIN[CHAIN.index(line) + (1 if at_launch else 0):])


#: What the registry's isJ6 means in the verdict's vocabulary. None is not False: "the registry
#: has this product but says nothing about Joomla 6" and "it does not support Joomla 6" are
#: different answers to a customer.
_STATUS = {True: "available", False: "none", None: "unknown"}


def profile_from_state(state: dict) -> SiteProfile:
    """What a site reports, in the shape the verdict rules already understand.

    Core extensions are left out. A site holds around a hundred of them, they move with the
    core, and listing them would bury the handful that matter under rows the customer cannot
    act on.
    """
    products = []
    for row in state.get("extensions") or []:
        if row.get("state") == "core":
            continue
        # A part of a package is not a product a customer bought, and the package it belongs to
        # is in this same list carrying the one verdict that answers for all of them. Seven
        # Xmap plugins beside Xmap is one product wearing eight lines.
        if row.get("state") == "part":
            continue

        if row.get("state") == "matched":
            status = _STATUS.get(row.get("isJ6"), "unknown")
            # Two kinds of answer wear the same shape here. One is a reading of the public
            # directory; the other is the publisher speaking about its own product, which the
            # directory may never have listed. Printing "the extension directory records" over
            # a publisher's declaration asserts a measurement that was never taken.
            if row.get("evidence") == "declared":
                source = "vendor"
                note = {
                    "available": "The publisher declares a Joomla 6 build for this.",
                    "none": "The publisher declares that this has no Joomla 6 build yet.",
                    "unknown": "The publisher lists this product but has not stated its Joomla 6 "
                               "status, so it is unknown rather than fine.",
                }[status]
            else:
                source = "registry"
                note = {
                    "available": "The extension directory records a Joomla 6 build for this.",
                    "none": "The extension directory records no Joomla 6 build for this.",
                    "unknown": "The extension directory has this product but says nothing about "
                               "Joomla 6, so its status is unknown rather than fine.",
                }[status]
        else:
            # A source of its own, because the verdict answers it differently: an extension no
            # directory lists is nobody at JoomlArt's to confirm.
            status, source = "unknown", "unlisted"
            note = ("This is not in the public extension registry, so nothing is known about "
                    "its Joomla 6 status. That is not the same as it being fine.")

        products.append(OwnedProduct(
            title=str(row.get("name") or ""), product=str(row.get("name") or ""),
            kind=str(row.get("type") or "extension"),
            last_download="", j6=status, j6_source=source, j6_note=note))

    products.sort(key=lambda p: p.product)

    unseen = [
        "The PHP version the site runs on. That lives with the hosting provider, and Joomla 6 "
        "needs 8.3 or newer.",
        "Whether each extension below is actually in use. It is installed; that is what was "
        "read.",
    ]
    # The count of what could not be matched is the honest limit of this whole skill, so it
    # travels with the report rather than staying in a log.
    unseen.extend(state.get("warnings") or [])

    core = state.get("core") or {}
    return SiteProfile(
        user_id=0, email="", domain="",
        joomla_version=str(core.get("version") or ""), version_measured_at="",
        products=products, unseen=unseen,
        scope_one="extension installed on this site",
        scope_many="extensions installed on this site",
        scope_limit=("It covers what the site reports as installed, looked up in the public "
                     "extension directory. Anything the directory does not list is named "
                     "above as unknown rather than treated as fine."))
