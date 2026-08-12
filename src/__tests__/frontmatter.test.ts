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

const EMPTY = { name: null, description: null, tags: [], requiresMcp: [] }

describe('parseSkillFrontmatter', () => {
  it('reads name, description and tags', () => {
    expect(parseSkillFrontmatter(doc)).toEqual({
      name: 'woocommerce-refund-audit',
      description: 'Reconciles refunds on WooCommerce against the ledger.',
      tags: ['woocommerce', 'finance'],
      requiresMcp: []
    })
  })

  it('returns nulls when there is no frontmatter', () => {
    expect(parseSkillFrontmatter('# Body only')).toEqual(EMPTY)
  })

  it('ignores non-string tag entries rather than throwing', () => {
    const messy = '---\nname: a\ntags:\n  - ok\n  - 42\n---\n'
    expect(parseSkillFrontmatter(messy).tags).toEqual(['ok'])
  })

  it('never throws: malformed YAML in frontmatter', () => {
    const malformed = '---\nname: [unclosed\n---\n'
    expect(() => parseSkillFrontmatter(malformed)).not.toThrow()
    expect(parseSkillFrontmatter(malformed)).toEqual(EMPTY)
  })

  it('never throws: empty frontmatter', () => {
    const empty = '---\n---\n'
    expect(() => parseSkillFrontmatter(empty)).not.toThrow()
    expect(parseSkillFrontmatter(empty)).toEqual(EMPTY)
  })

  it('never throws: name is a number', () => {
    const badName = '---\nname: 42\n---\n'
    expect(() => parseSkillFrontmatter(badName)).not.toThrow()
    expect(parseSkillFrontmatter(badName)).toEqual(EMPTY)
  })

  it('never throws: description is an object', () => {
    const badDesc = '---\ndescription: {key: value}\n---\n'
    expect(() => parseSkillFrontmatter(badDesc)).not.toThrow()
    expect(parseSkillFrontmatter(badDesc)).toEqual(EMPTY)
  })

  it('never throws: tags is a string instead of array', () => {
    const badTags = '---\ntags: "not-an-array"\n---\n'
    expect(() => parseSkillFrontmatter(badTags)).not.toThrow()
    expect(parseSkillFrontmatter(badTags)).toEqual(EMPTY)
  })

  it('reads requires-mcp as a list', () => {
    const withRequires = '---\nname: a\nrequires-mcp:\n  - joomla-mcp\n  - sendy\n---\n'
    expect(parseSkillFrontmatter(withRequires).requiresMcp).toEqual(['joomla-mcp', 'sendy'])
  })

  it('accepts the requires_mcp spelling and a comma-separated string, like Desk does', () => {
    const underscore = '---\nrequires_mcp:\n  - joomla-mcp\n---\n'
    expect(parseSkillFrontmatter(underscore).requiresMcp).toEqual(['joomla-mcp'])

    const comma = '---\nrequires-mcp: "joomla-mcp, sendy"\n---\n'
    expect(parseSkillFrontmatter(comma).requiresMcp).toEqual(['joomla-mcp', 'sendy'])
  })

  it('drops non-string and blank requires-mcp entries rather than throwing', () => {
    const messy = '---\nrequires-mcp:\n  - joomla-mcp\n  - 42\n  - "  "\n---\n'
    expect(parseSkillFrontmatter(messy).requiresMcp).toEqual(['joomla-mcp'])
  })
})
