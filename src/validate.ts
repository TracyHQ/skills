import matter from 'gray-matter'

import { ownerOf, PlatformSchema, SkillRecordSchema } from './record'

const PLATFORM_VALUES = PlatformSchema.options as readonly string[]

export type ValidationError = { code: string; message: string }

/**
 * Pure rules, no network access — runs on every PR even when the GitHub API is out of quota.
 * Checking that `SKILL.md` actually exists lives in `build-index`, not here.
 *
 * The file path and the file content deliberately mirror each other: `git mv`-ing a record to
 * a different directory without updating its content silently changes the record's identity,
 * so it must be an error.
 */
export function validateRecordFile(filePath: string, raw: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  const segments = filePath.split('/').filter(Boolean)

  if (segments.length !== 3 || segments[0] !== 'registry') {
    errors.push({
      code: 'path_outside_registry',
      message: `record must live at registry/{namespace}/{slug}.json: ${filePath}`
    })
    return errors
  }

  const parsed = SkillRecordSchema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ code: 'schema', message: `${issue.path.join('.') || '(root)'}: ${issue.message}` })
    }
    return errors
  }

  const record = parsed.data
  const pathNamespace = segments[1]!
  const fileSegment = segments[2]!
  const pathSlug = fileSegment.endsWith('.json') ? fileSegment.slice(0, -'.json'.length) : fileSegment

  if (pathNamespace !== record.namespace) {
    errors.push({
      code: 'path_namespace_mismatch',
      message: `directory "${pathNamespace}" does not match namespace "${record.namespace}"`
    })
  }

  if (pathSlug !== record.slug) {
    errors.push({
      code: 'path_slug_mismatch',
      message: `file name "${pathSlug}" does not match slug "${record.slug}"`
    })
  }

  // Namespace claims are backed by GitHub ownership: whoever controls the org controls the namespace.
  if (ownerOf(record.gitUrl).toLowerCase() !== record.namespace.toLowerCase()) {
    errors.push({
      code: 'namespace_not_owner',
      message: `namespace "${record.namespace}" does not own ${record.gitUrl}`
    })
  }

  return errors
}

/**
 * The frontmatter half of the contract (ADR 0053).
 *
 * `validateRecordFile` guards the record JSON, which a schema already describes. Nothing guarded
 * `SKILL.md` — and that is the layer a real bug went through: `site-scan` called
 * `mcp__tracy-site__scan_now` for weeks with no `requires-mcp`, so Tracy Desk could not warn a
 * team that the site was missing the server, and the failure surfaced only after install.
 *
 * Pure like its neighbour: the caller reads the file, this reads the string. Only runs for skills
 * whose source lives in this repository — a record pointing at somebody else's repo names a file
 * this build never sees, and failing a PR over a file it cannot read would be a gate nobody can
 * satisfy.
 */
export function validateSkillFrontmatter(
  filePath: string,
  source: string,
  record: { platforms: string[] }
): ValidationError[] {
  const errors: ValidationError[] = []
  const block = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!block) {
    return [{ code: 'frontmatter_missing', message: `${filePath}: no frontmatter block` }]
  }
  const body = source.slice(block[0].length)
  const front = block[1] ?? ''

  // 0. The block has to be YAML the index can actually read, and this check has to come first
  //    because every rule below is regex over the raw text — regex sees `requires-mcp:` whether or
  //    not the document parses, so a broken block passed all four gates while the index that Desk
  //    reads got nothing at all.
  //
  //    🔒 Found 2026-08-16, three skills deep: `demo-try-on`, `joomla-apply` and `wordpress-apply`
  //    all shipped a one-line `description:` containing ": " (as in "the Apply direction of a
  //    site: the opposite of reskin"), which YAML reads as a nested mapping and rejects. The
  //    parser is written never to throw, so the build carried on and published each of them with
  //    `description: null`, `tags: []` and `requiresMcp: []`. Two costs, both silent: the model
  //    picks skills BY the description, and `requires-mcp` is what warns a team the site is
  //    missing a server before they install. Use a `>-` block scalar for prose.
  try {
    matter(source)
  } catch (error) {
    return [
      {
        code: 'frontmatter_unparseable',
        message: `${filePath}: frontmatter is not valid YAML, so the index reads none of it (${
          (error as Error).message.split('\n')[0]
        })`
      }
    ]
  }

  const field = (name: string): string | null => {
    const m = front.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'))
    const value = m?.[1]?.trim()
    return value ? value : null
  }

  // 1. A skill that names an MCP tool must say which server it needs. Necessary, not sufficient:
  //    a skill calling `fill_block` by its bare name slips through, and catching that needs a
  //    tool catalogue this repository does not have.
  const declaresMcp = /^requires[-_]mcp:/m.test(front)
  if (/mcp__/.test(body) && !declaresMcp) {
    errors.push({
      code: 'requires_mcp_undeclared',
      message: `${filePath}: body calls an mcp__ tool but frontmatter declares no requires-mcp`
    })
  }

  // 2. Evidence of a real run, or an explicit admission there is none. Never absent: an empty
  //    field reads as "nobody got round to it", and "—" reads as "we know, and it is not proven".
  if (!field('provenOn')) {
    errors.push({
      code: 'proven_on_missing',
      message: `${filePath}: provenOn is required — use "—" when the skill has not run on a real site`
    })
  }

  // 3. Version: nothing machine-reads it, but it is what a team pins in the seat book.
  const version = field('version')
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    errors.push({
      code: 'version_invalid',
      message: `${filePath}: version must be semver (got ${version ?? 'nothing'})`
    })
  }

  // 4. `platforms` is the record's to declare; the frontmatter line is a copy for whoever reads
  //    SKILL.md alone, and a copy that disagrees is worse than no copy. `any` is a claim about
  //    every platform, so it only holds when the record actually lists them all.
  const declared = field('platforms')
  if (declared) {
    const named = declared
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
    const inRecord = new Set(record.platforms.map((p) => p.toLowerCase()))
    if (named.length === 1 && named[0] === 'any') {
      const missing = PLATFORM_VALUES.filter((p) => !inRecord.has(p))
      if (missing.length > 0) {
        errors.push({
          code: 'platforms_contradict_record',
          message: `${filePath}: frontmatter says "any" but the record omits ${missing.join(', ')}`
        })
      }
    } else {
      const strays = named.filter((p) => !inRecord.has(p))
      if (strays.length > 0) {
        errors.push({
          code: 'platforms_contradict_record',
          message: `${filePath}: frontmatter names ${strays.join(', ')}, which the record does not`
        })
      }
    }
  }

  return errors
}

/**
 * A numbered list other files cite is an API — check it like one.
 *
 * Written after the reskin trap list lost entries 37–42 on 2026-08-13: a commit that renumbered
 * stashed notes to 43–51 (to avoid clashing, exactly the right instinct) also dropped the 37–42 it
 * was avoiding. Four places went on citing them for three weeks — an example README, a script
 * comment, a `provenOn` field, and one of the surviving traps. Nothing noticed, because a citation
 * to a missing number reads exactly like a citation to a present one.
 *
 * What makes that dangerous is not the broken link. It is that an agent asked to follow the
 * citation cannot find it, knows roughly what such an entry would say, and fills the gap — with an
 * authoritative-looking reference to something it never read.
 *
 * Two rules, both cheap:
 *  - the sequence has no holes, and
 *  - every `trap N` written anywhere in the skill points at an entry that exists.
 */
/** Below this, an ordered list is prose, not an API. */
const CITABLE_SEQUENCE_MIN = 10

export function validateNumberedReference(
  refPath: string,
  refSource: string,
  citations: Array<{ file: string; text: string }>
): ValidationError[] {
  const errors: ValidationError[] = []
  const present = new Set<number>()
  for (const line of refSource.split('\n')) {
    const m = /^(\d{1,3})\. \*\*/.exec(line)
    if (m) present.add(Number(m[1]))
  }
  // A prose enumeration ("1. Routable / 2. Internal / 3. External") is not a citable reference,
  // and treating it as one makes every ordered list in a document a source of false failures.
  // A list other files cite by number is long by nature — the trap list that motivated this
  // check runs to 51.
  if (present.size === 0 || Math.max(...present) < CITABLE_SEQUENCE_MIN) return errors

  const highest = Math.max(...present)
  const holes = Array.from({ length: highest }, (_, i) => i + 1).filter((n) => !present.has(n))
  if (holes.length > 0) {
    errors.push({
      code: 'numbered_reference_gap',
      message: `${refPath}: numbered list runs to ${highest} but is missing ${holes.join(', ')}`
    })
  }

  // `trap 29`, `traps 8-10`, `traps 37/39` — every form the skills actually use.
  for (const { file, text } of citations) {
    for (const cite of text.matchAll(/\btraps?\s+(\d{1,3}(?:\s*[-/,]\s*\d{1,3})*)/gi)) {
      const cited = (cite[1] ?? '').split(/[-/,]/).map((n) => Number(n.trim()))
      const dangling = cited.filter((n) => Number.isFinite(n) && !present.has(n))
      if (dangling.length > 0) {
        errors.push({
          code: 'numbered_reference_dangling',
          message: `${file}: cites "${cite[0]}" but ${refPath} has no ${dangling.join(', ')}`
        })
      }
    }
  }
  return errors
}

/**
 * Repositories a reader outside Tracy cannot open. Names, not paths: the check below decides
 * what counts as a reference to one.
 */
const PRIVATE_REPOS = ['tracy-desk', 'tracy-docs', 'tracy-fleet', 'tracy.ai'] as const

/**
 * A published skill must be readable by whoever can install it (ADR 0053, amendment).
 *
 * `reskin` told every installer to read `tracy-docs/reskin/README.md` "before your first run" —
 * a private repository. The damage is not the broken link: an agent that cannot reach a cited
 * document still knows one exists, knows roughly what it says, and fills the gap while citing a
 * source it never read. The reverse is a leak — a public repo naming a private one's internal
 * paths.
 *
 * Matched as a REFERENCE, not as a name. `tracy.ai` is a repository and a domain, so
 * `joomlart-com-0871462c.tracy.ai` is a hostname and must not fail, and `/opt/tracy-fleet/reskin`
 * is a directory on a host that the skill itself explains how to populate. What fails is a repo
 * root followed by a path (`tracy-docs/reskin/README.md`) or an owner-qualified name
 * (`TracyHQ/tracy-desk`) — the two forms that tell a reader to go and open something.
 */
export function validateNoPrivateRepoReference(
  filePath: string,
  source: string
): ValidationError[] {
  const errors: ValidationError[] = []
  for (const repo of PRIVATE_REPOS) {
    const name = repo.replace(/[.]/g, '\\.')
    // Owner-qualified, or a repo root starting a path. `(?<![\w./-])` keeps `.tracy.ai` and
    // `/opt/tracy-fleet` out: both are preceded by a character that makes them something else.
    const pattern = new RegExp(`(?<![\\w./-])(?:TracyHQ/)?${name}/[\\w.-]`, 'g')
    for (const hit of source.matchAll(pattern)) {
      errors.push({
        code: 'private_repo_reference',
        message: `${filePath}: points at \`${hit[0]}\` — ${repo} is private, and an installer cannot open it`
      })
    }
  }
  return errors
}
