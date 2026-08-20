// Every threshold in this toolkit was paid for by a real failure, and until now none of them
// could be checked without rendering a site. `references/qa-scans.md` § "Trusting a gate"
// says a gate you have never seen fail is not trusted — these are the cases where it fails,
// written down so the next person to find a number "inconvenient" has to delete a test that
// names the incident.
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM, no type declarations by design (see qa-judge.mjs's header)
import {
  viewportsFor, parseArgs, parseTiers, splitList,
  judgeVisual, judgeLayout, judgeResponsive, checkReference, judgePixelDiff,
} from "../scripts/qa-judge.mjs";

describe("viewportsFor", () => {
  it("takes the union across tiers and always puts desktop first", () => {
    // Desktop-first is load-bearing, not cosmetic: the responsive tier judges every narrower
    // viewport against this side's OWN desktop layout, so desktop must already be measured.
    const names = viewportsFor(["visual", "layout", "responsive"]).map((v: any) => v.name);
    expect(names).toEqual(["desktop", "laptop", "tablet", "mobile"]);
  });

  it("renders only what a single tier needs, so old callers pay nothing extra", () => {
    expect(viewportsFor(["visual"]).map((v: any) => v.name)).toEqual(["desktop", "tablet", "mobile"]);
    expect(viewportsFor(["layout"]).map((v: any) => v.name)).toEqual(["desktop", "mobile"]);
  });
});

describe("parseArgs", () => {
  const spec = { defaults: { host: "", port: "", variant: "" }, required: ["host"] };

  it("accepts the flags it declares", () => {
    expect(parseArgs(["--host", "a.com", "--variant", "stratum"], spec)).toMatchObject({ host: "a.com", variant: "stratum" });
  });

  it("rejects an unknown flag instead of ignoring it", () => {
    // The incident: `layout-qa.sh --variant x` died on "unknown arg" while `layout-qa.sh`
    // with no variant graded the live site and passed. Both halves are now impossible — the
    // flag exists, and anything misspelt stops the run.
    expect(() => parseArgs(["--host", "a.com", "--varaint", "x"], spec)).toThrow(/unknown flag: --varaint/);
  });

  it("rejects a flag with no value rather than swallowing the next flag", () => {
    expect(() => parseArgs(["--host", "--variant", "x"], spec)).toThrow(/needs a value/);
  });

  it("rejects a missing required flag", () => {
    expect(() => parseArgs(["--variant", "x"], spec)).toThrow(/missing required flag: --host/);
  });

  it("splits comma lists the way every --pages value arrives", () => {
    expect(splitList("/, /pricing ,,/blog/")).toEqual(["/", "/pricing", "/blog/"]);
  });

  it("names an unknown tier", () => {
    expect(() => parseTiers("visual,responsiv")).toThrow(/unknown tier\(s\): responsiv/);
  });
});

describe("judgeVisual", () => {
  const clean = { overflowX: 0, navOverlap: [], edgeBleed: [], textClip: [], brokenImg: [] };

  it("passes a clean page", () => {
    expect(judgeVisual(clean, {})).toEqual([]);
  });

  it("tolerates sub-pixel scroll width but not real overflow", () => {
    expect(judgeVisual({ ...clean, overflowX: 8 }, {})).toEqual([]);
    expect(judgeVisual({ ...clean, overflowX: 9 }, {})[0]).toMatch(/overflow-x=9px/);
  });

  it("reports assets this site's own server answered 4xx for", () => {
    // The hole this closes: a CSS background-image that 404s was invisible to every gate —
    // `document.images` sees only <img>, the text tier only greps href=/src= out of the HTML,
    // and the console filter deliberately drops "Failed to load resource".
    const problems = judgeVisual(clean, { assetErrors: [{ url: "/images/hero.jpg", status: 404 }] });
    expect(problems[0]).toMatch(/asset-404=\/images\/hero\.jpg \(404\)/);
  });

  it("says how many asset failures it did not list", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ url: `/a${i}.jpg`, status: 404 }));
    expect(judgeVisual(clean, { assetErrors: many })[0]).toMatch(/\(\+3\)$/);
  });

  it("reports a menu that will not open", () => {
    expect(judgeVisual(clean, { interaction: ["nav toggler opens nothing (12 links before, 12 after)"] })[0])
      .toMatch(/interaction: nav toggler opens nothing/);
  });
});

describe("judgeLayout", () => {
  const clean = { pageHeight: 3000, pageWidthOverflow: 0, overflowCulprits: [], contentMeasure: null, sectionCount: 8, overlaps: [], escapes: [], collapsed: [], media: [] };

  it("passes a clean page", () => {
    expect(judgeLayout(clean)).toEqual([]);
  });

  it("does not fail the real site's own full-bleed layout", () => {
    // 97%, not 92%. The customer's live portfolio page deliberately runs at 93%; the first
    // threshold failed it, and a gate the real site fails is a gate nobody trusts.
    expect(judgeLayout({ ...clean, contentMeasure: { pct: 93, px: 1339, sample: "x" } })).toEqual([]);
    expect(judgeLayout({ ...clean, contentMeasure: { pct: 96, px: 1382, sample: "x" } })).toEqual([]);
    expect(judgeLayout({ ...clean, contentMeasure: { pct: 97, px: 1397, sample: "x" } })[0])
      .toMatch(/content-measure=97%.*not inside any container/);
  });

  it("names the widest offender when the page scrolls sideways", () => {
    // "overflow 300px" is useless without a who.
    const problems = judgeLayout({ ...clean, pageWidthOverflow: 300, overflowCulprits: [{ el: "div.hero", px: 300 }] });
    expect(problems[0]).toMatch(/page-width overflow=300px, culprits: div\.hero\(\+300px\)/);
  });

  it("catches an empty shell that renders 'fine'", () => {
    expect(judgeLayout({ ...clean, pageHeight: 420 })[0]).toMatch(/page-height=420px \(< 500: shell\?\)/);
  });

  it("flags drift only past the calibrated band", () => {
    const base = { pageHeight: 1000, sectionCount: 8 };
    expect(judgeLayout({ ...clean, pageHeight: 1250 }, { baseline: base })).toEqual([]);
    expect(judgeLayout({ ...clean, pageHeight: 1260 }, { baseline: base })[0]).toMatch(/height-drift 1000→1260px \(26%\)/);
    // Section drift is judged independently of height: a section can vanish while the page
    // stays the same length, which is precisely the case a height check alone would pass.
    expect(judgeLayout({ ...clean, pageHeight: 1000, sectionCount: 7 }, { baseline: base }))
      .toEqual(["section-drift 8→7"]);
  });
});

describe("judgeResponsive", () => {
  const block = (cols: number, extra = {}) => ({ visible: true, cols, headingPx: 32, hOverflow: false, ...extra });
  const sig = (blocks: any, chrome: any = {}) => ({ hasViewportMeta: true, blocks, chrome });

  it("does not fail a customer with four pricing tiers against a demo with three", () => {
    // The 16 false failures. Column counts are driven by ITEM COUNT, so comparing them
    // absolutely is noise. What must match is the FOLD RHYTHM: each side measured against
    // its own desktop state. Demo 3→1 at mobile, client 4→1 at mobile: both collapsed.
    const reference = { blocks: { "acm-pricing|desktop": block(3), "acm-pricing|mobile": block(1) } };
    const collected = { blocks: { "acm-pricing|desktop": block(4) } };
    const findings = judgeResponsive({
      sig: sig({ "acm-pricing": block(1) }), reference, collected, viewport: "mobile", path: "/pricing",
    });
    expect(findings).toEqual([]);
  });

  it("fails a block that refuses to collapse the way the demo's does", () => {
    const reference = { blocks: { "acm-pricing|desktop": block(3), "acm-pricing|mobile": block(1) } };
    const collected = { blocks: { "acm-pricing|desktop": block(4) } };
    const findings = judgeResponsive({
      sig: sig({ "acm-pricing": block(4) }), reference, collected, viewport: "mobile", path: "/pricing",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: "FAIL" });
    expect(findings[0].what).toMatch(/still 4 columns at mobile; demo collapses 3→1/);
  });

  it("judges a block against ITS OWN page's desktop layout, not another page's", () => {
    // Trap 50's second half. The same block type is laid out differently on different pages —
    // three cards on the home page, two on a landing page. Keying the desktop baseline by
    // type alone judges page B's fold against page A's desktop state, comparing two things
    // that were never the same shape. Here /landing shows 2 columns at desktop and still 2 at
    // mobile: it has NOT collapsed, and must fail even though the home page's 3 would make
    // the same number look like a collapse.
    const reference = { blocks: { "acm-cards|desktop": block(3), "acm-cards|mobile": block(1) } };
    const collected = { blocks: { "acm-cards|desktop": block(3) } }; // from /, seen first
    const pageDesktop = { "/|acm-cards": 3, "/landing|acm-cards": 2 };
    const findings = judgeResponsive({
      sig: sig({ "acm-cards": block(2) }), reference, collected, pageDesktop,
      viewport: "mobile", path: "/landing",
    });
    expect(findings[0]).toMatchObject({ level: "FAIL" });
    expect(findings[0].what).toMatch(/still 2 columns at mobile/);
    // Without the per-page baseline this reads as 2 < 3, i.e. "collapsed", and passes.
    expect(judgeResponsive({
      sig: sig({ "acm-cards": block(2) }), reference, collected,
      viewport: "mobile", path: "/landing",
    })).toEqual([]);
  });

  it("prefers a page's own desktop count of zero over the cross-page fallback", () => {
    // `??` rather than `||`: a legitimately measured 0 must not fall through to another
    // page's number the way a falsy check would send it.
    const reference = { blocks: { "acm-x|desktop": block(3), "acm-x|mobile": block(1) } };
    const findings = judgeResponsive({
      sig: sig({ "acm-x": block(0, { visible: true }) }),
      reference, collected: { blocks: { "acm-x|desktop": block(3) } },
      pageDesktop: { "/p|acm-x": 0 }, viewport: "mobile", path: "/p",
    });
    expect(findings.filter((f: any) => f.level === "FAIL")).toEqual([]);
  });

  it("fails a nav that stays expanded where the demo folds it", () => {
    const reference = { blocks: {}, chrome: { "header|mobile": { navLinks: 2, toggler: true, hOverflow: false } } };
    const findings = judgeResponsive({
      sig: sig({}, { header: { navLinks: 18, toggler: true, hOverflow: false } }),
      reference, collected: { blocks: {} }, viewport: "mobile", path: "/",
    });
    expect(findings[0]).toMatchObject({ level: "FAIL" });
    expect(findings[0].what).toMatch(/nav shows 18 links at mobile/);
  });

  it("does not blame the dress for behaviour the demo shares", () => {
    const reference = { blocks: { "acm-x|mobile": block(1, { hOverflow: true }) } };
    const findings = judgeResponsive({
      sig: sig({ "acm-x": block(1, { hOverflow: true }) }),
      reference, collected: { blocks: {} }, viewport: "mobile", path: "/",
    });
    expect(findings.filter((f: any) => f.level === "FAIL")).toEqual([]);
  });

  it("treats a block the mapping unpublished as the mapping's right", () => {
    const reference = { blocks: { "acm-x|mobile": block(3) } };
    const findings = judgeResponsive({
      sig: sig({ "acm-x": { visible: false, cols: 0, headingPx: null, hOverflow: false } }),
      reference, collected: { blocks: {} }, viewport: "mobile", path: "/",
    });
    expect(findings).toEqual([]);
  });

  it("fails a page that cannot respond at all", () => {
    const findings = judgeResponsive({
      sig: { hasViewportMeta: false, blocks: {}, chrome: {} },
      reference: { blocks: {} }, collected: { blocks: {} }, viewport: "mobile", path: "/",
    });
    expect(findings[0].what).toMatch(/no <meta name=viewport>/);
  });
});

describe("checkReference", () => {
  it("passes a reference recorded against a different host", () => {
    expect(checkReference({ blocks: { a: 1 }, meta: { host: "demo.example" } }, { host: "client.example", exists: true })).toBeNull();
  });

  it("tells the operator to record one instead of throwing ENOENT", () => {
    // The old script parsed the file one line ABOVE the friendly message, so the message was
    // dead code and a forgotten step produced a stack trace.
    expect(checkReference(null, { host: "x", exists: false })).toMatch(/run --mode reference against the DEMO first/);
  });

  it("refuses a reference recorded against the host being judged", () => {
    // Running --mode reference at the client by mistake overwrote the demo's reference; every
    // compare then passed, forever, silently. `meta.host` was always written and never read.
    expect(checkReference({ blocks: { a: 1 }, meta: { host: "client.example" } }, { host: "client.example", exists: true }))
      .toMatch(/comparing a site to itself always passes/);
  });

  it("refuses an empty reference", () => {
    expect(checkReference({ blocks: {}, meta: {} }, { host: "x", exists: true })).toMatch(/no blocks/);
  });
});

describe("judgePixelDiff", () => {
  it("absorbs render noise and catches real movement", () => {
    // Two renders of an unchanged page differ by ~0.1-0.3% (antialiased text, a lazy image
    // one frame late). Below 0.5% is noise; above it, something moved.
    expect(judgePixelDiff({ changed: 3000, total: 1_000_000, dimsChanged: false, before: {}, after: {} }).ok).toBe(true);
    const bad = judgePixelDiff({ changed: 30_000, total: 1_000_000, dimsChanged: false, before: {}, after: {} });
    expect(bad.ok).toBe(false);
    expect(bad.pct).toBe(3);
  });

  it("reports a size change as its own, louder finding", () => {
    // A percentage over the overlapping region would understate a page that grew a whole
    // missing section back.
    const v = judgePixelDiff({ changed: 0, total: 0, dimsChanged: true, before: { width: 1440, height: 4200 }, after: { width: 1440, height: 900 } });
    expect(v.ok).toBe(false);
    expect(v.pct).toBeNull();
    expect(v.what).toMatch(/page size changed 1440×4200 → 1440×900px/);
  });

  it("honours a caller-supplied threshold", () => {
    expect(judgePixelDiff({ changed: 20_000, total: 1_000_000, dimsChanged: false, before: {}, after: {} }, 5).ok).toBe(true);
  });
});
