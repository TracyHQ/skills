import { describe, expect, it } from 'vitest'

import type { UcpSurface } from '../harvest/ucp'
import { noteAgentDoor, noteClosed, noteInventory, noteRobots, noteVerdict } from '../narration'
import type { Finding } from '../types'

const probe = (over: Partial<UcpSurface['brand']> = {}): UcpSurface['brand'] => ({
  origin: 'https://a.com',
  status: 404,
  json: false,
  capabilities: [],
  paymentHandlers: [],
  signingKeys: false,
  ...over
})

const finding = (over: Partial<Finding> = {}): Finding => ({
  checkId: 'x',
  title: 'x',
  count: 1,
  priority: 1,
  urls: [],
  ...over
})

describe('the narration script', () => {
  it('tells the agent-door story with its three endings', () => {
    const found = probe({ status: 200, json: true, version: '2026-04-08' })
    expect(noteAgentDoor({ brand: found, agentFiles: [] }).kind).toBe('agent-door-found')
    // The twist: a working profile exists, but on a domain no assistant is ever told about.
    expect(noteAgentDoor({ brand: probe(), platform: found, agentFiles: [] }).kind).toBe('agent-door-split')
    expect(noteAgentDoor({ brand: probe(), agentFiles: [] }).kind).toBe('agent-door-missing')
  })

  it('only sounds the robots alarm when everything was turned away', () => {
    expect(noteRobots(0, 214)?.kind).toBe('robots-blocks-all')
    expect(noteRobots(200, 14)).toBeUndefined()
    // A site with no urls at all has nothing blocked — silence, not alarm.
    expect(noteRobots(0, 0)).toBeUndefined()
  })

  it('celebrates closed checks only when there are any', () => {
    expect(noteClosed(0)).toBeUndefined()
    expect(noteClosed(3)).toEqual({ kind: 'checks-closed', count: 3 })
  })

  it('never lets a platform limit be the verdict', () => {
    expect(noteVerdict([finding({ platformLimit: true })]).kind).toBe('checks-clean')
    expect(noteVerdict([finding(), finding({ platformLimit: true })])).toEqual({ kind: 'checks-found', count: 1 })
  })

  it('reports the map or the lack of one, with the count riding along', () => {
    expect(noteInventory(214)).toEqual({ kind: 'sitemap-found', count: 214 })
    expect(noteInventory(0).kind).toBe('sitemap-missing')
  })
})
