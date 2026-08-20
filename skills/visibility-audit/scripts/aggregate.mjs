// Flat global-weight aggregation, ported from `audit-aggregate.util.ts`.
// Every score = Σ gw·score / Σ gw over the SCORED criteria only. Nothing is rounded here;
// rounding happens once, at presentation time, so the gauge and the prose agree.

import { CRITERIA, FACTORS, TOTAL_CRITERIA, globalWeight } from './framework.mjs'

export function aggregateAudit(evaluated) {
  const byKey = new Map(evaluated.map((e) => [e.key, e]))
  const coverage = { scored: 0, na: 0, gated: 0, inactive: 0, totalDefined: TOTAL_CRITERIA }
  const criteria = []
  const factors = []

  const wMean = (rows) => {
    const scored = rows.filter((r) => r.status === 'scored' && r.score !== null)
    const den = scored.reduce((a, r) => a + globalWeight(r.key), 0)
    if (den === 0) return null
    return scored.reduce((a, r) => a + globalWeight(r.key) * r.score, 0) / den
  }

  for (const factorKey of Object.keys(FACTORS)) {
    const factorDef = FACTORS[factorKey]
    const resolved = Object.entries(CRITERIA)
      .filter(([, d]) => d.factor === factorKey)
      .map(([key, d]) => {
        const ev = byKey.get(key)
        if (!ev) return { key, def: d, status: 'inactive', score: null, evidence: {} }
        return {
          key,
          def: d,
          status: ev.status,
          score: ev.score ?? null,
          evidence: ev.evidence ?? {},
        }
      })

    for (const r of resolved) coverage[r.status] += 1

    const subGroups = Object.entries(factorDef.subGroups).map(([name, sg]) => ({
      name,
      pct: sg.pct,
      score: wMean(resolved.filter((r) => r.def.subGroup === name)),
    }))

    factors.push({
      key: factorKey,
      weightPct: factorDef.weightPct,
      status: resolved.some((r) => r.status !== 'inactive') ? 'scored' : 'inactive',
      score: wMean(resolved),
      subGroups,
    })

    for (const r of resolved) {
      criteria.push({
        key: r.key,
        factor: r.def.factor,
        subGroup: r.def.subGroup,
        weight: r.def.weight,
        status: r.status,
        score: r.score,
        impactRank: null,
        evidence: r.evidence,
        reason: r.status === 'na' || r.status === 'gated' ? (r.evidence?.reason ?? null) : null,
      })
    }
  }

  const scoredRows = criteria.filter((r) => r.status === 'scored' && r.score !== null)
  const gwSumScored = scoredRows.reduce((a, r) => a + globalWeight(r.key), 0)
  const total =
    gwSumScored === 0
      ? null
      : scoredRows.reduce((a, r) => a + globalWeight(r.key) * r.score, 0) / gwSumScored

  for (const row of criteria) {
    if (row.status !== 'scored' || row.score === null) continue
    row.impactRank = gwSumScored === 0 ? 0 : ((100 - row.score) * globalWeight(row.key)) / gwSumScored
  }

  const topPriorities = criteria
    .filter((r) => r.status === 'scored' && (r.impactRank ?? 0) > 0)
    .sort((a, b) => (b.impactRank ?? 0) - (a.impactRank ?? 0))

  return { total, coverage, factors, criteria, topPriorities }
}
