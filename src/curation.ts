import { z } from 'zod'

import { TierSchema, type Tier } from './record'

export const CurationRecordSchema = z.object({
  tier: TierSchema,
  reviewedHash: z.string().regex(/^[0-9a-f]{64}$/, 'reviewedHash must be a sha256 hex digest'),
  reviewedAt: z.string().min(1),
  reviewer: z.string().min(1)
})

export type CurationRecord = z.infer<typeof CurationRecordSchema>

/**
 * `curated` is pinned to the byte string that was actually read, not to the repo's name. The
 * repo keeps accepting PRs after review, so a label hung on the repo's name would be talking
 * about a version that no longer exists.
 *
 * `quarantined` does not fall based on hash: it is a removal decision, and a content change
 * does not lift it.
 */
export function resolveTier(
  curation: CurationRecord | null,
  contentHash: string
): { tier: Tier; demoted: boolean } {
  if (!curation) return { tier: 'listed', demoted: false }
  if (curation.tier === 'quarantined') return { tier: 'quarantined', demoted: false }
  if (curation.tier === 'curated' && curation.reviewedHash !== contentHash) {
    return { tier: 'listed', demoted: true }
  }
  return { tier: curation.tier, demoted: false }
}
