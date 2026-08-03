import fs from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { SkillRecordSchema } from '../src/record'

const target = path.join(process.cwd(), 'schema', 'skill-record.schema.json')
await fs.mkdir(path.dirname(target), { recursive: true })
await fs.writeFile(target, `${JSON.stringify(z.toJSONSchema(SkillRecordSchema), null, 2)}\n`)
console.log(`wrote ${target}`)
