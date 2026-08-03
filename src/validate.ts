import { ownerOf, SkillRecordSchema } from './record'

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
