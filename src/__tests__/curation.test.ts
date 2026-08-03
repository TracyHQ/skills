import { describe, expect, it } from 'vitest'

import { CurationRecordSchema, resolveTier } from '../curation'

const hash = 'a'.repeat(64)
const other = 'b'.repeat(64)
const curated = { tier: 'curated' as const, reviewedHash: hash, reviewedAt: '2026-08-03', reviewer: 'lee' }

describe('resolveTier', () => {
  it('defaults to listed when there is no curation record', () => {
    expect(resolveTier(null, hash)).toEqual({ tier: 'listed', demoted: false })
  })

  it('keeps curated when the reviewed hash still matches', () => {
    expect(resolveTier(curated, hash)).toEqual({ tier: 'curated', demoted: false })
  })

  it('demotes to listed when the content changed after review', () => {
    expect(resolveTier(curated, other)).toEqual({ tier: 'listed', demoted: true })
  })

  it('keeps quarantined regardless of hash', () => {
    const q = { ...curated, tier: 'quarantined' as const, reviewedHash: other }
    expect(resolveTier(q, hash)).toEqual({ tier: 'quarantined', demoted: false })
  })
})

describe('CurationRecordSchema', () => {
  it('rejects a reviewedHash that is not a sha256', () => {
    expect(CurationRecordSchema.safeParse({ ...curated, reviewedHash: 'short' }).success).toBe(false)
  })
})
