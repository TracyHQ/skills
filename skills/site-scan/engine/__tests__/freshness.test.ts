import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { needsRefresh } from '../freshness'

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

describe('needsRefresh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracy-freshness-'))

  it('a three-day-old file is still fresh at a seven-day window', () => {
    const file = join(dir, 'market.json')
    writeFileSync(file, '{}')
    utimesSync(file, daysAgo(3), daysAgo(3))
    expect(needsRefresh(file, 7)).toBe(false)
  })

  it('an eight-day-old file needs a refresh', () => {
    const file = join(dir, 'stale.json')
    writeFileSync(file, '{}')
    utimesSync(file, daysAgo(8), daysAgo(8))
    expect(needsRefresh(file, 7)).toBe(true)
  })

  it('a missing file always needs a refresh', () => {
    expect(needsRefresh(join(dir, 'never-written.json'), 7)).toBe(true)
  })
})
