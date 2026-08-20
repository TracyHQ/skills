#!/usr/bin/env python3
"""The two shapes a verdict is spoken in, and the one version rule both sides share.

Lifted out of the module that reads JoomlArt's download catalog, because this skill reads a
site instead and has no business carrying five hundred lines about a catalog it never opens.
The shapes stay identical on purpose: the verdict rules are the same rules whichever way a
site was read, and a second definition of what a product row looks like is how they quietly
stop being the same.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class OwnedProduct:
    title: str            # verbatim from the catalog
    product: str          # normalised name
    kind: str             # template | framework | extension
    last_download: str    # ISO date
    j6: str               # available | planned | none | discontinued | unknown
    j6_source: str        # catalog | declared | none
    j6_note: str


@dataclass(frozen=True)
class SiteProfile:
    user_id: int
    email: str
    domain: str
    joomla_version: str
    version_measured_at: str
    products: list[OwnedProduct] = field(default_factory=list)
    unseen: list[str] = field(default_factory=list)
    #: What the verdict was computed over, in words. The rules in verdict.py are worth reusing
    #: across every way of reading a site; the sentences are not. Read from JoomlArt's catalog
    #: these are products on an account and third-party extensions are invisible; read from the
    #: site itself they are the extensions installed on it and third-party is exactly what is
    #: covered. Defaults keep the catalog wording, so the internal report is unchanged.
    #: Spelled out at both counts rather than pluralised by rule. Appending "s" to the phrase
    #: reads fine for "JoomlArt product" and produced "the 4 extension installed on this sites"
    #: the first time a longer one was used.
    scope_one: str = "JoomlArt product on this account"
    scope_many: str = "JoomlArt products on this account"
    scope_limit: str = "It does not cover third-party extensions, which we could not see."
    #: The one PHP change this site needs before its next hop, in words, or empty when there
    #: is nothing to ask. Empty by default: a read that never saw a PHP version says nothing
    #: rather than guessing, and a blank line is the honest rendering of not knowing.
    php_note: str = ""
    #: How many upgrades stand between this site and Joomla 6, when that could be worked out.
    #: None means it could not, and the verdict then falls back to reasoning from the major
    #: alone. A Joomla 5.2 site is two upgrades away and looks like one to anybody counting
    #: majors, which is exactly the reader this number exists for.
    hops_to_six: int | None = None


def joomla_major(version: str) -> int | None:
    """The major number, or None when the string is not a measurement.

    Shared with the verdict so both agree on what counts as knowing the version. "3.x"
    counts: it says Joomla 3. "4+" does not: it says somebody could not tell, and it
    was reaching customers as though it were a reading.
    """
    head = (version or "").strip().split(".")[0]
    return int(head) if head.isdigit() else None
