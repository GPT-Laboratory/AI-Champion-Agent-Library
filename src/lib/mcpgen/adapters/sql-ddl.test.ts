import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sqlDdlAdapter as adapter } from './sql-ddl'
import { parseInput } from '../registry'
import type { ParseResult, SourceModel } from '../types'

const fx = (n: string) => readFileSync(fileURLToPath(new URL(`../testing/fixtures/${n}`, import.meta.url)), 'utf8')
const GOOD = fx('acme-schema.sql')
const BAD = fx('acme-schema-bad.sql')

function ok(r: ParseResult): SourceModel {
  if ('rejected' in r) throw new Error(`rejected: ${JSON.stringify(r.rejected)}`)
  return r.model
}
const codes = (r: ParseResult) => ('rejected' in r ? r.rejected : r.gaps).map((g) => g.code)

describe('sql-ddl adapter', () => {
  it('detects CREATE TABLE only', () => {
    expect(adapter.detect({ text: GOOD })).toBe(0.9)
    expect(adapter.detect({ text: 'create  table t (a int)' })).toBe(0.9)
    expect(adapter.detect({ text: 'a,b,c\n1,2,3' })).toBe(0)
    expect(adapter.detect({ text: 'SELECT 1' })).toBe(0)
  })

  it('parses tables, types, keys and foreign keys', () => {
    const m = ok(adapter.parse({ text: GOOD, filename: 'acme-schema.sql' }))
    expect(m.name).toBe('Acme Schema')
    expect(m.backend).toEqual({ kind: 'sql', dsnEnv: 'ACME_SCHEMA_DB_PATH' })
    expect(m.entities.map((e) => e.id)).toEqual(['customer', 'order', 'order_line', 'note_log'])
    const customer = m.entities[0]
    expect(customer.identifierFields).toEqual(['customer_id'])
    const by = (e: number) => Object.fromEntries(m.entities[e].fields.map((f) => [f.name, f]))
    expect(by(0).customer_id).toMatchObject({ type: 'integer', identifier: true, nullable: false })
    expect(by(0).customer_name.type).toBe('string')
    expect(by(1).total.type).toBe('number')
    expect(by(1).placed_on.type).toBe('string')
    expect(by(1).customer_id.description).toBe('References customer.customer_id')
    expect(m.entities[1].identifierFields).toEqual(['order_id'])
    expect(m.entities[2].identifierFields).toEqual(['order_id', 'line_no'])
    expect(by(2).order_id.description).toBe('References order.order_id')
    expect(by(2).quantity.type).toBe('integer')
  })

  it('builds read-only SELECT list and get operations', () => {
    const m = ok(adapter.parse({ text: GOOD }))
    expect(m.operations.every((o) => o.method === 'SELECT')).toBe(true)
    expect(m.operations.map((o) => o.id)).toContain('get_order_line')
    expect(m.operations.map((o) => o.id)).not.toContain('get_note_log')
    const get = m.operations.find((o) => o.id === 'get_order_line')!
    expect(get.params.map((p) => p.name)).toEqual(['order_id', 'line_no'])
    expect(m.limits.maxPageSize).toBe(100)
  })

  it('reports write statements, views and indexes and never turns them into tools', () => {
    const r = adapter.parse({ text: GOOD })
    const m = ok(r)
    const c = codes(r)
    expect(c).toContain('statement-ignored')
    expect(c).toContain('unsupported-statement')
    expect(m.writeOperationsDropped).toEqual(['delete:note_log', 'drop:legacy_table', 'insert:customer', 'update:customer'])
    expect(m.entities.map((e) => e.id)).not.toContain('open_orders')
    expect(m.operations.some((o) => /insert|update|delete|drop/i.test(o.id))).toBe(false)
    const inserts = (r as { gaps: { code: string; severity: string }[] }).gaps.filter((g) => g.code === 'statement-ignored')
    expect(inserts.length).toBe(4)
  })

  it('never copies literal values from DEFAULT or INSERT into the model', () => {
    const json = JSON.stringify(ok(adapter.parse({ text: GOOD })))
    for (const v of ['Zed Distinctive Value', 'Nowhere', 'standard', "'open'"]) expect(json).not.toContain(v)
  })

  it('handles quoting styles, comments and IF NOT EXISTS', () => {
    const sql = `-- c\nCREATE TABLE IF NOT EXISTS [dbo].[Part] ( /* x */ [PartId] INT PRIMARY KEY, \`Label\` TEXT, "Qty" BIGINT NOT NULL );`
    const m = ok(adapter.parse({ text: sql }))
    expect(m.entities[0].id).toBe('Part')
    expect(m.entities[0].fields.map((f) => f.name)).toEqual(['PartId', 'Label', 'Qty'])
    expect(m.entities[0].identifierFields).toEqual(['PartId'])
  })

  it('keeps semicolons and keywords inside strings and trigger bodies from becoming statements', () => {
    const sql = `CREATE TABLE a (x INT PRIMARY KEY, y TEXT DEFAULT 'a;b INSERT INTO z');\nCREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET y='q'; END;`
    const r = adapter.parse({ text: sql })
    const m = ok(r)
    expect(m.entities.length).toBe(1)
    expect(m.writeOperationsDropped).toEqual([])
    expect(codes(r)).toContain('unsupported-statement')
  })

  it('reports a table without a primary key', () => {
    const r = adapter.parse({ text: GOOD })
    expect((r as { gaps: { code: string; path?: string }[] }).gaps.find((g) => g.code === 'no-identifier')?.path).toBe('note_log')
  })

  it('reports unknown and composite types', () => {
    const r = adapter.parse({ text: 'CREATE TABLE t (a INT PRIMARY KEY, b GEOMETRY, c INT[], d TEXT[]);' })
    const m = ok(r)
    expect(codes(r)).toEqual(expect.arrayContaining(['unknown-type', 'unsupported-type']))
    expect(m.entities[0].fields.find((f) => f.name === 'c')!.type).toBe('string')
  })

  it('rejects input with no usable table and explains why', () => {
    const r = adapter.parse({ text: BAD })
    expect('rejected' in r).toBe(true)
    const c = codes(r)
    expect(c).toEqual(expect.arrayContaining(['duplicate-column', 'unparsable-table', 'no-tables']))
  })

  it('skips only the bad table when others are fine', () => {
    const r = adapter.parse({ text: `${BAD}\nCREATE TABLE ok_t (id INT PRIMARY KEY);` })
    expect(ok(r).entities.map((e) => e.id)).toEqual(['ok_t'])
  })

  it('skips tables and columns with unsafe names', () => {
    const r = adapter.parse({ text: 'CREATE TABLE "bad name" (a INT);\nCREATE TABLE good (id INT PRIMARY KEY, "x y" TEXT);' })
    const m = ok(r)
    expect(m.entities.map((e) => e.id)).toEqual(['good'])
    expect(m.entities[0].fields.map((f) => f.name)).toEqual(['id'])
    expect(codes(r).filter((c) => c === 'unsafe-identifier').length).toBe(2)
  })

  it('is deterministic and never throws', () => {
    expect(adapter.parse({ text: GOOD })).toEqual(adapter.parse({ text: GOOD }))
    for (const t of ['', ';;;', 'CREATE TABLE', 'CREATE TABLE t (', "CREATE TABLE t ('", 'CREATE TABLE t ()', '\u0000', 'CREATE TABLE t (a INT,,)']) {
      expect(() => adapter.parse({ text: t })).not.toThrow()
    }
  })

  it('goes through the real registry', () => {
    const r = parseInput({ text: GOOD, filename: 'acme-schema.sql' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.adapterId).toBe('sql-ddl')
  })
})
