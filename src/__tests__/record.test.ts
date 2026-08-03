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

  it('rejects a ref with path traversal (..)', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, ref: 'main/../../../evil-owner/evil-repo/main' }).success).toBe(false)
  })

  it('rejects a ref with query string character (?)', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, ref: 'main?x=1' }).success).toBe(false)
  })

  it('rejects a ref with fragment character (#)', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, ref: 'main#frag' }).success).toBe(false)
  })

  it('rejects a ref with whitespace', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, ref: 'has space' }).success).toBe(false)
  })

  it('rejects a ref starting with /', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, ref: '/leading' }).success).toBe(false)
  })

  it('rejects a ref ending with /', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, ref: 'trailing/' }).success).toBe(false)
  })

  it('rejects a ref with backslash', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, ref: 'a\\b' }).success).toBe(false)
  })

  it('accepts a ref that is just main', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, ref: 'main' }).success).toBe(true)
  })

  it('accepts a semantic version ref', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, ref: 'v1.2.3' }).success).toBe(true)
  })

  it('accepts a release branch ref', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, ref: 'release/2026-08' }).success).toBe(true)
  })

  it('accepts a commit SHA ref', () => {
    expect(SkillRecordSchema.safeParse({ ...valid, ref: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' }).success).toBe(true)
  })
})
