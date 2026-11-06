// Golden files for the deterministic emitter (one per backend kind). Byte equality is the point.
// Regenerate only deliberately, then read the diff: UPDATE_GOLDEN=1 npx vitest run src/lib/mcpgen/emit/golden.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { generate } from '../generate'
import { acmeHttp, acmeDataset, acmeSql } from '../testing/sample-models'

const DIR = fileURLToPath(new URL('../__golden__/', import.meta.url))
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

const content = (m: typeof acmeHttp, name: string) => generate(m, {}).files.find((f) => f.path === name)!.content

describe('golden files', () => {
  it('acme-http: server, generated tests and report', () => {
    check('acme-http.server.py', content(acmeHttp, 'server.py'))
    check('acme-http.test_server.py', content(acmeHttp, 'test_server.py'))
    check('acme-http.report.json', content(acmeHttp, 'report.json'))
  })
  it('acme-dataset: server', () => {
    check('acme-dataset.server.py', content(acmeDataset, 'server.py'))
  })
  it('acme-sql: server', () => {
    check('acme-sql.server.py', content(acmeSql, 'server.py'))
  })
  it('golden files contain only invented data', () => {
    for (const f of ['acme-http.server.py', 'acme-dataset.server.py', 'acme-sql.server.py']) {
      const t = readFileSync(join(DIR, f), 'utf8')
      expect(t).toContain('Acme')
      expect(t).not.toMatch(/https?:\/\//)
    }
  })
})
