// Review 23 info findings that were cheap and clearly correct: CR-06, CR-07, CR-08 (see also plan.review23.test.ts),
// CR-09, CR-13, CR-16, CR-21, CR-22, CR-23.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { openApiAdapter } from './openapi'
import { odataAdapter } from './odata'
import { precheckXml } from './odata-xml'
import { sqlDdlAdapter } from './sql-ddl'
import { parseInput } from '../registry'
import type { ParseResult } from '../types'

const gapsOf = (r: ParseResult) => ('rejected' in r ? r.rejected : r.gaps)
const src = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

const OA = (extra: string, paths: string) =>
  `openapi: 3.0.3\ninfo: {title: T, version: '1'}\n${extra}\npaths:\n${paths}`
const GET = (p: string) => `  ${p}:\n    get:\n      responses:\n        '200':\n          description: ok\n          content:\n            application/json:\n              schema: {type: array, items: {type: object, properties: {id: {type: integer}}}}\n`

describe('CR-07: JSON pointers traverse arrays', () => {
  it('a $ref into a parameters array resolves', () => {
    const t = OA('', `  /a:\n    get:\n      parameters:\n        - name: q\n          in: query\n          schema: {type: string}\n      responses:\n        '200':\n          description: ok\n          content:\n            application/json:\n              schema: {type: array, items: {type: object, properties: {id: {type: integer}}}}\n  /b:\n    get:\n      parameters:\n        - $ref: '#/paths/~1a/get/parameters/0'\n      responses:\n        '200':\n          description: ok\n          content:\n            application/json:\n              schema: {type: array, items: {type: object, properties: {id: {type: integer}}}}\n`)
    const r = openApiAdapter.parse({ text: t })
    expect(gapsOf(r).map((g) => g.code)).not.toContain('ref-unresolved')
    if ('rejected' in r) throw new Error('rejected')
    expect(r.model.operations.find((o) => o.path === '/b')?.params.map((p) => p.name)).toEqual(['q'])
  })
})

describe('CR-09: HEAD, OPTIONS and TRACE are not reported as dropped write operations', () => {
  it('lists only real write methods', () => {
    const t = OA('', `${GET('/items')}  /items2:\n    head:\n      responses: {'200': {description: ok}}\n    options:\n      responses: {'200': {description: ok}}\n    post:\n      responses: {'200': {description: ok}}\n`)
    const r = openApiAdapter.parse({ text: t })
    if ('rejected' in r) throw new Error('rejected')
    expect(r.model.writeOperationsDropped).toHaveLength(1)
  })
})

describe('CR-06: a Swagger 2.0 path item $ref is reported, not silently dropped', () => {
  it('reports the external path item $ref', () => {
    const t = 'swagger: "2.0"\ninfo: {title: S, version: "1"}\npaths:\n  /a:\n    $ref: "other.yaml#/x"\n  /b:\n    get:\n      responses:\n        "200":\n          description: ok\n          schema: {type: array, items: {type: object, properties: {id: {type: integer}}}}\n'
    const r = openApiAdapter.parse({ text: t })
    expect(gapsOf(r).map((g) => g.code)).toContain('external-ref-unsupported')
  })
})

describe('CR-13: ENUM with a trailing CHARACTER SET keeps its labels', () => {
  it('maps to an enum, not an unknown type', () => {
    const ddl = "CREATE TABLE t (id INT PRIMARY KEY, c ENUM('a','b') CHARACTER SET utf8mb4 NOT NULL);"
    const r = parseInput({ text: ddl, filename: 'x.sql' })
    if (!r.ok) throw new Error(JSON.stringify(r.gaps))
    const f = r.model.entities[0].fields.find((x) => x.name === 'c')!
    expect(f.enum).toEqual(['a', 'b'])
    expect(r.model.gaps.map((g) => g.code)).not.toContain('unknown-type')
  })
  it('keeps working for the plain forms', () => {
    const r = parseInput({ text: "CREATE TABLE t (id INT PRIMARY KEY, c ENUM('a','b'));", filename: 'x.sql' })
    if (!r.ok) throw new Error('x')
    expect(r.model.entities[0].fields.find((x) => x.name === 'c')!.enum).toEqual(['a', 'b'])
  })
  void sqlDdlAdapter
})

describe('CR-16: limit-default agrees with the page size actually applied', () => {
  it('a non-integer maxPageSize reports the default', () => {
    const ddl = 'CREATE TABLE t (id INT PRIMARY KEY, n TEXT);'
    const r = parseInput({ text: ddl, filename: 'x.sql' }, { options: { limits: { maxPageSize: 2.5 } } })
    if (!r.ok) throw new Error('x')
    expect(r.model.gaps.map((g) => g.code)).toContain('limit-default')
  })
})

describe('CR-21: no invisible byte order mark in the source', () => {
  it('odata.ts and odata-xml.ts spell the BOM as an escape', () => {
    for (const f of ['./odata.ts', './odata-xml.ts']) expect(src(f).includes('\uFEFF'), f).toBe(false)
  })
  it('a BOM before the XML declaration is still accepted', () => {
    expect(precheckXml('\uFEFF<?xml version="1.0"?><a/>')).toBeUndefined()
  })
})

describe('CR-22: the XML pre-check message says markers inside CDATA or comments count too', () => {
  it('names the false-positive case', () => {
    const g = precheckXml('<a><![CDATA[<?php echo 1; ?>]]></a>')
    expect(g?.code).toBe('xml-pi-rejected')
    expect(g?.message).toMatch(/CDATA/)
  })
})

describe('CR-23: a cut base type chain is reported', () => {
  const json = (container: object, types: object) => JSON.stringify({ $Version: '4.0', $EntityContainer: 'A.C', A: { C: { $Kind: 'EntityContainer', ...container }, ...types } })
  it('a cycle reports odata-type-unresolved', () => {
    const t = json({ Ts: { $Collection: true, $Type: 'A.X' } }, { X: { $Kind: 'EntityType', $BaseType: 'A.Y', $Key: ['Id'], Id: {} }, Y: { $Kind: 'EntityType', $BaseType: 'A.X', Name: {} } })
    const r = odataAdapter.parse({ text: t })
    expect(gapsOf(r).map((g) => g.code)).toContain('odata-type-unresolved')
  })
  it('a chain longer than the limit reports it', () => {
    const types: Record<string, unknown> = {}
    for (let i = 0; i < 40; i++) types[`T${i}`] = { $Kind: 'EntityType', ...(i > 0 ? { $BaseType: `A.T${i - 1}` } : { $Key: ['Id'], Id: {} }), [`P${i}`]: {} }
    const r = odataAdapter.parse({ text: json({ Ts: { $Collection: true, $Type: 'A.T39' } }, types) })
    expect(gapsOf(r).map((g) => g.code)).toContain('odata-type-unresolved')
  })
  it('an ordinary chain does not', () => {
    const t = json({ Ts: { $Collection: true, $Type: 'A.Y' } }, { X: { $Kind: 'EntityType', $Key: ['Id'], Id: {} }, Y: { $Kind: 'EntityType', $BaseType: 'A.X', Name: {} } })
    expect(gapsOf(odataAdapter.parse({ text: t })).map((g) => g.code)).not.toContain('odata-type-unresolved')
  })
})
