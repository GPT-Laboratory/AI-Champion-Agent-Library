// Hand-rolled Prisma schema reader (D-546..D-548). Invented Acme schema; connection strings that
// look like credentials are assembled at runtime.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { prismaAdapter as adapter } from './prisma'
import { sqlDdlAdapter } from './sql-ddl'
import { parseInput } from '../registry'
import { generate } from '../generate'
import type { Gap, ParseResult, SourceModel } from '../types'

const fx = (n: string) => readFileSync(fileURLToPath(new URL(`../testing/fixtures/${n}`, import.meta.url)), 'utf8')
const PRISMA = fx('acme-prisma.prisma')
const j = (...p: string[]) => p.join('')

function ok(r: ParseResult): SourceModel {
  if ('rejected' in r) throw new Error(`rejected: ${JSON.stringify(r.rejected)}`)
  return r.model
}
const gapsOf = (r: ParseResult): Gap[] => ('rejected' in r ? r.rejected : r.gaps)
const codes = (r: ParseResult) => gapsOf(r).map((g) => g.code)
const entity = (m: SourceModel, id: string) => m.entities.find((e) => e.id === id)!
const field = (m: SourceModel, e: string, f: string) => entity(m, e).fields.find((x) => x.name === f)!

describe('prisma adapter', () => {
  const r = adapter.parse({ text: PRISMA, filename: 'acme-prisma.prisma' })
  const m = ok(r)

  it('detects by structure, not by name', () => {
    expect(adapter.detect({ text: PRISMA })).toBe(0.95)
    expect(adapter.detect({ text: 'model A {\n  id Int\n}\n' })).toBe(0.8)
    expect(adapter.detect({ text: 'CREATE TABLE a (id INT);' })).toBe(0)
    expect(adapter.detect({ text: 'openapi: 3.0.0' })).toBe(0)
    expect(adapter.detect({ text: 'a,b\n1,2' })).toBe(0)
    expect(adapter.detect({ text: 'CREATE TABLE a (id INT);\nmodel A {\n  id Int @id\n}\n' })).toBe(0.5)
  })

  it('maps models to tables with @@map and fields to columns with @map', () => {
    expect(m.entities.map((e) => e.id)).toEqual(['customer', 'orders', 'OrderLine'])
    expect(entity(m, 'customer').fields.map((f) => f.name)).toEqual(['id', 'customer_name', 'segment', 'email', 'credit', 'profile', 'tags', 'createdAt'])
    expect(m.backend).toEqual({ kind: 'sql', dsnEnv: 'ACME_PRISMA_DB_PATH' })
  })

  it('reads @id, @@id, @unique and required versus optional', () => {
    expect(entity(m, 'customer').identifierFields).toEqual(['id'])
    expect(entity(m, 'OrderLine').identifierFields).toEqual(['orderId', 'lineNo'])
    expect(field(m, 'customer', 'email').description).toBe('Unique.')
    expect(field(m, 'customer', 'customer_name').nullable).toBe(false)
    expect(field(m, 'customer', 'segment').nullable).toBeUndefined()
    expect(field(m, 'customer', 'credit').nullable).toBeUndefined()
    expect(m.operations.map((o) => o.id)).toContain('get_OrderLine')
  })

  it('maps scalar types; Json and lists become gaps', () => {
    expect(field(m, 'customer', 'id').type).toBe('integer')
    expect(field(m, 'orders', 'id').type).toBe('integer')
    expect(field(m, 'orders', 'total').type).toBe('number')
    expect(field(m, 'customer', 'credit').type).toBe('number')
    expect(field(m, 'customer', 'createdAt').type).toBe('string')
    const paths = gapsOf(r).filter((g) => g.code === 'unsupported-type').map((g) => g.path)
    expect(paths.sort()).toEqual(['Customer.profile', 'Customer.tags'])
  })

  it('turns @relation(fields, references) into a foreign key and skips relation fields as columns', () => {
    expect(field(m, 'orders', 'customer_id').description).toBe('References customer.id')
    expect(field(m, 'OrderLine', 'orderId').description).toBe('References orders.id')
    expect(entity(m, 'orders').fields.map((f) => f.name)).toEqual(['id', 'customer_id', 'state', 'total'])
    expect(gapsOf(r).find((g) => g.code === 'relation-fields-skipped')?.severity).toBe('info')
  })

  it('turns enums into allowed values (with @map)', () => {
    expect(field(m, 'orders', 'state').enum).toEqual(['OPEN', 'SHIPPED', 'cancelled'])
    expect(field(m, 'orders', 'state').type).toBe('string')
  })

  it('ignores datasource and generator blocks entirely and never copies @default values', () => {
    const json = JSON.stringify(r)
    for (const v of ['DATABASE_URL', 'postgresql', 'prisma-client-js', 'autoincrement', 'standard', 'provider']) expect(json).not.toContain(v)
    expect(gapsOf(r).find((g) => g.code === 'config-blocks-ignored')?.severity).toBe('info')
  })

  it('reports the SQLite-backend limitation', () => {
    const g = gapsOf(r).find((x) => x.code === 'sqlite-backend-only')!
    expect(g.severity).toBe('info')
    expect(g.message).toMatch(/SQLite database file/)
  })

  it('is deterministic and never throws', () => {
    expect(adapter.parse({ text: PRISMA })).toEqual(adapter.parse({ text: PRISMA }))
    for (const t of ['', 'model', 'model A {', 'model A { id Int @id', 'enum E {', 'datasource db {\n url = "', 'model A {\n id Int @id @default(\n}\n', '\u0000', '}}}', 'model A {\n@@id([\n}']) {
      expect(() => adapter.parse({ text: t })).not.toThrow()
    }
  })

  it('rejects a schema without a usable model and explains why', () => {
    const rr = adapter.parse({ text: 'datasource db {\n  provider = "sqlite"\n}\n' })
    expect('rejected' in rr).toBe(true)
    expect(codes(rr)).toContain('no-tables')
    const un = adapter.parse({ text: 'model A {\n  id Int @id\n' })
    expect(codes(un)).toContain('unterminated-block')
  })

  it('reports views and composite types, models without an id, and unsafe names', () => {
    const rr = adapter.parse({
      text: [
        'view V {\n  id Int @unique\n}',
        'type T {\n  a String\n}',
        'model NoKey {\n  a String\n}',
        'model Odd {\n  id Int @id\n  weird String @map("bad name")\n}',
        '',
      ].join('\n'),
    })
    const m2 = ok(rr)
    expect(m2.entities.map((e) => e.id)).toEqual(['NoKey', 'Odd'])
    expect(codes(rr)).toEqual(expect.arrayContaining(['unsupported-statement', 'no-identifier', 'unsafe-identifier']))
    expect(entity(m2, 'Odd').fields.map((f) => f.name)).toEqual(['id'])
  })

  it('handles declarations that span lines and comments', () => {
    const text = 'model A {\n  id Int @id // pk\n  b String // note\n  c Int\n  d Int\n  @@unique([\n    c,\n    d\n  ])\n  @@map("a_tbl")\n}\n'
    const m2 = ok(adapter.parse({ text }))
    expect(m2.entities[0].id).toBe('a_tbl')
    expect(m2.entities[0].fields.map((f) => f.name)).toEqual(['id', 'b', 'c', 'd'])
  })
})

describe('prisma through the registry', () => {
  it('auto-detects the schema and generates a server', () => {
    const res = parseInput({ text: PRISMA, filename: 'schema.prisma' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.adapterId).toBe('prisma')
    const out = generate(res.model, {})
    expect(out.files.length).toBeGreaterThan(0)
    const py = out.files.find((f) => f.path === 'server.py')!.content
    expect(py).toContain('def query_customer(')
    expect(py).not.toContain('DATABASE_URL')
    expect(py).not.toContain('postgresql')
    expect(py).toContain('?mode=ro')
  })

  it('rejects a literal connection URL with userinfo before the adapter runs, and never echoes it', () => {
    const url = j('postgresql://', 'acme_user', ':', 'hunter2hunter2', '@db.example.test:5432/acme')
    const text = PRISMA.replace('env("DATABASE_URL")', `"${url}"`)
    const res = parseInput({ text, filename: 'schema.prisma' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.gaps.map((g) => g.code)).toContain('credential-rejected')
      expect(JSON.stringify(res.gaps)).not.toContain('hunter2')
    }
  })

  it('a URL without credentials in the datasource block is ignored, not copied', () => {
    const text = PRISMA.replace('env("DATABASE_URL")', '"postgresql://db.example.test:5432/acme"')
    const res = parseInput({ text, filename: 'schema.prisma' })
    if (res.ok) expect(JSON.stringify(res)).not.toContain('db.example.test')
  })

  it('SQL with a Prisma-looking comment still goes to sql-ddl; the forced Prisma adapter reports the overlap', () => {
    const sql = 'CREATE TABLE a (id INT PRIMARY KEY);\nmodel A {\n  id Int @id\n}\n'
    const auto = parseInput({ text: sql })
    expect(auto.ok && auto.adapterId).toBe('sql-ddl')
    const forced = parseInput({ text: sql }, { adapterId: 'prisma' })
    expect(forced.ok).toBe(true)
    if (forced.ok) expect(forced.gaps.map((g) => g.code)).toContain('ambiguous-input')
    expect(sqlDdlAdapter.detect({ text: sql })).toBeGreaterThan(adapter.detect({ text: sql }))
  })
})
