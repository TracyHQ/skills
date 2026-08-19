import { describe, expect, it } from 'vitest'

import { validateNoPrivateRepoReference, validateNumberedReference, validateSkillFrontmatter } from '../validate'

const ALL = ['wordpress', 'woocommerce', 'joomla', 'shopify']

function skill(front: Record<string, string>, body = 'A skill.'): string {
  const lines = Object.entries(front).map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`
}

const good = { name: 'x', description: 'd', version: '1.0.0', provenOn: '—' }
const codes = (errors: { code: string }[]) => errors.map((e) => e.code)

/**
 * The frontmatter half of ADR 0053. Each rule here exists because the thing it catches already
 * happened, or would have on the next edit.
 */
describe('validateSkillFrontmatter', () => {
  it('passes a skill that declares everything', () => {
    expect(validateSkillFrontmatter('a/SKILL.md', skill(good), { platforms: ALL })).toEqual([])
  })

  it('refuses a block the index cannot parse, before judging anything inside it', () => {
    // 2026-08-16: three published skills carried a one-line description holding ": ", which YAML
    // reads as a nested mapping and rejects. Every rule below this one is regex over raw text, so
    // all four gates passed while the index Desk reads got description: null, tags: [] and
    // requiresMcp: [] — the model picks skills BY the description, and requires-mcp is the
    // pre-install warning. Silent both ways, which is why it survived three skills.
    const broken = skill({ ...good, description: 'The Apply direction of a site: the opposite of reskin' })
    const errors = validateSkillFrontmatter('a/SKILL.md', broken, { platforms: ALL })
    expect(codes(errors)).toEqual(['frontmatter_unparseable'])

    // The fix is a block scalar, and then the ordinary rules apply again.
    const folded = `---\nname: x\ndescription: >-\n  The Apply direction of a site: the opposite of reskin\nversion: 1.0.0\nprovenOn: "—"\n---\n\nA skill.\n`
    expect(validateSkillFrontmatter('a/SKILL.md', folded, { platforms: ALL })).toEqual([])
  })

  it('refuses a skill that calls an mcp__ tool without naming the server', () => {
    // The real case: `site-scan` called mcp__tracy-site__scan_now for weeks, so Desk could not
    // warn a team the server was missing and the failure only surfaced after install.
    const body = 'Two triggers, one tool — `mcp__tracy-site__scan_now`.'
    const errors = validateSkillFrontmatter('a/SKILL.md', skill(good, body), { platforms: ALL })
    expect(codes(errors)).toEqual(['requires_mcp_undeclared'])

    const declared = { ...good, 'requires-mcp': '[tracy-site]' }
    expect(validateSkillFrontmatter('a/SKILL.md', skill(declared, body), { platforms: ALL })).toEqual([])
  })

  it('accepts the underscore spelling, because the desk parser does', () => {
    const body = 'calls `mcp__tracy-site__scan_now`'
    const front = { ...good, requires_mcp: '[tracy-site]' }
    expect(validateSkillFrontmatter('a/SKILL.md', skill(front, body), { platforms: ALL })).toEqual([])
  })

  it('requires provenOn, and takes an em dash as the honest answer', () => {
    const { provenOn: _dropped, ...without } = good
    expect(codes(validateSkillFrontmatter('a/SKILL.md', skill(without), { platforms: ALL }))).toContain(
      'proven_on_missing'
    )
    // An empty value is the same as absent: it reads as "nobody got round to it".
    expect(
      codes(validateSkillFrontmatter('a/SKILL.md', skill({ ...good, provenOn: '' }), { platforms: ALL }))
    ).toContain('proven_on_missing')
  })

  it('requires a semver version', () => {
    expect(codes(validateSkillFrontmatter('a/SKILL.md', skill({ ...good, version: '1.3' }), { platforms: ALL }))).toEqual(
      ['version_invalid']
    )
  })

  describe('platforms', () => {
    it('lets "any" stand only when the record actually lists every platform', () => {
      const front = { ...good, platforms: 'any' }
      expect(validateSkillFrontmatter('a/SKILL.md', skill(front), { platforms: ALL })).toEqual([])

      const errors = validateSkillFrontmatter('a/SKILL.md', skill(front), { platforms: ['joomla'] })
      expect(codes(errors)).toEqual(['platforms_contradict_record'])
      expect(errors[0]?.message).toContain('wordpress')
    })

    it('refuses a platform the record does not name', () => {
      const front = { ...good, platforms: 'joomla, shopify' }
      const errors = validateSkillFrontmatter('a/SKILL.md', skill(front), { platforms: ['joomla'] })
      expect(codes(errors)).toEqual(['platforms_contradict_record'])
      expect(errors[0]?.message).toContain('shopify')
    })

    it('says nothing when the frontmatter keeps no copy — the record is the contract', () => {
      expect(validateSkillFrontmatter('a/SKILL.md', skill(good), { platforms: ['joomla'] })).toEqual([])
    })
  })

  it('refuses a file with no frontmatter at all, and stops there', () => {
    expect(codes(validateSkillFrontmatter('a/SKILL.md', '# Just a heading\n', { platforms: ALL }))).toEqual([
      'frontmatter_missing'
    ])
  })
})

/**
 * The 2026-08-13 loss, as a test. A commit renumbered stashed notes to 43–51 to avoid clashing
 * with 37–42 — the right instinct — and the same patch deleted the 37–42 it was avoiding. Four
 * places cited them for three weeks and nothing noticed.
 */
describe('validateNumberedReference', () => {
  const list = (numbers: number[]) => numbers.map((n) => `${n}. **entry ${n}** text.`).join('\n')
  const full = list(Array.from({ length: 51 }, (_, i) => i + 1))
  const codes = (e: { code: string }[]) => e.map((x) => x.code)

  it('passes a gapless list with citations that resolve', () => {
    const cites = [{ file: 'a.sh', text: '# see trap 29 and traps 8-10' }]
    expect(validateNumberedReference('spec.md', full, cites)).toEqual([])
  })

  it('catches the hole', () => {
    const holed = list([...Array.from({ length: 36 }, (_, i) => i + 1), 43, 44, 51])
    const errors = validateNumberedReference('spec.md', holed, [])
    expect(codes(errors)).toEqual(['numbered_reference_gap'])
    expect(errors[0]?.message).toContain('37')
    expect(errors[0]?.message).toContain('42')
  })

  it('catches a citation of a number that is not there, in every form used', () => {
    const holed = list([...Array.from({ length: 36 }, (_, i) => i + 1), 43, 51])
    const cites = [
      { file: 'examples/README.md', text: 'See traps 37/39 in the spec.' },
      { file: 'scripts/fill-block.sh', text: '# trap 37: layouts belong to their template family' }
    ]
    const dangling = validateNumberedReference('spec.md', holed, cites).filter(
      (e) => e.code === 'numbered_reference_dangling'
    )
    expect(dangling).toHaveLength(2)
    expect(dangling[0]?.message).toContain('examples/README.md')
  })

  it('leaves a prose enumeration alone — an ordered list is not an API', () => {
    // Three kinds of link, numbered for reading. Nothing cites them, and a document full of these
    // would otherwise turn every `trap N` elsewhere into a false failure.
    const prose = list([1, 2, 3])
    expect(validateNumberedReference('qa.md', prose, [{ file: 'x.sh', text: 'trap 22' }])).toEqual([])
  })

  it('says nothing about a file with no numbered list at all', () => {
    expect(validateNumberedReference('x.md', '# Heading\n\nProse only.\n', [])).toEqual([])
  })
})

/**
 * ADR 0053's amendment. The case that motivated it: `reskin` told every installer to read
 * `tracy-docs/reskin/README.md` "before your first run", and `tracy-docs` is private.
 */
describe('validateNoPrivateRepoReference', () => {
  const codes = (e: { code: string }[]) => e.map((x) => x.code)

  it('refuses a path rooted at a private repository', () => {
    const errors = validateNoPrivateRepoReference('SKILL.md', 'Read `tracy-docs/reskin/README.md` first.')
    expect(codes(errors)).toEqual(['private_repo_reference'])
    expect(errors[0]?.message).toContain('tracy-docs')
  })

  it('refuses an owner-qualified private repository', () => {
    expect(codes(validateNoPrivateRepoReference('x.sh', '# see TracyHQ/tracy-desk/src'))).toEqual([
      'private_repo_reference'
    ])
  })

  it('leaves a hostname alone — tracy.ai is a repository AND a domain', () => {
    // Every preview address a reskin skill prints would otherwise fail the gate.
    const text = '`joomlart-com-0871462c.tracy.ai` names the stack. curl -H "Host: <label>.tracy.ai"'
    expect(validateNoPrivateRepoReference('SKILL.md', text)).toEqual([])
  })

  it('leaves a path on the fleet host alone', () => {
    // The skill explains how to populate this directory; it is not a repository reference.
    expect(validateNoPrivateRepoReference('SKILL.md', 'scp scripts/* <host>:/opt/tracy-fleet/reskin/')).toEqual([])
  })

  it('says nothing about a public repository', () => {
    expect(validateNoPrivateRepoReference('SKILL.md', 'pinned in `TracyHQ/skills` and `mcp/servers/`')).toEqual([])
  })

  it('refuses a private repository under an owner that is not TracyHQ', () => {
    // The form that shipped: a vendored skill's provenance line, no trailing path, foreign owner.
    const text = 'Ported from the pack in (`lab3-ai/mention-network-shopify`), commit `035e1df0`.'
    expect(codes(validateNoPrivateRepoReference('SKILL.md', text))).toEqual(['private_repo_reference'])
  })

  it('refuses a private repository named in a GitHub URL', () => {
    const text = 'see https://github.com/lab3-ai/mention-network-shopify for the source'
    expect(codes(validateNoPrivateRepoReference('SKILL.md', text))).toEqual(['private_repo_reference'])
  })

  it('reports an owner-qualified reference once, not once per matching form', () => {
    expect(codes(validateNoPrivateRepoReference('x.md', 'github.com/TracyHQ/tracy-desk'))).toEqual([
      'private_repo_reference'
    ])
  })
})
