import { describe, expect, it } from 'vitest'

import { parseSkillFrontmatter } from '../frontmatter'

const doc = `---
name: woocommerce-refund-audit
description: Đối chiếu refund trên WooCommerce với sổ quỹ.
tags:
  - woocommerce
  - finance
---

# Nội dung
`

describe('parseSkillFrontmatter', () => {
  it('reads name, description and tags', () => {
    expect(parseSkillFrontmatter(doc)).toEqual({
      name: 'woocommerce-refund-audit',
      description: 'Đối chiếu refund trên WooCommerce với sổ quỹ.',
      tags: ['woocommerce', 'finance']
    })
  })

  it('returns nulls when there is no frontmatter', () => {
    expect(parseSkillFrontmatter('# Chỉ có nội dung')).toEqual({ name: null, description: null, tags: [] })
  })

  it('ignores non-string tag entries rather than throwing', () => {
    const messy = '---\nname: a\ntags:\n  - ok\n  - 42\n---\n'
    expect(parseSkillFrontmatter(messy).tags).toEqual(['ok'])
  })
})
