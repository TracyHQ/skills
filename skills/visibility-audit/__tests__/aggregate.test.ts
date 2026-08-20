// `aggregateAudit` is the weighted-mean maths FRAMEWORK.md describes: "Every score ... is the
// weighted mean over the criteria that were actually scored. `na` and `gated` leave the
// denominator; they are not zeros." These cases pin that contract directly, plus the
// `total: null` case that feeds incident C (a null total must not later read as "weak" — see
// framework.test.ts for the verdictTier half of that fix).
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain ESM, no type declarations by design
import { aggregateAudit } from '../scripts/aggregate.mjs'

describe('aggregateAudit', () => {
  it('total is null when nothing was scored — not 0, not a low number', () => {
    // Every one of the 40 criteria is unaccounted for → all `inactive`. This is the exact
    // shape a store with a completely empty/unreadable page produces.
    const agg = aggregateAudit([])
    expect(agg.total).toBeNull()
    expect(agg.coverage.scored).toBe(0)
    expect(agg.coverage.inactive).toBe(40)
    expect(agg.topPriorities).toHaveLength(0)
  })

  it('weights two scored criteria by their raw label weight ratio, ignoring everything else', () => {
    // `ai-bots-allowed` (label weight 3) and `internal-linking` (label weight 1) are both in
    // Discoverability, so the same factor budget cancels out of the ratio: a 3:1 label-weight
    // split means the weighted mean of 100 and 0 is exactly 75, not a plain 50/50 average.
    const agg = aggregateAudit([
      { key: 'ai-bots-allowed', status: 'scored', score: 100, evidence: {} },
      { key: 'internal-linking', status: 'scored', score: 0, evidence: {} },
    ])
    expect(agg.total).toBeCloseTo(75, 6)
    expect(agg.coverage.scored).toBe(2)
    // The other 38 defined criteria were never given a row → `inactive`, and `na`/`gated`
    // leave the denominator the same way `inactive` does (all three are simply absent from
    // `scoredRows`), so they must not drag the total toward 0.
    expect(agg.coverage.inactive).toBe(38)
  })

  it('na and gated criteria leave the denominator: adding one does not move the total', () => {
    const base = aggregateAudit([
      { key: 'ai-bots-allowed', status: 'scored', score: 100, evidence: {} },
    ])
    const withNa = aggregateAudit([
      { key: 'ai-bots-allowed', status: 'scored', score: 100, evidence: {} },
      { key: 'reddit', status: 'na', score: null, evidence: { reason: 'No Reddit data collected' } },
    ])
    expect(withNa.total).toBe(base.total)
    expect(withNa.coverage.na).toBe(1)
    // The reason travels onto the criterion row so the report can say why it's missing.
    const row = withNa.criteria.find((c: any) => c.key === 'reddit')
    expect(row.reason).toBe('No Reddit data collected')
  })

  it('ranks topPriorities by impact (low score * high weight first), scored criteria only', () => {
    const agg = aggregateAudit([
      { key: 'ai-bots-allowed', status: 'scored', score: 0, evidence: {} }, // weight 3, worst
      { key: 'internal-linking', status: 'scored', score: 0, evidence: {} }, // weight 1
      { key: 'video-schema', status: 'na', score: null, evidence: { reason: 'no-video' } },
    ])
    expect(agg.topPriorities.map((c: any) => c.key)).toEqual(['ai-bots-allowed', 'internal-linking'])
  })
})
