// Syntax check only. The generated Python is never imported, executed or installed here:
// `python3 -I -m py_compile <file>` in a fresh temp directory outside the repository.
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../generate'
import { acmeHttp, acmeDataset, acmeSql } from '../testing/sample-models'
import type { SourceModel } from '../types'

const probe = spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' })
const hasPython = probe.status === 0
if (!hasPython) console.warn('pycompile.test: python3 not found, syntax checks skipped')

const evil = '"""\nimport os; os.system("x")\n\\" \'\'\' \\N{x} https://evil.example/x'
const hostile: SourceModel = {
  ...acmeHttp,
  name: 'Acme "quoted" \\ name',
  operations: acmeHttp.operations.map((o) => ({ ...o, summary: evil, params: o.params.map((p) => ({ ...p, description: evil })) })),
  entities: acmeHttp.entities.map((e) => ({
    ...e,
    label: evil,
    fields: e.fields.map((f) => ({ ...f, description: evil, label: evil })),
  })),
}
const hostileDataset: SourceModel = {
  ...acmeDataset,
  entities: acmeDataset.entities.map((e) => ({
    ...e,
    label: evil,
    fields: [...e.fields.map((f) => ({ ...f, label: evil })), { name: 'odd "name" \\ here', type: 'string' as const }],
  })),
}

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe.skipIf(!hasPython)('py_compile of generated files', () => {
  const cases: [string, SourceModel][] = [
    ['acme-http', acmeHttp],
    ['acme-dataset', acmeDataset],
    ['acme-sql', acmeSql],
    ['hostile-http', hostile],
    ['hostile-dataset', hostileDataset],
  ]
  for (const [label, model] of cases) {
    it(`${label}: server.py and test_server.py compile`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'mcpgen-pyc-'))
      dirs.push(dir)
      const r = generate(model, {})
      expect(r.files.length).toBeGreaterThan(0)
      for (const name of ['server.py', 'test_server.py']) {
        const file = join(dir, name)
        writeFileSync(file, r.files.find((f) => f.path === name)!.content)
        const res = spawnSync('python3', ['-I', '-m', 'py_compile', file], { encoding: 'utf8' })
        expect(res.status, `${label}/${name}: ${res.stderr}`).toBe(0)
      }
    })
  }
})
