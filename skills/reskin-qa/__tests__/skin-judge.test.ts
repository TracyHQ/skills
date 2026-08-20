// The skin comparison's whole risk is false failure. A dressed page legitimately differs
// from the demo in every word, every photograph and often in item count — so a rule that is
// even slightly too strict produces a wall of noise, and the next person turns the gate off
// rather than reading it. That already happened once to the responsive tier (16 false
// failures, all from comparing absolute column counts).
//
// These cases are therefore mostly about what must NOT fail.
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM, no type declarations by design
import { paletteCarryOver, judgeSkin, pairPages, PALETTE_FLOOR } from "../scripts/skin-judge.mjs";

const c = (rgb: number[], share: number) => ({ rgb, share });

describe("paletteCarryOver", () => {
  it("counts a colour as carried wherever it appears, not at the same rank", () => {
    // A client whose photography is darker shifts every share without losing a colour.
    const ref = [c([255, 255, 255], 0.5), c([16, 32, 64], 0.3), c([224, 64, 32], 0.2)];
    const own = [c([16, 32, 64], 0.6), c([224, 64, 32], 0.25), c([255, 255, 255], 0.15)];
    expect(paletteCarryOver(ref, own).carried).toBe(1);
  });

  it("tolerates a theme's own tint variants", () => {
    const ref = [c([224, 64, 32], 1)];
    expect(paletteCarryOver(ref, [c([200, 40, 60], 1)]).carried).toBe(1);
  });

  it("does not accept a different brand colour as the same one", () => {
    const ref = [c([224, 64, 32], 1)];
    const { carried, missing } = paletteCarryOver(ref, [c([32, 64, 224], 1)]);
    expect(carried).toBe(0);
    expect(missing).toHaveLength(1);
  });

  it("weighs by painted area, so losing the background matters more than losing an accent", () => {
    const ref = [c([255, 255, 255], 0.8), c([224, 64, 32], 0.2)];
    expect(paletteCarryOver(ref, [c([255, 255, 255], 1)]).carried).toBeCloseTo(0.8);
    expect(paletteCarryOver(ref, [c([224, 64, 32], 1)]).carried).toBeCloseTo(0.2);
  });

  it("passes trivially when the demo has no palette to carry", () => {
    expect(paletteCarryOver([], []).carried).toBe(1);
  });
});

describe("judgeSkin", () => {
  const demo = {
    palette: [c([255, 255, 255], 0.5), c([16, 32, 64], 0.3), c([224, 64, 32], 0.2)],
    fontFamily: "Inter",
    headingRatio: 2.5,
    bands: [66, 100],
  };
  const dressed = { ...demo, palette: [...demo.palette] };
  const run = (sig: any) => judgeSkin({ sig, ref: demo, viewport: "desktop", path: "/" });

  it("says nothing about a dressing that landed", () => {
    expect(run(dressed)).toEqual([]);
  });

  it("fails a page that lost its stylesheet", () => {
    // The failure a geometry gate passes with a clean sheet: boxes are fine, the page is
    // white and Times New Roman.
    const bare = { palette: [c([255, 255, 255], 1)], fontFamily: "Times New Roman", headingRatio: 2, bands: [100] };
    const findings = run(bare);
    const fails = findings.filter((f: any) => f.level === "FAIL");
    expect(fails).toHaveLength(3);
    expect(fails.map((f: any) => f.what.split(":")[0])).toEqual(["palette", "type", "layout"]);
  });

  it("holds the palette floor where it was set", () => {
    // 60%: a correct dressing whose photography differs wholesale still carries chrome,
    // headings, buttons and background — well over half the painted weight.
    expect(PALETTE_FLOOR).toBe(0.6);
    // white 0.5 + red 0.2 = 0.7 of the demo's painted weight carried -> warn, not fail.
    const mostly = { ...dressed, palette: [c([255, 255, 255], 0.7), c([224, 64, 32], 0.3)] };
    expect(run(mostly).filter((f: any) => f.level === "FAIL")).toEqual([]);
    expect(run(mostly)[0].level).toBe("warn");
    // Only the accent carried -> 0.2 of the weight -> fail.
    const bare = { ...dressed, palette: [c([224, 64, 32], 1)] };
    expect(run(bare)[0]).toMatchObject({ level: "FAIL" });
  });

  it("does not fail a page for using more container bands than the demo", () => {
    // The dress may add a full-bleed section the demo never had; what it may not do is lose
    // the demo's own wrapper.
    expect(run({ ...dressed, bands: [50, 66, 100] })).toEqual([]);
  });

  it("fails only when every constrained band is gone, not when one is", () => {
    // Every template has a full-bleed 100% band, so a page whose wrapper vanished still
    // shares that one with the demo — judging "did any band survive" would make the failure
    // unreachable. One of two containers missing is a warn; all of them missing is the
    // wrapper being gone.
    const wide = { ...demo, bands: [50, 66, 100] };
    const partial = judgeSkin({ sig: { ...dressed, bands: [66, 100] }, ref: wide, viewport: "desktop", path: "/" });
    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({ level: "warn" });
    expect(partial[0].what).toMatch(/container band\(s\) 50% from the demo are unused/);

    const gone = run({ ...dressed, bands: [100] });
    expect(gone[0]).toMatchObject({ level: "FAIL" });
    expect(gone[0].what).toMatch(/every section runs full width, so the wrapper is gone/);
  });

  it("lets a type scale drift within the band content can move it", () => {
    expect(run({ ...dressed, headingRatio: 2.9 })).toEqual([]);
    expect(run({ ...dressed, headingRatio: 3.3 })[0]).toMatchObject({ level: "warn" });
  });

  it("says nothing about type when either side did not measure it", () => {
    expect(run({ ...dressed, fontFamily: null, headingRatio: null })).toEqual([]);
  });
});

describe("pairPages", () => {
  it("pairs by position, because only the mapping knows /features became /what-we-do", () => {
    const { pairs } = pairPages(["/", "/features"], ["/", "/what-we-do"]);
    expect(pairs).toEqual([{ ref: "/", own: "/" }, { ref: "/features", own: "/what-we-do" }]);
  });

  it("names what it could not pair on either side rather than dropping it", () => {
    const { pairs, unpaired } = pairPages(["/", "/features", "/pricing"], ["/"]);
    expect(pairs).toHaveLength(1);
    expect(unpaired).toEqual([
      { side: "demo", path: "/features" },
      { side: "demo", path: "/pricing" },
    ]);
  });
});
