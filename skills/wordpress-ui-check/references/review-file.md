# The review file

`review.json` is the review. Everything else — the capture, the screenshots, `review.md` — is
either raw material for it or a rendering of it. Read this before writing anything into it by hand,
and then do not write anything into it by hand: `review.mjs` is the only thing that should.

## Contents

- [Why it is a document and not a report](#why-it-is-a-document-and-not-a-report)
- [Shape](#shape)
- [The five states](#the-five-states)
- [The two fingerprints](#the-two-fingerprints)
- [What a second run does](#what-a-second-run-does)
- [Where it lives](#where-it-lives)

## Why it is a document and not a report

The skill used to finish by writing an HTML page. That page was read once and then it was litter:
it held no record of what the person thought about any of it, so the next run raised every fault
they had already looked at and dismissed, and they had to start again. The work was theirs and the
tool kept none of it.

So the output is a document that accumulates. It knows which findings have been read, what was
decided about each, which pages it measured and what those pages said at the time — which is what
lets a second run cost seconds and ask only about what genuinely changed.

## Shape

```jsonc
{
  "site": "https://juneflower.vn",           // always the live domain, whatever was scanned
  "scannedAgainst": {
    "kind": "preview",                          // "preview" | "live"
    "url": "https://june-a3f.tracy.ai",
    "revision": "a3f19c",                     // null whenever the copy publishes no signal
    "at": "2026-08-21T09:00:00Z",
    "previewTried": "https://june-a3f.tracy.ai" // only on a live fallback: the address that did not answer
  },
  "status": "in_progress",                    // "in_progress" | "closed"
  "reviewedAt": "2026-08-21T09:14:00Z",
  "language": "vi",                           // the language the findings are written in
  "summary": "One paragraph for the owner.",
  "nextId": 12,                               // so an id is never reused after an archive
  "pages": [{ "url": "/gio-hang/", "fingerprint": "sha256:…" }],
  "droppedFromReview": 3,                     // pages the survey had to cut, said out loud
  "fixedCount": 2,                            // proved gone on a later run; the findings are in archive/
  "findings": [
    {
      "id": "f7",                             // stable across runs; what a person refers to
      "fingerprint": "sha256:…",
      "checkId": "image-distorted",           // from references/checks.md
      "kind": "fixed",                        // "fixed" = a named check · "free" = something you noticed
      "severity": "high",                     // high | medium | low, as checks.md defines them
      "page": "/san-pham/hoa-cuoi/",          // a path, so the review survives moving between the two
      "viewport": "desktop",
      "blockIds": ["b12"],                    // what you named
      "selectors": ["main > section:nth-of-type(2) > figure > img"],  // derived, never written by hand
      "rects": [{ "x": 120, "y": 880, "w": 320, "h": 240 }],
      "forOwner": "What a visitor runs into, and what it costs.",
      "forBuilder": "The block, the numbers, the viewport.",
      "state": "new",
      "decidedAt": null
    }
  ]
}
```

`selectors` and `rects` are looked up from the capture by `review.mjs`, from the block ids you
named. Never write either yourself: a selector you invented is a guess about a DOM you did not
measure, and a rectangle in roughly the right place is worse than no rectangle at all.

## The five states

| State | Means | The next run |
|---|---|---|
| `new` | Found, not yet read | Asks |
| `seen` | Read, nothing decided — what "explain this to me" leaves behind | Asks again |
| `saved` | Kept, to be fixed | Does not ask; lists it under "To fix" |
| `ignored` | Not worth fixing | Does not ask, **still counts it** in the overview |
| `fixed` | A later run opened the page and it was gone | Moves it to `archive/`, keeps the count |

`ignored` counting rather than disappearing is deliberate. A fault that vanishes from every total
the moment somebody waves it away turns "skip this" into a trapdoor, and this skill's whole promise
is that nothing unmeasured passes as measured.

## The two fingerprints

**A page fingerprint** is a hash of the page's visible words, taken from raw HTML fetched over
plain HTTP. It has to be cheap enough that re-checking twenty pages costs seconds, which is why it
is never taken from a rendered browser page.

**A finding fingerprint** is a hash of where the finding points — the page path, the check that
fired, the viewport, the css addresses of the blocks, and the first forty characters those blocks
said. Same fingerprint next run means the same finding, so it keeps its id and its state.

That is coarse on purpose. Hashing a whole section's text would resurrect an ignored finding
because somebody fixed a comma three paragraphs below it, and a review that re-asks about settled
things is one nobody finishes twice.

## What a second run does

Three groups come out of the merge:

1. **A fingerprint that was already here** keeps its id and its state. Somebody decided this once.
2. **A finding on a page this run did not open** is carried through untouched. This is what makes
   re-reading three changed pages cost three pages rather than twenty.
3. **A finding that was here, on a page this run did open, and is not here now** was fixed. It
   moves to `archive/<date>/fixed.json` and only its count stays.

Only a page that was actually opened again can prove a finding gone. Treating a page nobody looked
at as evidence of a fix is how a living document starts congratulating people for work they never
did.

## Where it lives

Inside a Tracy site folder, `TracyWork/deliverables/ui-check/`:

```
review.json           the document
review.md             the reading version, rewritten whenever review.json changes
capture/              screenshots and measurements from the most recent scan
archive/<date>/       findings a later run proved gone
```

**One site, one open review** — not a folder per day. A folder per day cannot answer "carry on
where I left off", because nothing says which day is the one still open.

`TracyWork/deliverables/` is the right place and the neighbouring directories are not:
`TracyWork/surface/` and `TracyWork/digest/` are overwritten by every Sync, so a review left in
either is a review that disappears. Standalone, outside a site folder, the same shape goes in
`./wordpress-ui-check/` where the person is working.
