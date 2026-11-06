// Golden files for the SQL dialect inputs and the Prisma adapter: invented input -> real registry
// -> generate() -> byte-stable model, server.py and report. Regenerate only deliberately, then
// read the diff:
//   UPDATE_GOLDEN=1 npx vitest run src/lib/mcpgen/adapters/sql-dialects.golden.test.ts
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

function build(text: string, filename: string) {
  const r = parseInput({ text, filename })
  if (!r.ok) throw new Error(JSON.stringify(r.gaps))
  return { adapterId: r.adapterId, model: r.model as SourceModel, result: generate(r.model, {}) }
}
const server = (r: ReturnType<typeof generate>) => r.files.find((f) => f.path === 'server.py')!.content

const cases = {
  pgdump: build(fx('acme-pgdump.sql'), 'acme-pgdump.sql'),
  sqlite: build(fx('acme-sqlite.schema'), 'acme-sqlite.schema'),
  mysqldump: build(fx('acme-mysqldump.sql'), 'acme-mysqldump.sql'),
  prisma: build(fx('acme-prisma.prisma'), 'acme-prisma.prisma'),
}

describe('dialect and prisma goldens', () => {
  it.each(Object.entries(cases))('%s: model, server and report', (label, built) => {
    expect(built.result.files.length).toBeGreaterThan(0)
    check(`${label}.model.json`, stableJson(built.model))
    check(`${label}.server.py`, server(built.result))
    check(`${label}.report.json`, stableJson(built.result.report))
  })

  it('adapters picked by auto-detection', () => {
    expect(Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v.adapterId]))).toEqual({ pgdump: 'sql-ddl', sqlite: 'sql-ddl', mysqldump: 'sql-ddl', prisma: 'prisma' })
  })

  it('generation is repeatable', () => {
    expect(server(build(fx('acme-pgdump.sql'), 'acme-pgdump.sql').result)).toBe(server(cases.pgdump.result))
    expect(server(build(fx('acme-prisma.prisma'), 'acme-prisma.prisma').result)).toBe(server(cases.prisma.result))
  })

  it('a pg_dump with COPY data produces the same server as the schema-only dump and reports the skipped lines', () => {
    const withData = build(`${fx('acme-pgdump.sql')}\n${fx('acme-pgdump-data.copy')}`, 'acme-pgdump.sql')
    expect(server(withData.result)).toBe(server(cases.pgdump.result))
    const g = withData.result.report.gaps.find((x) => x.code === 'data-rows-skipped')!
    expect(g.message).toMatch(/^3 data lines in 2 COPY blocks were skipped/)
    const all = JSON.stringify(withData.result)
    for (const v of ['Zed Distinctive Row', 'Second Row Value', 'Nowhere Corp']) expect(all).not.toContain(v)
  })

  it('reports carry the SQLite-backend limitation for pg, mysql and prisma input only', () => {
    const has = (k: keyof typeof cases) => cases[k].result.report.gaps.some((g) => g.code === 'sqlite-backend-only' && g.severity === 'info')
    expect([has('pgdump'), has('mysqldump'), has('prisma'), has('sqlite')]).toEqual([true, true, true, false])
  })

  it('goldens contain no row data, connection strings or urls', () => {
    for (const label of Object.keys(cases)) {
      for (const ext of ['model.json', 'server.py', 'report.json']) {
        const t = readFileSync(join(DIR, `${label}.${ext}`), 'utf8')
        for (const v of ['Zed Distinctive Row', 'Nowhere Corp', 'DATABASE_URL', 'postgresql', 'prisma-client-js']) expect(t).not.toContain(v)
        expect(t).not.toMatch(/https?:\/\//)
      }
    }
  })
})

describe('dialect servers are read-only sqlite readers', () => {
  it.each(Object.entries(cases))('%s: parameterised, allow-listed, opened read-only', (_label, built) => {
    const py = server(built.result)
    expect(py).toContain('?mode=ro')
    expect(py).toContain('PRAGMA query_only = ON')
    expect(py).toContain('conn.execute(sql, args)')
    expect(py).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/)
    expect(py).not.toMatch(/f"[^"\n]*(SELECT|WHERE|FROM)/)
  })
  it('table and column names are the schema names (after @map, @@map and qualifier stripping)', () => {
    expect(server(cases.pgdump.result)).toContain('def query_order(')
    expect(server(cases.prisma.result)).toContain('def query_orders(')
    expect(server(cases.prisma.result)).toContain('customer_name')
    expect(server(cases.mysqldump.result)).toContain('def query_order_line(')
  })
})

const hasPython = spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' }).status === 0
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
// Syntax check only; the generated code is never imported or executed.
describe.skipIf(!hasPython)('py_compile', () => {
  for (const [label, built] of Object.entries(cases)) {
    it(`${label}: server.py compiles`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'mcpgen-dialect-'))
      dirs.push(dir)
      const file = join(dir, 'server.py')
      writeFileSync(file, server(built.result))
      const res = spawnSync('python3', ['-I', '-m', 'py_compile', file], { encoding: 'utf8' })
      expect(res.status, res.stderr).toBe(0)
    })
  }
})
