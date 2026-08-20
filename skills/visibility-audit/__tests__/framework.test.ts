// Incident C: `verdictTier(null)` used to return `"weak"`, so a run that scored NOTHING (an
// empty page, or every lane unavailable) got the same judgement word as an honestly-measured
// failing store. `score.mjs` writes that tier straight into `audit.json` next to `score: null`,
// and `report-md.mjs` printed `**Score —** (weak)` — a specific, false claim from an artifact
// that measured nothing. `null` must read as "unknown", never as the worst tier.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain ESM, no type declarations by design
import { verdictTier, globalWeight, CRITERIA, FACTORS } from '../scripts/framework.mjs'

describe('verdictTier', () => {
  it('returns null for a null total, never a judgement tier', () => {
    expect(verdictTier(null)).toBeNull()
  })

  it('still tiers a real 0 as weak — null and 0 are different totals, not the same case', () => {
    expect(verdictTier(0)).toBe('weak')
  })

  it('tiers the documented boundaries: <50 weak, <80 moderate, >=80 strong', () => {
    expect(verdictTier(49)).toBe('weak')
    expect(verdictTier(50)).toBe('moderate')
    expect(verdictTier(79)).toBe('moderate')
    expect(verdictTier(80)).toBe('strong')
    expect(verdictTier(100)).toBe('strong')
  })
})

describe('globalWeight — the aggregation maths FRAMEWORK.md promises', () => {
  it('sums to 100 across all 40 criteria', () => {
    // "The 40 global weights sum to 100, and the percentages in the tables below are those
    // weights" (FRAMEWORK.md). If a criterion is added/removed/reweighted without this still
    // holding, every score in the report is quietly off.
    const total = Object.keys(CRITERIA).reduce((sum, key) => sum + globalWeight(key), 0)
    expect(total).toBeCloseTo(100, 6)
  })

  it("each factor's criteria sum to that factor's own weightPct", () => {
    for (const factorKey of Object.keys(FACTORS)) {
      const sum = Object.entries(CRITERIA)
        .filter(([, def]) => def.factor === factorKey)
        .reduce((acc, [key]) => acc + globalWeight(key), 0)
      expect(sum).toBeCloseTo(FACTORS[factorKey].weightPct, 6)
    }
  })

  it('returns 0 for an unknown key rather than throwing (aggregate.mjs relies on this)', () => {
    expect(globalWeight('not-a-real-criterion')).toBe(0)
  })
})
