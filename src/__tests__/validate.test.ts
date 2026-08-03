import { describe, expect, it } from 'vitest'

import { validateRecordFile } from '../validate'

const valid = {
  namespace: 'tracyhq',
  slug: 'refund-audit',
  gitUrl: 'https://github.com/TracyHQ/skills',
  ref: 'main',
  skillPath: 'skills/refund-audit'
}
const validPath = 'registry/tracyhq/refund-audit.json'

const codes = (raw: unknown, path = validPath) => validateRecordFile(path, raw).map((e) => e.code)

describe('validateRecordFile', () => {
  it('accepts a well-formed record at the right path', () => {
    expect(validateRecordFile(validPath, valid)).toEqual([])
  })

  it('rejects a schema violation', () => {
    expect(codes({ ...valid, gitUrl: 'nope' })).toContain('schema')
  })

  it('rejects a namespace that does not match the file path', () => {
    expect(codes(valid, 'registry/someone-else/refund-audit.json')).toContain('path_namespace_mismatch')
  })

  it('rejects a slug that does not match the file name', () => {
    expect(codes(valid, 'registry/tracyhq/other-name.json')).toContain('path_slug_mismatch')
  })

  it('rejects a namespace that does not own the repo', () => {
    expect(codes({ ...valid, namespace: 'someone-else' }, 'registry/someone-else/refund-audit.json')).toContain(
      'namespace_not_owner'
    )
  })

  it('matches owner case-insensitively', () => {
    // namespace là kebab-case chữ thường; owner GitHub là "TracyHQ".
    expect(codes(valid)).not.toContain('namespace_not_owner')
  })

  it('rejects a file outside registry/', () => {
    expect(codes(valid, 'curation/tracyhq/refund-audit.json')).toContain('path_outside_registry')
  })

  it('rejects extra path segments after the filename', () => {
    expect(codes(valid, 'registry/tracyhq/refund-audit.json/x/y/z')).toContain('path_outside_registry')
  })

  it('rejects path traversal attempts in extra segments', () => {
    expect(codes(valid, 'registry/tracyhq/refund-audit.json/../../etc/passwd')).toContain('path_outside_registry')
  })

  it('rejects a path with wrong segment structure (4 segments)', () => {
    expect(codes({ ...valid, namespace: 'a', slug: 'b' }, 'registry/a/b/sub.json')).toContain(
      'path_outside_registry'
    )
  })

  it('rejects a path with missing filename', () => {
    expect(codes(valid, 'registry/tracyhq')).toContain('path_outside_registry')
  })

  it('rejects a path with only registry directory', () => {
    expect(codes(valid, 'registry')).toContain('path_outside_registry')
  })
})
