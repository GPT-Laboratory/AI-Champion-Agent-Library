// Golden files for the emitted mcptest-binding.json (E10 D3), one per sample backend. Byte equality is the point.
// Regenerate only deliberately, then read the diff: UPDATE_GOLDEN=1 npx vitest run src/lib/mcpgen/binding.golden.test.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generate } from './generate'
import { acmeDataset, acmeHttp, acmeSql } from './testing/sample-models'

const DIR = fileURLToPath(new URL('./__golden__/', import.meta.url))
const update = process.env.UPDATE_GOLDEN === '1'

function check(file: string, actual: string) {
  const path = join(DIR, file)
  if (update) {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(path, actual)
    return
  }
  expect(actual).toBe(readFileSync(path, 'utf8'))
}

const binding = (m: typeof acmeHttp) => generate(m, {}).files.find((f) => f.path === 'mcptest-binding.json')!.content

describe('mcptest-binding.json golden files', () => {
  it('acme-http', () => check('acme-http.mcptest-binding.json', binding(acmeHttp)))
  it('acme-dataset', () => check('acme-dataset.mcptest-binding.json', binding(acmeDataset)))
  it('acme-sql', () => check('acme-sql.mcptest-binding.json', binding(acmeSql)))
})
