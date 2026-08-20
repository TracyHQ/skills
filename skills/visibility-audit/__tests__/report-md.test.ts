// A skipped lane must be RECORDED in the delivered artifact, not just spoken about in the
// terminal: "the choice must be recorded, not just spoken" (design decision this file pins).
// `dataSources.llmRoute`/`offStoreRoute` are `null` exactly when that lane never ran at all
// (see score.mjs — analyze-llm.mjs/collect-offstore.mjs are simply never invoked without a
// key), as opposed to `llmBatchFailures`/`offStoreFailures`, which name a lane that ran and had
// calls throw (audit incident H). These tests pin that a reader of report.md can always tell
// "not measured" apart from "measured and scored low", and never sees a warning for a lane that
// actually ran.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain ESM, no type declarations by design
import { renderMarkdown } from '../scripts/report-md.mjs'

function baseReport(overrides: any = {}) {
  return {
    subject: {
      shop: { name: 'Acme', storeUrl: 'acme.com' },
      product: { title: 'Widget' },
      pdpUrl: 'https://acme.com/products/widget',
      location: { country: 'US' },
      language: 'en',
    },
    score: 62,
    verdict: 'moderate',
    summary: null,
    generatedAt: '2026-08-20T00:00:00.000Z',
    coverage: { scored: 40, na: 0, gated: 0, inactive: 0, totalDefined: 40 },
    dataSources: {
      renderer: 'plain',
      offStoreRoute: 'serpapi',
      llmRoute: 'anthropic',
      narrativeRoute: 'anthropic',
      llmBatchFailures: [],
      offStoreFailures: [],
    },
    source: 'byok',
    factors: [],
    topPriorities: [],
    ...overrides,
  }
}

describe('renderMarkdown — skipped-lane disclosure', () => {
  it('warns about the grading lane, naming its Critical criteria, when llmRoute is null', () => {
    const md = renderMarkdown(
      baseReport({
        coverage: { scored: 25, na: 15, gated: 0, inactive: 0, totalDefined: 40 },
        dataSources: {
          renderer: 'plain',
          offStoreRoute: 'serpapi',
          llmRoute: null,
          narrativeRoute: null,
          llmBatchFailures: [],
          offStoreFailures: [],
        },
      }),
    )
    expect(md).toMatch(/Grading lane skipped \(no LLM key at run time\)/)
    expect(md).toMatch(/15 criteria are `na`, not scored low/)
    // The verdict-relevant ones are named, not just counted.
    expect(md).toMatch(/specifications/)
    expect(md).toMatch(/faq-product/)
    // The off-store lane DID run — its warning must not fire alongside the LLM one.
    expect(md).not.toMatch(/Off-store lane skipped/)
  })

  it('warns about the off-store lane, naming its Critical criteria, when offStoreRoute is null', () => {
    const md = renderMarkdown(
      baseReport({
        coverage: { scored: 33, na: 7, gated: 0, inactive: 0, totalDefined: 40 },
        dataSources: {
          renderer: 'plain',
          offStoreRoute: null,
          llmRoute: 'anthropic',
          narrativeRoute: 'anthropic',
          llmBatchFailures: [],
          offStoreFailures: [],
        },
      }),
    )
    expect(md).toMatch(/Off-store lane skipped \(no SerpApi key at run time\)/)
    expect(md).toMatch(/7 criteria are `na`, not scored low/)
    expect(md).toMatch(/reddit/)
    expect(md).toMatch(/press-and-lists/)
    expect(md).not.toMatch(/Grading lane skipped/)
  })

  it('prints neither skipped-lane warning when both lanes actually ran', () => {
    const md = renderMarkdown(baseReport())
    expect(md).not.toMatch(/lane skipped/)
  })

  it('states the score is a weighted mean over what was measured whenever coverage is partial', () => {
    const md = renderMarkdown(
      baseReport({ coverage: { scored: 18, na: 22, gated: 0, inactive: 0, totalDefined: 40 } }),
    )
    expect(md).toMatch(/weighted mean over the 18 criteria that were actually measured/)
    expect(md).toMatch(/do not pull the number down — they are absent from the average, not zeros in it/)
  })

  it('omits that explanatory line entirely when every criterion was scored (nothing to explain away)', () => {
    const md = renderMarkdown(baseReport())
    expect(md).not.toMatch(/weighted mean over the/)
  })

  it('a lane that ran but had batches fail still gets the EXISTING failure warning, not the skip warning', () => {
    // Distinguishes "ran, some calls threw" (llmBatchFailures) from "never ran" (llmRoute:
    // null) — both must be visible, but they are different findings and must not collapse into
    // the same sentence (audit incident H already established this for the failure case; this
    // pins that the new skip-lane warning does not blur back over it).
    const md = renderMarkdown(
      baseReport({
        dataSources: {
          renderer: 'plain',
          offStoreRoute: 'serpapi',
          llmRoute: 'anthropic',
          narrativeRoute: 'anthropic',
          llmBatchFailures: ['content'],
          offStoreFailures: [],
        },
      }),
    )
    expect(md).toMatch(/1 LLM grading batch did not complete \(content\)/)
    expect(md).not.toMatch(/Grading lane skipped/)
  })
})
