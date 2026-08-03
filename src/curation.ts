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
 * `curated` gắn vào chuỗi byte đã được đọc, không gắn vào tên repo. Repo còn nhận PR sau khi
 * review, nên nhãn treo trên tên repo là nhãn nói về một phiên bản không còn tồn tại.
 *
 * `quarantined` không rớt theo hash: nó là quyết định gỡ bỏ, và nội dung đổi không gỡ nó.
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
