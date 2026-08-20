// G: `city` (the Q1 answer) never reached any engine — collect-pool.mjs built serpapi args as
// `['--hl', job.hl, '--gl', job.gl, ...common]` and never passed `--location`, which
// collect-serpapi.mjs has always supported. A report stamped "Riyadh" was actually built from
// country-level answers. buildArgs is where that plumbing had to go.
//
// C: every collector's `--timeout-ms` needs to reach it through the pool too, or "raise
// --timeout-ms" (RECOVERY.md) only works for a hand-run single cell, not the grid.
//
// P: collect-pool.mjs used to write `${job.out}.log` — i.e. into cells/ itself — which breaks
// RECOVERY.md's rule that cells/ holds "one <intent>.<platform>.json per cell — nothing else in
// here". logPathFor moves it to a sibling logs/ directory.
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM, no type declarations by design
import { buildArgs, logPathFor, parseArgs } from "../scripts/collect-pool.mjs";

describe("buildArgs — serpapi jobs", () => {
  it("omits --location when the job carries none (country-level default)", () => {
    const args = buildArgs({ route: "serpapi", hl: "ar", gl: "SA", intent: "where_to_buy", out: "cells/x.json" });
    expect(args).not.toContain("--location");
  });

  it("passes --location through when the job carries a city", () => {
    const args = buildArgs({
      route: "serpapi", hl: "ar", gl: "SA", location: "Riyadh", intent: "where_to_buy", out: "cells/x.json",
    });
    const i = args.indexOf("--location");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe("Riyadh");
  });

  it("passes --timeout-ms through for both api and serpapi jobs", () => {
    const apiArgs = buildArgs({
      route: "api", provider: "anthropic", model: "claude-sonnet-5", intent: "where_to_buy",
      out: "cells/x.json", timeoutMs: 90000,
    });
    expect(apiArgs).toEqual(expect.arrayContaining(["--timeout-ms", "90000"]));

    const serpArgs = buildArgs({
      route: "serpapi", hl: "ar", gl: "SA", intent: "where_to_buy", out: "cells/x.json", timeoutMs: 90000,
    });
    expect(serpArgs).toEqual(expect.arrayContaining(["--timeout-ms", "90000"]));
  });
});

describe("logPathFor — pool logs never land inside cells/", () => {
  it("writes to a sibling logs/ directory, not next to the cell file", () => {
    const p = logPathFor("/run/cells/where_to_buy.claude.json");
    expect(p).toBe("/run/logs/where_to_buy.claude.json.log");
    expect(p).not.toContain("/cells/");
  });
});

describe("parseArgs — --grid is required (documented, not silently optional)", () => {
  it("parses --grid and --concurrency", () => {
    const out = parseArgs(["--grid", "run/grid.json", "--concurrency", "api=2,serpapi=3"]);
    expect(out.grid).toBe("run/grid.json");
    expect(out.concurrency).toEqual({ api: 2, serpapi: 3 });
  });

  it("leaves grid null when not passed, so main() throws its documented error", () => {
    expect(parseArgs([]).grid).toBeNull();
  });
});
