// AGENT_LANE_CONTAMINATION_PATTERN used to include bare `permission` and `denied` alternatives.
// That regex is byte-identical to the backend's own `AGENT_LANE_CONTAMINATION_PATTERN`
// (byok-validate.util.ts) on purpose — the two lanes must catch and pass the same cells or the
// client-side self-check (check-detections.mjs) stops predicting what
// `validate_byok_submission` will actually do server-side. Real incident (#287, R5): a
// `cheapest × claude` cell whose answer opened "WebFetch was denied, so I couldn't open product
// pages for live prices — the answer below is from search results only" was an agent-lane leak
// worth catching. But the bare words also hard-failed ordinary commerce prose that never came
// near a collection tool ("Returns may be denied without a receipt.") with
// `AGENT_LANE_CONTAMINATION`, and RECOVERY.md's only fix for that code is "re-collect the cell" —
// spending quota to reproduce text that was never contaminated. The fix keeps the two words but
// requires tool-refusal CONTEXT around them, so the pattern still catches genuine leakage.
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM, no type declarations by design
import { AGENT_LANE_CONTAMINATION_PATTERN, checkContamination } from "../scripts/check-detections.mjs";

const cellWith = (rawText: string) => ({
  file: "where_to_buy.claude.json",
  cell: { response: { rawText } },
});

describe("AGENT_LANE_CONTAMINATION_PATTERN", () => {
  it("still catches the real incident verbatim", () => {
    const raw =
      "WebFetch was denied, so I couldn't open product pages for live prices — the answer below " +
      "is from search results only, and only one concrete price was confirmed.";
    expect(AGENT_LANE_CONTAMINATION_PATTERN.test(raw)).toBe(true);
  });

  it("catches the Japanese tool-permission phrase", () => {
    const raw = "WebFetchを許可いただければ、公式・楽天・Yahoo!の実売価格を突き合わせて正確な最安値表を出せます。";
    expect(AGENT_LANE_CONTAMINATION_PATTERN.test(raw)).toBe(true);
  });

  it("catches a bare tool name (web_search) mid-answer", () => {
    expect(AGENT_LANE_CONTAMINATION_PATTERN.test("Let me use web_search to check current prices.")).toBe(true);
  });

  it("catches 'permission denied' — permission + denied in tool-refusal context", () => {
    expect(AGENT_LANE_CONTAMINATION_PATTERN.test("Permission denied when I tried to open the product page.")).toBe(true);
  });

  it("catches 'denied access' — the reversed order", () => {
    expect(AGENT_LANE_CONTAMINATION_PATTERN.test("The tool was denied access, so I summarised from memory.")).toBe(true);
  });

  it("catches 'permission to browse/fetch/access/open/visit'", () => {
    expect(AGENT_LANE_CONTAMINATION_PATTERN.test("I don't have permission to browse the web right now.")).toBe(true);
  });

  it("does NOT fail ordinary commerce prose containing 'denied' alone", () => {
    // This is the exact case that used to hard-fail a genuine shopper cell.
    expect(AGENT_LANE_CONTAMINATION_PATTERN.test("Returns may be denied without a receipt.")).toBe(false);
  });

  it("does NOT fail ordinary commerce prose containing 'permission' alone", () => {
    expect(AGENT_LANE_CONTAMINATION_PATTERN.test("Ask the store for permission before reselling.")).toBe(false);
  });

  it("does NOT fail 'denied' followed by something other than permission/access", () => {
    expect(AGENT_LANE_CONTAMINATION_PATTERN.test("Entry to the outlet may be denied after 9pm.")).toBe(false);
  });

  it("does NOT fail a clean shopper answer with neither word", () => {
    expect(AGENT_LANE_CONTAMINATION_PATTERN.test("You can buy it at Noon and Amazon.ae for AED 135.")).toBe(false);
  });
});

describe("checkContamination", () => {
  it("flags the contaminated cell with AGENT_LANE_CONTAMINATION and names the file", () => {
    const out = checkContamination([cellWith("WebFetch was denied, so I couldn't open the page.")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ file: "where_to_buy.claude.json", code: "AGENT_LANE_CONTAMINATION" });
  });

  it("does not flag an ordinary answer that merely mentions returns being denied", () => {
    const out = checkContamination([cellWith("You can buy it at Noon. Returns may be denied without a receipt.")]);
    expect(out).toHaveLength(0);
  });

  it("skips cells with no rawText rather than throwing", () => {
    expect(checkContamination([{ file: "x.json", cell: {} }])).toHaveLength(0);
  });
});
