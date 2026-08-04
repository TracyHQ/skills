import fs from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { SkillRecordSchema } from '../src/record'

const target = path.join(process.cwd(), 'schema', 'skill-record.schema.json')
await fs.mkdir(path.dirname(target), { recursive: true })

/**
 * `io: 'input'` — this schema describes the file a submitter writes, which is what their
 * editor validates against via the record's own `$schema` key. Zod's default mode emits the
 * *output* type, where every field carrying `.default()` has already been filled in and is
 * therefore marked required. That produced a schema stricter than the registry itself:
 * `pnpm validate` accepts a record with no `ref` and no `platforms` and supplies the defaults,
 * while the published schema flagged both as missing. An editor contradicting CI teaches
 * people to ignore the editor.
 */
await fs.writeFile(target, `${JSON.stringify(z.toJSONSchema(SkillRecordSchema, { io: 'input' }), null, 2)}\n`)
console.log(`wrote ${target}`)
