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

  it('rejects a Windows drive-letter absolute skillPath with forward slash', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, skillPath: 'C:/Windows/System32' }).success).toBe(false)
  })

  it('rejects a Windows drive-relative skillPath', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, skillPath: 'C:foo/bar' }).success).toBe(false)
  })

  it('rejects a Windows drive-letter absolute skillPath on another drive', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, skillPath: 'D:/secrets' }).success).toBe(false)
  })

  it('rejects a Windows UNC path skillPath', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, skillPath: '\\\\server\\share' }).success).toBe(false)
  })

  it('rejects a gitUrl with userinfo credentials', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, gitUrl: 'https://user:pass@github.com/a/b' }).success).toBe(false)
  })

  it('rejects a gitUrl with a non-default port', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, gitUrl: 'https://github.com:9999/a/b' }).success).toBe(false)
  })

  it('rejects a gitUrl with a query string', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, gitUrl: 'https://github.com/a/b?ref=x' }).success).toBe(false)
  })

  it('rejects a gitUrl with a fragment', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, gitUrl: 'https://github.com/a/b#readme' }).success).toBe(false)
  })
})
