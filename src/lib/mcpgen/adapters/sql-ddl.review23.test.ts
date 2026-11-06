// Phase 23 review fixes for the sql-ddl adapter (CR-10, CR-11, CR-12). A separate file: the original
// sql-ddl.test.ts is pinned as unmodified since Phase 15 (criteria.test.ts).
import { describe, it, expect } from 'vitest'
import { sqlDdlAdapter as adapter } from './sql-ddl'
import type { ParseResult, SourceModel } from '../types'

function ok(r: ParseResult): SourceModel {
  if ('rejected' in r) throw new Error(`rejected: ${JSON.stringify(r.rejected)}`)
  return r.model
}

// CR-10: a column whose name is a constraint keyword is still a column.
describe('columns named like constraint keywords (CR-10)', () => {
  const fieldNames = (sql: string) => ok(adapter.parse({ text: sql })).entities[0].fields.map((f) => f.name)
  it('keeps period, exclude, key and index columns with parenthesised types', () => {
    expect(
      fieldNames("CREATE TABLE t (id integer primary key, period varchar(7), exclude char(1), key enum('a','b'), index set('x'), name text)"),
    ).toEqual(['id', 'period', 'exclude', 'key', 'index', 'name'])
    expect(fieldNames('CREATE TABLE t (id integer primary key, period numeric(5,2), name text)')).toEqual(['id', 'period', 'name'])
    expect(fieldNames('CREATE TABLE t (id int, `key` varchar(20), `index` int(11), check_x int)')).toEqual(['id', 'key', 'index', 'check_x'])
  })
  it('still skips real constraints and indexes', () => {
    const sql = `CREATE TABLE t (id int, name varchar(9), period_start date, period_end date,
      PERIOD FOR system_time (period_start, period_end), CHECK (id > 0), CONSTRAINT c CHECK(id < 9),
      EXCLUDE USING gist (name WITH =), EXCLUDE (name WITH =), KEY idx_name (name), KEY (name(10)), INDEX i2 (id, name), FULLTEXT KEY ft (name), UNIQUE KEY u (name))`
    expect(fieldNames(sql)).toEqual(['id', 'name', 'period_start', 'period_end'])
  })
})

// CR-11: key, foreign key and unique column names match case-insensitively.
describe('identifier case in keys (CR-11)', () => {
  const parse = (sql: string) => ok(adapter.parse({ text: sql }))
  it('a table-level PRIMARY KEY with different case keeps the table', () => {
    const m = parse('CREATE TABLE t (Id INT, name text, PRIMARY KEY (id))')
    expect(m.entities[0].identifierFields).toEqual(['Id'])
    expect(m.entities[0].fields.find((f) => f.name === 'Id')).toMatchObject({ identifier: true })
  })
  it('a table-level FOREIGN KEY and UNIQUE with different case are applied', () => {
    const m = parse('CREATE TABLE p (Id INT PRIMARY KEY); CREATE TABLE c (Cid INT PRIMARY KEY, ParentId INT, Code TEXT, FOREIGN KEY (parentid) REFERENCES p (id), UNIQUE (code))')
    const c = m.entities.find((e) => e.id === 'c')!
    expect(c.fields.find((f) => f.name === 'ParentId')!.description).toBe('References p.id')
  })
  it('ALTER TABLE constraints match table and column case-insensitively', () => {
    const m = parse('CREATE TABLE Users (Id INT, Name TEXT); ALTER TABLE ONLY users ADD CONSTRAINT pk PRIMARY KEY (id);')
    expect(m.entities[0].identifierFields).toEqual(['Id'])
  })
})

// CR-12: MySQL hash comments.
describe('MySQL comments (CR-12)', () => {
  it('an apostrophe in a # comment does not swallow the script', () => {
    const sql = "# it's mine\nCREATE TABLE t (id INT PRIMARY KEY, name TEXT);\n# don't\nCREATE TABLE u (id INT PRIMARY KEY) ENGINE=InnoDB;\n"
    const m = ok(adapter.parse({ text: sql }))
    expect(m.entities.map((e) => e.id)).toEqual(['t', 'u'])
  })
  it('a # inside a quoted string is not a comment', () => {
    const m = ok(adapter.parse({ text: "CREATE TABLE t (id INT PRIMARY KEY, tag ENUM('#a','b') NOT NULL) ENGINE=InnoDB;" }))
    expect(m.entities[0].fields.find((f) => f.name === 'tag')!.enum).toEqual(['#a', 'b'])
  })
  it('--1 without a space is not a comment in MySQL', () => {
    const m = ok(adapter.parse({ text: "CREATE TABLE t (id INT PRIMARY KEY, n INT DEFAULT 5--1, name TEXT) ENGINE=InnoDB;" }))
    expect(m.entities[0].fields.map((f) => f.name)).toEqual(['id', 'n', 'name'])
  })
})
