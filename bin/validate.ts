import fs from 'node:fs/promises'
import path from 'node:path'

import { validateRecordFile } from '../src/validate'

const root = process.cwd()
const registryDir = path.join(root, 'registry')
let failed = 0

const namespaces = await fs.readdir(registryDir).catch(() => [] as string[])
for (const namespace of namespaces.sort()) {
  const dir = path.join(registryDir, namespace)
  if (!(await fs.stat(dir)).isDirectory()) continue
  for (const file of (await fs.readdir(dir)).sort()) {
    if (!file.endsWith('.json')) continue
    const relative = path.posix.join('registry', namespace, file)
    let raw: unknown
    try {
      raw = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'))
    } catch (error) {
      console.error(`FAIL ${relative}: unreadable JSON — ${error instanceof Error ? error.message : error}`)
      failed += 1
      continue
    }
    const errors = validateRecordFile(relative, raw)
    if (errors.length === 0) {
      console.log(`ok   ${relative}`)
      continue
    }
    failed += 1
    for (const error of errors) console.error(`FAIL ${relative}: [${error.code}] ${error.message}`)
  }
}

if (failed > 0) {
  console.error(`${failed} record(s) failed validation`)
  process.exit(1)
}
