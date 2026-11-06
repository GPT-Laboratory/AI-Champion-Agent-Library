// OpenAPI 3.1 / 3.2 audit (D-530): every construct is either supported or reported with a stable gap code, never guessed.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openApiAdapter } from './openapi'
import { parseInput } from '../registry'

const fixture = readFileSync(fileURLToPath(new URL('../testing/fixtures/acme-openapi31.yaml', import.meta.url)), 'utf8')

function ok(text: string) {
  const r = parseInput({ text })
  if (!r.ok) throw new Error(JSON.stringify(r.gaps))
  return r
}
const codes = (r: { gaps: { code: string }[] }) => r.gaps.map((g) => g.code)

/** A small 3.x document whose Thing schema is `schema` (YAML, indented by the helper) and whose root gets `root`. */
function doc(schema: string, root = '', version = '3.1.0', pathItemExtra = ''): string {
  const ind = (s: string, n: number) => s.replace(/^/gm, ' '.repeat(n))
  return `openapi: ${version}\ninfo: { title: Acme Audit, version: "1" }\n${root}paths:\n  /things:\n${pathItemExtra ? `${ind(pathItemExtra.trimEnd(), 4)}\n` : ''}    get:\n      operationId: listThings\n      responses:\n        "200":\n          description: ok\n          content:\n            application/json:\n              schema:\n                type: array\n                items:\n                  $ref: "#/components/schemas/Thing"\ncomponents:\n  schemas:\n    Thing:\n${ind(schema, 6)}\n`
}
const THING = 'type: object\nproperties:\n  thing_id: { type: string }\n'
const field = (r: ReturnType<typeof ok>, name: string) => r.model.entities.find((e) => e.id === 'thing')!.fields.find((f) => f.name === name)!

describe('3.1 fixture', () => {
  const r = ok(fixture)
  it('is detected and read by the openapi adapter', () => {
    expect(openApiAdapter.detect({ text: fixture })).toBe(0.95)
    expect(r.adapterId).toBe('openapi')
  })
  it('type lists with null and nullable are supported as nullable fields', () => {
    const asset = r.model.entities.find((e) => e.id === 'asset')!
    const f = (n: string) => asset.fields.find((x) => x.name === n)!
    expect(f('location')).toMatchObject({ type: 'string', nullable: true })
    expect(f('retiredOn')).toMatchObject({ type: 'string', nullable: true })
    expect(f('weightKg')).toMatchObject({ type: 'number', nullable: true })
  })
  it('a $ref with only an annotation sibling (description) is supported without a gap', () => {
    expect(r.model.entities.find((e) => e.id === 'asset')!.fields.find((x) => x.name === 'owner')!.type).toBe('object')
    expect(codes(r)).not.toContain('ref-sibling-keywords-ignored')
  })
  it('a type list of several non-null types is reported and read as unknown', () => {
    expect(r.model.entities.find((e) => e.id === 'asset')!.fields.find((x) => x.name === 'tag')!.type).toBe('unknown')
    expect(codes(r)).toContain('multi-type-unsupported')
  })
  it('webhooks are ignored with a gap', () => {
    expect(r.gaps.find((g) => g.code === 'webhooks-ignored')).toMatchObject({ severity: 'info' })
    expect(r.model.operations.map((o) => o.id)).not.toContain('assetChangedHook')
    expect(r.model.writeOperationsDropped).not.toContain('assetChangedHook')
  })
  it('components.pathItems referenced from paths are read; the base dialect raises no gap', () => {
    expect(r.model.operations.map((o) => o.id)).toEqual(['getAsset', 'listAssets'])
    expect(codes(r)).not.toContain('json-schema-dialect-unsupported')
  })
  it('schema examples (array) that match the schema raise nothing', () => {
    expect(codes(r)).not.toContain('example-schema-mismatch')
  })
})

describe('3.1 schema constructs', () => {
  it('nullable and type [x, null] both mark nullable', () => {
    const r = ok(doc(`${THING}  a: { type: [integer, "null"] }\n  b: { type: string, nullable: true }\n`))
    expect(field(r, 'a')).toMatchObject({ type: 'integer', nullable: true })
    expect(field(r, 'b')).toMatchObject({ type: 'string', nullable: true })
  })
  it('type: [null] alone is an unknown, non-guessed type', () => {
    const r = ok(doc(`${THING}  a: { type: ["null"] }\n`))
    expect(field(r, 'a').type).toBe('unknown')
  })
  it('$ref with sibling keywords other than annotations is reported and not merged', () => {
    const r = ok(doc(`${THING}  a:\n    $ref: "#/components/schemas/Other"\n    type: [object, "null"]\n    nullable: true\n`) + '    Other:\n      type: object\n      properties:\n        x: { type: string }\n')
    expect(codes(r)).toContain('ref-sibling-keywords-ignored')
    expect(field(r, 'a').nullable).toBeUndefined()
  })
  it('schema examples array: a contradicting value is reported (value never echoed), a matching one is not', () => {
    const bad = ok(doc(`type: object\nproperties:\n  thing_id: { type: string }\nexamples:\n  - { thing_id: 1 }\n`).replace('type: array\n                items:\n                  $ref: "#/components/schemas/Thing"', '$ref: "#/components/schemas/Thing"'))
    expect(codes(bad)).toContain('example-schema-mismatch')
    const good = ok(doc(`type: object\nproperties:\n  thing_id: { type: string }\nexamples:\n  - { thing_id: a }\n`).replace('type: array\n                items:\n                  $ref: "#/components/schemas/Thing"', '$ref: "#/components/schemas/Thing"'))
    expect(codes(good)).not.toContain('example-schema-mismatch')
  })
  it('keywords that change shape but are not read are reported once, by name', () => {
    const r = ok(doc(`${THING}if: { properties: { thing_id: { const: a } } }\nthen: { required: [thing_id] }\npatternProperties: { "^x-": { type: string } }\nprefixItems: [{ type: string }]\n`))
    const g = r.gaps.filter((x) => x.code === 'schema-keyword-unsupported')
    expect(g).toHaveLength(1)
    for (const k of ['if', 'then', 'patternProperties', 'prefixItems']) expect(g[0].message).toContain(k)
  })
  it('$dynamicRef is reported, never resolved', () => {
    const r = ok(doc(`${THING}  next: { $dynamicRef: "#node" }\n`))
    expect(codes(r)).toContain('schema-keyword-unsupported')
  })
  it('$ref to an anchor is a per-operation gap, not a fetch', () => {
    const r = parseInput({ text: doc(`${THING}  next: { $ref: "#node" }\n`) })
    expect(r.ok).toBe(false)
    expect(codes(r)).toContain('ref-anchor-unsupported')
  })
  it('a $ref to $defs inside the document works', () => {
    const r = ok(doc(`type: object\nproperties:\n  thing_id: { type: string }\n  kind: { $ref: "#/components/schemas/Thing/$defs/Kind" }\n$defs:\n  Kind: { type: string, enum: [a, b] }\n`))
    expect(field(r, 'kind').enum).toEqual(['a', 'b'])
  })
})

describe('3.1 document level', () => {
  it('a custom jsonSchemaDialect is reported (warn) and never fetched', () => {
    const r = ok(doc(THING, 'jsonSchemaDialect: https://schemas.acme.example/dialect\n'))
    expect(r.gaps.find((g) => g.code === 'json-schema-dialect-unsupported')).toMatchObject({ severity: 'warn' })
    expect(JSON.stringify(r.gaps)).not.toContain('schemas.acme.example')
  })
  it('known dialects are accepted without a gap', () => {
    for (const d of ['https://spec.openapis.org/oas/3.1/dialect/base', 'https://spec.openapis.org/oas/3.2/dialect/base', 'https://json-schema.org/draft/2020-12/schema']) {
      expect(codes(ok(doc(THING, `jsonSchemaDialect: ${d}\n`)))).not.toContain('json-schema-dialect-unsupported')
    }
  })
  it('a document with only webhooks is rejected as no-paths and still mentions the webhooks', () => {
    const r = parseInput({ text: 'openapi: 3.1.0\ninfo: { title: Acme Hooks, version: "1" }\nwebhooks:\n  ping:\n    post:\n      responses: { "200": { description: ok } }\n' })
    expect(r.ok).toBe(false)
    expect(codes(r)).toEqual(expect.arrayContaining(['no-paths', 'webhooks-ignored']))
  })
  it('an empty webhooks object is not a gap', () => {
    expect(codes(ok(doc(THING, 'webhooks: {}\n')))).not.toContain('webhooks-ignored')
  })
  it('a path item $ref that does not resolve or is external is skipped with a gap', () => {
    const t = `openapi: 3.1.0\ninfo: { title: Acme Items, version: "1" }\npaths:\n  /a:\n    $ref: "#/components/pathItems/Nope"\n  /b:\n    $ref: "https://items.acme.example/b.yaml"\n  /things:\n    get:\n      operationId: listThings\n      responses:\n        "200":\n          description: ok\n          content:\n            application/json:\n              schema:\n                type: array\n                items: { type: object, properties: { thing_id: { type: string } } }\n`
    const r = ok(t)
    expect(codes(r)).toEqual(expect.arrayContaining(['ref-unresolved', 'external-ref-unsupported']))
    expect(r.model.operations.map((o) => o.id)).toEqual(['listThings'])
  })
})

describe('3.2 constructs', () => {
  it('is accepted as OpenAPI 3.x', () => {
    expect(openApiAdapter.detect({ text: doc(THING, '$self: https://acme.example/api.yaml\n', '3.2.0') })).toBe(0.95)
    const r = ok(doc(THING, '$self: https://acme.example/api.yaml\n', '3.2.0'))
    expect(r.model.operations.map((o) => o.id)).toEqual(['listThings'])
    expect(JSON.stringify(r.model)).not.toContain('acme.example')
  })
  it('the query method and additionalOperations are reported and skipped', () => {
    const r = ok(doc(THING, '', '3.2.0', 'query:\n  operationId: queryThings\n  responses: { "200": { description: ok } }\nadditionalOperations:\n  LINK:\n    operationId: linkThings\n    responses: { "200": { description: ok } }\n'))
    expect(codes(r)).toContain('query-method-unsupported')
    expect(r.model.operations.map((o) => o.id)).toEqual(['listThings'])
    expect(r.model.writeOperationsDropped).toEqual([])
  })
  it('a querystring parameter is reported and not exposed as an argument', () => {
    const t = doc(THING, '', '3.2.0').replace('      operationId: listThings\n', '      operationId: listThings\n      parameters:\n        - { name: qs, in: querystring, content: { application/x-www-form-urlencoded: { schema: { type: object } } } }\n')
    const r = ok(t)
    expect(codes(r)).toContain('querystring-param-unsupported')
    expect(r.model.operations[0].params).toEqual([])
  })
  it('oauth2 with the 3.2 device authorization flow is the same bearer access token', () => {
    const t = `openapi: 3.2.0\ninfo: { title: Acme Dev, version: "1" }\nsecurity:\n  - D: []\npaths:\n  /things:\n    get:\n      operationId: listThings\n      responses:\n        "200":\n          description: ok\n          content:\n            application/json:\n              schema: { type: array, items: { type: object, properties: { thing_id: { type: string } } } }\ncomponents:\n  securitySchemes:\n    D:\n      type: oauth2\n      oauth2MetadataUrl: https://auth.acme.example/.well-known/oauth-authorization-server\n      flows:\n        deviceAuthorization:\n          deviceAuthorizationUrl: https://auth.acme.example/device\n          tokenUrl: https://auth.acme.example/token\n          scopes: {}\n`
    const r = ok(t)
    expect(r.model.auth).toMatchObject({ scheme: 'bearer', envVar: 'ACME_DEV_ACCESS_TOKEN', oauth2: true })
    expect(JSON.stringify(r.model)).not.toContain('auth.acme.example')
  })
})

describe('audit gaps are stable and carry no document text', () => {
  it('codes are fixed words; messages never echo keyword values or urls', () => {
    const r = ok(doc(`${THING}  a: { type: [string, integer] }\n  b: { $ref: "#/components/schemas/Thing", nullable: true }\nnot: { type: string }\n`, 'jsonSchemaDialect: https://schemas.acme.example/d\nwebhooks:\n  w: { post: { responses: { "200": { description: ok } } } }\n'))
    const audit = r.gaps.filter((g) => ['multi-type-unsupported', 'ref-sibling-keywords-ignored', 'schema-keyword-unsupported', 'json-schema-dialect-unsupported', 'webhooks-ignored'].includes(g.code))
    expect(audit.map((g) => g.code).sort()).toEqual(['json-schema-dialect-unsupported', 'multi-type-unsupported', 'ref-sibling-keywords-ignored', 'schema-keyword-unsupported', 'webhooks-ignored'])
    expect(JSON.stringify(audit)).not.toContain('schemas.acme.example')
  })
  it('parsing the same document twice gives the same gaps (no state leaks between parses)', () => {
    const a = ok(fixture)
    ok(doc(THING)) // a document without findings in between
    const b = ok(fixture)
    expect(b.gaps).toEqual(a.gaps)
    expect(codes(ok(doc(THING)))).not.toContain('webhooks-ignored')
  })
})

// CR-05: the 3.1 nullable idiom and const.
describe('3.1 nullable unions and const (CR-05)', () => {
  const schema = `type: object
properties:
  thing_id: { type: string }
  nick: { anyOf: [{ type: string }, { type: "null" }] }
  owner: { oneOf: [{ $ref: "#/components/schemas/Owner" }, { type: "null" }] }
  kind: { const: a }
  mixed: { anyOf: [{ type: string }, { type: integer }] }
`
  const text = doc(schema).replace('components:\n  schemas:\n', 'components:\n  schemas:\n    Owner:\n      type: object\n      properties:\n        owner_id: { type: string }\n')
  const r = ok(text)
  it('anyOf [T, null] is T and nullable', () => {
    expect(field(r, 'nick')).toMatchObject({ type: 'string', nullable: true })
  })
  it('oneOf [$ref, null] is the referenced type and nullable', () => {
    expect(field(r, 'owner')).toMatchObject({ type: 'object', nullable: true })
  })
  it('const becomes a one-value enum', () => {
    expect(field(r, 'kind').enum).toEqual(['a'])
  })
  it('a union of several real types stays unknown and is reported', () => {
    expect(field(r, 'mixed').type).toBe('unknown')
    expect(codes(r)).toContain('schema-keyword-unsupported')
  })
})
