// Owner's decision (this branch), translated from the original: "when a key is missing the skill
// should tell the user they have none, and ask them to supply one or choose to skip checking that
// engine" — a missing key gets exactly two
// real choices (supply it, or skip that engine for this run), never a silent skip and never a
// silent fail. These tests pin the pure logic behind that conversation: turning
// `credentials.mjs check`'s printed lines into per-engine status, and turning the user's Q1 answer
// into the declared/skipped/blocked split every later step (grid.json, submit.mjs, local-report.mjs)
// has to agree with.
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM, no type declarations by design
import {
  ENGINES, parseCheckLine, engineStatuses, classifyGaps, resolveDeclaredPlatforms,
  assertRectangularGrid, gapLine,
} from "../scripts/engine-preflight.mjs";

describe("parseCheckLine — mirrors credentials.mjs check()'s six states", () => {
  it("missing", () => {
    expect(parseCheckLine("OPENAI_API_KEY: missing — nothing to check")).toMatchObject({ name: "OPENAI_API_KEY", state: "missing" });
  });
  it("ok", () => {
    expect(parseCheckLine("GEMINI_API_KEY: ok — stored ****FHEQ")).toMatchObject({ name: "GEMINI_API_KEY", state: "ok" });
  });
  it("REJECTED", () => {
    expect(parseCheckLine("OPENAI_API_KEY: REJECTED 401 — the key is wrong, revoked or out of quota")).toMatchObject({ state: "rejected" });
  });
  it("inconclusive (e.g. 429) is NOT the same as rejected", () => {
    expect(parseCheckLine("GEMINI_API_KEY: inconclusive — provider answered 429")).toMatchObject({ state: "inconclusive" });
  });
  it("unreachable is NOT a verdict on the key either", () => {
    expect(parseCheckLine("ANTHROPIC_API_KEY: unreachable (network error) — network, not necessarily the key")).toMatchObject({ state: "unreachable" });
  });
  it("MENTION_NETWORK_KEY's 'not probed here' line", () => {
    expect(parseCheckLine("MENTION_NETWORK_KEY: stored ****abcd — not probed here; P1 verifies it against the MCP")).toMatchObject({ state: "not-probed" });
  });
  it("a blank/unparseable line returns null instead of throwing", () => {
    expect(parseCheckLine("")).toBeNull();
  });
});

describe("engineStatuses — a key check() never mentioned reads as missing, not unknown", () => {
  it("maps all 4 engines from their keys, defaulting anything absent from the lines to missing", () => {
    const statuses = engineStatuses(["OPENAI_API_KEY: ok — stored ****a91f"]);
    expect(statuses.chatgpt).toMatchObject({ key: "OPENAI_API_KEY", state: "ok" });
    expect(statuses.claude).toMatchObject({ key: "ANTHROPIC_API_KEY", state: "missing" });
    expect(statuses.gemini).toMatchObject({ key: "GEMINI_API_KEY", state: "missing" });
    expect(statuses.google_ai_mode).toMatchObject({ key: "SERPAPI_API_KEY", state: "missing" });
  });

  it("covers exactly the 4 engines, in the routing table's order", () => {
    expect(ENGINES.map((e) => e.engine)).toEqual(["chatgpt", "claude", "gemini", "google_ai_mode"]);
  });
});

describe("classifyGaps — retry states are not the same conversation as gap states", () => {
  it("puts missing/rejected in gaps (need a Q1 decision) and inconclusive/unreachable in retry", () => {
    const statuses = {
      chatgpt: { key: "OPENAI_API_KEY", state: "missing" },
      claude: { key: "ANTHROPIC_API_KEY", state: "rejected" },
      gemini: { key: "GEMINI_API_KEY", state: "inconclusive" },
      google_ai_mode: { key: "SERPAPI_API_KEY", state: "unreachable" },
    };
    const { gaps, retry } = classifyGaps(statuses);
    expect(gaps.map((g) => g.engine).sort()).toEqual(["chatgpt", "claude"]);
    expect(retry.map((g) => g.engine).sort()).toEqual(["gemini", "google_ai_mode"]);
  });

  it("an ok engine is neither a gap nor a retry", () => {
    const { gaps, retry } = classifyGaps({ chatgpt: { key: "OPENAI_API_KEY", state: "ok" } });
    expect(gaps).toHaveLength(0);
    expect(retry).toHaveLength(0);
  });
});

const readyStatuses = {
  chatgpt: { key: "OPENAI_API_KEY", state: "ok" },
  claude: { key: "ANTHROPIC_API_KEY", state: "ok" },
  gemini: { key: "GEMINI_API_KEY", state: "missing" },
  google_ai_mode: { key: "SERPAPI_API_KEY", state: "missing" },
};

describe("resolveDeclaredPlatforms — the Q1 decision, made explicit", () => {
  it("an ok engine declares itself with no decision needed", () => {
    const { declared } = resolveDeclaredPlatforms({ statuses: readyStatuses, decisions: {} });
    expect(declared.sort()).toEqual(["chatgpt", "claude"]);
  });

  it("a gap engine with NO decision yet is blocked, never silently declared and never silently dropped", () => {
    const { declared, skipped, blocked } = resolveDeclaredPlatforms({ statuses: readyStatuses, decisions: {} });
    expect(declared).not.toContain("gemini");
    expect(skipped.map((s) => s.engine)).not.toContain("gemini");
    expect(blocked.map((b) => b.engine)).toContain("gemini");
  });

  it("'skip' turns a gap into a declared skip, carrying a reason for the report", () => {
    const { skipped, blocked } = resolveDeclaredPlatforms({
      statuses: readyStatuses,
      decisions: { gemini: "skip", google_ai_mode: "skip" },
    });
    expect(blocked).toHaveLength(0);
    const gemini = skipped.find((s) => s.engine === "gemini");
    expect(gemini).toBeDefined();
    expect(gemini!.reason).toMatch(/skipped by the user at Q1/);
  });

  it("SERPAPI_API_KEY's skip reason can be overridden — this is the ONLY route to google_ai_mode, worth saying explicitly", () => {
    const { skipped } = resolveDeclaredPlatforms({
      statuses: readyStatuses,
      decisions: { google_ai_mode: "skip", google_ai_modeReason: "no SERPAPI_API_KEY — the only route to this engine, user declined to sign up" },
    });
    expect(skipped[0].reason).toMatch(/only route to this engine/);
  });

  it("'include' on a NOT-ok engine is refused, not honored — forcing it in is exactly the silent hole this file exists to stop", () => {
    const { declared, blocked } = resolveDeclaredPlatforms({
      statuses: readyStatuses,
      decisions: { gemini: "include" },
    });
    expect(declared).not.toContain("gemini");
    const g = blocked.find((b) => b.engine === "gemini");
    expect(g).toBeDefined();
    expect(g!.reason).toMatch(/not ok/);
  });

  it("an explicit skip on an OK engine is still honored — skipping is always the user's call", () => {
    const { declared, skipped } = resolveDeclaredPlatforms({
      statuses: readyStatuses,
      decisions: { chatgpt: "skip" },
    });
    expect(declared).not.toContain("chatgpt");
    expect(skipped.map((s) => s.engine)).toContain("chatgpt");
  });
});

describe("assertRectangularGrid — the backend's integrity rule, checked locally first", () => {
  const declaredPlatforms = ["gemini", "google_ai_mode"];
  const declaredIntents = ["where_to_buy", "cheapest"];
  const completeCells = [
    { platformSlug: "gemini", intentSlug: "where_to_buy" },
    { platformSlug: "gemini", intentSlug: "cheapest" },
    { platformSlug: "google_ai_mode", intentSlug: "where_to_buy" },
    { platformSlug: "google_ai_mode", intentSlug: "cheapest" },
  ];

  it("a complete declared grid is ok with no holes", () => {
    const r = assertRectangularGrid(completeCells, { declaredPlatforms, declaredIntents });
    expect(r).toMatchObject({ ok: true, holes: [], extraPlatforms: [], extraIntents: [] });
  });

  it("a missing cell for a declared platform × intent is a hole", () => {
    const missingOne = completeCells.slice(0, 3); // drop google_ai_mode × cheapest
    const r = assertRectangularGrid(missingOne, { declaredPlatforms, declaredIntents });
    expect(r.ok).toBe(false);
    expect(r.holes).toEqual([{ platform: "google_ai_mode", intent: "cheapest" }]);
  });

  it("a cell for a SKIPPED engine reappearing is caught as extraPlatforms, not silently accepted", () => {
    // The exact bug the whole feature exists to prevent: chatgpt was skipped at Q1 (never
    // declared), but a stray cell for it shows up in cells/ anyway — collected by mistake, or left
    // over from a resumed run that changed its declared set.
    const withStray = [...completeCells, { platformSlug: "chatgpt", intentSlug: "where_to_buy" }];
    const r = assertRectangularGrid(withStray, { declaredPlatforms, declaredIntents });
    expect(r.ok).toBe(false);
    expect(r.extraPlatforms).toEqual(["chatgpt"]);
  });

  it("a cell for an undeclared intent is caught as extraIntents", () => {
    const withStray = [...completeCells, { platformSlug: "gemini", intentSlug: "free_shipping" }];
    const r = assertRectangularGrid(withStray, { declaredPlatforms, declaredIntents });
    expect(r.ok).toBe(false);
    expect(r.extraIntents).toEqual(["free_shipping"]);
  });
});

describe("gapLine — the wording Q1 actually shows, not a paraphrase reconstructed each run", () => {
  it("offers BOTH real choices: supply it, or skip the engine", () => {
    const line = gapLine({ engine: "gemini", key: "GEMINI_API_KEY", state: "missing" });
    expect(line).toMatch(/Supply it now/);
    expect(line).toMatch(/skip gemini for this run/);
  });

  it("names SERPAPI_API_KEY as the ONLY route to google_ai_mode, explicitly — not one of several", () => {
    const line = gapLine({ engine: "google_ai_mode", key: "SERPAPI_API_KEY", state: "missing" });
    expect(line).toMatch(/ONLY route to google_ai_mode/);
    expect(line).toMatch(/no alternative engine to fall back to/);
  });

  it("a REJECTED key is described as rejected, not as merely absent", () => {
    const line = gapLine({ engine: "chatgpt", key: "OPENAI_API_KEY", state: "rejected" });
    expect(line).toMatch(/was rejected/);
  });
});
