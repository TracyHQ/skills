import { describe, expect, it } from 'vitest'

import { previewUrl, fleetLabel, looksLikeSnapshotShell, pageUrl, resolveTarget, revisionOf } from '../scripts/target.mjs'

/** A fetch that answers from a table, so none of this touches the network. */
const serving = (table: Record<string, { ok?: boolean; status?: number; text?: string }>) => {
  const calls: string[] = []
  const fetchText = async (url: string) => {
    calls.push(url)
    const key = Object.keys(table).find((k) => url.startsWith(k))
    const hit = key ? table[key] : undefined
    return hit ? { ok: hit.ok ?? true, status: hit.status ?? 200, text: hit.text ?? '' } : { ok: false, status: 404 }
  }
  return { fetchText, calls }
}

describe('fleetLabel', () => {
  // The one case measured against a live site on 2026-08-21: this address answered 200, and the
  // site folder on disk carries the same name. If the fleet ever changes how it builds a label
  // this is the test that notices, and the skill would otherwise scan the live site in silence.
  it('matches the label the fleet actually serves', () => {
    expect(fleetLabel('juneflower.vn')).toBe('juneflower-vn-7f6409d0')
    expect(previewUrl('https://juneflower.vn')).toBe('https://juneflower-vn-7f6409d0.tracy.ai')
  })

  it('collapses punctuation rather than doubling it, which the DNS rules forbid', () => {
    expect(fleetLabel('ja-stratum.demo.joomlart.com')).toMatch(/^ja-stratum-demo-joomlart-com-[0-9a-f]{8}$/)
    expect(fleetLabel('my-shop.io')).not.toContain('--')
  })

  it('gives two hosts that read alike two different labels', () => {
    expect(fleetLabel('my-shop.io')).not.toBe(fleetLabel('my.shop.io'))
  })
})

describe('revisionOf', () => {
  // Measured on juneflower's own copy: both files 404 and WordPress answers with its 404 PAGE.
  // A revision is therefore an optional corroboration and never a precondition — the page
  // fingerprints are what carry "has anything changed".
  it('is null when the copy publishes neither signal', async () => {
    const { fetchText } = serving({})
    expect(await revisionOf('https://x.tracy.ai', fetchText)).toBeNull()
  })

  it('is null rather than an error when the site answers HTML instead of json', async () => {
    const { fetchText } = serving({ 'https://x.tracy.ai/tracy-deployed.json': { text: '<!doctype html><html>404' } })
    expect(await revisionOf('https://x.tracy.ai', fetchText)).toBeNull()
  })

  it('reads both signals, and says so when only one answers', async () => {
    const { fetchText } = serving({
      'https://x.tracy.ai/tracy-deployed.json': { text: '{"commit":"a3f19c"}' },
      'https://x.tracy.ai/tracy-changed.json': { status: 404, ok: false }
    })
    expect(await revisionOf('https://x.tracy.ai', fetchText)).toBe('a3f19c/-')
  })
})

describe('resolveTarget', () => {
  it('prefers the Preview, because that is what the preview pane shows', async () => {
    const { fetchText } = serving({ 'https://juneflower-vn-7f6409d0.tracy.ai/': { text: 'hi' } })
    const target = await resolveTarget('https://juneflower.vn', 'auto', fetchText)
    expect(target.kind).toBe('preview')
    expect(target.url).toBe('https://juneflower-vn-7f6409d0.tracy.ai')
  })

  it('falls back to the live site, and records which address it tried', async () => {
    const { fetchText } = serving({})
    const target = await resolveTarget('https://juneflower.vn', 'auto', fetchText)
    expect(target.kind).toBe('live')
    expect(target.url).toBe('https://juneflower.vn')
    expect(target.previewTried).toBe('https://juneflower-vn-7f6409d0.tracy.ai')
  })

  // Somebody who names the Preview is usually about to compare the review against a change they made
  // there. Reviewing the live site instead would answer a question they did not ask, and it would
  // look like a successful run.
  it('refuses to fall back when the Preview was asked for by name', async () => {
    const { fetchText } = serving({})
    const target = await resolveTarget('https://juneflower.vn', 'preview', fetchText)
    expect(target.kind).toBe('unreachable')
    expect(target.error).toContain('juneflower-vn-7f6409d0.tracy.ai')
  })

  it('never probes anything when the live site was asked for', async () => {
    const { fetchText, calls } = serving({})
    const target = await resolveTarget('https://juneflower.vn', 'live', fetchText)
    expect(target.kind).toBe('live')
    expect(calls).toEqual([])
  })

  it('takes an explicit address for a copy this construction would not find', async () => {
    const { fetchText } = serving({ 'https://staging.example.com/': { text: 'hi' } })
    const target = await resolveTarget('https://example.com', 'https://staging.example.com', fetchText)
    expect(target).toMatchObject({ kind: 'preview', url: 'https://staging.example.com' })
  })
})

describe('reading a Preview', () => {
  const preview = { kind: 'preview', url: 'https://juneflower-vn-7f6409d0.tracy.ai' }

  // Measured 21/08: the Preview's own address returns 7.9KB of Tracy chrome wrapping the site in an
  // iframe, while the same path with this parameter returns the 129KB page. The first run against
  // a copy found 119 of 120 pages identical because of it.
  it('asks for the page inside the frame, not the frame', () => {
    expect(pageUrl('https://juneflower-vn-7f6409d0.tracy.ai/contact/', preview)).toBe(
      'https://juneflower-vn-7f6409d0.tracy.ai/contact/?__tracy_frame=1'
    )
  })

  it('keeps a query string the page already carried', () => {
    expect(pageUrl('https://juneflower-vn-7f6409d0.tracy.ai/?s=hoa', preview)).toContain('s=hoa')
  })

  it('leaves the live site alone', () => {
    expect(pageUrl('https://juneflower.vn/contact/', { kind: 'live', url: 'https://juneflower.vn' })).toBe(
      'https://juneflower.vn/contact/'
    )
  })

  // A staging copy somewhere else is not the fleet and knows nothing about this parameter.
  it('leaves a Preview that is not on the fleet alone', () => {
    expect(pageUrl('https://staging.example.com/contact/', { kind: 'preview', url: 'https://staging.example.com' })).toBe(
      'https://staging.example.com/contact/'
    )
  })

  // The parameter belongs to the fleet and appears nowhere in the desk's source, so it is used AND
  // checked. Without this the day it is renamed is the day every review reports an empty site.
  it('recognises the shell, so a rename becomes a refusal rather than nonsense', () => {
    expect(looksLikeSnapshotShell('<body><div id="tracy-bar">Tracy Snapshot</div><iframe id="tracy-frame"></iframe>')).toBe(true)
    expect(looksLikeSnapshotShell('<body class="home wp-singular"><h1>Wedding flowers</h1>')).toBe(false)
  })
})
