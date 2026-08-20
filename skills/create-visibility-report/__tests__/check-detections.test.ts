// Gemini's groundingChunks[].web.uri comes back as a vertexaisearch.cloud.google.com redirect,
// not the merchant's real page — collect-api.mjs's domainOf() records that proxy host as
// citation.domain (see its own comment). A literal domain compare in check-detections.mjs then
// never matches a real merchant on a Gemini cell: real incident, 8 of 30 merchants in one run
// false-flagged WARN_FALSE_CITATION_SOURCE this way, and a hand-resolved redirect proved the
// citation genuine (gymshark.com -> https://uk.gymshark.com/collections/leggings/womens, HTTP
// 200). citationSupportsDomain() fixes this by falling back to the Gemini chunk's own `title`
// (which is the source's hostname more often than not) whenever the citation's domain is the
// vertexaisearch proxy host. See ANALYSIS.md "One thing that bites on Gemini cells".
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM, no type declarations by design
import {
  citationSupportsDomain,
  isSupported,
  checkCell,
  checkTarget,
  targetFromMeta,
} from "../scripts/check-detections.mjs";

const GEMINI_REDIRECT =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCdEf123";

describe("citationSupportsDomain", () => {
  it("matches a plain, non-redirect citation domain literally", () => {
    const citation = { url: "https://gymshark.com/leggings", domain: "gymshark.com" };
    expect(citationSupportsDomain(citation, "gymshark.com")).toBe(true);
  });

  it("does NOT match a plain citation against a different domain", () => {
    const citation = { url: "https://noon.com/leggings", domain: "noon.com" };
    expect(citationSupportsDomain(citation, "gymshark.com")).toBe(false);
  });

  it("falls back to the Gemini chunk's title when the domain is the vertexaisearch redirect host", () => {
    const citation = { url: GEMINI_REDIRECT, domain: "vertexaisearch.cloud.google.com", title: "gymshark.com" };
    expect(citationSupportsDomain(citation, "gymshark.com")).toBe(true);
  });

  it("still refuses a Gemini-shaped citation whose title names a different site", () => {
    const citation = { url: GEMINI_REDIRECT, domain: "vertexaisearch.cloud.google.com", title: "noon.com" };
    expect(citationSupportsDomain(citation, "gymshark.com")).toBe(false);
  });

  it("is case- and www-insensitive on both sides, same as normDomain elsewhere in this file", () => {
    const citation = { url: GEMINI_REDIRECT, domain: "vertexaisearch.cloud.google.com", title: "WWW.GymShark.com" };
    expect(citationSupportsDomain(citation, "gymshark.com")).toBe(true);
  });

  it("returns false with no merchant domain to check against", () => {
    const citation = { url: "https://gymshark.com/leggings", domain: "gymshark.com" };
    expect(citationSupportsDomain(citation, undefined)).toBe(false);
  });
});

describe("isSupported — Gemini redirect citations", () => {
  it("supports a merchant named only via a Gemini-shaped citation whose title names its domain", () => {
    const merchant = {
      name: "Gymshark UK",
      domain: "gymshark.com",
      mentionSources: ["citation"],
    };
    const response = {
      rawText: "Several UK retailers stock this legging.",
      citations: [{ url: GEMINI_REDIRECT, domain: "vertexaisearch.cloud.google.com", title: "gymshark.com" }],
    };
    expect(isSupported(merchant, response)).toBe(true);
  });

  it("does not support a merchant whose domain matches no citation at all, redirect or not", () => {
    const merchant = { name: "Some Reseller", domain: "example.com", mentionSources: ["citation"] };
    const response = {
      rawText: "Several UK retailers stock this legging.",
      citations: [{ url: GEMINI_REDIRECT, domain: "vertexaisearch.cloud.google.com", title: "gymshark.com" }],
    };
    expect(isSupported(merchant, response)).toBe(false);
  });
});

describe("checkCell — WARN_FALSE_CITATION_SOURCE on a Gemini cell", () => {
  const cellWith = (merchant: Record<string, unknown>, citations: Record<string, unknown>[]) => ({
    file: "where_to_buy.gemini.json",
    cell: {
      response: { rawText: "Gymshark UK sells this online.", citations },
      detection: { merchants: [merchant] },
    },
  });

  it("does NOT fire on a genuine Gemini citation whose title names the merchant's domain", () => {
    const cell = cellWith(
      { name: "Gymshark UK", domain: "gymshark.com", position: 1, mentionSources: ["citation", "text"] },
      [{ url: GEMINI_REDIRECT, domain: "vertexaisearch.cloud.google.com", title: "gymshark.com" }],
    );
    const violations = checkCell(cell);
    expect(violations.map((v: { code: string }) => v.code)).not.toContain("WARN_FALSE_CITATION_SOURCE");
  });

  it("still fires when the Gemini citation's title names a different site entirely", () => {
    const cell = cellWith(
      { name: "Gymshark UK", domain: "gymshark.com", position: 1, mentionSources: ["citation", "text"] },
      [{ url: GEMINI_REDIRECT, domain: "vertexaisearch.cloud.google.com", title: "noon.com" }],
    );
    const violations = checkCell(cell);
    expect(violations.map((v: { code: string }) => v.code)).toContain("WARN_FALSE_CITATION_SOURCE");
  });
});

describe("checkTarget — target-domain match through a Gemini redirect citation", () => {
  it("fires WARN_TARGET_MISSED once a Gemini citation's title reveals the target was actually cited", () => {
    // Before the fix, a literal domain compare against `vertexaisearch.cloud.google.com` would
    // never match `kbeautyarabia.com`, so this citation-only mention of the target shop was
    // invisible to checkTarget — no merchant listed it, and no warning fired to say so either.
    // That silent miss is the bug: the target really was cited, it just went unnoticed.
    const target = targetFromMeta({ shop: { name: "K-Beauty Arabia", primaryDomain: "kbeautyarabia.com" } });
    const cell = {
      response: {
        rawText: "Several retailers carry this essence in the region.",
        citations: [{ url: GEMINI_REDIRECT, domain: "vertexaisearch.cloud.google.com", title: "kbeautyarabia.com" }],
      },
      detection: { merchants: [] },
    };
    const out = checkTarget({ file: "where_to_buy.gemini.json", cell }, target);
    expect(out.map((v: { code: string }) => v.code)).toContain("WARN_TARGET_MISSED");
  });
});

// Found while verifying the Gemini title fallback against the real gymshark.com run
// (.mn-runs/gymshark-com/2026-08-20T0859): the first fix compared with `title.includes(want)`,
// so `shark.com` matched a citation whose title was "gymshark.com". A merchant would have
// inherited a competitor's evidence — the exact failure this guard exists to prevent, arriving
// through the fix for it. Match the title as a HOST: equal, or a subdomain of it.
describe('citationSupportsDomain — host boundary, not substring', () => {
  const gemini = (title: string) => ({ domain: 'vertexaisearch.cloud.google.com', title })

  it('does not credit a merchant whose domain is a suffix of the cited one', () => {
    expect(citationSupportsDomain(gemini('gymshark.com'), 'shark.com')).toBe(false)
    expect(citationSupportsDomain(gemini('gymshark.com'), 'ymshark.com')).toBe(false)
  })

  it('still credits the exact host', () => {
    expect(citationSupportsDomain(gemini('gymshark.com'), 'gymshark.com')).toBe(true)
  })

  it('credits a subdomain of the merchant domain', () => {
    expect(citationSupportsDomain(gemini('uk.gymshark.com'), 'gymshark.com')).toBe(true)
  })

  it('does not credit the parent when the merchant IS the subdomain', () => {
    expect(citationSupportsDomain(gemini('gymshark.com'), 'uk.gymshark.com')).toBe(false)
  })

  it('finds the host inside a title that carries more than a hostname', () => {
    expect(citationSupportsDomain(gemini('Buy now — selfridges.com'), 'selfridges.com')).toBe(true)
  })
})
