import { statSync } from 'node:fs'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The weekly gate on enrichment calls (spec §7, grilling 2026-07-30): third-party
 * data barely moves day to day, and the worker has a global budget — so a file
 * younger than `maxAgeDays` means keep what we have. Age is the file's mtime;
 * a missing file always needs a refresh.
 */
export function needsRefresh(filePath: string, maxAgeDays: number): boolean {
  try {
    return Date.now() - statSync(filePath).mtimeMs > maxAgeDays * DAY_MS
  } catch {
    return true
  }
}
