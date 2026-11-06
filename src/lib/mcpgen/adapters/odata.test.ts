// OData adapter: CSDL JSON and EDMX XML into the http backend (D-561..D-572). Synthetic Acme fixtures only.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { odataAdapter } from './odata'
import { ADAPTERS } from './index'
import { detectAdapters, parseInput, prepareInput } from '../registry'
import { runPipeline, runPipelineAsync } from '../pipeline'
import type { Gap, SourceModel } from '../types'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../testing/fixtures/${name}`, import.meta.url)), 'utf8')
const xml = fixture('acme-odata.xml')
const json = fixture('acme-odata.json')
const v3 = fixture('acme-odata-v3.xml')
const doctype = fixture('acme-odata-doctype.xml')

// describe.each bodies run at collection time, so the XML reader is loaded before any of them.
await prepareInput({ text: xml })

function ok(text: string, opts: Parameters<typeof parseInput>[1] = {}) {
  const r = parseInput({ text }, opts)
  if (!r.ok) throw new Error(JSON.stringify(r.gaps))
  return r
}
const codes = (gaps: Gap[]) => gaps.map((g) => g.code)

describe('registration and detection', () => {
  it('is registered last and detects EDMX and CSDL JSON by structure', () => {
    expect(ADAPTERS[ADAPTERS.length - 1].id).toBe('odata')
    for (const t of [xml, json, v3]) expect(detectAdapters({ text: t })[0].adapter.id).toBe('odata')
    expect(odataAdapter.detect({ text: xml })).toBe(0.95)
  })
  it('does not claim other inputs', () => {
    for (const t of ['openapi: 3.0.3\ninfo: {}\npaths: {}\n', 'CREATE TABLE a (b INT);', '{"a":1}', '<root/>', '{"$Version":"4.0"}x', 'model A {\n id Int @id\n}\n']) {
      expect(odataAdapter.detect({ text: t })).toBeLessThanOrEqual(0.5)
    }
    expect(detectAdapters({ text: '<root xmlns="http://docs.oasis-open.org/odata/ns/edm"/>' }).map((h) => h.adapter.id)).not.toContain('odata')
  })
  it('a schema-only CSDL JSON is a weak match and a document that also looks like OpenAPI reports ambiguity', () => {
    expect(odataAdapter.detect({ text: '{"$Version":"4.0","Acme":{}}' })).toBe(0.5)
    const both = JSON.stringify({ openapi: '3.0.3', $Version: '4.0', $EntityContainer: 'A.C', A: { C: { $Kind: 'EntityContainer', Things: { $Collection: true, $Type: 'A.T' } }, T: { $Kind: 'EntityType', $Key: ['Id'], Id: { $Type: 'Edm.Int32' } } } })
    const r = ok(both, { adapterId: 'odata' })
    expect(codes(r.gaps)).toContain('ambiguous-input')
  })
})

describe.each([
  ['EDMX XML', xml],
  ['CSDL JSON', json],
])('%s model', (_label, text) => {
  const r = ok(text)
  const m = r.model
  const entity = (id: string) => m.entities.find((e) => e.id === id)!
  it('goes through the odata adapter into the http backend', () => {
    expect(r.adapterId).toBe('odata')
    expect(m.backend).toEqual({ kind: 'http', baseUrlEnv: 'ACME_CATALOG_BASE_URL' })
    expect(m.name).toBe('Acme Catalog')
  })
  it('creates a list per entity set and a lookup where the key is usable, GET only', () => {
    expect(m.operations.map((o) => o.id).sort()).toEqual(['get_OrderLines', 'get_Products', 'get_Suppliers', 'list_OrderLines', 'list_Products', 'list_Suppliers'])
    expect(m.operations.every((o) => o.method === 'GET' && o.protocol === 'odata')).toBe(true)
    const list = m.operations.find((o) => o.id === 'list_Products')!
    expect(list.path).toBe('/Products')
    expect(list.params).toMatchObject([
      { name: 'top', wireName: '$top', in: 'query' },
      { name: 'skip', wireName: '$skip', in: 'query' },
    ])
    expect(list.pageParam).toBe('skip')
    expect(list.pageSizeParam).toBe('top')
  })
  it('composite keys keep property order and wire names', () => {
    const get = m.operations.find((o) => o.id === 'get_OrderLines')!
    expect(get.params.map((p) => [p.name, p.wireName, p.type])).toEqual([
      ['order_id', 'OrderID', 'integer'],
      ['line_number', 'LineNumber', 'integer'],
    ])
    expect(entity('OrderLine').identifierFields).toEqual(['OrderID', 'LineNumber'])
  })
  it('maps Edm types and carries the literal kind for filters', () => {
    const kinds = Object.fromEntries(entity('Product').fields.map((f) => [f.name, [f.type, f.odata?.kind ?? null]]))
    expect(kinds).toMatchObject({
      ID: ['string', 'guid'],
      Name: ['string', 'string'],
      Status: ['string', 'enum'],
      Price: ['string', 'number'],
      Stock: ['integer', 'number'],
      ReleaseDate: ['string', 'date'],
      Active: ['boolean', 'boolean'],
      Size: ['object', null],
      Tags: ['array', null],
    })
    expect(entity('Product').fields.find((f) => f.name === 'Status')).toMatchObject({ enum: ['Draft', 'Active', 'Retired'], odata: { enumType: 'Acme.Catalog.ProductStatus' } })
  })
  it('leaves out binary properties and reports them', () => {
    expect(entity('Product').fields.map((f) => f.name)).not.toContain('Photo')
    expect(r.gaps.find((g) => g.code === 'unsupported-type')?.message).toContain('Photo')
  })
  it('reports navigation properties and never expands them', () => {
    const g = r.gaps.find((x) => x.code === 'odata-navigation-not-expanded' && x.path === 'Products')!
    expect(g.message).toContain('Supplier')
    expect(g.message).toContain('Reviews')
    expect(JSON.stringify(m.operations)).not.toContain('expand')
  })
  it('FilterRestrictions makes a property unfilterable', () => {
    const note = entity('OrderLine').fields.find((f) => f.name === 'Note')!
    expect(note.odata).toMatchObject({ kind: 'string', filterable: false })
    expect(entity('OrderLine').fields.find((f) => f.name === 'Quantity')!.odata!.filterable).toBe(true)
  })
  it('actions are dropped writes, functions and singletons are reported', () => {
    expect(m.writeOperationsDropped).toEqual(['Acme.Catalog.ArchiveProduct'])
    expect(codes(r.gaps)).toEqual(expect.arrayContaining(['odata-function-unsupported', 'odata-singleton-unsupported']))
  })
  it('references and external annotations are reported, never fetched, and no URL is kept', () => {
    expect(codes(r.gaps)).toEqual(expect.arrayContaining(['external-reference-not-fetched', 'odata-external-annotations-ignored']))
    expect(JSON.stringify(m)).not.toMatch(/https?:|vocab\.acme/)
    expect(JSON.stringify(r.gaps)).not.toMatch(/https?:|vocab\.acme/)
  })
  it('Authorization annotation maps to a supplied OAuth2 access token', () => {
    expect(m.auth).toEqual({ scheme: 'bearer', envVar: 'ACME_CATALOG_ACCESS_TOKEN', oauth2: true })
    expect(codes(r.gaps)).toContain('oauth2-flow-not-implemented')
  })
  it('Core.Description becomes the operation summary', () => {
    expect(m.operations.find((o) => o.id === 'list_Products')!.summary).toBe('Products you can order.')
    expect(m.operations.find((o) => o.id === 'list_Suppliers')!.summary).toBeUndefined()
  })
  it('Int64 and Decimal stay text, with one info gap', () => {
    expect(codes(r.gaps)).toContain('odata-precision-as-string')
  })
})

describe('XML only', () => {
  const m = ok(xml).model
  it('derived types are flattened with an info gap and Int64 is text', () => {
    expect(ok(xml).gaps.map((g) => g.code)).toContain('odata-derived-types-flattened')
    expect(m.entities.find((e) => e.id === 'Supplier')!.fields.find((f) => f.name === 'Rating')).toMatchObject({ type: 'string', odata: { kind: 'number' } })
  })
})

describe('OData V2 and V3', () => {
  it('is rejected with the stable code and nothing else', () => {
    const r = parseInput({ text: v3 })
    expect(r.ok).toBe(false)
    expect(r.gaps.map((g) => g.code)).toEqual(['odata-version-unsupported'])
    expect(r.gaps[0].severity).toBe('error')
  })
  it('an unsupported or missing JSON $Version is rejected the same way', () => {
    const r = parseInput({ text: '{"$Version":"1.0","$EntityContainer":"A.C"}' }, { adapterId: 'odata' })
    expect(r.ok).toBe(false)
    expect(r.gaps.map((g) => g.code)).toEqual(['odata-version-unsupported'])
  })
})

describe('rejections and edge cases', () => {
  it('no entity sets', () => {
    const r = parseInput({ text: '{"$Version":"4.0","$EntityContainer":"A.C","A":{"C":{"$Kind":"EntityContainer"}}}' })
    expect(r.ok).toBe(false)
    expect(r.gaps.map((g) => g.code)).toContain('no-entity-sets')
  })
  it('an entity set whose type is defined only in a referenced schema is left out and reported', () => {
    const t = JSON.stringify({ $Version: '4.0', $EntityContainer: 'A.C', A: { C: { $Kind: 'EntityContainer', Things: { $Collection: true, $Type: 'Elsewhere.Thing' }, Own: { $Collection: true, $Type: 'A.Own' } }, Own: { $Kind: 'EntityType', $Key: ['Id'], Id: { $Type: 'Edm.Int32' } } } })
    const r = ok(t)
    expect(r.model.entities.map((e) => e.id)).toEqual(['Own'])
    expect(codes(r.gaps)).toContain('odata-type-unresolved')
  })
  it('a type without a key lists only; an alias-path key is reported', () => {
    const t = JSON.stringify({ $Version: '4.0', $EntityContainer: 'A.C', A: { C: { $Kind: 'EntityContainer', Things: { $Collection: true, $Type: 'A.T' } }, T: { $Kind: 'EntityType', Name: {} } } })
    const r = ok(t)
    expect(r.model.operations.map((o) => o.id)).toEqual(['list_Things'])
    expect(codes(r.gaps)).toContain('no-identifier')
    const alias = t.replace('"Name":{}', '"$Key":[{"K":"Name"}],"Name":{}')
    expect(codes(ok(alias).gaps)).toContain('odata-key-unsupported')
  })
  it('unsafe names are left out, never copied into the model', () => {
    const t = JSON.stringify({ $Version: '4.0', $EntityContainer: 'A.C', A: { C: { $Kind: 'EntityContainer', 'Bad/Name': { $Collection: true, $Type: 'A.T' }, Good: { $Collection: true, $Type: 'A.T' } }, T: { $Kind: 'EntityType', $Key: ['Id'], Id: { $Type: 'Edm.Int32' }, 'a b': {}, 'x"y': {} } } })
    const r = ok(t)
    expect(r.model.operations.map((o) => o.path)).toEqual(['/Good', '/Good'])
    expect(r.model.entities[0].fields.map((f) => f.name)).toEqual(['Id'])
    expect(JSON.stringify(r)).not.toContain('Bad/Name')
  })
  it('key argument names that collide with standard tool arguments are suffixed', () => {
    const t = JSON.stringify({ $Version: '4.0', $EntityContainer: 'A.C', A: { C: { $Kind: 'EntityContainer', Things: { $Collection: true, $Type: 'A.T' } }, T: { $Kind: 'EntityType', $Key: ['Fields'], Fields: {} } } })
    expect(ok(t).model.operations.find((o) => o.kind === 'get')!.params[0]).toMatchObject({ name: 'fields_key', wireName: 'Fields' })
  })
  it('malformed input is a rejection, never a throw', () => {
    for (const t of ['{"$Version":', '<edmx:Edmx', '{"$Version":"4.0"', '<a><b></a>']) {
      const r = parseInput({ text: t }, { adapterId: 'odata' })
      expect(r.ok).toBe(false)
    }
  })
  it('a forced odata adapter on other text is rejected', () => {
    expect(parseInput({ text: 'hello' }, { adapterId: 'odata' }).ok).toBe(false)
  })
})

describe('end to end', () => {
  it('runPipelineAsync prepares the XML reader; the synchronous pipeline never throws without it', async () => {
    const r = await runPipelineAsync(xml, {})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.adapterId).toBe('odata')
    expect(() => runPipeline(xml, {})).not.toThrow()
    const j = runPipeline(json, {})
    expect(j.ok).toBe(true)
  })
  it('the same tools come out of JSON and XML', async () => {
    const a = await runPipelineAsync(xml, {})
    const b = runPipeline(json, {})
    if (!a.ok || !b.ok) throw new Error('both must generate')
    expect(a.report.toolsEmitted).toEqual(b.report.toolsEmitted)
    expect(a.report.toolsEmitted).toEqual(['list_order_lines', 'list_products', 'list_suppliers', 'lookup_order_line_by_order_id_and_line_number', 'lookup_product_by_id', 'lookup_supplier_by_supplier_code'])
  })
  it('model typing', () => {
    const m: SourceModel = ok(json).model
    expect(m.entities.length).toBe(3)
  })
})

describe('hostile documents', () => {
  it('a DOCTYPE with an external entity is rejected before the parser, with the stable code', () => {
    const r = parseInput({ text: doctype })
    expect(r.ok).toBe(false)
    expect(r.gaps.map((g) => g.code)).toEqual(['doctype-rejected'])
    expect(JSON.stringify(r.gaps)).not.toContain('nonexistent')
  })
  it('credentials inside annotations are rejected by the credential scan before the adapter', () => {
    const literal = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('')
    for (const t of [xml.replace('A product in the Acme catalog.', `token ${literal}`), json.replace('A product in the Acme catalog.', `token ${literal}`)]) {
      const r = parseInput({ text: t })
      expect(r.ok).toBe(false)
      expect(r.gaps.map((g) => g.code)).toContain('credential-rejected')
      expect(JSON.stringify(r)).not.toContain(literal)
    }
  })
})
