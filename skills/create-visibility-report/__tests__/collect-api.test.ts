// F: `webSearchUsed` must only be true when a search genuinely RETURNED, matching the invariant
// SKILL.md states at "Web search must actually run for every cell" and the warning at
// collect-api.mjs's Anthropic section ("a `server_tool_use` block proves the model asked; only a
// result block proves it was answered"). Before this fix, OpenAI counted every `web_search_call`
// regardless of `status` and Gemini counted a query the moment it was ISSUED
// (`webSearchQueries.length > 0`) even with zero `groundingChunks` back — both let a cell claim
// grounding it never received. Anthropic already got this right (`searchesReturned`), so these
// tests pin OpenAI and Gemini to the same standard.
//
// C: `--timeout-ms` did not exist before this fix — `parseArgs` silently dropped it (RECOVERY.md
// and SKILL.md told the user to raise a flag that was thrown away), and `fetchWithRetry` passed no
// `AbortSignal`, so a hung provider hung the cell forever. These tests pin the flag's parsing and
// the retry helper's timeout behavior.
import { describe, it, expect, vi } from "vitest";
// @ts-expect-error — plain ESM, no type declarations by design
import {
  parseArgs, parseOpenAI, parseGemini, parseAnthropic, fetchWithRetry, DEFAULT_TIMEOUT_MS,
} from "../scripts/collect-api.mjs";

describe("parseArgs — --timeout-ms", () => {
  it("parses --timeout-ms into timeoutMs", () => {
    const out = parseArgs(["--provider", "openai", "--model", "gpt-5.5", "--timeout-ms", "45000"]);
    expect(out.timeoutMs).toBe("45000");
  });

  it("defaults timeoutMs to null when not passed, so main() can apply DEFAULT_TIMEOUT_MS", () => {
    const out = parseArgs(["--provider", "openai", "--model", "gpt-5.5"]);
    expect(out.timeoutMs).toBeNull();
  });

  it("still parses every other known flag alongside --timeout-ms", () => {
    const out = parseArgs([
      "--provider", "anthropic", "--model", "claude-sonnet-5", "--intent", "where_to_buy",
      "--platform", "claude", "--out", "cells/x.json", "--timeout-ms", "9000",
    ]);
    expect(out).toMatchObject({
      provider: "anthropic", model: "claude-sonnet-5", intent: "where_to_buy",
      platform: "claude", out: "cells/x.json", timeoutMs: "9000",
    });
  });
});

describe("DEFAULT_TIMEOUT_MS", () => {
  it("is a positive, documented default (120s)", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120_000);
  });
});

describe("fetchWithRetry — timeout", () => {
  it("aborts a hung request instead of waiting forever, and surfaces a timeout error", async () => {
    // A fetch that never settles is exactly the "hung provider" case #C exists to fix: no
    // AbortSignal meant this awaited indefinitely before the fix.
    const hangingFetch = vi.fn((_url: string, init: any) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    await expect(
      fetchWithRetry("https://example.test", {}, {
        fetchImpl: hangingFetch, timeoutMs: 5, retries: 0, sleepImpl: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/timed out/);
  });

  it("passes an AbortSignal on every attempt so a real fetch implementation can honor it", async () => {
    const okFetch = vi.fn((_url: string, init: any) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve({ status: 200, headers: { get: () => null } });
    });
    await fetchWithRetry("https://example.test", {}, { fetchImpl: okFetch, timeoutMs: 1000 });
    expect(okFetch).toHaveBeenCalledTimes(1);
  });
});

describe("parseOpenAI — webSearchUsed requires a COMPLETED search", () => {
  it("is false when the only web_search_call never completed (in_progress)", () => {
    const body = {
      output: [
        { type: "web_search_call", status: "in_progress", action: { query: "buy widget" } },
        { type: "message", content: [{ text: "I searched but here is my answer." }] },
      ],
    };
    expect(parseOpenAI(body, "gpt-5.5").webSearchUsed).toBe(false);
  });

  it("is false when the search failed", () => {
    const body = {
      output: [
        { type: "web_search_call", status: "failed" },
        { type: "message", content: [{ text: "Answer from memory." }] },
      ],
    };
    expect(parseOpenAI(body, "gpt-5.5").webSearchUsed).toBe(false);
  });

  it("is true when a web_search_call completed", () => {
    const body = {
      output: [
        { type: "web_search_call", status: "completed", action: { query: "buy widget" } },
        { type: "message", content: [{ text: "You can buy it at Acme." }] },
      ],
    };
    expect(parseOpenAI(body, "gpt-5.5").webSearchUsed).toBe(true);
  });

  it("is still true from citations alone, even without a completed call recorded", () => {
    const body = {
      output: [
        {
          type: "message",
          content: [{ text: "Acme sells it.", annotations: [{ type: "url_citation", url: "https://acme.test/p" }] }],
        },
      ],
    };
    expect(parseOpenAI(body, "gpt-5.5").webSearchUsed).toBe(true);
  });
});

describe("parseGemini — webSearchUsed requires grounding CHUNKS, not just an issued query", () => {
  it("is false when a query was issued but no groundingChunks came back", () => {
    const body = {
      candidates: [{
        content: { parts: [{ text: "Here is an answer." }] },
        groundingMetadata: { webSearchQueries: ["buy widget"], groundingChunks: [] },
      }],
    };
    expect(parseGemini(body, "gemini-3.6-flash").webSearchUsed).toBe(false);
  });

  it("is true when groundingChunks came back", () => {
    const body = {
      candidates: [{
        content: { parts: [{ text: "Acme sells it." }] },
        groundingMetadata: {
          webSearchQueries: ["buy widget"],
          groundingChunks: [{ web: { uri: "https://acme.test/p", title: "Acme" } }],
        },
      }],
    };
    expect(parseGemini(body, "gemini-3.6-flash").webSearchUsed).toBe(true);
  });

  it("is false with no grounding metadata at all", () => {
    const body = { candidates: [{ content: { parts: [{ text: "Answer from memory." }] } }] };
    expect(parseGemini(body, "gemini-3.6-flash").webSearchUsed).toBe(false);
  });
});

describe("parseAnthropic — webSearchUsed requires a RETURNED result (unchanged reference behavior)", () => {
  it("is false when the server refused the search (max_uses_exceeded) even though the model asked", () => {
    const body = {
      content: [
        { type: "server_tool_use", name: "web_search", input: { query: "buy widget" } },
        { type: "text", text: "Answer without fresh data." },
      ],
      stop_reason: "end_turn",
    };
    expect(parseAnthropic(body, "claude-sonnet-5").webSearchUsed).toBe(false);
  });

  it("is true when a web_search_tool_result actually returned (even an empty array)", () => {
    const body = {
      content: [
        { type: "server_tool_use", name: "web_search", input: { query: "buy widget" } },
        { type: "web_search_tool_result", content: [] },
        { type: "text", text: "Answer." },
      ],
      stop_reason: "end_turn",
    };
    expect(parseAnthropic(body, "claude-sonnet-5").webSearchUsed).toBe(true);
  });
});
