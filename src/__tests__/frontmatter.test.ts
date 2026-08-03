import { describe, expect, it } from 'vitest'

import { parseSkillFrontmatter } from '../frontmatter'

const doc = `---
name: woocommerce-refund-audit
description: Reconciles refunds on WooCommerce against the ledger.
tags:
  - woocommerce
  - finance
---

# Body
`

describe('parseSkillFrontmatter', () => {
  it('reads name, description and tags', () => {
    expect(parseSkillFrontmatter(doc)).toEqual({
      name: 'woocommerce-refund-audit',
      description: 'Reconciles refunds on WooCommerce against the ledger.',
      tags: ['woocommerce', 'finance']
    })
  })

  it('returns nulls when there is no frontmatter', () => {
    expect(parseSkillFrontmatter('# Body only')).toEqual({ name: null, description: null, tags: [] })
  })

  it('ignores non-string tag entries rather than throwing', () => {
    const messy = '---\nname: a\ntags:\n  - ok\n  - 42\n---\n'
    expect(parseSkillFrontmatter(messy).tags).toEqual(['ok'])
  })

  it('never throws: malformed YAML in frontmatter', () => {
    const malformed = '---\nname: [unclosed\n---\n'
    expect(() => parseSkillFrontmatter(malformed)).not.toThrow()
    expect(parseSkillFrontmatter(malformed)).toEqual({ name: null, description: null, tags: [] })
  })

  it('never throws: empty frontmatter', () => {
    const empty = '---\n---\n'
    expect(() => parseSkillFrontmatter(empty)).not.toThrow()
    expect(parseSkillFrontmatter(empty)).toEqual({ name: null, description: null, tags: [] })
  })

  it('never throws: name is a number', () => {
    const badName = '---\nname: 42\n---\n'
    expect(() => parseSkillFrontmatter(badName)).not.toThrow()
    expect(parseSkillFrontmatter(badName)).toEqual({ name: null, description: null, tags: [] })
  })

  it('never throws: description is an object', () => {
    const badDesc = '---\ndescription: {key: value}\n---\n'
    expect(() => parseSkillFrontmatter(badDesc)).not.toThrow()
    expect(parseSkillFrontmatter(badDesc)).toEqual({ name: null, description: null, tags: [] })
  })

  it('never throws: tags is a string instead of array', () => {
    const badTags = '---\ntags: "not-an-array"\n---\n'
    expect(() => parseSkillFrontmatter(badTags)).not.toThrow()
    expect(parseSkillFrontmatter(badTags)).toEqual({ name: null, description: null, tags: [] })
  })
})
