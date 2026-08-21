import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

/**
 * The merge rules, exercised through the command line the agent actually calls.
 *
 * Every rule here fails silently when it is wrong. A state that does not carry re-asks about a
 * fault somebody already dismissed; a finding wrongly called fixed congratulates them for work
 * nobody did; a finding on a page nobody re-opened being marked either way is an answer invented
 * out of no evidence at all. None of those raise an error, and all of them destroy the one thing
 * this file is for — that the review remembers.
 */
const REVIEW = fileURLToPath(new URL('../scripts/review.mjs', import.meta.url))
const PREVIEW = 'https://example-com-1a2b3c4d.tracy.ai'

let work: string
const at = (...p: string[]) => path.join(work, ...p)
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

/** Runs the command the agent runs. A refusal is rethrown carrying what it said, not "exit 2". */
const run = (...args: string[]) => {
  try {
    return JSON.parse(execFileSync(process.execPath, [REVIEW, ...args], { encoding: 'utf8', stdio: 'pipe' }))
  } catch (e) {
    throw new Error(String((e as { stderr?: string }).stderr || (e as Error).message))
  }
}

/** One measured block, addressable the way the capture writes it. */
const block = (id: string, hint: string) => ({
  id,
  selector: `main > section:nth-of-type(${id.slice(1)})`,
  textHint: hint,
  rect: { x: 0, y: 100, w: 800, h: 300 }
})

function capture(pages: { url: string; slug: string; blocks: ReturnType<typeof block>[] }[]) {
  mkdirSync(at('capture', 'pages'), { recursive: true })
  for (const p of pages) {
    writeFileSync(
      at('capture', 'pages', `${p.slug}.json`),
      JSON.stringify({ url: p.url, slug: p.slug, viewports: { desktop: { title: p.slug, sections: p.blocks } } })
    )
  }
  writeFileSync(
    at('capture', 'index.json'),
    JSON.stringify({
      capturedAt: '2026-08-21T09:00:00Z',
      viewports: ['desktop'],
      pages: pages.map((p) => ({ url: p.url, slug: p.slug, measurements: path.join('pages', `${p.slug}.json`) }))
    })
  )
}

/** `opened` is what a second look actually re-opens: on a recheck, only the pages that changed. */
function survey(pages: string[], opened = pages) {
  writeFileSync(
    at('survey.json'),
    JSON.stringify({
      site: 'https://example.com',
      scannedAgainst: { kind: 'preview', url: PREVIEW, revision: null, at: '2026-08-21T09:00:00Z' },
      pages: pages.map((p) => ({ url: p, scanUrl: `${PREVIEW}${p}`, fingerprint: `sha256:${p}` })),
      pagesToReview: opened.map((p) => `${PREVIEW}${p}`),
      droppedFromReview: 3
    })
  )
}

type Finding = { id: string; severity: string; page: string; blockIds: string[]; forOwner: string }
function findings(list: Finding[]) {
  writeFileSync(
    at('findings.json'),
    JSON.stringify({ language: 'en', summary: 'The contact page was never finished.', findings: list.map((f) => ({ kind: 'fixed', viewport: 'desktop', forBuilder: 'b', ...f })) })
  )
}

const build = () =>
  run('build', '--review', at('out', 'review.json'), '--capture', at('capture'), '--survey', at('survey.json'), '--findings', at('findings.json'))

const emptyBlock = {
  id: 'empty-block',
  severity: 'high',
  page: `${PREVIEW}/contact/`,
  blockIds: ['b2'],
  forOwner: 'The contact page gives a visitor no way to reach the business.'
}

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), 'ui-check-'))
  capture([{ url: `${PREVIEW}/contact/`, slug: 'contact', blocks: [block('b2', 'Contact us')] }])
  survey(['/contact/'])
  findings([emptyBlock])
})

describe('build', () => {
  it('files a finding by path, with the address the capture measured', () => {
    build()
    const [f] = json(at('out', 'review.json')).findings
    expect(f).toMatchObject({
      id: 'f1',
      state: 'new',
      page: '/contact/',
      checkId: 'empty-block',
      selectors: ['main > section:nth-of-type(2)']
    })
    expect(f.fingerprint).toMatch(/^sha256:[0-9a-f]{16}$/)
  })

  it('writes the copy it was read against where a reader cannot miss it', () => {
    build()
    const md = readFileSync(at('out', 'review.md'), 'utf8')
    expect(md).toContain(PREVIEW)
    expect(md).toContain('the Preview publishes no revision')
    expect(md).toContain('3 page(s) were left out')
  })

  it('carries the decision somebody already made', () => {
    build()
    run('decide', '--review', at('out', 'review.json'), '--id', 'f1', '--state', 'ignored')
    const second = build()
    const [f] = json(at('out', 'review.json')).findings
    expect(f).toMatchObject({ id: 'f1', state: 'ignored' })
    expect(second.newSinceLastRun).toBe(0)
    expect(second.open).toBe(0)
  })

  it('re-asks when the block it points at now says something else', () => {
    build()
    run('decide', '--review', at('out', 'review.json'), '--id', 'f1', '--state', 'ignored')
    capture([{ url: `${PREVIEW}/contact/`, slug: 'contact', blocks: [block('b2', 'About us')] }])
    build()
    const review = json(at('out', 'review.json'))
    expect(review.findings.map((f: { state: string }) => f.state)).toEqual(['new'])
    expect(review.findings[0].id).toBe('f2')
  })

  it('calls a finding fixed only when the page was opened again', () => {
    build()
    findings([])
    build()
    const review = json(at('out', 'review.json'))
    expect(review.findings).toHaveLength(0)
    expect(review.fixedCount).toBe(1)
    // It leaves the file for the archive rather than staying as a line nobody reads: the list of
    // things that are no longer wrong grows forever, while the count is what an owner asks for.
    const archive = at('out', 'archive', new Date().toISOString().slice(0, 10), 'fixed.json')
    expect(existsSync(archive)).toBe(true)
    const archived = json(archive)
    expect(archived[0]).toMatchObject({ id: 'f1', state: 'fixed' })
  })

  // The rule that makes a second look cheap: pages whose content did not change are not re-opened,
  // so they can prove nothing either way and everything on them is carried through untouched.
  it('carries findings on a page this run never opened', () => {
    build()
    run('decide', '--review', at('out', 'review.json'), '--id', 'f1', '--state', 'saved')
    survey(['/contact/'], [])
    findings([])
    capture([])
    const second = build()
    expect(second.carriedOver).toBe(1)
    expect(json(at('out', 'review.json')).findings[0]).toMatchObject({ id: 'f1', state: 'saved' })
    expect(json(at('out', 'review.json')).fixedCount).toBe(0)
  })
})

describe('next', () => {
  const three = (severity: string) =>
    ['b2', 'b3', 'b4'].map((b, i) => ({ ...emptyBlock, id: `check-${i}`, severity, blockIds: [b] }))

  beforeEach(() => {
    capture([{ url: `${PREVIEW}/contact/`, slug: 'contact', blocks: [block('b2', 'a'), block('b3', 'b'), block('b4', 'c')] }])
  })

  it('asks about a serious finding on its own', () => {
    findings(three('high'))
    build()
    const out = run('next', '--review', at('out', 'review.json'))
    expect(out.mode).toBe('one')
    expect(out.remaining).toEqual({ open: 3, high: 3 })
  })

  // Three questions to settle three things nobody would have named unprompted is where a person
  // stops answering. The small ones arrive as one question with one answer.
  it('puts the small ones in a single question', () => {
    findings(three('low'))
    build()
    const out = run('next', '--review', at('out', 'review.json'))
    expect(out.mode).toBe('batch')
    expect(out.findings).toHaveLength(3)
  })

  it('takes the serious ones first', () => {
    findings([{ ...emptyBlock, severity: 'low', blockIds: ['b3'] }, { ...emptyBlock, severity: 'high', blockIds: ['b2'] }])
    build()
    expect(run('next', '--review', at('out', 'review.json')).finding.severity).toBe('high')
  })
})

describe('decide', () => {
  beforeEach(() => build())
  const review = () => at('out', 'review.json')

  it('hands back the next question in the same breath', () => {
    capture([{ url: `${PREVIEW}/contact/`, slug: 'contact', blocks: [block('b2', 'Contact us'), block('b3', 'b')] }])
    findings([emptyBlock, { ...emptyBlock, id: 'thin-page', severity: 'medium', blockIds: ['b3'] }])
    build()
    const out = run('decide', '--review', review(), '--id', 'f1', '--state', 'saved')
    expect(out.next.mode).toBe('one')
    expect(out.next.finding.checkId).toBe('thin-page')
  })

  // "Explain this to me" is not a decision. It leaves the finding open so the next run asks again,
  // and it leaves no timestamp, because nothing was settled.
  it('records being looked at without recording a decision', () => {
    run('decide', '--review', review(), '--id', 'f1', '--state', 'seen')
    const [f] = json(review()).findings
    expect(f).toMatchObject({ state: 'seen', decidedAt: null })
    expect(json(review()).status).toBe('in_progress')
  })

  it('closes the review once nothing is open', () => {
    const out = run('decide', '--review', review(), '--id', 'f1', '--state', 'ignored')
    expect(out.next.done).toBe(true)
    expect(json(review()).status).toBe('closed')
    expect(json(review()).findings[0].decidedAt).toMatch(/^\d{4}-\d\d-\d\d/)
  })

  it('refuses an id it does not know rather than silently doing nothing', () => {
    expect(() => run('decide', '--review', review(), '--id', 'f9', '--state', 'saved')).toThrow(/no such finding/)
    expect(json(review()).findings[0].state).toBe('new')
  })
})

describe('deciding a whole group at once', () => {
  beforeEach(() => {
    capture([
      { url: `${PREVIEW}/contact/`, slug: 'contact', blocks: [block('b2', 'Contact us'), block('b3', 'b'), block('b4', 'c')] }
    ])
    findings([
      emptyBlock,
      { ...emptyBlock, id: 'thin-page', severity: 'medium', blockIds: ['b3'] },
      { ...emptyBlock, id: 'demo-page-live', severity: 'low', blockIds: ['b4'] }
    ])
    build()
  })

  const review = () => at('out', 'review.json')
  const stateOf = (id: string) =>
    json(review()).findings.find((f: { id: string }) => f.id === id)?.state

  /**
   * Every command an agent runs costs the customer an approval dialog. Writing each answer the
   * moment it is given turned an eleven-finding review into eleven dialogs stacked on top of the
   * eleven questions that were the point — and a dialog that appears eleven times is one nobody
   * reads by the fourth.
   */
  it('takes different answers for different findings in one call', () => {
    const out = run('decide', '--review', review(), '--saved', 'f1', '--ignored', 'f2,f3')
    expect(out.decided).toEqual({ f1: 'saved', f2: 'ignored', f3: 'ignored' })
    expect(stateOf('f1')).toBe('saved')
    expect(stateOf('f2')).toBe('ignored')
    expect(stateOf('f3')).toBe('ignored')
    expect(json(review()).status).toBe('closed')
  })

  // Half a batch is worse than none: the person's answers would then live in two places, the file
  // and the conversation, disagreeing about which of them happened.
  it('writes nothing at all when one id in the batch is unknown', () => {
    expect(() => run('decide', '--review', review(), '--saved', 'f1,f99')).toThrow(/no such finding: f99/)
    expect(stateOf('f1')).toBe('new')
  })

  it('still takes a single answer the old way', () => {
    run('decide', '--review', review(), '--id', 'f1', '--state', 'saved')
    expect(stateOf('f1')).toBe('saved')
  })

  it('refuses a call that names no finding at all', () => {
    expect(() => run('decide', '--review', review())).toThrow(/decide needs/)
  })
})

describe('overview', () => {
  it('counts what was set aside instead of hiding it', () => {
    build()
    run('decide', '--review', at('out', 'review.json'), '--id', 'f1', '--state', 'ignored')
    const out = run('overview', '--review', at('out', 'review.json'))
    expect(out).toMatchObject({ total: 1, open: 0, ignored: 1, status: 'closed', droppedFromReview: 3 })
    expect(out.bySeverity).toEqual({ high: 1, medium: 0, low: 0 })
  })

  it('says so rather than crashing when there is no review yet', () => {
    expect(() => run('overview', '--review', at('nothing', 'review.json'))).toThrow(/no review at/)
  })
})
