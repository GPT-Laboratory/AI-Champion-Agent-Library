import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tabularCatalogAdapter as adapter } from './tabular-catalog'
import { parseInput } from '../registry'
import type { ParseResult, SourceModel } from '../types'

const fx = (n: string) => readFileSync(fileURLToPath(new URL(`../testing/fixtures/${n}`, import.meta.url)), 'utf8')
const ACME_TABULAR = `${fx('acme-catalog-header.csv')}# dictionary\n${fx('acme-catalog-dictionary.csv')}`

function ok(r: ParseResult): SourceModel {
  if ('rejected' in r) throw new Error(`rejected: ${JSON.stringify(r.rejected)}`)
  return r.model
}
const codes = (r: ParseResult) => ('rejected' in r ? r.rejected : r.gaps).map((g) => g.code)

describe('tabular-catalog adapter', () => {
  it('detects a header, not DDL or OpenAPI', () => {
    expect(adapter.detect({ text: ACME_TABULAR })).toBe(0.6)
    expect(adapter.detect({ text: 'a,b,c\n1,2,3' })).toBe(0.6)
    expect(adapter.detect({ text: 'a;b;c' })).toBe(0.6)
    expect(adapter.detect({ text: 'CREATE TABLE t (a,b,c)' })).toBe(0)
    expect(adapter.detect({ text: 'openapi: 3.0.0\ninfo: x' })).toBe(0)
    expect(adapter.detect({ text: '{"a":1,"b":2,"c":3}' })).toBe(0)
    expect(adapter.detect({ text: 'one,two' })).toBe(0)
    expect(adapter.detect({ text: '' })).toBe(0)
  })

  it('builds a dataset model with labels, types and the identifier', () => {
    const m = ok(adapter.parse({ text: ACME_TABULAR }))
    expect(m.name).toBe('Acme Widgets')
    expect(m.backend).toEqual({ kind: 'dataset', datasetPathEnv: 'ACME_WIDGETS_DATA_PATH' })
    expect(m.auth.scheme).toBe('none')
    const e = m.entities[0]
    expect(e.id).toBe('widget')
    expect(e.identifierFields).toEqual(['WG010'])
    const by = Object.fromEntries(e.fields.map((f) => [f.name, f]))
    expect(by.WG010).toMatchObject({ type: 'string', identifier: true, label: 'Widget code' })
    expect(by.WG020).toMatchObject({ type: 'string', nameLike: true, label: 'Widget name' })
    expect(by.WG030.classLike).toBe(true)
    expect(by.WG040.type).toBe('integer')
    expect(by.WG050.type).toBe('number')
    expect(by.WG060.type).toBe('boolean')
    expect(by.WG010.description).toContain('Column code: WG010')
  })

  it('infers types from sample rows when there is no dictionary, identifier stays a string', () => {
    const m = ok(adapter.parse({ text: 'item_id,qty,price,label\n1000,5,2.5,abc\n1001,6,3.5,def' }))
    const by = Object.fromEntries(m.entities[0].fields.map((f) => [f.name, f.type]))
    expect(by).toEqual({ item_id: 'string', qty: 'integer', price: 'number', label: 'string' })
  })

  it('is deterministic and never throws', () => {
    expect(adapter.parse({ text: ACME_TABULAR })).toEqual(adapter.parse({ text: ACME_TABULAR }))
    for (const t of ['', '\n\n', '#', '# dictionary', 'a', ',,,', '\u0000\u0001', 'a,b,c\n# options\nskip_rows=x']) {
      expect(() => adapter.parse({ text: t })).not.toThrow()
    }
  })

  it('never copies sample row values into the model', () => {
    const m = ok(adapter.parse({ text: ACME_TABULAR }))
    const json = JSON.stringify(m)
    for (const v of ['ZZ-9001', 'ZZ-9002', 'Sample gizmo', 'Sample sprocket', 'Gadgets', '10.25']) expect(json).not.toContain(v)
  })

  it('rejects more than 5 data rows and does not echo them', () => {
    const rows = Array.from({ length: 6 }, (_, i) => `QQ-${i}77,v${i},x`).join('\n')
    const r = adapter.parse({ text: `c1,c2,c3\n${rows}` })
    expect('rejected' in r).toBe(true)
    expect(codes(r)).toContain('rows-rejected')
    expect(JSON.stringify(r)).not.toContain('QQ-')
    // exactly five is accepted
    expect('rejected' in adapter.parse({ text: `c1,c2,c3\n${rows.split('\n').slice(0, 5).join('\n')}` })).toBe(false)
  })

  it('skip_rows lets label rows sit below the code row', () => {
    const many = ['Ca,Cb,Cc', 'l1,l2,l3', 'u1,u2,u3', 'v,v,v', '# options', 'skip_rows=2']
    expect('rejected' in adapter.parse({ text: many.join('\n') })).toBe(false)
  })

  it('reports no-identifier instead of guessing', () => {
    const r = adapter.parse({ text: 'alpha,beta,gamma' })
    const m = ok(r)
    expect(m.entities[0].identifierFields).toEqual([])
    expect(m.entities[0].fields.some((f) => f.identifier)).toBe(false)
    expect(codes(r)).toContain('no-identifier')
  })

  it('finds an identifier by name pattern', () => {
    expect(ok(adapter.parse({ text: 'name,part_no,color' })).entities[0].identifierFields).toEqual(['part_no'])
    expect(ok(adapter.parse({ text: 'name,sku,color' })).entities[0].identifierFields).toEqual(['sku'])
  })

  it('rejects duplicate and invalid column codes', () => {
    expect(codes(adapter.parse({ text: 'a,b,a' }))).toContain('duplicate-column')
    expect(codes(adapter.parse({ text: 'a,1bad,c' }))).toContain('invalid-column')
    expect(codes(adapter.parse({ text: 'a,"x;drop",c' }))).toContain('invalid-column')
  })

  it('rejects names that collide after normalisation', () => {
    const r = adapter.parse({ text: 'Part No,part_no,c' })
    expect(codes(r)).toContain('column-collision')
    expect('rejected' in r).toBe(true)
  })

  it('normalises unsafe codes and keeps the original code in the description', () => {
    const r = adapter.parse({ text: 'Part No,Colour,c' })
    const f = ok(r).entities[0].fields[0]
    expect(f.name).toBe('part_no')
    expect(f.description).toContain('Part No')
    expect(codes(r)).toContain('column-renamed')
  })

  it('reports dictionary orphans and missing labels', () => {
    const r = adapter.parse({ text: 'aa,bb,cc\n# dictionary\naa,Alpha\nzz,Zulu' })
    const c = codes(r)
    expect(c).toContain('dictionary-orphan')
    expect(c).toContain('missing-label')
    const by = Object.fromEntries(ok(r).entities[0].fields.map((f) => [f.name, f.label]))
    expect(by).toMatchObject({ aa: 'Alpha', bb: 'bb', cc: 'cc' })
  })

  it('goes through the real registry', () => {
    const r = parseInput({ text: ACME_TABULAR, filename: 'catalog.csv' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.adapterId).toBe('tabular-catalog')
  })
})
