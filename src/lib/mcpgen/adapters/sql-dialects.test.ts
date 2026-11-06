// SQL dialect folding (D-540..D-545): pg_dump, SQLite .schema and mysqldump through the sql-ddl
// adapter and the real registry. Fixtures are invented ("Acme"). Secret-shaped strings are
// assembled at runtime so no deliberate secret is committed as text.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sqlDdlAdapter as adapter } from './sql-ddl'
import { parseInput } from '../registry'
import { scanForCredentials } from '../credentials'
import { stripSqlDumpData } from '../sqlcopy'
import type { Gap, ParseResult, SourceModel } from '../types'

const fx = (n: string) => readFileSync(fileURLToPath(new URL(`../testing/fixtures/${n}`, import.meta.url)), 'utf8')
const PG = fx('acme-pgdump.sql')
const COPY = fx('acme-pgdump-data.copy')
const SQLITE = fx('acme-sqlite.schema')
const MYSQL = fx('acme-mysqldump.sql')
const j = (...p: string[]) => p.join('')

function ok(r: ParseResult): SourceModel {
  if ('rejected' in r) throw new Error(`rejected: ${JSON.stringify(r.rejected)}`)
  return r.model
}
const gapsOf = (r: ParseResult): Gap[] => ('rejected' in r ? r.rejected : r.gaps)
const codes = (r: ParseResult) => gapsOf(r).map((g) => g.code)
const entity = (m: SourceModel, id: string) => m.entities.find((e) => e.id === id)!
const field = (m: SourceModel, e: string, f: string) => entity(m, e).fields.find((x) => x.name === f)!

describe('pg_dump (--schema-only)', () => {
  const r = adapter.parse({ text: PG, filename: 'acme-pgdump.sql' })
  const m = ok(r)

  it('keeps every key that pg_dump writes as ALTER TABLE ... ADD CONSTRAINT', () => {
    expect(m.entities.map((e) => [e.id, e.identifierFields])).toEqual([
      ['customer', ['customer_id']],
      ['order', ['order_id']],
      ['order_line', ['order_id', 'line_no']],
      ['note_log', []],
    ])
    expect(field(m, 'order', 'customer_id').description).toBe('References customer.customer_id')
    expect(field(m, 'order_line', 'order_id').description).toBe('References order.order_id')
    expect(field(m, 'customer', 'external_ref').description).toBe('Unique.')
  })

  it('strips schema qualifiers, ONLY and quoted names', () => {
    expect(m.entities.map((e) => e.id)).toContain('order')
    expect(JSON.stringify(m)).not.toContain('public')
  })

  it('maps Postgres types: serial-like integers, numeric(p,s), uuid, timestamptz; jsonb and arrays become a gap', () => {
    expect(field(m, 'customer', 'customer_id').type).toBe('integer')
    expect(field(m, 'order', 'order_id').type).toBe('integer')
    expect(field(m, 'customer', 'credit').type).toBe('number')
    expect(field(m, 'order', 'total').type).toBe('number')
    expect(field(m, 'customer', 'external_ref').type).toBe('string')
    expect(field(m, 'customer', 'created_at').type).toBe('string')
    expect(field(m, 'customer', 'search_key').type).toBe('string')
    const unsupported = gapsOf(r).filter((g) => g.code === 'unsupported-type').map((g) => g.path)
    expect(unsupported.sort()).toEqual(['customer.profile', 'customer.tags'])
  })

  it('turns CREATE TYPE ... AS ENUM values into the allowed values of the column', () => {
    const f = field(m, 'order', 'state')
    expect(f.type).toBe('string')
    expect(f.enum).toEqual(['open', 'shipped', 'cancelled'])
    expect(codes(r).filter((c) => c === 'unknown-type')).toEqual([])
  })

  it('tolerates CHECK and generated columns', () => {
    expect(entity(m, 'customer').fields.map((f) => f.name)).toContain('search_key')
    expect(entity(m, 'customer').fields.length).toBe(9)
  })

  it('counts housekeeping quietly and reports views and functions', () => {
    const noise = gapsOf(r).find((g) => g.code === 'dialect-noise-ignored')!
    expect(noise.severity).toBe('info')
    expect(codes(r)).not.toContain('statement-ignored')
    expect(m.writeOperationsDropped).toEqual([])
    const unsupported = gapsOf(r).filter((g) => g.code === 'unsupported-statement').map((g) => g.message)
    expect(unsupported.some((x) => /VIEW/.test(x))).toBe(true)
    expect(unsupported.some((x) => /FUNCTION/.test(x))).toBe(true)
    // the function body ($$ ... $$) never became statements of its own
    expect(unsupported.some((x) => /RETURN|NEW|BEGIN/.test(x))).toBe(false)
    expect(m.entities.map((e) => e.id)).not.toContain('open_orders')
  })

  it('reports the dialect and the SQLite-backend limitation as info gaps', () => {
    const g = gapsOf(r)
    expect(g.find((x) => x.code === 'sql-dialect-detected')?.severity).toBe('info')
    const lim = g.find((x) => x.code === 'sqlite-backend-only')!
    expect(lim.severity).toBe('info')
    expect(lim.message).toMatch(/SQLite database file/)
    expect(m.backend).toEqual({ kind: 'sql', dsnEnv: 'ACME_PGDUMP_DB_PATH' })
  })

  it('a table that stays keyless is still reported (no key in the input at all)', () => {
    expect(gapsOf(r).find((g) => g.code === 'no-identifier')?.path).toBe('note_log')
  })
})

describe('COPY data blocks are never ingested', () => {
  const FAKE = j('ghp', '_', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')
  const withData = `${PG}\n${COPY}\nCOPY public.note_log (note_text, created) FROM stdin;\nrotate ${FAKE} soon\t2026-03-04 05:06:07\n\\.\n`

  it('the fake token row is something the scanner would reject (the proof is meaningful)', () => {
    expect(scanForCredentials(`rotate ${FAKE} soon`).length).toBeGreaterThan(0)
  })

  it('strips blocks and counts lines only', () => {
    const s = stripSqlDumpData(withData)
    expect(s.blocks).toBe(3)
    expect(s.skippedLines).toBe(4)
    expect(s.text).not.toContain('Zed Distinctive Row')
    expect(s.text).not.toContain(FAKE)
    expect(s.text).not.toMatch(/FROM stdin/)
    expect(stripSqlDumpData(PG).changed).toBe(false)
    expect(stripSqlDumpData(PG).text).toBe(PG)
  })

  it('a dump WITH data parses to the same model as the schema-only dump and reports the line count', () => {
    const a = ok(adapter.parse({ text: PG, filename: 'x.sql' }))
    const rb = adapter.parse({ text: withData, filename: 'x.sql' })
    const b = ok(rb)
    expect({ ...b, gaps: [] }).toEqual({ ...a, gaps: [] })
    const g = gapsOf(rb).find((x) => x.code === 'data-rows-skipped')!
    expect(g.severity).toBe('info')
    expect(g.message).toMatch(/^4 data lines in 3 COPY blocks were skipped/)
  })

  it('never echoes a row anywhere in the model or the gaps', () => {
    const rb = adapter.parse({ text: withData })
    const all = JSON.stringify(rb)
    for (const v of ['Zed Distinctive Row', 'Second Row Value', 'Nowhere Corp', FAKE, 'zed distinctive row']) expect(all).not.toContain(v)
  })

  it('goes through the real registry: not rejected because of row data, even with a token-looking row', () => {
    const res = parseInput({ text: withData, filename: 'acme.sql' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.adapterId).toBe('sql-ddl')
      expect(JSON.stringify(res)).not.toContain(FAKE)
      expect(res.gaps.some((x) => x.code === 'data-rows-skipped')).toBe(true)
    }
    const forced = parseInput({ text: withData }, { adapterId: 'sql-ddl' })
    expect(forced.ok).toBe(true)
  })

  it('the scanner still sees every non-data line', () => {
    const inInsert = `${PG}\nINSERT INTO public.note_log VALUES ('${FAKE}', now());\n`
    const a = parseInput({ text: inInsert })
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.gaps.map((g) => g.code)).toContain('credential-rejected')
    const inComment = `${withData}\n-- ${FAKE}\n`
    const b = parseInput({ text: inComment })
    expect(b.ok).toBe(false)
    const inHeader = withData.replace('SET lock_timeout = 0;', `SET lock_timeout = 0; -- ${FAKE}`)
    expect(parseInput({ text: inHeader }).ok).toBe(false)
  })

  it('an unterminated COPY block skips to the end and says so', () => {
    const r = adapter.parse({ text: `${PG}\nCOPY public.note_log (note_text) FROM stdin;\nrow one\nrow two` })
    expect(ok(r).entities.length).toBe(4)
    expect(codes(r)).toEqual(expect.arrayContaining(['data-rows-skipped', 'copy-block-unterminated']))
  })

  it('psql meta-commands are dropped, not parsed', () => {
    const r = adapter.parse({ text: `\\restrict abcDEF123\n${PG}\n\\unrestrict abcDEF123\n` })
    expect(ok(r).entities.length).toBe(4)
    expect(JSON.stringify(r)).not.toContain('abcDEF123')
  })
})

describe('SQLite .schema', () => {
  const r = adapter.parse({ text: SQLITE, filename: 'acme-sqlite.schema' })
  const m = ok(r)
  it('reads backtick, bracket and double-quote quoting, AUTOINCREMENT, WITHOUT ROWID and STRICT', () => {
    expect(m.entities.map((e) => [e.id, e.identifierFields])).toEqual([
      ['customer', ['customer_id']],
      ['order', ['order_id']],
      ['order_line', ['order_id', 'line_no']],
    ])
    expect(entity(m, 'customer').fields.map((f) => f.name)).toEqual(['customer_id', 'customer_name', 'segment', 'city'])
    expect(field(m, 'order', 'customer_id').description).toBe('References customer.customer_id')
  })
  it('skips sqlite_sequence quietly and needs no backend caveat', () => {
    expect(m.entities.map((e) => e.id)).not.toContain('sqlite_sequence')
    expect(codes(r)).not.toContain('sqlite-backend-only')
    expect(gapsOf(r).find((g) => g.code === 'sql-dialect-detected')?.message).toMatch(/SQLite/)
  })
})

describe('mysqldump --no-data', () => {
  const r = adapter.parse({ text: MYSQL, filename: 'acme-mysqldump.sql' })
  const m = ok(r)
  it('reads backticks, ENGINE=, AUTO_INCREMENT and inline KEY / UNIQUE KEY lines', () => {
    expect(m.entities.map((e) => [e.id, e.identifierFields])).toEqual([
      ['customer', ['customer_id']],
      ['order_line', ['order_id', 'line_no']],
    ])
    expect(entity(m, 'customer').fields.map((f) => f.name)).toEqual(['customer_id', 'customer_name', 'segment', 'note', 'created'])
    expect(field(m, 'customer', 'customer_name').description).toBe('Unique.')
    expect(field(m, 'order_line', 'customer_id').description).toBe('References customer.customer_id')
  })
  it('inline enum() values become allowed values; backslash escapes and semicolons in strings are safe', () => {
    expect(field(m, 'customer', 'segment').enum).toEqual(['standard', 'premium'])
    expect(field(m, 'customer', 'note').type).toBe('string')
    expect(entity(m, 'customer').fields.length).toBe(5)
  })
  it('counts DROP IF EXISTS, LOCK TABLES and conditional comments as housekeeping', () => {
    expect(codes(r)).toContain('dialect-noise-ignored')
    expect(codes(r)).not.toContain('statement-ignored')
    expect(m.writeOperationsDropped).toEqual([])
    expect(codes(r)).toContain('sqlite-backend-only')
  })
})

describe('dialect detection and ambiguity', () => {
  it('stays generic (no dialect gaps) for plain DDL', () => {
    const r = adapter.parse({ text: 'CREATE TABLE a (id INT PRIMARY KEY, x TEXT);' })
    expect(codes(r)).not.toContain('sql-dialect-detected')
    expect(codes(r)).not.toContain('sqlite-backend-only')
  })
  it('reports markers of two dialects instead of guessing', () => {
    const text = 'CREATE TABLE a (id INT PRIMARY KEY AUTOINCREMENT, x TEXT) ENGINE=InnoDB;\nSELECT pg_catalog.set_config(\'search_path\', \'\', false);'
    const r = adapter.parse({ text })
    expect(codes(r)).toContain('dialect-ambiguous')
    expect(codes(r)).not.toContain('sql-dialect-detected')
  })
  it('auto-detect still picks sql-ddl for the existing and the new SQL inputs', () => {
    for (const [t, f] of [[PG, 'a.sql'], [SQLITE, 'a.schema'], [MYSQL, 'a.sql'], [fx('acme-schema.sql'), 'a.sql']] as const) {
      const res = parseInput({ text: t, filename: f })
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.adapterId).toBe('sql-ddl')
    }
  })
  it('flags text that is also a Prisma schema', () => {
    const r = adapter.parse({ text: `CREATE TABLE a (id INT PRIMARY KEY);\nmodel A {\n  id Int @id\n}\n` })
    expect(codes(r)).toContain('ambiguous-input')
  })
})

describe('column parsing hardening', () => {
  it('a column named key or index with a type length is a column, not an index line', () => {
    const m = ok(adapter.parse({ text: 'CREATE TABLE t (id INT PRIMARY KEY, key VARCHAR(20), index INT);' }))
    expect(m.entities[0].fields.map((f) => f.name)).toEqual(['id', 'key', 'index'])
  })
  it('words inside string defaults and comments do not change the column', () => {
    const m = ok(adapter.parse({ text: "CREATE TABLE t (a TEXT DEFAULT 'primary key not null', b TEXT COMMENT 'references x(y)');" }))
    expect(m.entities[0].identifierFields).toEqual([])
    expect(m.entities[0].fields[0].nullable).toBeUndefined()
    expect(m.entities[0].fields[1].description).toBeUndefined()
  })
  it('an enum value that spells a constraint keyword stays inside the type', () => {
    const m = ok(adapter.parse({ text: "CREATE TABLE t (a INT PRIMARY KEY, s enum('default','not null') NOT NULL) ENGINE=InnoDB;" }))
    expect(m.entities[0].fields[1].enum).toEqual(['default', 'not null'])
    expect(m.entities[0].fields[1].nullable).toBe(false)
  })
  it('ALTER TABLE SET NOT NULL is folded', () => {
    const m = ok(adapter.parse({ text: 'CREATE TABLE t (id INT PRIMARY KEY, x TEXT);\nALTER TABLE ONLY public.t ALTER COLUMN x SET NOT NULL;' }))
    expect(m.entities[0].fields[1].nullable).toBe(false)
  })
})
