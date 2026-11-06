// Golden files for the tabular-catalog and sql-ddl adapters: invented input -> real registry ->
// generate() -> byte-stable server.py. Regenerate only deliberately, then read the diff:
//   UPDATE_GOLDEN=1 npx vitest run src/lib/mcpgen/adapters/dataset.golden.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { generate, stableJson } from '../generate'
import { parseInput } from '../registry'
import type { SourceModel } from '../types'

const DIR = fileURLToPath(new URL('../__golden__/', import.meta.url))
const FX = fileURLToPath(new URL('../testing/fixtures/', import.meta.url))
const update = process.env.UPDATE_GOLDEN === '1'
const fx = (n: string) => readFileSync(join(FX, n), 'utf8')

function check(file: string, actual: string) {
  const path = join(DIR, file)
  if (update) {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(path, actual)
    return
  }
  expect(actual).toBe(readFileSync(path, 'utf8'))
}

function build(text: string, adapterId: string, filename?: string) {
  const r = parseInput({ text, filename }, { adapterId })
  if (!r.ok) throw new Error(JSON.stringify(r.gaps))
  return { model: r.model as SourceModel, result: generate(r.model, {}) }
}
const server = (r: ReturnType<typeof generate>) => r.files.find((f) => f.path === 'server.py')!.content

const tabular = build(`${fx('acme-catalog-header.csv')}# dictionary\n${fx('acme-catalog-dictionary.csv')}`, 'tabular-catalog', 'acme-catalog.csv')
const sql = build(fx('acme-schema.sql'), 'sql-ddl', 'acme-schema.sql')

describe('dataset adapter goldens', () => {
  it('tabular-catalog: model and server', () => {
    check('tabular.model.json', stableJson(tabular.model))
    check('tabular.server.py', server(tabular.result))
  })
  it('sql-ddl: model and server', () => {
    check('sqlddl.model.json', stableJson(sql.model))
    check('sqlddl.server.py', server(sql.result))
  })
  it('generation is repeatable', () => {
    expect(server(build(fx('acme-schema.sql'), 'sql-ddl', 'acme-schema.sql').result)).toBe(server(sql.result))
  })
  it('goldens contain no sample row or statement values', () => {
    for (const f of ['tabular.model.json', 'tabular.server.py', 'sqlddl.model.json', 'sqlddl.server.py']) {
      const t = readFileSync(join(DIR, f), 'utf8')
      for (const v of ['ZZ-9001', 'Sample gizmo', 'Zed Distinctive Value', 'Nowhere']) expect(t).not.toContain(v)
      expect(t).not.toMatch(/https?:\/\//)
    }
  })
})

describe('sql server.py safety (text checks)', () => {
  const py = server(sql.result)
  it('identifiers come from an allow-list and values are bound parameters', () => {
    expect(py).toContain('_TABLES')
    expect(py).toContain('Table and column names come only from the generated allow-list')
    expect(py).toContain('conn.execute(sql, args)')
    expect(py).toContain('LIMIT ? OFFSET ?')
    // no string formatting of tool arguments into SQL
    expect(py).not.toMatch(/f"[^"\n]*(SELECT|WHERE|FROM)/)
    expect(py).not.toMatch(/f'[^'\n]*(SELECT|WHERE|FROM)/)
    expect(py).not.toMatch(/\.format\(/)
    expect(py).not.toMatch(/"\s*%\s*\(?\s*(value|field|match|limit|offset)/)
    expect(py).not.toMatch(/(SELECT|WHERE|FROM)[^\n]*"\s*%\s/)
  })
  it('has no data-changing statements and opens the database read-only', () => {
    expect(py).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/)
    expect(py).toContain('?mode=ro')
    expect(py).toContain('PRAGMA query_only = ON')
  })
  it('covers every table of the schema', () => {
    for (const t of ['customer', 'order', 'order_line', 'note_log']) expect(py).toContain(`def query_${t}(`)
  })
})

describe('dataset server.py (tabular)', () => {
  const py = server(tabular.result)
  it('reads the data path from the environment and never contains data', () => {
    expect(py).toContain('ACME_WIDGETS_DATA_PATH')
    expect(py).toContain('def query_widget(')
  })
})

const probe = spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' })
const hasPython = probe.status === 0
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
// Syntax check only; the generated code is never imported or executed.
describe.skipIf(!hasPython)('py_compile', () => {
  for (const [label, built] of [['tabular', tabular], ['sqlddl', sql]] as const) {
    it(`${label}: server.py compiles`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'mcpgen-ds-'))
      dirs.push(dir)
      const file = join(dir, 'server.py')
      writeFileSync(file, server(built.result))
      const res = spawnSync('python3', ['-I', '-m', 'py_compile', file], { encoding: 'utf8' })
      expect(res.status, res.stderr).toBe(0)
    })
  }
})
