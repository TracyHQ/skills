// SKILL.md "Live data comes from the MCP, never from memory": the live fetch stays authoritative,
// but a fetch failure must degrade to a documented local path rather than stopping the run or
// inventing a value (owner's decision: this skill runs fully locally now, the MCP is a convenience
// when reachable). This is that documented path — a dated copy of the last successful fetch. These
// tests pin the two properties that make it safe to use as a fallback rather than a second source
// of truth: it never answers for a name that was never actually fetched, and it always reports its
// own age so nothing downstream mistakes a cached catalog for a current one.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain ESM, no type declarations by design
import { saveCatalog, loadCatalog, cachePath, ageDescription, KNOWN_CATALOGS } from "../scripts/catalog-cache.mjs";

let dir: string;
let env: Record<string, string>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mn-catalog-cache-"));
  env = { MENTION_NETWORK_CREDENTIALS: join(dir, "credentials") };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("saveCatalog / loadCatalog — round trip", () => {
  it("loadCatalog returns null (not a throw) when nothing was ever cached — the normal first-run case", () => {
    expect(loadCatalog("describe_check_grid", env)).toBeNull();
  });

  it("save then load returns the same data plus a fetchedAt timestamp", () => {
    const data = { intents: ["where_to_buy", "cheapest"], platforms: { chatgpt: "gpt-5.4" } };
    saveCatalog("describe_check_grid", data, env, new Date("2026-08-19T10:00:00Z"));
    const found = loadCatalog("describe_check_grid", env);
    expect(found).not.toBeNull();
    expect(found!.data).toEqual(data);
    expect(found!.fetchedAt).toBe("2026-08-19T10:00:00.000Z");
  });

  it("rejects an unknown catalog name instead of silently caching something nothing will look for", () => {
    expect(() => saveCatalog("list_intents_typo", {}, env)).toThrow(/unknown catalog name/);
  });

  it("every real catalog name P1/P3 fetches is in the allowlist", () => {
    for (const name of ["describe_check_grid", "get_prompt_templates", "get_detect_extraction_spec"]) {
      expect(KNOWN_CATALOGS).toContain(name);
    }
  });

  it("lives beside the credential store, not inside the skill bundle", () => {
    const p = cachePath("describe_check_grid", env);
    expect(p.startsWith(dir)).toBe(true);
    expect(p).toMatch(/catalog-cache[/\\]describe_check_grid\.json$/);
  });
});

describe("ageDescription — every fallback use must say how stale it is", () => {
  const now = new Date("2026-08-20T12:00:00Z");
  it("same day", () => {
    expect(ageDescription("2026-08-20T09:00:00Z", now)).toBe("fetched earlier today");
  });
  it("exactly 1 day", () => {
    expect(ageDescription("2026-08-19T12:00:00Z", now)).toBe("fetched 1 day ago");
  });
  it("several days", () => {
    expect(ageDescription("2026-08-10T12:00:00Z", now)).toBe("fetched 10 days ago");
  });
});
