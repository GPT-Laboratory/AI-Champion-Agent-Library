import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openApiAdapter } from './openapi'
import { parseInput, detectAdapters } from '../registry'
import { detectDerivedTools } from '../plan'
import type { ParseResult, SourceModel } from '../types'

const fx = (n: string) => readFileSync(fileURLToPath(new URL(`../testing/fixtures/${n}`, import.meta.url)), 'utf8')
const good = fx('acme-openapi.yaml')
const bad = fx('acme-openapi-bad.yaml')

function ok(r: ParseResult): { model: SourceModel; gaps: { code: string; severity: string }[] } {
  if ('rejected' in r) throw new Error(`rejected: ${JSON.stringify(r.rejected)}`)
  return r
}
const parse = (text: string) => openApiAdapter.parse({ text })
const codes = (r: ParseResult) => ('rejected' in r ? r.rejected : r.gaps).map((g) => g.code)

describe('openapi adapter: detect', () => {
  it('scores OpenAPI 3 in YAML and JSON, Swagger 2 low, others zero', () => {
    expect(openApiAdapter.detect({ text: good })).toBe(0.95)
    expect(openApiAdapter.detect({ text: '{"openapi": "3.1.0", "paths": {}}' })).toBe(0.95)
    // D-520: Swagger 2.0 is read by this adapter now (was 0.1 and rejected)
    expect(openApiAdapter.detect({ text: 'swagger: "2.0"\ninfo: {}' })).toBe(0.95)
    expect(openApiAdapter.detect({ text: 'a,b,c\n1,2,3' })).toBe(0)
    expect(openApiAdapter.detect({ text: '' })).toBe(0)
  })
  it('never throws on garbage', () => {
    expect(() => openApiAdapter.detect({ text: '\u0000\u0001\ufffd'.repeat(1000) })).not.toThrow()
    expect(openApiAdapter.detect({ text: '\u0000\u0001\ufffd' })).toBe(0)
  })
  it('the real registry detects the fixture as openapi', () => {
    expect(detectAdapters({ text: good })[0].adapter.id).toBe('openapi')
    const r = parseInput({ text: good })
    expect(r.ok && r.adapterId).toBe('openapi')
  })
})

describe('openapi adapter: parse acme-openapi.yaml', () => {
  const { model, gaps } = ok(parse(good))

  it('names the server and uses env names only', () => {
    expect(model.name).toBe('Acme Parts API')
    expect(model.backend).toEqual({ kind: 'http', baseUrlEnv: 'ACME_PARTS_BASE_URL' })
    expect(model.auth).toEqual({ scheme: 'apiKeyHeader', paramName: 'X-Acme-Key', envVar: 'ACME_PARTS_API_KEY' })
  })
  it('never carries the server URL or example values', () => {
    const json = JSON.stringify({ model, gaps })
    expect(json).not.toContain('acme.example')
    expect(json).not.toContain('sample-key-0000')
    expect(json).not.toContain('https://')
  })
  it('models GET operations only and lists the writes', () => {
    expect(model.operations.every((o) => o.method === 'GET')).toBe(true)
    expect(model.operations.map((o) => o.id)).toEqual(['getPart', 'listParts'])
    expect(model.writeOperationsDropped).toEqual(['createPart', 'deletePart'])
  })
  it('infers kinds, paging and the page size ceiling', () => {
    const list = model.operations.find((o) => o.id === 'listParts')!
    expect(list.kind).toBe('search')
    expect(list.pageParam).toBe('page')
    expect(list.pageSizeParam).toBe('size')
    expect(list.params.find((p) => p.name === 'size')).toMatchObject({ min: 1, max: 50, type: 'integer' })
    expect(list.params.some((p) => p.name === 'X-Acme-Key')).toBe(false)
    const get = model.operations.find((o) => o.id === 'getPart')!
    expect(get.kind).toBe('get')
    expect(get.params).toEqual([expect.objectContaining({ name: 'partId', in: 'path', required: true })])
    expect(model.limits.maxPageSize).toBe(50)
  })
  it('builds the entity with identifier, name-like and class-like fields', () => {
    expect(model.entities.map((e) => e.id)).toEqual(['part'])
    const e = model.entities[0]
    expect(e.fields.length).toBeGreaterThanOrEqual(25)
    expect(e.identifierFields).toEqual(['partId'])
    expect(e.fields.find((f) => f.name === 'name')?.nameLike).toBe(true)
    expect(e.fields.find((f) => f.name === 'category')?.classLike).toBe(true)
    expect(e.fields.find((f) => f.name === 'status')?.enum).toEqual(['active', 'retired'])
  })
  it('detects the nested feature collection and the structure for the derived filter', () => {
    const n = model.entities[0].nested
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ field: 'features', keyFields: ['featureCode'], valueFields: ['featureValue', 'unit'] })
    expect(detectDerivedTools(model).map((d) => d.id)).toEqual(['part.features'])
  })
  it('is reproducible', () => {
    expect(parse(good)).toEqual(parse(good))
  })
})

describe('openapi adapter: gaps', () => {
  it('reports the five distinct constructs and keeps the good operation', () => {
    const r = parse(bad)
    const { model } = ok(r)
    const c = codes(r)
    for (const code of ['external-ref-unsupported', 'ambiguous-oneof', 'missing-response-schema', 'path-param-undocumented', 'pagination-conflict']) {
      expect(c).toContain(code)
    }
    expect(model.operations.map((o) => o.id)).toEqual(['listWidgets'])
    const warn = ok(r).gaps.filter((g) => g.code !== 'no-identifier')
    expect(warn.every((g) => g.severity === 'warn' || g.severity === 'info')).toBe(true)
  })
  it('reads Swagger 2.0 (D-520); an empty one has nothing usable', () => {
    const r = parse('swagger: "2.0"\ninfo:\n  title: Old\n  version: "1"\npaths: {}\n')
    expect(r).toMatchObject({ rejected: [{ code: 'no-operations', severity: 'error' }] })
  })
  it('rejects a document with nothing usable and raises severity to error', () => {
    const r = parse('openapi: 3.0.0\ninfo: {title: Acme Empty, version: "1"}\npaths:\n  /x:\n    get:\n      responses: {"204": {description: none}}\n')
    expect('rejected' in r).toBe(true)
    if ('rejected' in r) {
      expect(r.rejected.map((g) => g.code)).toContain('missing-response-schema')
      expect(r.rejected.every((g) => g.severity === 'error')).toBe(true)
    }
  })
  it('records no-identifier and skips lookup when no identifier can be determined', () => {
    const doc = `openapi: 3.0.0
info: {title: Acme Things, version: "1"}
paths:
  /things:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: {type: array, items: {$ref: "#/components/schemas/Thing"}}
  /things/{slug}:
    get:
      parameters: [{name: slug, in: path, required: true, schema: {type: string}}]
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: {$ref: "#/components/schemas/Thing"}
components:
  schemas:
    Thing:
      type: object
      properties:
        label: {type: string}
        weight: {type: number}
`
    const r = parse(doc)
    const { model } = ok(r)
    expect(codes(r)).toContain('no-identifier')
    expect(model.operations.map((o) => o.kind)).toEqual(['list'])
  })
})

describe('openapi adapter: safety', () => {
  it('never throws and hides details on broken input', () => {
    const r = parse('openapi: 3.0.0\npaths: [unclosed')
    expect(r).toMatchObject({ rejected: [{ code: 'parse-failed' }] })
    expect(JSON.stringify(r)).not.toContain('unclosed')
    expect(() => parse('\u0000\u0001')).not.toThrow()
    expect(parse('null')).toHaveProperty('rejected')
  })
  it('refuses oversized input', () => {
    const r = parse(`openapi: 3.0.0\n# ${'x'.repeat(262144)}\n`)
    expect(r).toMatchObject({ rejected: [{ code: 'input-too-large' }] })
  })
  it('survives a YAML alias bomb', () => {
    const lines = ['openapi: 3.0.0', 'x0: &a0 [a, a, a, a]']
    for (let i = 1; i < 60; i++) lines.push(`x${i}: &a${i} [${Array(5).fill(`*a${i - 1}`).join(', ')}]`)
    const r = parse(lines.join('\n') + '\n')
    expect('rejected' in r).toBe(true)
  })
  it('does not loop on reference cycles and never follows external refs', () => {
    const doc = `openapi: 3.0.0
info: {title: Acme Loop, version: "1"}
paths:
  /loops:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: {$ref: "#/components/schemas/A"}
components:
  schemas:
    A: {$ref: "#/components/schemas/B"}
    B: {$ref: "#/components/schemas/A"}
`
    const r = parse(doc)
    expect('rejected' in r).toBe(true)
    expect(codes(r)).toContain('ref-depth-exceeded')
  })
  it('strips links from copied text', () => {
    const doc = good.replace('Fetch one part', 'Fetch one part, see https://docs.acme.example/part for more')
    const { model } = ok(parse(doc))
    expect(JSON.stringify(model)).not.toContain('docs.acme.example')
  })
  it('handles JSON input', () => {
    const json = JSON.stringify({
      openapi: '3.0.1',
      info: { title: 'Example Items', version: '1' },
      paths: {
        '/items': {
          get: {
            parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', maximum: 20 } }],
            responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } } } } } },
          },
        },
      },
      components: { securitySchemes: { b: { type: 'http', scheme: 'bearer' } } },
      security: [{ b: [] }],
    })
    const { model } = ok(parse(json))
    expect(model.auth).toMatchObject({ scheme: 'bearer', envVar: 'EXAMPLE_ITEMS_TOKEN' })
    expect(model.limits.maxPageSize).toBe(20)
    expect(model.entities[0].id).toBe('item')
    expect(model.entities[0].identifierFields).toEqual(['id'])
  })
})

// CR-01: the version marker can sit beyond the first 64 KB (key-sorted documents).
describe('openapi adapter: detect in large key-sorted documents (CR-01)', () => {
  const big = (kind: 'json' | 'yaml') => {
    const schemas: Record<string, unknown> = {}
    for (let i = 0; i < 900; i++) schemas[`S${String(i).padStart(4, '0')}`] = { type: 'object', description: 'x'.repeat(60), properties: { a: { type: 'string' }, b: { type: 'integer' } } }
    const doc = { components: { schemas }, info: { title: 'T', version: '1' }, openapi: '3.0.3', paths: { '/items': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/S0001' } } } } } } } } } }
    return kind === 'json' ? JSON.stringify(doc, null, 1) : JSON.stringify(doc) // flow-style JSON is valid YAML
  }
  it('detects the marker after 64 KB of components', () => {
    const t = big('json')
    expect(t.indexOf('"openapi"')).toBeGreaterThan(65536)
    expect(t.length).toBeLessThan(262144)
    expect(openApiAdapter.detect({ text: t })).toBe(0.95)
    expect(parseInput({ text: t }).ok).toBe(true)
  })
  it('the unrecognized-input message names the adapter override', () => {
    const r = parseInput({ text: 'nothing useful here' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.gaps[0].message).toMatch(/--adapter/)
  })
})

// CR-04: a path in servers[0].url or basePath is not copied, and the operator is told to put it in BASE_URL.
describe('openapi adapter: base path gap (CR-04)', () => {
  const doc = (servers: string) =>
    `openapi: 3.0.3\ninfo: {title: Pathy, version: '1'}\n${servers}\npaths:\n  /items:\n    get:\n      responses:\n        '200':\n          description: ok\n          content:\n            application/json:\n              schema: {type: array, items: {type: object, properties: {id: {type: integer}}}}\n`
  const gapCodes = (text: string) => {
    const r = parse(text)
    return 'rejected' in r ? [] : r.gaps.filter((g) => g.code === 'base-path-in-env')
  }
  it('reports a path in the first server url', () => {
    for (const s of ['servers:\n  - url: https://api.example.com/v2', 'servers:\n  - url: /v2/', 'servers:\n  - url: "{scheme}://h/api/{ver}"']) {
      const g = gapCodes(doc(s))
      expect(g, s).toHaveLength(1)
      expect(g[0].message).toContain('PATHY_BASE_URL')
    }
  })
  it('is silent for a root or host-only server and for no servers', () => {
    for (const s of ['servers:\n  - url: https://api.example.com', 'servers:\n  - url: https://api.example.com/', 'servers:\n  - url: /', '']) expect(gapCodes(doc(s)), s).toHaveLength(0)
  })
  it('reports a Swagger 2 basePath', () => {
    const t = 'swagger: "2.0"\ninfo: {title: Pathy, version: "1"}\nbasePath: /v2\npaths:\n  /items:\n    get:\n      responses:\n        "200":\n          description: ok\n          schema: {type: array, items: {type: object, properties: {id: {type: integer}}}}\n'
    const g = gapCodes(t)
    expect(g).toHaveLength(1)
    expect(g[0].message).not.toContain('/v2')
  })
})
