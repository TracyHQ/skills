import type { Finding } from '../types'

/**
 * The `disabled-extension-residue` Check (Discipline: Reliability): extensions the site has
 * switched OFF whose database tables are still there, silently carried by every backup and
 * migration (the motivating case: a disabled sh404sef keeping 853k rows of `ja_sh404sef_pageids`
 * through a full site migration).
 *
 * Platform-aware by design — each platform names, stores and leaves residue differently:
 *
 * - **Joomla** (v1, implemented): the cowork component answers `db.tables` (SHOW TABLES, names
 *   only) and the Sync writes it to `surface/db-tables.json` beside `surface/inventory.json`.
 *   A disabled extension's element is looked up in a curated fragment map; only mapped
 *   extensions count, because guessing table ownership from arbitrary element names would
 *   collide with core tables (`content`, `users`, …).
 * - **WordPress** (adapter ready, fuel pending): same file contract, but the cowork plugin has
 *   no `db.tables` parity endpoint yet, so `db-tables.json` never exists for a WP site today.
 *   The adapter maps a deactivated plugin's slug (`plugin:<dir>/<file>.php`) through its own
 *   curated table map the moment the fuel arrives.
 * - **Shopify**: no database door at all — its residue story is theme references to removed
 *   apps, which is a different mechanism and belongs to a future theme-scoped Check, not this
 *   one. No adapter on purpose.
 *
 * The Check runs (and appears in `checksRun`) only when BOTH files are present and the platform
 * has an adapter — a missing answer must read as "not measured", never as "clean".
 */
export const DB_RESIDUE_CHECK_ID = 'disabled-extension-residue'

/** `surface/inventory.json` as this check reads it (the @tracyai/core shape, structurally). */
export type InventoryDoc = {
  items?: Array<{ id?: string; name?: string; state?: string }>
}

/** `surface/db-tables.json` as the Sync writes it. */
export type DbTablesDoc = {
  tables?: string[]
}

/**
 * Joomla: extension element → the table-name fragments it owns. Curated, not guessed — an
 * element missing here is simply not counted (fragments like `content` or `search` would
 * otherwise claim core tables). Fragments match a whole `_`-separated run of the table name.
 */
const JOOMLA_TABLE_FRAGMENTS: Record<string, string[]> = {
  sh404sef: ['sh404sef'],
  osmap: ['osmap'],
  jcomments: ['jcomments'],
  k2: ['k2'],
  kunena: ['kunena'],
  comprofiler: ['comprofiler', 'cbsubs'],
  acymailing: ['acymailing'],
  acym: ['acym'],
  virtuemart: ['virtuemart'],
  hikashop: ['hikashop'],
  rsform: ['rsform'],
  akeeba: ['ak_profiles', 'ak_stats', 'ak_storage'],
  admintools: ['admintools'],
  falang: ['falang'],
  jomsocial: ['community'],
  easyblog: ['easyblog'],
  easysocial: ['social'],
  jevents: ['jevents'],
  djcatalog2: ['djc2'],
  phocagallery: ['phocagallery']
}

/**
 * WordPress: plugin slug (the directory half of `<dir>/<file>.php`) → table fragments. Same
 * matching rule as Joomla; waits on the `db.tables` parity endpoint for fuel.
 */
const WORDPRESS_TABLE_FRAGMENTS: Record<string, string[]> = {
  woocommerce: ['woocommerce', 'wc'],
  'wordpress-seo': ['yoast'],
  redirection: ['redirection'],
  wpforms: ['wpforms'],
  'contact-form-7': ['cf7'],
  elementor: ['e_events', 'e_submissions'],
  'wp-mail-smtp': ['wpmailsmtp'],
  buddypress: ['bp'],
  bbpress: ['bb']
}

type Adapter = {
  /** The map-lookup candidates a disabled item offers (element, slug, …), lowercased. */
  candidatesOf: (item: { id?: string; name?: string }) => string[]
  fragments: Record<string, string[]>
}

const JOOMLA_ID_PREFIX = /^(plg|com|mod|tpl|pkg|lib|files)_/

const ADAPTERS: Record<string, Adapter> = {
  joomla: {
    candidatesOf: (item) => {
      const id = (item.id ?? '').toLowerCase()
      const stripped = id.replace(JOOMLA_ID_PREFIX, '')
      const segments = stripped.split('_')
      return [stripped, segments[segments.length - 1] ?? ''].filter(Boolean)
    },
    fragments: JOOMLA_TABLE_FRAGMENTS
  },
  wordpress: {
    candidatesOf: (item) => {
      const id = (item.id ?? '').toLowerCase()
      if (!id.startsWith('plugin:')) return []
      const slug = id.slice('plugin:'.length).split('/')[0]
      return slug ? [slug] : []
    },
    fragments: WORDPRESS_TABLE_FRAGMENTS
  }
}

/** Whether `fragment` appears as a whole `_`-separated run inside `table` (case-insensitive). */
function tableCarriesFragment(table: string, fragment: string): boolean {
  const t = table.toLowerCase()
  const f = fragment.toLowerCase()
  const at = t.indexOf(f)
  if (at < 0) return false
  const before = at === 0 || t[at - 1] === '_'
  const end = at + f.length
  const after = end === t.length || t[end] === '_'
  return before && after
}

/**
 * Whether this crawl can measure residue at all: an adapter exists for the platform and both
 * surface files answered. Callers use this to gate `checksRun` — only a run that measured may
 * later close the finding as verified.
 */
export function dbResidueCheckRan(input: {
  platform: string | null
  inventory: InventoryDoc | undefined
  dbTables: DbTablesDoc | undefined
}): boolean {
  return Boolean(
    input.platform &&
      ADAPTERS[input.platform] &&
      Array.isArray(input.inventory?.items) &&
      Array.isArray(input.dbTables?.tables)
  )
}

/** Count the tables still owned by disabled extensions. Empty when not measurable or clean. */
export function runDbResidueCheck(input: {
  platform: string | null
  inventory: InventoryDoc | undefined
  dbTables: DbTablesDoc | undefined
}): Finding[] {
  if (!dbResidueCheckRan(input)) return []
  const adapter = ADAPTERS[input.platform as string]
  const tables = (input.dbTables?.tables ?? []).filter((t): t is string => typeof t === 'string')
  const disabled = (input.inventory?.items ?? []).filter((item) => item.state === 'disabled')

  const residueTables = new Set<string>()
  const culprits = new Set<string>()
  for (const item of disabled) {
    for (const candidate of adapter.candidatesOf(item)) {
      const fragments = adapter.fragments[candidate]
      if (!fragments) continue
      for (const table of tables) {
        if (fragments.some((fragment) => tableCarriesFragment(table, fragment))) {
          residueTables.add(table)
          culprits.add(item.name || candidate)
        }
      }
    }
  }

  if (residueTables.size === 0) return []
  const named = [...culprits].sort().slice(0, 3).join(', ')
  return [
    {
      checkId: DB_RESIDUE_CHECK_ID,
      title: `Disabled extensions still keep database tables (${named})`,
      count: residueTables.size,
      priority: 2,
      urls: []
    }
  ]
}
