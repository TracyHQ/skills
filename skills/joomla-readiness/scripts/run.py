#!/usr/bin/env python3
"""One call, one answer. The engine's front door.

Until this existed, SKILL.md said "run the engine rather than reasoning it out yourself" and
then listed five modules, so every caller composed them by hand:

    load_catalog() -> read_state(...) -> profile_from_state(...) -> decide(...)

Four calls, and three of them take an argument that changes what a customer is told and is
silently optional. `php=` left out makes the report claim PHP was never looked at. `packages=`
left out turns one product into eight unknowns. Nothing raises either way.

That is not a hypothetical: the worked example in `examples/` was first written by hand and got
the PHP advice wrong, in the file whose job is to show the right answer.

So the composition lives here, once, and the caller passes data rather than remembering an
order.

    python3 scripts/run.py reading.json
    cat reading.json | python3 scripts/run.py -

`reading.json` is what the two tools returned, plus the package manifests when a route could
read them:

    {
      "joomla": "5.2.5",
      "php": "8.2",
      "extensions": [ {"name": "K2", "element": "com_k2", "type": "component",
                       "version": "2.11.1", "enabled": true} ],
      "packages":   [ {"name": "Xmap Package", "element": "xmap", "version": "2.3.3",
                       "children": [{"type": "plugin", "element": "com_k2",
                                     "group": "xmap"}]} ]
    }

`php` and `packages` may be absent, and absent is a real answer that the report will state
rather than fill in. Anything else missing is refused: a reading with no `joomla` key is not a
site on an unknown version, it is a caller that forgot a field, and guessing which would put a
verdict in front of a customer that nobody measured.

`--registry FILE` reads the catalog from a file instead of the network, which is how the tests
run offline and how a caller can pin a reading to a crawl they already have.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from catalog import Catalog, load_catalog          # noqa: E402
from site_state import read_state                  # noqa: E402
from upgrade_path import profile_from_state        # noqa: E402
from verdict import decide                         # noqa: E402


def _reading(raw: dict) -> dict:
    """The caller's JSON, checked. Refuses rather than defaults."""
    if not isinstance(raw, dict):
        raise ValueError("the reading must be a JSON object")
    if "joomla" not in raw:
        raise ValueError(
            "no 'joomla' key: a missing version and an unreadable version are different "
            "answers, and only the tool that read the site can tell them apart")
    if not isinstance(raw.get("extensions", []), list):
        raise ValueError("'extensions' must be a list")
    if not isinstance(raw.get("packages", []), list):
        raise ValueError("'packages' must be a list")
    return raw


def run(reading: dict, catalog: Catalog) -> dict:
    """Every step in order, with nothing optional left to memory."""
    reading = _reading(reading)
    state = read_state(version=str(reading.get("joomla") or ""),
                       extensions=reading.get("extensions") or [],
                       registry=catalog.records,
                       packages=reading.get("packages") or None)
    profile = profile_from_state(state, php=str(reading.get("php") or ""))
    v = decide(profile)
    return {
        "level": v.level,
        "headline": v.headline,
        "scope": v.scope_line,
        "blockers": list(v.blockers),
        # The PHP instruction leads, because it is the only step the customer carries out
        # themselves and every other step waits on it. See "The shape of the answer".
        "next_steps": ([profile.php_note] if profile.php_note else []) + list(v.next_steps),
        "not_looked_at": list(profile.unseen),
        "counts": dict(state["counts"]),
        "hops_to_six": profile.hops_to_six,
        # Printed so the answer can say how old its evidence is. A verdict is exactly as fresh
        # as the crawl behind it, and the registry is re-crawled by hand.
        "registry_observed_at": catalog.observed_at,
        "registry_source": catalog.source,
    }


def _main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="One Joomla 6 readiness answer, from one reading.")
    ap.add_argument("reading", help="path to the reading JSON, or - for stdin")
    ap.add_argument("--registry", default="", help="catalog JSON on disk instead of the network")
    args = ap.parse_args(argv)

    text = sys.stdin.read() if args.reading == "-" else Path(args.reading).read_text("utf-8")
    try:
        reading = json.loads(text)
    except ValueError as e:
        print(f"the reading is not JSON: {e}", file=sys.stderr)
        return 2

    if args.registry:
        raw = json.loads(Path(args.registry).read_text("utf-8"))
        catalog = Catalog(records=raw.get("records", raw),
                          observed_at=raw.get("observed_at", ""),
                          source=raw.get("source", "file"))
    else:
        catalog = load_catalog()

    try:
        print(json.dumps(run(reading, catalog), indent=1))
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
