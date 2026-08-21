// The owner's decision (translated from the original: when a key is missing the skill should tell
// the user there is no key, and let them supply one or choose to skip) means a missing key must be
// a CONVERSATION before P3 ever runs, not a bare
// "15 criteria go na" buried in the coverage line. These tests pin the preflight decision itself
// — which criteria a lane buys, and which of those are Critical to the verdict — independent of
// any real key or network call, and independent of `report-md.test.ts`, which pins where this
// same data lands in the delivered report.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain ESM, no type declarations by design
import {
  LLM_LANE_CRITERIA,
  OFFSTORE_LANE_CRITERIA,
  laneImpact,
  llmLanePreflight,
  offstoreLanePreflight,
  preflight,
} from '../scripts/preflight.mjs'
// @ts-expect-error — plain ESM, no type declarations by design
import { CONTENT_LLM_KEYS, VOICE_LLM_KEYS, CREDIBILITY_LLM_KEYS } from '../scripts/analyze-llm.mjs'
// @ts-expect-error — plain ESM, no type declarations by design
import { TOTAL_CRITERIA } from '../scripts/framework.mjs'

describe('lane membership matches what the run actually grades/collects', () => {
  it('LLM_LANE_CRITERIA is exactly analyze-llm.mjs\'s own three batches — reused, not re-typed', () => {
    // A hand-typed second copy of this list is exactly how it would drift from what
    // analyze-llm.mjs grades without anyone noticing — reusing the exports is the fix.
    expect(LLM_LANE_CRITERIA).toEqual([...CONTENT_LLM_KEYS, ...VOICE_LLM_KEYS, ...CREDIBILITY_LLM_KEYS])
    expect(LLM_LANE_CRITERIA).toHaveLength(15) // SKILL.md: "Grading LLM | +15"
  })

  it('OFFSTORE_LANE_CRITERIA has the 7 criteria SKILL.md documents for that lane', () => {
    expect(OFFSTORE_LANE_CRITERIA).toHaveLength(7) // SKILL.md: "Off-store | +7"
    expect(OFFSTORE_LANE_CRITERIA).toEqual(
      expect.arrayContaining([
        'reddit',
        'trustpilot',
        'google-reviews',
        'social-video-mentions',
        'press-and-lists',
        'entity-databases',
        'google-merchant-feed',
      ]),
    )
  })
})

describe('laneImpact — what a lane is worth, not just how many criteria it has', () => {
  it('names the Critical criteria inside the LLM lane, not just a count', () => {
    // These four are weight-3/Critical inside the 15 — losing them is a different verdict-level
    // conversation than losing e.g. `troubleshooting-care` (weight 1/Medium), and a user
    // deciding whether to stop for a key needs to see that difference before Q1 ever asks.
    const impact = laneImpact(LLM_LANE_CRITERIA)
    expect(impact.count).toBe(15)
    expect(impact.criticalKeys.sort()).toEqual(
      ['answer-formatting', 'faq-product', 'specifications', 'unique-description'].sort(),
    )
    expect(impact.weightPct).toBeGreaterThan(0)
  })

  it('names the Critical criteria inside the off-store lane', () => {
    const impact = laneImpact(OFFSTORE_LANE_CRITERIA)
    expect(impact.count).toBe(7)
    expect(impact.criticalKeys.sort()).toEqual(['google-merchant-feed', 'press-and-lists', 'reddit'].sort())
  })

  it('throws rather than silently miscounting a criterion that is not in the framework', () => {
    // A typo'd key here must fail loudly at preflight time, not quietly under-report what a
    // lane buys — the same "no invented signals" principle scorers.mjs holds for evidence.
    expect(() => laneImpact(['not-a-real-criterion'])).toThrow()
  })
})

describe('llmLanePreflight — agrees with pickRoute, never invents a route of its own', () => {
  it('reports no key and the full 15-criterion loss when nothing is stored', () => {
    const p = llmLanePreflight({})
    expect(p.hasKey).toBe(false)
    expect(p.route).toBeNull()
    expect(p.impact.count).toBe(15)
  })

  it('picks the same provider pickRoute would, in the documented anthropic > openai > gemini order', () => {
    const p = llmLanePreflight({ OPENAI_API_KEY: 'sk-x', ANTHROPIC_API_KEY: 'sk-ant-x' })
    expect(p.hasKey).toBe(true)
    expect(p.route).toBe('anthropic')
    expect(p.storedProviders).toEqual(expect.arrayContaining(['anthropic', 'openai']))
  })
})

describe('offstoreLanePreflight', () => {
  it('reports no key and the full 7-criterion loss when SERPAPI_API_KEY is unset', () => {
    const p = offstoreLanePreflight({})
    expect(p.hasKey).toBe(false)
    expect(p.impact.count).toBe(7)
  })

  it('reports a usable key when SERPAPI_API_KEY is a non-empty string', () => {
    expect(offstoreLanePreflight({ SERPAPI_API_KEY: 'abc' }).hasKey).toBe(true)
  })
})

describe('preflight — the combined picture P1 shows before any question is asked', () => {
  it('with no keys at all, only the page lane can score: 40 - 15 - 7 = 18', () => {
    const p = preflight({})
    expect(p.totalCriteria).toBe(TOTAL_CRITERIA)
    expect(p.maxScoreable).toBe(18)
  })

  it('with both keys present, the ceiling is the full 40 (page-lane na/gated still possible)', () => {
    const p = preflight({ ANTHROPIC_API_KEY: 'sk-ant-x', SERPAPI_API_KEY: 'abc' })
    expect(p.maxScoreable).toBe(40)
  })

  it('with only one key, the loss is exactly that one lane\'s criteria — never double-counted', () => {
    const p = preflight({ ANTHROPIC_API_KEY: 'sk-ant-x' })
    expect(p.maxScoreable).toBe(40 - 7) // off-store lost, LLM lane intact
  })
})
