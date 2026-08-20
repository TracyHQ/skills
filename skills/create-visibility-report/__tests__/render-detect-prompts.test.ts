// H: two drift guards used to share a blind spot. `renderPrompt`'s "unknown placeholder" check and
// its "unfilled after render" check both used `/\{[a-zA-Z]+\}/g`, so a spec that grew
// `{shop_name}` (underscore) or `{answerText2}` (digit) matched NEITHER regex — it sailed through
// both guards and reached the analyzer as a literal string, exactly what these guards exist to
// prevent (SKILL.md/ADR-0027: the client lane must extract with the backend's EXACT prompt).
//
// Separately, `spec.promptTemplate.split('## CITATIONS')[0]` discarded everything from the
// CITATIONS header to the end of the template and re-appended only a freshly rendered citations
// block — so output rules a spec places AFTER '## CITATIONS' (which ADR-0027 requires to be used
// exactly) were silently dropped from the rendered prompt every time.
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain ESM, no type declarations by design
import { renderPrompt } from "../scripts/render-detect-prompts.mjs";

const baseMeta = {
  shop: { name: "Acme Beauty", primaryDomain: "acmebeauty.com" },
  product: { title: "Snail Mucin Essence" },
};
const baseCell = {
  promptText: "Where can I buy Snail Mucin Essence?",
  platformSlug: "chatgpt",
  response: {
    servedModel: "gpt-5.5",
    rawText: "You can buy it at Acme Beauty.",
    citations: [{ url: "https://acmebeauty.com/p", domain: "acmebeauty.com", title: "Acme Beauty" }],
  },
};

describe("renderPrompt — placeholder guards catch underscore and digit forms", () => {
  it("throws on an underscore placeholder ({shop_name}) instead of rendering it literally", () => {
    const spec = { promptTemplate: "Shop: {shop_name}\n\n## CITATIONS\n{citations}\n" };
    expect(() => renderPrompt({ spec, meta: baseMeta, cell: baseCell }))
      .toThrow(/\{shop_name\}/);
  });

  it("throws on a digit-suffixed placeholder ({answerText2})", () => {
    const spec = { promptTemplate: "Answer: {answerText2}\n\n## CITATIONS\n{citations}\n" };
    expect(() => renderPrompt({ spec, meta: baseMeta, cell: baseCell }))
      .toThrow(/\{answerText2\}/);
  });

  it("still accepts every known camelCase placeholder", () => {
    const spec = {
      promptTemplate:
        "Shop: {shopName}\nProduct: {productTitle}\nModel: {model}\nQuestion: {question}\n" +
        "Answer: {answerText}\n\n## CITATIONS\n{citations}\n",
    };
    const out = renderPrompt({ spec, meta: baseMeta, cell: baseCell });
    expect(out).toContain("Shop: Acme Beauty");
    expect(out).toContain("Product: Snail Mucin Essence");
    expect(out).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
  });
});

describe("renderPrompt — content after '## CITATIONS' survives the rebuild", () => {
  const specWithOutputRules = {
    promptTemplate:
      "Shop: {shopName}\nProduct: {productTitle}\n\n" +
      "## CITATIONS\n{citations}\n\n" +
      "## OUTPUT RULES\nReturn JSON only. Repeat the product title: {productTitle}\n",
  };

  it("keeps the OUTPUT RULES section instead of truncating at the citations header", () => {
    const out = renderPrompt({ spec: specWithOutputRules, meta: baseMeta, cell: baseCell });
    expect(out).toContain("## OUTPUT RULES");
    expect(out).toContain("Return JSON only.");
  });

  it("fills placeholders that appear again AFTER the citations block", () => {
    const out = renderPrompt({ spec: specWithOutputRules, meta: baseMeta, cell: baseCell });
    expect(out).toContain("Repeat the product title: Snail Mucin Essence");
  });

  it("still rebuilds the citations block itself from this cell's own citations", () => {
    const out = renderPrompt({ spec: specWithOutputRules, meta: baseMeta, cell: baseCell });
    expect(out).toContain("acmebeauty.com");
    expect(out).not.toContain("{citations}");
  });

  it("renders identically (no tail lost) when the spec has no content after citations", () => {
    const spec = { promptTemplate: "Shop: {shopName}\n\n## CITATIONS\n{citations}\n" };
    const out = renderPrompt({ spec, meta: baseMeta, cell: baseCell });
    expect(out).toContain("Shop: Acme Beauty");
    expect(out).toContain("acmebeauty.com");
  });
});
