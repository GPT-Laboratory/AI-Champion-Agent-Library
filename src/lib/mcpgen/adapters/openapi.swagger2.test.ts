// Swagger 2.0 input (D-520): normalised inside the openapi adapter into the existing model path.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { openApiAdapter, OPERATION_SCHEMA_BUDGET } from './openapi'
import { detectAdapters, parseInput } from '../registry'
import { runPipeline } from '../pipeline'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../testing/fixtures/${name}`, import.meta.url)), 'utf8')
const yamlText = fixture('acme-swagger2.yaml')
const jsonText = fixture('acme-swagger2.json')
const hostile = fixture('acme-swagger2-hostile.yaml')

function ok(text: string) {
  const r = parseInput({ text })
  if (!r.ok) throw new Error(JSON.stringify(r.gaps))
  return r
}

describe('swagger 2.0 detection', () => {
  it('is preferred by the openapi adapter for YAML and JSON, quoted or not', () => {
    for (const t of [yamlText, jsonText, 'swagger: 2.0\ninfo: {}', "swagger: '2.0'\n"]) {
      expect(openApiAdapter.detect({ text: t })).toBe(0.95)
      expect(detectAdapters({ text: t })[0].adapter.id).toBe('openapi')
    }
  })
  it('another swagger version is recognised but scored low and rejected', () => {
    const t = 'swagger: "1.2"\ninfo: {}\npaths: {}\n'
    expect(openApiAdapter.detect({ text: t })).toBe(0.1)
    const r = parseInput({ text: t })
    expect(r.ok).toBe(false)
    expect(r.gaps.map((g) => g.code)).toContain('unsupported-version')
  })
})

describe('swagger 2.0 model', () => {
  const r = ok(yamlText)
  it('goes through the openapi adapter', () => {
    expect(r.adapterId).toBe('openapi')
  })
  it('keeps only the read operations; body parameters belong to dropped writes', () => {
    expect(r.model.operations.map((o) => o.id)).toEqual(['getPart', 'listParts'])
    expect(r.model.writeOperationsDropped).toEqual(['createPart', 'deletePart'])
  })
  it('reads query and path parameters (also by reference), drops header parameters', () => {
    const list = r.model.operations.find((o) => o.id === 'listParts')!
    expect(list.params.map((p) => `${p.in}:${p.name}:${p.type}`)).toEqual(['query:q:string', 'query:page:integer', 'query:size:integer'])
    expect(list.pageParam).toBe('page')
    expect(list.pageSizeParam).toBe('size')
    expect(list.params.find((p) => p.name === 'size')).toMatchObject({ min: 1, max: 50 })
    expect(r.model.operations.find((o) => o.id === 'getPart')!.params).toMatchObject([{ in: 'path', name: 'partId', required: true }])
  })
  it('resolves definitions, enums and x-nullable', () => {
    const part = r.model.entities.find((e) => e.id === 'part')!
    expect(part.fields.find((f) => f.name === 'status')!.enum).toEqual(['active', 'retired'])
    expect(part.fields.find((f) => f.name === 'note')!.nullable).toBe(true)
    expect(part.identifierFields).toEqual(['partId'])
    expect(part.nested.map((n) => n.field)).toEqual(['features'])
  })
  it('never copies host, basePath or scheme: the base address is an env placeholder', () => {
    expect(r.model.backend).toEqual({ kind: 'http', baseUrlEnv: 'ACME_SWAGGER_PARTS_BASE_URL' })
    expect(JSON.stringify(r.model)).not.toMatch(/acme\.example|\/v1|https/)
  })
  it('apiKey in a header becomes the header scheme', () => {
    expect(r.model.auth).toEqual({ scheme: 'apiKeyHeader', paramName: 'X-Acme-Key', envVar: 'ACME_SWAGGER_PARTS_API_KEY' })
  })
  it('the YAML fixture re-serialised as JSON gives the same model', () => {
    const asJson = JSON.stringify(parseYaml(yamlText))
    expect(JSON.stringify(ok(asJson).model)).toBe(JSON.stringify(r.model))
  })
})

describe('swagger 2.0 JSON, produces, response references and oauth2', () => {
  const r = ok(jsonText)
  it('resolves #/responses references, offset paging and drops put', () => {
    expect(r.model.operations.map((o) => o.id)).toEqual(['getOrder', 'listOrders'])
    const list = r.model.operations.find((o) => o.id === 'listOrders')!
    expect(list.offsetParam).toBe('offset')
    expect(list.pageSizeParam).toBe('limit')
    expect(r.model.writeOperationsDropped).toEqual(['replaceOrder'])
  })
  it('an operation that cannot produce JSON is reported, not guessed', () => {
    expect(r.gaps.find((g) => g.code === 'missing-response-schema')).toMatchObject({ path: 'downloadReport' })
  })
  it('oauth2 securityDefinitions become the bearer access token', () => {
    expect(r.model.auth).toEqual({ scheme: 'bearer', envVar: 'ACME_SWAGGER_ORDERS_ACCESS_TOKEN', oauth2: true })
    expect(r.gaps.map((g) => g.code)).toContain('oauth2-flow-not-implemented')
  })
})

describe('swagger 2.0 other cases', () => {
  const base = (extra: string, security = '') =>
    `swagger: "2.0"\ninfo: { title: Acme Misc, version: "1" }\n${security}paths:\n  /things:\n    get:\n      operationId: listThings\n${extra}      responses:\n        "200":\n          description: ok\n          schema:\n            type: array\n            items:\n              $ref: "#/definitions/Thing"\ndefinitions:\n  Thing:\n    type: object\n    properties:\n      thing_id: { type: string }\n`
  it('basic auth is reported as unsupported (no credentials are sent)', () => {
    const r = ok(base('', 'securityDefinitions:\n  B: { type: basic }\nsecurity:\n  - B: []\n'))
    expect(r.model.auth.scheme).toBe('none')
    expect(r.gaps.map((g) => g.code)).toContain('auth-unsupported')
  })
  it('a GET with a body parameter is reported at info level', () => {
    const r = ok(base('      parameters:\n        - { name: body, in: body, schema: { type: object } }\n'))
    expect(r.gaps.find((g) => g.code === 'swagger2-body-param-ignored')).toMatchObject({ severity: 'info' })
  })
  it('produces without a JSON type leaves no response schema', () => {
    const r = parseInput({ text: base('      produces: [text/plain]\n') })
    expect(r.ok).toBe(false)
    expect(r.gaps.map((g) => g.code)).toContain('missing-response-schema')
  })
  it('a missing path parameter definition omits the operation', () => {
    const t = base('').replace('/things:', '/things/{thingId}:')
    const r = parseInput({ text: t })
    expect(r.ok).toBe(false)
    expect(r.gaps.map((g) => g.code)).toContain('path-param-undocumented')
  })
  it('an unresolvable parameter or response reference is reported with the usual code', () => {
    const r = parseInput({ text: base('      parameters:\n        - $ref: "#/parameters/Nope"\n') })
    expect(r.ok).toBe(false)
    expect(r.gaps.map((g) => g.code)).toContain('ref-unresolved')
  })
})

describe('swagger 2.0 hostile input', () => {
  const r = ok(hostile)
  it('a schema that refers to itself terminates and keeps its fields', () => {
    const node = r.model.entities.find((e) => e.id === 'node')!
    expect(node.fields.map((f) => f.name)).toEqual(['nodeId', 'parent', 'children'])
  })
  it('endless reference chains, external references and anchors are gaps; nothing is fetched', () => {
    const byPath = (code: string) => r.gaps.find((g) => g.code === code)?.path
    expect(byPath('ref-depth-exceeded')).toBe('listLoops')
    expect(byPath('external-ref-unsupported')).toBe('listRemote')
    expect(byPath('ref-anchor-unsupported')).toBe('listAnchored')
    expect(r.model.operations.map((o) => o.id)).toEqual(['listNodes'])
  })
  it('a huge allOf fan-out in definitions is bounded by the existing budgets', () => {
    const members = Array.from({ length: OPERATION_SCHEMA_BUDGET + 500 }, () => ({}))
    const text = JSON.stringify({
      swagger: '2.0',
      info: { title: 'Acme Fan' },
      paths: { '/things': { get: { operationId: 'listThings', responses: { '200': { description: 'ok', schema: { type: 'array', items: { $ref: '#/definitions/S0' } } } } } } },
      definitions: { S0: { allOf: members } },
    })
    const t0 = performance.now()
    const out = parseInput({ text })
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(out.ok).toBe(false)
    expect(out.gaps.map((g) => g.code)).toContain('schema-budget-exceeded')
  })
  it('exponential allOf chains stay memoised', () => {
    const defs: Record<string, unknown> = {}
    for (let i = 0; i < 11; i++) defs[`S${i}`] = { allOf: Array.from({ length: 6 }, () => ({ $ref: `#/definitions/S${i + 1}` })) }
    defs.S11 = { type: 'object', properties: { thing_id: { type: 'string' } } }
    const text = JSON.stringify({
      swagger: '2.0',
      info: { title: 'Acme Chain' },
      paths: { '/things': { get: { operationId: 'listThings', responses: { '200': { description: 'ok', schema: { type: 'array', items: { $ref: '#/definitions/S0' } } } } } } },
      definitions: defs,
    })
    const t0 = performance.now()
    expect(runPipeline(text).ok).toBe(true)
    expect(performance.now() - t0).toBeLessThan(2000)
  })
  it('a credential embedded in an example is rejected before any adapter runs and is never echoed', () => {
    const literal = ['sk', 'live', 'abcdef1234567890abcdef'].join('-')
    const withKey = `${yamlText}\nx-example-config:\n  api_key: ${literal}\n`
    const out = parseInput({ text: withKey })
    expect(out.ok).toBe(false)
    expect(out.gaps.map((g) => g.code)).toContain('credential-rejected')
    expect(JSON.stringify(out)).not.toContain(literal)
  })
  it('input over the size limit is still rejected', () => {
    const out = parseInput({ text: `${yamlText}\n#${'x'.repeat(6 * 1024 * 1024)}` })
    expect(out.ok).toBe(false)
    expect(out.gaps.map((g) => g.code)).toContain('input-too-large')
  })
})

// CR-03: produces: ["*/*"] must not drop every operation (OpenAPI 3 accepts */*).
describe('swagger 2.0 produces */* (CR-03)', () => {
  const doc = (produces: string) =>
    `swagger: "2.0"\ninfo: {title: Wild, version: "1"}\nproduces: ${produces}\npaths:\n  /items:\n    get:\n      responses:\n        "200":\n          description: ok\n          schema: {type: array, items: {type: object, properties: {id: {type: integer}}}}\n`
  it('keeps the operation for */*', () => {
    const r = parseInput({ text: doc('["*/*"]') })
    expect(r.ok, JSON.stringify(r.ok ? [] : r.gaps)).toBe(true)
  })
  it('prefers JSON when both are present and still drops XML-only', () => {
    expect(parseInput({ text: doc('["application/xml", "*/*"]') }).ok).toBe(true)
    expect(parseInput({ text: doc('["application/json", "*/*"]') }).ok).toBe(true)
    expect(parseInput({ text: doc('["application/xml"]') }).ok).toBe(false)
  })
})
