// Incident A: P4 was documented as "these two are independent; start both", but P4a
// (`analyze-llm.mjs --offstore ...`) reads a file only P4b writes. Reproduced verbatim in the
// audit: `ENOENT: no such file or directory, open 'offstore.json'`, exit 1, whenever the
// off-store file did not exist yet (wrong run order) OR never would (no SerpApi key, so P4b
// never wrote one at all). `readOptionalJson` is the fix: a path that is omitted OR points at
// nothing degrades to "that lane did not run" (`null`); anything else — bad JSON, permissions —
// still throws, so a genuine mistake is not swallowed along with the legitimate case.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error — plain ESM, no type declarations by design
import { readOptionalJson } from '../scripts/analyze-llm.mjs'

describe('readOptionalJson', () => {
  it('returns null when the flag was never passed', () => {
    expect(readOptionalJson(undefined, 'offstore')).toBeNull()
    expect(readOptionalJson('', 'offstore')).toBeNull()
  })

  it('returns null (not a throw) when the path does not exist on disk — the incident A repro', () => {
    const fakeReadFile = () => {
      throw Object.assign(new Error("ENOENT: no such file or directory, open 'offstore.json'"), {
        code: 'ENOENT',
      })
    }
    expect(readOptionalJson('offstore.json', 'offstore', fakeReadFile)).toBeNull()
  })

  it('still throws on a read failure that is NOT "file absent" — e.g. bad JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'visibility-audit-'))
    const path = join(dir, 'broken.json')
    writeFileSync(path, '{not valid json')
    try {
      expect(() => readOptionalJson(path, 'offstore')).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('parses and returns the file when it genuinely exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'visibility-audit-'))
    const path = join(dir, 'offstore.json')
    writeFileSync(path, JSON.stringify({ press: { candidates: [{ link: 'https://example.com' }] } }))
    try {
      const result = readOptionalJson(path, 'offstore')
      expect(result.press.candidates).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
