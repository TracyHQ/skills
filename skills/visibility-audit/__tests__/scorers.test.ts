// The scorer audit found one shape repeated across `scorers.mjs`: a grading lane that never
// ran (`!a` — no LLM key at all, or the batch threw) getting scored 0 instead of `na`. Only
// `shipping-competitive` had it (incident B, this file's whole reason to exist): a no-LLM-key
// run scored it 0/100 with `source: "llm"` and `reason: "No shipping terms visible"` — a
// specific, wrong claim about a page nothing read — and it landed as the report's #1 priority,
// which directly contradicts the skill's own design contract (SKILL.md §3: "A missing key is
// a setup task, not a zero. A criterion with no data is `na` and says so.").
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain ESM, no type declarations by design (see scorers.mjs's header)
import { shippingCompetitive, llmBandScorer } from '../scripts/scorers.mjs'

describe('shippingCompetitive', () => {
  it('goes na when the credibility batch never ran (no LLM key at all)', () => {
    // This is the exact reproduction from the audit: `ctx.llmAnalysis` has no entry for the
    // key because analyze-llm.mjs never ran (no ANTHROPIC/OPENAI/GEMINI key stored).
    const ctx = { llmAnalysis: {} }
    const result = shippingCompetitive.score(ctx)
    expect(result.status).toBe('na')
    expect(result.score).toBeUndefined()
  })

  it('goes na when the batch ran but this one call failed and got caught', () => {
    // analyze-llm.mjs's `warn()` degrades a failed batch to `{}` — same shape as "no key".
    const ctx = { llmAnalysis: {} }
    expect(shippingCompetitive.score(ctx).status).toBe('na')
  })

  it('stays a scored 0 when the model answered but returned band "na" anyway (backend parity, deliberate)', () => {
    // The prompt tells the model "NEVER na — always return 0/50/100", but scorers.mjs still
    // guards the case where it does anyway. This branch is a KNOWN, intentional match with the
    // backend's own shipping-competitive scorer (which floors this exact case at 0 too) — kept
    // identical so a submit never disagrees with the server over a criterion that DID run.
    const ctx = { llmAnalysis: { 'shipping-competitive': { band: 'na', reason: 'no shipping page found' } } }
    const result = shippingCompetitive.score(ctx)
    expect(result.status).toBe('scored')
    expect(result.score).toBe(0)
    expect(result.evidence.reason).toBe('no shipping page found')
  })

  it('scores the band normally when the batch ran and answered with a real band', () => {
    const ctx = { llmAnalysis: { 'shipping-competitive': { band: 50, reason: 'free shipping over threshold' } } }
    const result = shippingCompetitive.score(ctx)
    expect(result.status).toBe('scored')
    expect(result.score).toBe(50)
  })
})

// The correct pattern that `shippingCompetitive` was missing, already present everywhere else
// in the file — asserted here so a future scorer copy-pasted from `shippingCompetitive`
// (rather than from this, the more common shape) doesn't reintroduce incident B.
describe('llmBandScorer (the pattern every other LLM-graded criterion already followed)', () => {
  const aboutPage = llmBandScorer('about-page')

  it('goes na, not 0, when its lane never ran', () => {
    expect(aboutPage.score({ llmAnalysis: {} })).toMatchObject({ status: 'na' })
  })

  it('goes na when the model itself returned band "na"', () => {
    const ctx = { llmAnalysis: { 'about-page': { band: 'na', reason: 'no About page found' } } }
    expect(aboutPage.score(ctx)).toMatchObject({ status: 'na', reason: 'no About page found' })
  })

  it('scores normally otherwise', () => {
    const ctx = { llmAnalysis: { 'about-page': { band: 100, reason: 'named founder + origin story' } } }
    expect(aboutPage.score(ctx)).toMatchObject({ status: 'scored', score: 100 })
  })
})
