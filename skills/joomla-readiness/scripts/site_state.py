#!/usr/bin/env python3
"""What a site says about itself, joined to what the registry knows.

The two inputs are the whole point of this module existing. Both are available to anyone with
their own site connected to Tracy, and neither needs anything of JoomlArt's:

    component `info`            -> JVERSION, the core version, exact
    component `extension.list`  -> name, type, element, version, enabled
    registry.tracy.ai/platform  -> 5,604 Joomla extensions with isJ3..isJ6

The readiness report this replaces read JoomlArt's production database and a CSV on one
laptop. It could tell a customer what they had *downloaded*, on a machine only one team could
run. This reads what is *installed*, on anyone's.

## The gap this module is mostly about

The registry is keyed by JED listing slug. A site reports Joomla element names. There is no
shared key, and the mismatch is not small:

    k2            -> com_k2         the slug happens to be the element
    akeeba-backup -> com_akeeba     close, and not equal
    jomsocial     -> com_community  no textual relationship at all

Measured against the live registry on 2026-08-19: of 5,604 Joomla records, only **13% have a
single-word slug** with any chance of equalling an element. The other 87% are reachable, if at
all, through the human name. That is the ceiling this module works under, and it is why the
count of what could not be matched is a headline number rather than a footnote.

One more figure from the same read, because it is the reason this whole layer matters: **59%
of the registry says it has no Joomla 6 build**, against 40% that says it has. Third-party
extensions really are what blocks an upgrade, and the report this replaces could not see a
single one of them.

So this does not try to match everything. It matches what two independent routes can reach,
counts what neither could, and puts that count where nobody can miss it. A report that quietly
drops the half it did not recognise would be worse than one that admits the half.
"""
from __future__ import annotations

import re

CORE, MATCHED, UNRECOGNISED = "core", "matched", "unrecognised"

#: Element prefixes Joomla gives its own extension types. Stripped before comparing to a
#: listing slug, which never carries them.
_TYPE_PREFIXES = ("com_", "mod_", "plg_", "tpl_", "lib_", "pkg_", "file_")


def _squash(text: str) -> str:
    """A name with every separator removed. The same rule the readiness report already uses
    for catalog names, and here for the same reason: two sources spell one product two ways."""
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _strip_type(element: str) -> str:
    low = (element or "").lower()
    for prefix in _TYPE_PREFIXES:
        if low.startswith(prefix):
            return low[len(prefix):]
    return low


#: Marks a key that more than one product answers to, so it can be dropped once the whole
#: registry has been walked rather than guessed at on the way through.
_AMBIGUOUS = object()


def _put(table: dict, key: str, record: dict) -> None:
    if not key:
        return
    table[key] = _AMBIGUOUS if key in table else record


def _index(registry: dict) -> tuple[dict, dict]:
    """Two lookup tables, because there are two routes in and they find different things.

    By slug, `k2` is reachable and `jomsocial` is not. By title, `JomSocial` is reachable.
    Neither route alone covers what a real site holds.
    """
    by_slug, by_title = {}, {}
    for slug, record in registry.items():
        _put(by_slug, _squash(record.get("slug") or slug), record)
        title = record.get("title")
        if title:
            _put(by_title, _squash(title), record)
    # A key two different products answer to is dropped rather than resolved to one of them.
    # Measured on the live registry 2026-08-19: 4 titles and 5 slugs collide, "Count Down"
    # against "Countdown", "Custom CSS" against "CustomCSS", "Backdoor" against "AdminExile".
    # Eight records, 0.2%, and picking whichever was seen first was silent. Rare is not
    # harmless: a wrong verdict is worse than an honest unknown, and "two products answer to
    # this name" is an honest unknown.
    return ({k: v for k, v in by_slug.items() if v is not _AMBIGUOUS},
            {k: v for k, v in by_title.items() if v is not _AMBIGUOUS})


def classify(extension: dict, registry: dict, *, core_version: str,
             index: tuple[dict, dict] | None = None) -> dict:
    """One installed extension: is it core, is it in the registry, and what does it say.

    Core is decided by its version matching the core's. That is the only signal the component
    gives us, and it is wrong in one direction: a third party shipping the same version string
    reads as core. Rare, and the safe way round, because a core row makes no claim at all while
    a wrong lookup would make a false one.
    """
    by_slug, by_title = index if index is not None else _index(registry)
    name = str(extension.get("name") or "")
    element = str(extension.get("element") or "")
    version = str(extension.get("version") or "")

    row = {
        "name": name,
        "element": element,
        "type": str(extension.get("type") or ""),
        "version": version,
        "enabled": bool(extension.get("enabled")),
        "state": UNRECOGNISED,
        "match": None,
        "isJ6": None,
    }

    if core_version and version and version == core_version:
        row["state"] = CORE
        return row

    record = by_slug.get(_squash(_strip_type(element))) or by_title.get(_squash(name))
    if record is None:
        return row

    joomla = (record.get("platformData") or {}).get("joomla") or {}
    row["state"] = MATCHED
    row["match"] = record.get("slug")
    # None rather than False when the registry has the product but says nothing about Joomla 6.
    # "We have no reading" and "it does not support 6" are different answers to a customer.
    row["isJ6"] = joomla.get("isJ6") if "isJ6" in joomla else None
    return row


def read_state(*, version: str, extensions: list, registry: dict) -> dict:
    """The whole picture, with the counts that must never be quiet.

    `version` empty is a real state, not an error: in relay-only mode `list_extensions` works
    but the relay's own capability service says it cannot tell Joomla 4 from 5+, so the core
    stays unanswered while the extensions are still answerable. The report has to say which.
    """
    index = _index(registry)
    rows = [classify(e, registry, core_version=version, index=index) for e in (extensions or [])]

    counts = {
        "total": len(rows),
        "core": sum(1 for r in rows if r["state"] == CORE),
        "matched": sum(1 for r in rows if r["state"] == MATCHED),
        "unrecognised": sum(1 for r in rows if r["state"] == UNRECOGNISED),
    }

    warnings = []
    if not version:
        warnings.append(
            "The Joomla version could not be read, so nothing here is said about the core "
            "itself. Extensions are still answered.")
    if not rows:
        warnings.append(
            "No extensions were read from this site, so this is not a clean bill of health: "
            "it is a report with nothing to work from.")
    if counts["unrecognised"]:
        warnings.append(
            f"{counts['unrecognised']} of {counts['total']} installed extensions are not in "
            "the public registry, so their Joomla 6 status is unknown rather than fine. The "
            "registry is keyed by directory listing and a site reports element names; the two "
            "do not always meet.")

    return {
        "core": {"version": version, "known": bool(version)},
        "extensions": rows,
        "counts": counts,
        "warnings": warnings,
    }
