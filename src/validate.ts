import { ownerOf, SkillRecordSchema } from './record'

export type ValidationError = { code: string; message: string }

/**
 * Luật thuần, không chạm mạng — chạy được trên mọi PR kể cả khi GitHub API hết quota.
 * Kiểm tra sự tồn tại thật của `SKILL.md` nằm ở `build-index`, không ở đây.
 *
 * Đường dẫn file và nội dung file cố tình lặp lại nhau: `git mv` một record sang thư mục khác
 * mà không sửa nội dung là đổi danh tính bản ghi trong im lặng, nên nó phải là lỗi.
 */
export function validateRecordFile(filePath: string, raw: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  const segments = filePath.split('/').filter(Boolean)

  if (segments[0] !== 'registry') {
    errors.push({ code: 'path_outside_registry', message: `record must live under registry/: ${filePath}` })
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
  const pathNamespace = segments[1] ?? ''
  const pathSlug = (segments[2] ?? '').replace(/\.json$/, '')

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

  // Namespace claim bằng quyền sở hữu GitHub: ai kiểm soát org thì kiểm soát namespace.
  if (ownerOf(record.gitUrl).toLowerCase() !== record.namespace.toLowerCase()) {
    errors.push({
      code: 'namespace_not_owner',
      message: `namespace "${record.namespace}" does not own ${record.gitUrl}`
    })
  }

  return errors
}
