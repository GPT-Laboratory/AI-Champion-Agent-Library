// Review fix CR-02 (exponential allOf / oneOf fan-out) and IN-04 (Object.prototype property names).
// Every document here is a few kilobytes; before the fix the first one took many seconds.
import { describe, expect, it } from 'vitest'
import { OPERATION_SCHEMA_BUDGET } from './openapi'
import { runPipeline } from '../pipeline'
import { parseInput } from '../registry'

/** Far above the memoised cost, far below the unbounded one (seconds to hours). */
const BOUND_MS = 2000

function doc(schemas: Record<string, unknown>, root = 'S0'): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Acme Parts' },
    paths: {
      '/things': {
        get: {
          operationId: 'listThings',
          responses: {
            '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: `#/components/schemas/${root}` } } } } },
          },
        },
      },
    },
    components: { schemas },
  })
}

/** S0 -> S1 -> ... -> S{depth}: every level lists `width` references to the next one. */
function chain(depth: number, width: number, kind: 'allOf' | 'oneOf'): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < depth; i++) {
    const members = Array.from({ length: width }, () => ({ $ref: `#/components/schemas/S${i + 1}` }))
    out[`S${i}`] = kind === 'allOf' ? { allOf: members } : { oneOf: members, discriminator: { propertyName: 'kind' } }
  }
  out[`S${depth}`] = { type: 'object', properties: { thing_id: { type: 'string' }, name: { type: 'string' } } }
  return out
}

describe('schema composition is memoised and bounded', () => {
  it.each([
    ['allOf width 4 depth 11', chain(11, 4, 'allOf')],
    ['allOf width 8 depth 11', chain(11, 8, 'allOf')],
    ['oneOf with a discriminator, width 6 depth 11', chain(11, 6, 'oneOf')],
  ])('%s is read quickly and keeps its fields', (_name, schemas) => {
    const text = doc(schemas)
    expect(text.length).toBeLessThan(5000)
    const t0 = performance.now()
    const r = runPipeline(text)
    expect(performance.now() - t0).toBeLessThan(BOUND_MS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const server = r.files.find((f) => f.path === 'server.py')!.content
      expect(server).toContain('thing_id')
    }
  })

  it('a composition larger than the node budget is reported as a gap and the operation is omitted', () => {
    const members = Array.from({ length: OPERATION_SCHEMA_BUDGET + 500 }, () => ({}))
    const text = doc({ S0: { allOf: members } })
    const t0 = performance.now()
    const r = parseInput({ text })
    expect(performance.now() - t0).toBeLessThan(BOUND_MS)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const codes = r.gaps.map((g) => g.code)
      expect(codes).toContain('schema-budget-exceeded')
      expect(r.gaps.find((g) => g.code === 'schema-budget-exceeded')!.message).toMatch(/too large/)
    }
  })

  it('one over-budget operation does not stop the others', () => {
    const members = Array.from({ length: OPERATION_SCHEMA_BUDGET + 10 }, () => ({}))
    const text = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Acme Parts' },
      paths: {
        '/big': { get: { operationId: 'listBig', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { allOf: members } } } } } } } },
        '/small': {
          get: {
            operationId: 'listSmall',
            responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { small_id: { type: 'string' } } } } } } } },
          },
        },
      },
    })
    const r = parseInput({ text })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.gaps.map((g) => g.code)).toContain('schema-budget-exceeded')
      expect(r.model.operations.map((o) => o.id)).toEqual(['listSmall'])
    }
  })

  it('a cyclic allOf still fails with the depth gap, quickly', () => {
    const text = doc({ S0: { allOf: [{ $ref: '#/components/schemas/S1' }] }, S1: { allOf: [{ $ref: '#/components/schemas/S0' }] } })
    const t0 = performance.now()
    const r = parseInput({ text })
    expect(performance.now() - t0).toBeLessThan(BOUND_MS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.gaps.map((g) => g.code)).toContain('ref-depth-exceeded')
  })
})

describe('property names that exist on Object.prototype are ordinary fields (IN-04)', () => {
  it('constructor, toString, valueOf and hasOwnProperty survive an allOf merge', () => {
    const text = doc({
      S0: { allOf: [{ $ref: '#/components/schemas/Base' }], properties: { own_id: { type: 'string' } } },
      Base: {
        type: 'object',
        properties: { constructor: { type: 'string' }, toString: { type: 'string' }, valueOf: { type: 'string' }, hasOwnProperty: { type: 'string' } },
      },
    })
    const r = parseInput({ text })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const names = r.model.entities[0].fields.map((f) => f.name)
      for (const n of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'own_id']) expect(names).toContain(n)
    }
  })
  it('a __proto__ property does not change the prototype of the property map', () => {
    const text = doc({ S0: { type: 'object', properties: { own_id: { type: 'string' } } } }).replace('"own_id"', '"__proto__":{"type":"string"},"own_id"')
    const r = parseInput({ text })
    expect(r.ok).toBe(true)
    expect(({} as Record<string, unknown>).type).toBeUndefined()
    if (r.ok) expect(r.model.entities[0].fields.map((f) => f.name)).toContain('own_id')
  })
})
