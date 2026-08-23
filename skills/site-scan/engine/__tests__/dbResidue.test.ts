import { describe, expect, it } from 'vitest'

import { DB_RESIDUE_CHECK_ID, dbResidueCheckRan, runDbResidueCheck } from '../analyze/dbResidue'

const JOOMLA_TABLES = {
  tables: [
    'ja_content',
    'ja_users',
    'ja_sh404sef_pageids',
    'ja_sh404sef_urls',
    'ja_k2_items',
    'ja_osmap_sitemap',
    'ja_jcomments'
  ]
}

describe('dbResidue', () => {
  it('counts the tables of disabled joomla extensions through the curated map', () => {
    const findings = runDbResidueCheck({
      platform: 'joomla',
      inventory: {
        items: [
          { id: 'com_sh404sef', name: 'sh404SEF', state: 'disabled' },
          { id: 'plg_system_sh404sef', name: 'sh404SEF system plugin', state: 'disabled' },
          { id: 'com_k2', name: 'K2', state: 'enabled' },
          { id: 'com_osmap', name: 'OSMap', state: 'disabled' }
        ]
      },
      dbTables: JOOMLA_TABLES
    })

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding.checkId).toBe(DB_RESIDUE_CHECK_ID)
    // sh404sef owns two tables, osmap one; K2 is enabled so ja_k2_items is not residue.
    expect(finding.count).toBe(3)
    expect(finding.priority).toBe(2)
    expect(finding.urls).toEqual([])
    expect(finding.title).toContain('OSMap')
    expect(finding.platformLimit).toBeUndefined()
  })

  it('never claims a core table for a disabled extension outside the map', () => {
    const findings = runDbResidueCheck({
      platform: 'joomla',
      inventory: {
        // `content` as an element would text-match `ja_content` — the curated map must not
        // list it, and an unmapped element must count nothing.
        items: [{ id: 'plg_search_content', name: 'Search content', state: 'disabled' }]
      },
      dbTables: JOOMLA_TABLES
    })
    expect(findings).toEqual([])
  })

  it('maps a deactivated wordpress plugin slug when table fuel exists', () => {
    const findings = runDbResidueCheck({
      platform: 'wordpress',
      inventory: {
        items: [
          { id: 'plugin:redirection/redirection.php', name: 'Redirection', state: 'disabled' },
          { id: 'plugin:akismet/akismet.php', name: 'Akismet', state: 'enabled' }
        ]
      },
      dbTables: { tables: ['wp_posts', 'wp_redirection_items', 'wp_redirection_logs'] }
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].count).toBe(2)
  })

  it('does not run without fuel, an adapter, or a platform', () => {
    const inventory = { items: [{ id: 'com_sh404sef', state: 'disabled' }] }
    expect(dbResidueCheckRan({ platform: 'joomla', inventory, dbTables: undefined })).toBe(false)
    expect(dbResidueCheckRan({ platform: 'joomla', inventory: undefined, dbTables: JOOMLA_TABLES })).toBe(false)
    expect(dbResidueCheckRan({ platform: 'shopify', inventory, dbTables: JOOMLA_TABLES })).toBe(false)
    expect(dbResidueCheckRan({ platform: null, inventory, dbTables: JOOMLA_TABLES })).toBe(false)
    expect(runDbResidueCheck({ platform: 'joomla', inventory, dbTables: undefined })).toEqual([])
  })

  it('does not claim a live family because one connector plugin is off (joomlart rsform case)', () => {
    const findings = runDbResidueCheck({
      platform: 'joomla',
      inventory: {
        items: [
          { id: 'com_rsform', name: 'RSForm! Pro', state: 'enabled' },
          { id: 'plg_pagecache_rsform', name: 'Page Cache - RSForm! Pro', state: 'disabled' },
          { id: 'com_sh404sef', name: 'sh404SEF', state: 'disabled' },
          { id: 'plg_system_sh404sef', name: 'sh404sef - System plugin', state: 'disabled' }
        ]
      },
      dbTables: {
        tables: ['ja_rsform_forms', 'ja_rsform_submissions', 'ja_sh404sef_pageids', 'ja_sh404sef_urls']
      }
    })
    // rsform is vetoed by its enabled owner; sh404sef is disabled wholesale, so only its
    // tables count.
    expect(findings).toHaveLength(1)
    expect(findings[0].count).toBe(2)
    expect(findings[0].title).not.toContain('RSForm')
  })

  it('treats an unknown-state claimant as live, never as residue', () => {
    expect(
      runDbResidueCheck({
        platform: 'joomla',
        inventory: {
          items: [
            { id: 'com_k2', name: 'K2', state: 'unknown' },
            { id: 'plg_xmap_com_k2', name: 'Xmap - K2 Plugin', state: 'disabled' }
          ]
        },
        dbTables: { tables: ['ja_k2_items'] }
      })
    ).toEqual([])
  })

  it('never counts a table already in the trash, so a cleanup closes the finding', () => {
    expect(
      runDbResidueCheck({
        platform: 'joomla',
        inventory: { items: [{ id: 'com_sh404sef', name: 'sh404SEF', state: 'disabled' }] },
        dbTables: { tables: ['_tracy_trash_20260823__ja_sh404sef_pageids', 'ja_content'] }
      })
    ).toEqual([])
  })

  it('reports nothing when every mapped extension is clean or enabled', () => {
    expect(
      runDbResidueCheck({
        platform: 'joomla',
        inventory: { items: [{ id: 'com_k2', name: 'K2', state: 'enabled' }] },
        dbTables: JOOMLA_TABLES
      })
    ).toEqual([])
    expect(
      dbResidueCheckRan({
        platform: 'joomla',
        inventory: { items: [] },
        dbTables: JOOMLA_TABLES
      })
    ).toBe(true)
  })
})
