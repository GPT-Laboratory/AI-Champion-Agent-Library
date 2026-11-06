import { describe, it, expect } from 'vitest'
import { buildPlan, detectDerivedTools, snake, plural, uniqueName, toolKind, PROJECTION_MAX_FIELDS } from './plan'
import { acmeHttp, acmeDataset, acmeSql } from './testing/sample-models'
import type { DerivedTool, SourceModel } from './types'

const names = (m: SourceModel, o = {}) => buildPlan(m, o).tools.map((t) => t.name)

describe('naming helpers', () => {
  it('snake-cases and pluralises', () => {
    expect(snake('ProductGroup')).toBe('product_group')
    expect(snake('9lives')).toBe('x_9lives')
    expect(plural('category')).toBe('categories')
    expect(plural('box')).toBe('boxes')
    expect(plural('product')).toBe('products')
  })
  it('suffixes collisions deterministically and caps the length', () => {
    const used = new Set<string>()
    expect(uniqueName('list_a', used)).toBe('list_a')
    expect(uniqueName('list_a', used)).toBe('list_a_2')
    expect(uniqueName('list_a', used)).toBe('list_a_3')
    const long = uniqueName('x'.repeat(80), new Set())
    expect(long.length).toBeLessThanOrEqual(48)
  })
})

describe('buildPlan: http', () => {
  const plan = buildPlan(acmeHttp, {})
  it('names tools by intent, never operationId style', () => {
    const n = plan.tools.map((t) => t.name)
    expect(n).toEqual([...n].sort())
    expect(n).toContain('lookup_product_by_id')
    expect(n).toContain('search_product')
    expect(n).toContain('list_products')
    expect(n).toContain('filter_product_by_features')
    for (const x of n) {
      expect(x).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(x.length).toBeLessThanOrEqual(48)
      expect(x.toLowerCase()).not.toContain('usingget')
      expect(x).not.toMatch(/^(get|post|put|patch|delete)_/)
    }
  })
  it('is deterministic', () => {
    expect(JSON.stringify(buildPlan(acmeHttp, {}))).toBe(JSON.stringify(plan))
  })
  it('detects the derived filter and the tool fetches through the list operation', () => {
    const d = detectDerivedTools(acmeHttp)
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ kind: 'inMemoryFilter', origin: 'detected', entity: 'product', source: 'features' })
    const t = plan.tools.find((x) => x.derived)!
    expect(t.operation).toBe('listProducts')
    expect(toolKind(plan, t)).toBe('filter')
  })
  it('does not derive a filter when a request param already covers the nested field', () => {
    const m: SourceModel = {
      ...acmeHttp,
      operations: acmeHttp.operations.map((o) =>
        o.id === 'listProducts' ? { ...o, params: [...o.params, { name: 'feature_code', in: 'query', type: 'string', required: false }] } : o,
      ),
    }
    expect(detectDerivedTools(m)).toEqual([])
    expect(names(m).some((x) => x.startsWith('filter_'))).toBe(false)
  })
  it('caps projection at 12 and keeps identifier, name, class and nested field', () => {
    for (const t of plan.tools) expect(t.projection.length).toBeLessThanOrEqual(PROJECTION_MAX_FIELDS)
    expect(plan.tools[0].projection).toEqual(['product_id', 'name', 'category', 'features'])
    const wide = Array.from({ length: 20 }, (_, i) => `attr_${String(i + 1).padStart(2, '0')}`)
    const p2 = buildPlan(acmeHttp, { projectionOverride: { product: ['product_id', ...wide, 'nope'] } })
    expect(p2.tools[0].projection).toHaveLength(12)
    expect(p2.gaps.map((g) => g.code)).toEqual(expect.arrayContaining(['projection-capped', 'projection-unknown-field']))
  })
  it('drops writes, records opt-in without emitting', () => {
    expect(plan.gaps.some((g) => g.code === 'write-dropped' && g.path === 'createProduct')).toBe(true)
    const p = buildPlan(acmeHttp, { allowWrite: ['createProduct'] })
    expect(p.gaps.some((g) => g.code === 'write-not-supported')).toBe(true)
    expect(p.tools.some((t) => /create/.test(t.name))).toBe(false)
  })
  it('validates user-origin derived tools and never guesses', () => {
    const good: DerivedTool = { id: 'product.features.b', kind: 'inMemoryFilter', entity: 'product', source: 'features', description: 'x', origin: 'user' }
    const bad1: DerivedTool = { ...good, id: 'b1', entity: 'ghost' }
    const bad2: DerivedTool = { ...good, id: 'b2', source: 'nothing' }
    const bad3: DerivedTool = { ...good, id: 'b3', kind: 'crossFieldSearch' }
    const p = buildPlan(acmeHttp, {}, [good, bad1, bad2, bad3])
    expect(p.gaps.filter((g) => g.code === 'derived-invalid')).toHaveLength(3)
    expect(p.derived.map((d) => d.id)).toEqual(['product.features', 'product.features.b'])
    expect(p.derived[1].origin).toBe('user')
    expect(p.tools.filter((t) => t.derived)).toHaveLength(2)
  })
  it('warns when no ceiling is known and omits tools with unsafe parameter names', () => {
    const m: SourceModel = {
      ...acmeHttp,
      limits: { maxPageSize: 50, maxResponseItems: 200 },
      operations: [
        {
          id: 'listProducts',
          kind: 'list',
          method: 'GET',
          path: '/products',
          entity: 'product',
          params: [{ name: 'class', in: 'query', type: 'string', required: false }],
        },
        { id: 'weird', kind: 'get', method: 'GET', path: '/x/{a-b}', entity: 'product', params: [{ name: 'a-b', in: 'path', type: 'string', required: true }] },
      ],
    }
    const p = buildPlan(m, {})
    expect(p.gaps.map((g) => g.code)).toEqual(expect.arrayContaining(['ceiling-unknown', 'tool-omitted', 'param-dropped']))
    expect(p.tools.map((t) => t.name)).toEqual(['filter_product_by_features', 'list_products'])
    const none = buildPlan({ ...m, operations: [m.operations[1]] })
    expect(none.gaps.some((g) => g.code === 'no-tools' && g.severity === 'error')).toBe(true)
  })
  it('skips non-GET operations', () => {
    const m: SourceModel = {
      ...acmeHttp,
      operations: [...acmeHttp.operations, { id: 'postThing', kind: 'other', method: 'DATASET', entity: 'product', params: [] }],
    }
    expect(buildPlan(m).gaps.some((g) => g.code === 'operation-skipped' && g.path === 'postThing')).toBe(true)
  })
})

describe('buildPlan: dataset and sql', () => {
  it('dataset gets describe and query tools', () => {
    expect(names(acmeDataset)).toEqual(['describe_acme_inventory', 'query_item'])
  })
  it('sql gets one query tool per table (reserved word table included)', () => {
    expect(names(acmeSql)).toEqual(['describe_acme_orders', 'query_customer', 'query_order'])
  })
  it('omits sql entities with unsafe names and reports them', () => {
    const m: SourceModel = { ...acmeSql, entities: [...acmeSql.entities, { id: 'bad name; drop', label: 'x', fields: [{ name: 'a', type: 'string' }], identifierFields: [], nested: [] }] }
    const p = buildPlan(m)
    expect(p.tools.map((t) => t.name)).not.toContain('query_bad_name_drop')
    expect(p.gaps.some((g) => g.code === 'tool-omitted')).toBe(true)
  })
  it('applies option overrides for limits and server name', () => {
    const p = buildPlan(acmeDataset, { serverName: 'Other Name', limits: { maxPageSize: 7 } })
    expect(p.model.name).toBe('Other Name')
    expect(p.tools.some((t) => t.name === 'describe_other_name')).toBe(true)
    expect(p.tools.find((t) => t.name === 'query_item')!.description).toContain('7 rows')
  })
})
