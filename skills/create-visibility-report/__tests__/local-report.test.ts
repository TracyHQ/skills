// Owner's decision (this branch), translated from the original: "this skill will run in full on
// the local machine, the MCP backend is only there to store" — collection, detection and analysis
// complete locally and produce a local artifact BEFORE
// the MCP is ever touched for submission. Two invariants this file's tests exist to pin:
//   1. The report states the real denominator ("2 of 4 engines") plainly, in the body — never a
//      footnote tacked onto a claim of full coverage.
//   2. A skipped engine can never reappear as an empty/zero row: it is simply not IN the cells this
//      report renders from, because it was never declared and never collected (SKILL.md design
//      contract 5 / engine-preflight.mjs). These tests build cells for the declared engines only,
//      the same shape P4 actually produces, and check the skipped ones never leak into the table.
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM, no type declarations by design
import { coverageLine, cellVerdict, renderReportMarkdown, ALL_ENGINES } from "../scripts/local-report.mjs";

describe("coverageLine — the real denominator, stated plainly", () => {
  it("full coverage: no 'Not measured' clause at all", () => {
    const line = coverageLine({ declaredPlatforms: ALL_ENGINES, skipped: [] });
    expect(line).toBe("Measured 4 of 4 engines: chatgpt, claude, gemini, google_ai_mode.");
    expect(line).not.toMatch(/Not measured/);
  });

  it("partial coverage names the denominator AND why each missing engine is missing — never a bare count", () => {
    const line = coverageLine({
      declaredPlatforms: ["gemini", "google_ai_mode"],
      skipped: [
        { engine: "chatgpt", reason: "no OPENAI_API_KEY — skipped by the user at Q1" },
        { engine: "claude", reason: "ANTHROPIC_API_KEY rejected — skipped by the user at Q1" },
      ],
    });
    expect(line).toMatch(/^Measured 2 of 4 engines: gemini, google_ai_mode\./);
    expect(line).toMatch(/Not measured: chatgpt \(no OPENAI_API_KEY/);
    expect(line).toMatch(/claude \(ANTHROPIC_API_KEY rejected/);
  });

  it("an undeclared engine with no matching skipped entry still gets a real (generic) reason, never silence", () => {
    const line = coverageLine({ declaredPlatforms: ["gemini"], skipped: [] });
    expect(line).toMatch(/chatgpt \(not declared this run\)/);
  });
});

describe("cellVerdict — a plain readout of detection, not a computed score", () => {
  it("target flagged: reports its position, not just 'mentioned'", () => {
    const cell = {
      platformSlug: "gemini", intentSlug: "where_to_buy",
      detection: { merchants: [
        { name: "Noon", position: 1, isTargetShop: false },
        { name: "Acme Beauty", position: 2, isTargetShop: true },
      ] },
    };
    const v = cellVerdict(cell);
    expect(v).toMatchObject({ hasDetection: true, targetMentioned: true, targetPosition: 2, merchantCount: 2 });
  });

  it("target never mentioned: targetPosition stays null, not 0 or a fabricated rank", () => {
    const cell = {
      platformSlug: "gemini", intentSlug: "where_to_buy",
      detection: { merchants: [{ name: "Noon", position: 1, isTargetShop: false }] },
    };
    const v = cellVerdict(cell);
    expect(v).toMatchObject({ targetMentioned: false, targetPosition: null });
  });

  it("no detection at all: hasDetection is false, distinct from 'analyzed and not found'", () => {
    const v = cellVerdict({ platformSlug: "gemini", intentSlug: "where_to_buy" });
    expect(v.hasDetection).toBe(false);
    expect(v.targetMentioned).toBe(false);
  });

  it("topMerchants is sorted by first-appearance position and capped at 3", () => {
    const cell = {
      platformSlug: "gemini", intentSlug: "where_to_buy",
      detection: { merchants: [
        { name: "D", position: 4 }, { name: "B", position: 2 },
        { name: "A", position: 1 }, { name: "C", position: 3 },
      ] },
    };
    const v = cellVerdict(cell);
    expect(v.topMerchants.map((m: any) => m.name)).toEqual(["A", "B", "C"]);
  });
});

describe("renderReportMarkdown — the local artifact", () => {
  const meta = {
    shop: { name: "Acme Beauty" }, product: { title: "Snail Mucin Essence" },
    locationCountry: "SA", language: "ar",
  };
  const cells = [
    { platformSlug: "gemini", intentSlug: "where_to_buy", detection: { merchants: [{ name: "Acme Beauty", position: 1, isTargetShop: true }] } },
    { platformSlug: "google_ai_mode", intentSlug: "where_to_buy", detection: { merchants: [{ name: "Noon", position: 1, isTargetShop: false }] } },
  ];

  it("includes the coverage line so the denominator is visible without opening state.json", () => {
    const md = renderReportMarkdown({
      meta, cells, declaredPlatforms: ["gemini", "google_ai_mode"],
      skipped: [
        { engine: "chatgpt", reason: "no OPENAI_API_KEY — skipped by the user at Q1" },
        { engine: "claude", reason: "no ANTHROPIC_API_KEY — skipped by the user at Q1" },
      ],
    });
    expect(md).toMatch(/Measured 2 of 4 engines: gemini, google_ai_mode\./);
  });

  it("a skipped engine never appears as a grid row — it has no cells to render, by construction", () => {
    const md = renderReportMarkdown({
      meta, cells, declaredPlatforms: ["gemini", "google_ai_mode"],
      skipped: [{ engine: "chatgpt", reason: "no key" }, { engine: "claude", reason: "no key" }],
    });
    const tableSection = md.slice(md.indexOf("| Intent |"));
    expect(tableSection).not.toMatch(/\bchatgpt\b/);
    expect(tableSection).not.toMatch(/\bclaude\b/);
  });

  it("no submission yet: says so plainly and disclaims a score rather than inventing one", () => {
    const md = renderReportMarkdown({ meta, cells, declaredPlatforms: ["gemini", "google_ai_mode"], skipped: [] });
    expect(md).toMatch(/Not submitted to Mention Network/);
    expect(md).toMatch(/no official score or verdict/);
  });

  it("submitted: names the checkRunId/reportId and defers the official score to the hosted report", () => {
    const md = renderReportMarkdown({
      meta, cells, declaredPlatforms: ["gemini", "google_ai_mode"], skipped: [],
      submission: { checkRunId: "run_123", reportId: "rep_456" },
    });
    expect(md).toMatch(/Submitted to Mention Network/);
    expect(md).toMatch(/run_123/);
    expect(md).toMatch(/rep_456/);
    expect(md).toMatch(/official score/);
  });

  it("target position renders as a rank, not-listed reads as prose, and un-analyzed cells are labeled distinctly", () => {
    const md = renderReportMarkdown({ meta, cells, declaredPlatforms: ["gemini", "google_ai_mode"], skipped: [] });
    expect(md).toMatch(/#1/); // Acme Beauty flagged at position 1 in the gemini cell
    expect(md).toMatch(/not listed/); // google_ai_mode cell never flags the target
  });
});
