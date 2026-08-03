import { describe, expect, it } from 'vitest'

import { SkillRecordSchema } from '../record'

const valid = {
  namespace: 'tracyhq',
  slug: 'woocommerce-refund-audit',
  gitUrl: 'https://github.com/TracyHQ/skills',
  ref: 'main',
  skillPath: 'skills/woocommerce-refund-audit'
}

describe('SkillRecordSchema', () => {
  it('accepts a complete record', () => {
    expect(SkillRecordSchema.parse(valid)).toMatchObject(valid)
  })

  it('defaults ref to main when omitted', () => {
    const { ref, ...withoutRef } = valid
    expect(SkillRecordSchema.parse(withoutRef).ref).toBe('main')
  })

  it('rejects a missing gitUrl', () => {
    const { gitUrl, ...withoutUrl } = valid
    expect(SkillRecordSchema.safeParse(withoutUrl).success).toBe(false)
  })

  it('rejects a non-github host', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, gitUrl: 'https://gitlab.com/a/b' }).success).toBe(false)
  })

  it('rejects an http gitUrl', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, gitUrl: 'http://github.com/a/b' }).success).toBe(false)
  })

  it('rejects a slug with uppercase or spaces', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, slug: 'Refund Audit' }).success).toBe(false)
  })

  it('rejects a skillPath that escapes the repo', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, skillPath: '../secrets' }).success).toBe(false)
  })

  it('rejects an absolute skillPath', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, skillPath: '/etc' }).success).toBe(false)
  })
})
