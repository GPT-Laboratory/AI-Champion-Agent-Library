// Review fix WR-09: `security: []` is a public API, and operation level security is reported.
import { describe, expect, it } from 'vitest'
import { parseInput } from '../registry'
import { generate } from '../generate'
import { openApiAdapter } from './openapi'

const op = (extra: Record<string, unknown> = {}) => ({
  get: {
    operationId: 'listParts',
    ...extra,
    responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Part' } } } } } },
  },
})

function doc(root: Record<string, unknown>, operation: Record<string, unknown> = {}): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Acme Parts' },
    paths: { '/parts': op(operation) },
    components: {
      schemas: { Part: { type: 'object', properties: { part_id: { type: 'string' }, name: { type: 'string' } } } },
      securitySchemes: { AcmeKey: { type: 'apiKey', in: 'header', name: 'X-Acme-Key' } },
    },
    ...root,
  })
}

function model(text: string) {
  const r = parseInput({ text })
  if (!r.ok) throw new Error(`fixture must parse: ${JSON.stringify(r.gaps)}`)
  return r
}

describe('document-level security', () => {
  it('an empty security list means no authentication, even with declared schemes', () => {
    const r = model(doc({ security: [] }))
    expect(r.model.auth.scheme).toBe('none')
    expect(r.gaps.some((g) => g.code === 'auth-public' && g.severity === 'info')).toBe(true)
    const server = generate(r.model).files.find((f) => f.path === 'server.py')!.content
    expect(server).not.toContain('X-Acme-Key')
    expect(server).not.toMatch(/AUTH_ENV = "/)
  })
  it('a referenced scheme is used', () => {
    const r = model(doc({ security: [{ AcmeKey: [] }] }))
    expect(r.model.auth).toMatchObject({ scheme: 'apiKeyHeader', paramName: 'X-Acme-Key' })
    expect(r.gaps.some((g) => g.code === 'auth-public')).toBe(false)
  })
  it('without a security entry the declared scheme is still used (unchanged behaviour)', () => {
    expect(model(doc({})).model.auth.scheme).toBe('apiKeyHeader')
  })
})

describe('operation-level security', () => {
  it('an operation that declares its own security is reported, naming the operation', () => {
    const r = model(doc({ security: [{ AcmeKey: [] }] }, { security: [] }))
    const g = r.gaps.find((x) => x.code === 'auth-operation-override')
    expect(g).toMatchObject({ severity: 'warn', path: 'listParts' })
    expect(r.model.gaps.some((x) => x.code === 'auth-operation-override')).toBe(true)
  })
  it('an operation that repeats the document-level requirement is not reported', () => {
    const r = model(doc({ security: [{ AcmeKey: [] }] }, { security: [{ AcmeKey: [] }] }))
    expect(r.gaps.some((g) => g.code === 'auth-operation-override')).toBe(false)
  })
  it('a different scheme set on the operation is reported', () => {
    const r = model(doc({ security: [{ AcmeKey: [] }] }, { security: [{ Other: [] }] }))
    expect(r.gaps.some((g) => g.code === 'auth-operation-override')).toBe(true)
  })
})

// CR-02: a security requirement naming a scheme that is not defined must not silently mean "no auth".
describe('undefined security scheme (CR-02)', () => {
  const doc = (extra: string) =>
    `openapi: 3.0.3\ninfo: {title: T, version: '1'}\n${extra}\npaths:\n  /items:\n    get:\n      responses:\n        '200':\n          description: ok\n          content:\n            application/json:\n              schema: {type: array, items: {type: object, properties: {id: {type: integer}}}}\n`
  it('reports auth-unsupported when the only referenced scheme is missing', () => {
    const r = openApiAdapter.parse({ text: doc('security:\n  - nope: []') })
    expect('rejected' in r).toBe(false)
    if (!('rejected' in r)) {
      expect(r.model.auth).toEqual({ scheme: 'none' })
      expect(r.gaps.map((g) => g.code)).toContain('auth-unsupported')
    }
  })
  it('reports it when the referenced scheme is not an object', () => {
    const r = openApiAdapter.parse({ text: doc("components:\n  securitySchemes:\n    bad: 5\nsecurity:\n  - bad: []") })
    if (!('rejected' in r)) expect(r.gaps.map((g) => g.code)).toContain('auth-unsupported')
  })
  it('stays quiet when a defined scheme is picked', () => {
    const r = openApiAdapter.parse({ text: doc('components:\n  securitySchemes:\n    k: {type: apiKey, in: header, name: X-K}\nsecurity:\n  - k: []') })
    if (!('rejected' in r)) expect(r.gaps.map((g) => g.code)).not.toContain('auth-unsupported')
  })
})
