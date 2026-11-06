// Defect (research 14-INPUT-KINDS-RESEARCH section 1): the sql-ddl adapter dropped every ALTER
// statement as a write, so pg_dump input lost the keys it adds with ALTER TABLE ... ADD CONSTRAINT.
// These tests were written before the fix and failed against the old adapter.
import { describe, it, expect } from 'vitest'
import { sqlDdlAdapter as adapter } from './sql-ddl'
import type { ParseResult, SourceModel } from '../types'

function ok(r: ParseResult): SourceModel {
  if ('rejected' in r) throw new Error(`rejected: ${JSON.stringify(r.rejected)}`)
  return r.model
}
const gapsOf = (r: ParseResult) => ('rejected' in r ? r.rejected : r.gaps)
const codes = (r: ParseResult) => gapsOf(r).map((g) => g.code)

const BASE = `
CREATE TABLE public.t (id integer NOT NULL, name text, parent_id integer);
CREATE TABLE public.u (a integer NOT NULL, b integer NOT NULL, label text);
`

describe('ALTER TABLE constraint folding', () => {
  it('folds ADD CONSTRAINT PRIMARY KEY (single and composite)', () => {
    const r = adapter.parse({
      text: `${BASE}
ALTER TABLE ONLY public.t ADD CONSTRAINT t_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.u ADD CONSTRAINT u_pkey PRIMARY KEY (a, b);`,
    })
    const m = ok(r)
    expect(m.entities.find((e) => e.id === 't')!.identifierFields).toEqual(['id'])
    expect(m.entities.find((e) => e.id === 'u')!.identifierFields).toEqual(['a', 'b'])
    expect(m.operations.map((o) => o.id)).toContain('get_u')
    expect(codes(r)).not.toContain('no-identifier')
    expect(m.writeOperationsDropped).toEqual([])
    expect(codes(r)).not.toContain('statement-ignored')
  })

  it('folds ADD CONSTRAINT FOREIGN KEY ... REFERENCES', () => {
    const m = ok(
      adapter.parse({
        text: `${BASE}
ALTER TABLE ONLY public.t ADD CONSTRAINT t_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.t ADD CONSTRAINT t_parent_fkey FOREIGN KEY (parent_id) REFERENCES public.t(id) ON DELETE CASCADE;`,
      }),
    )
    const f = m.entities[0].fields.find((x) => x.name === 'parent_id')!
    expect(f.description).toBe('References t.id')
  })

  it('folds ADD CONSTRAINT UNIQUE without dropping the table or counting a write', () => {
    const r = adapter.parse({ text: `${BASE}\nALTER TABLE ONLY public.t ADD CONSTRAINT t_name_key UNIQUE (name);` })
    const m = ok(r)
    expect(m.entities[0].fields.find((x) => x.name === 'name')!.description).toBe('Unique.')
    expect(m.writeOperationsDropped).toEqual([])
  })

  it('accepts several actions in one statement and IF EXISTS / ONLY', () => {
    const m = ok(
      adapter.parse({
        text: `${BASE}\nALTER TABLE IF EXISTS ONLY public.t ADD CONSTRAINT p PRIMARY KEY (id), ADD CONSTRAINT f FOREIGN KEY (parent_id) REFERENCES t (id);`,
      }),
    )
    expect(m.entities[0].identifierFields).toEqual(['id'])
    expect(m.entities[0].fields.find((x) => x.name === 'parent_id')!.description).toBe('References t.id')
  })

  it('still reports other ALTERs as dropped writes with the stable code', () => {
    const r = adapter.parse({
      text: `${BASE}
ALTER TABLE public.t ADD COLUMN extra text;
ALTER TABLE public.t DROP COLUMN name;
ALTER TABLE public.u RENAME TO u2;`,
    })
    const m = ok(r)
    expect(codes(r)).toContain('statement-ignored')
    expect(m.writeOperationsDropped).toEqual(['alter:t', 'alter:u'])
    expect(m.entities.find((e) => e.id === 't')!.fields.map((f) => f.name)).toEqual(['id', 'name', 'parent_id'])
  })

  it('ignores ALTER COLUMN SET DEFAULT nextval quietly (noise, not a write)', () => {
    const r = adapter.parse({
      text: `${BASE}\nALTER TABLE ONLY public.t ALTER COLUMN id SET DEFAULT nextval('public.t_id_seq'::regclass);`,
    })
    ok(r)
    expect(codes(r)).not.toContain('statement-ignored')
    expect(ok(r).writeOperationsDropped).toEqual([])
  })

  it('reports a constraint on a table that is not in the input', () => {
    const r = adapter.parse({ text: `${BASE}\nALTER TABLE ONLY public.ghost ADD CONSTRAINT g PRIMARY KEY (id);` })
    expect(gapsOf(r).find((g) => g.code === 'alter-target-missing')?.path).toBe('ghost')
  })

  it('reports a key the constraint names but the table does not have', () => {
    const r = adapter.parse({ text: `${BASE}\nALTER TABLE ONLY public.t ADD CONSTRAINT p PRIMARY KEY (nope);` })
    expect(gapsOf(r).find((g) => g.code === 'unparsable-constraint')?.path).toBe('t')
    expect(ok(r).entities[0].identifierFields).toEqual([])
  })

  it('does not overwrite an existing primary key and says so', () => {
    const r = adapter.parse({ text: `CREATE TABLE t (id integer PRIMARY KEY, x integer);\nALTER TABLE t ADD PRIMARY KEY (x);` })
    expect(ok(r).entities[0].identifierFields).toEqual(['id'])
    expect(codes(r)).toContain('duplicate-primary-key')
  })

  it('adds a distinct gap when an unreadable ALTER may have held the keys of a keyless table', () => {
    const r = adapter.parse({ text: `${BASE}\nALTER TABLE ONLY public.t ADD PRIMARY KEY USING INDEX t_idx;` })
    const g = gapsOf(r).find((x) => x.code === 'alter-may-hold-keys')
    expect(g?.path).toBe('t')
    expect(codes(r)).toContain('no-identifier')
  })

  it('a pg_dump style fixture keeps all its keys', () => {
    const m = ok(adapter.parse({ text: PG_MINI }))
    expect(Object.fromEntries(m.entities.map((e) => [e.id, e.identifierFields]))).toEqual({ customer: ['customer_id'], order: ['order_id'] })
    expect(m.entities[1].fields.find((f) => f.name === 'customer_id')!.description).toBe('References customer.customer_id')
  })
})

const PG_MINI = `
CREATE TABLE public.customer (customer_id integer NOT NULL, customer_name text);
CREATE TABLE public."order" (order_id bigint NOT NULL, customer_id integer NOT NULL);
ALTER TABLE ONLY public.customer
    ADD CONSTRAINT customer_pkey PRIMARY KEY (customer_id);
ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_pkey PRIMARY KEY (order_id);
ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_customer_fkey FOREIGN KEY (customer_id) REFERENCES public.customer(customer_id);
`
