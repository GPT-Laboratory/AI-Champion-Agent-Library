// Adversarial and performance tests for the SQL and Prisma readers (D-549). Parsing must be linear
// in the input: each shape below is about the size cap and must finish far below the bound that a
// quadratic parser would exceed (same style as credentials.hardening.test.ts). Nothing here may
// throw, and an input that cannot be read is rejected with gaps, never half-read.
import { describe, it, expect } from 'vitest'
import { sqlDdlAdapter } from './sql-ddl'
import { prismaAdapter } from './prisma'
import { parseInput } from '../registry'
import { stripSqlDumpData } from '../sqlcopy'
import { MAX_INPUT_BYTES } from '../api-contract'
import type { InputAdapter } from '../types'

const BOUND_MS = 1500
const N = 250_000
const OK_TABLE = 'CREATE TABLE ok_t (id INT PRIMARY KEY, name TEXT);\n'

function timed(adapter: InputAdapter, text: string): number {
  const t0 = performance.now()
  expect(() => adapter.parse({ text })).not.toThrow()
  return performance.now() - t0
}

const sqlShapes: Array<[string, string]> = [
  ['huge COPY block', `${OK_TABLE}COPY public.ok_t (id, name) FROM stdin;\n${'1\tsome row text\n'.repeat(15_000)}\\.\n`],
  ['unterminated COPY block', `${OK_TABLE}COPY public.ok_t (id) FROM stdin;\n${'row\n'.repeat(60_000)}`],
  ['many COPY headers without stdin', 'COPY a FROM x;\n'.repeat(15_000)],
  ['unterminated statement', `${OK_TABLE}CREATE TABLE t (${'a INT, '.repeat(35_000)}`],
  ['single quote bomb', `${OK_TABLE}CREATE TABLE t (a TEXT DEFAULT ${"'".repeat(N)}`],
  ['unterminated string with a long body', `${OK_TABLE}INSERT INTO t VALUES ('${'x'.repeat(N)}`],
  ['double quote bomb', `${OK_TABLE}CREATE TABLE "${'"'.repeat(N)}`],
  ['backtick bomb', `${OK_TABLE}CREATE TABLE \`${'`'.repeat(N)}`],
  ['open bracket bomb', `${OK_TABLE}CREATE TABLE t (a ${'['.repeat(N)}`],
  ['open bracket then spaces', `${OK_TABLE}CREATE TABLE t (a INT[${' '.repeat(N)}`],
  ['bracket space runs', `${OK_TABLE}CREATE TABLE t (a INT${'[  '.repeat(80_000)}`],
  ['dollar quote bomb', `${OK_TABLE}${'$$'.repeat(N / 2)}`],
  ['tagged dollar quote bomb', `${OK_TABLE}${'$a$ '.repeat(N / 4)}`],
  ['E string backslash bomb', `${OK_TABLE}CREATE TABLE t (a TEXT DEFAULT E'${'\\'.repeat(N)}`],
  ['escaped quote run', `${OK_TABLE}CREATE TABLE t (a TEXT DEFAULT '${"''".repeat(N / 2)}'`],
  ['deeply nested parentheses (open)', `${OK_TABLE}CREATE TABLE t (a INT DEFAULT ${'('.repeat(N)}`],
  ['deeply nested parentheses (balanced)', `${OK_TABLE}CREATE TABLE t (a INT CHECK ${'('.repeat(100_000)}1${')'.repeat(100_000)});`],
  ['comment bombs', `${OK_TABLE}/*${'/*'.repeat(N / 2)}`],
  ['line comment run', `${OK_TABLE}${'-- c\n'.repeat(50_000)}`],
  ['many semicolons', `${OK_TABLE}${';'.repeat(N)}`],
  ['many SET statements', `${OK_TABLE}${'SET a = 1;\n'.repeat(20_000)}`],
  ['many ALTER constraints', `${OK_TABLE}${'ALTER TABLE ONLY ok_t ADD CONSTRAINT c PRIMARY KEY (id);\n'.repeat(4_000)}`],
  ['one ALTER with thousands of actions', `${OK_TABLE}ALTER TABLE ok_t ${'ADD CONSTRAINT c UNIQUE (name), '.repeat(8_000)}ADD CHECK (id > 0);`],
  ['thousands of tables', Array.from({ length: 6_000 }, (_, i) => `CREATE TABLE t${i} (id INT PRIMARY KEY);`).join('\n')],
  ['one wide table', `CREATE TABLE w (${Array.from({ length: 20_000 }, (_, i) => `c${i} INT`).join(', ')});`],
  ['enum with thousands of labels', `CREATE TYPE e AS ENUM (${Array.from({ length: 20_000 }, (_, i) => `'v${i}'`).join(', ')});\n${OK_TABLE}`],
  ['trigger without END', `${OK_TABLE}CREATE TRIGGER t AFTER INSERT ON a BEGIN ${'UPDATE a SET x=1; '.repeat(10_000)}`],
  ['whitespace after END', `${OK_TABLE}${'END'.repeat(1)}${' '.repeat(N)}`],
  ['psql meta-lines', `${OK_TABLE}${'\\restrict x\n'.repeat(20_000)}`],
]

describe('sql-ddl: linear time on hostile input', () => {
  it.each(sqlShapes)('%s stays fast and never throws', (_n, text) => {
    expect(timed(sqlDdlAdapter, text)).toBeLessThan(BOUND_MS)
  })

  it('stripSqlDumpData is linear for huge and for header-only inputs', () => {
    for (const [, text] of sqlShapes.slice(0, 3)) {
      const t0 = performance.now()
      stripSqlDumpData(text)
      expect(performance.now() - t0).toBeLessThan(BOUND_MS)
    }
  })

  it('the same shapes through the registry stay fast (size cap, scanner, adapter)', () => {
    for (const [, text] of sqlShapes) {
      if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) continue
      const t0 = performance.now()
      expect(() => parseInput({ text })).not.toThrow()
      expect(performance.now() - t0).toBeLessThan(BOUND_MS * 2)
    }
  })

  it('a huge COPY block is skipped, counted and not echoed', () => {
    const text = `${OK_TABLE}COPY public.ok_t (id, name) FROM stdin;\n${'1\tinvented-row-marker\n'.repeat(10_000)}\\.\n`
    const res = parseInput({ text })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.gaps.find((g) => g.code === 'data-rows-skipped')?.message).toMatch(/^10000 data lines in 1 COPY block/)
      expect(JSON.stringify(res)).not.toContain('invented-row-marker')
    }
  })

  it('an unterminated statement is reported, not half-read', () => {
    const r = sqlDdlAdapter.parse({ text: 'CREATE TABLE t (a INT, b TEXT' })
    expect('rejected' in r).toBe(true)
    if ('rejected' in r) expect(r.rejected.map((g) => g.code)).toEqual(expect.arrayContaining(['unparsable-table', 'no-tables']))
  })

  it('a quote bomb after a good table keeps the good table', () => {
    const r = sqlDdlAdapter.parse({ text: `${OK_TABLE}CREATE TABLE bad (a TEXT DEFAULT '${"'".repeat(1000)}` })
    expect('model' in r && r.model.entities.map((e) => e.id)).toEqual(['ok_t'])
  })

  it('a table past the table cap is reported', () => {
    const text = Array.from({ length: 130 }, (_, i) => `CREATE TABLE t${i} (id INT PRIMARY KEY);`).join('\n')
    const r = sqlDdlAdapter.parse({ text })
    expect('model' in r && r.model.entities.length).toBe(100)
    expect('model' in r && r.gaps.some((g) => g.code === 'too-many-tables')).toBe(true)
  })
})

const prismaShapes: Array<[string, string]> = [
  ['unterminated block', `model A {\n${'  id Int @id\n'.repeat(15_000)}`],
  ['unterminated string', `model A {\n  id Int @default("${'x'.repeat(N)}`],
  ['string quote bomb', `datasource db {\n url = ${'"'.repeat(N)}`],
  ['backslash bomb', `model A {\n  a String @map("${'\\'.repeat(N)}`],
  ['deeply nested parentheses', `model A {\n  a Int @default(${'('.repeat(N)}\n}`],
  ['deeply nested braces', `model A {\n${'{'.repeat(N)}`],
  ['many open attributes', `model A {\n${'  a Int @relation(\n'.repeat(12_000)}}`],
  ['many models', Array.from({ length: 6_000 }, (_, i) => `model M${i} {\n  id Int @id\n}`).join('\n')],
  ['many fields', `model W {\n${Array.from({ length: 15_000 }, (_, i) => `  f${i} Int`).join('\n')}\n}`],
  ['many enum values', `enum E {\n${Array.from({ length: 15_000 }, (_, i) => `  V${i}`).join('\n')}\n}\nmodel A {\n  id Int @id\n  e E\n}`],
  ['at signs', `model A {\n  id Int ${'@'.repeat(N)}\n}`],
  ['junk lines', 'zzz\n'.repeat(60_000)],
]

describe('prisma: linear time on hostile input', () => {
  it.each(prismaShapes)('%s stays fast and never throws', (_n, text) => {
    expect(timed(prismaAdapter, text)).toBeLessThan(BOUND_MS)
  })
  it('a huge datasource block is skipped without reading it', () => {
    const text = `datasource db {\n  url = "${'u'.repeat(100_000)}"\n}\nmodel A {\n  id Int @id\n}\n`
    const r = prismaAdapter.parse({ text })
    expect('model' in r && r.model.entities.map((e) => e.id)).toEqual(['A'])
    expect(JSON.stringify(r)).not.toContain('uuuu')
  })
  it('too many models are capped and reported', () => {
    const text = Array.from({ length: 130 }, (_, i) => `model M${i} {\n  id Int @id\n}`).join('\n')
    const r = prismaAdapter.parse({ text })
    expect('model' in r && r.model.entities.length).toBe(100)
    expect('model' in r && r.gaps.some((g) => g.code === 'too-many-tables')).toBe(true)
  })
})
