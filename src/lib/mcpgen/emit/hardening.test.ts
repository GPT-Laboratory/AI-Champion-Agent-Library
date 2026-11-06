// Review fixes for the generated code: WR-01 (dot segments), WR-02 (shadowed builtins), WR-04
// (numbers and identifiers at the emitter boundary), WR-05 (delimiter), WR-07 (equals case folding),
// WR-10 (offset paging), IN-01 (rowid order), IN-05 (dead code). The generated Python is only ever
// compiled (guarded py_compile), never executed.
import { describe, expect, it, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate } from '../generate'
import { buildPlan } from '../plan'
import { emitPython } from './python'
import { pyIdent, pyNum, sqlIdent } from './pyutil'
import { parseInput } from '../registry'
import { acmeDataset, acmeHttp, acmeSql } from '../testing/sample-models'
import type { Operation, Param, SourceModel } from '../types'

const file = (m: SourceModel, name: string, opts = {}) => generate(m, opts).files.find((f) => f.path === name)!.content
const server = (m: SourceModel, opts = {}) => file(m, 'server.py', opts)
const tests = (m: SourceModel, opts = {}) => file(m, 'test_server.py', opts)

const probe = spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' })
const hasPython = probe.status === 0
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
function compiles(m: SourceModel, label: string) {
  if (!hasPython) return
  const dir = mkdtempSync(join(tmpdir(), 'mcpgen-hard-'))
  dirs.push(dir)
  for (const name of ['server.py', 'test_server.py']) {
    const f = join(dir, name)
    writeFileSync(f, file(m, name))
    const r = spawnSync('python3', ['-I', '-m', 'py_compile', f], { encoding: 'utf8' })
    expect(r.status, `${label}/${name}: ${r.stderr}`).toBe(0)
  }
}

function withOp(m: SourceModel, id: string, patch: Partial<Operation>): SourceModel {
  return { ...m, operations: m.operations.map((o) => (o.id === id ? { ...o, ...patch } : o)) }
}

describe('WR-01: dot segments', () => {
  it('the generated _seg rejects "." and ".." and a generated test pins it', () => {
    const s = server(acmeHttp)
    expect(s).toMatch(/text in \("\.", "\.\."\)/)
    const t = tests(acmeHttp)
    expect(t).toContain('def test_dot_segment_identifiers_are_rejected_before_any_call')
    expect(t).toMatch(/DOT_CASES = \[/)
    expect(t).toContain('"product_id"')
    compiles(acmeHttp, 'acme-http')
  })
  it('no dot-segment test is emitted when no tool has a string path parameter', () => {
    const noGet: SourceModel = { ...acmeHttp, operations: acmeHttp.operations.filter((o) => o.id !== 'getProduct') }
    expect(tests(noGet)).not.toContain('DOT_CASES')
  })
})

describe('WR-02: names the tool bodies use at call time cannot be parameters', () => {
  const withParam = (name: string, required: boolean): SourceModel => ({
    ...acmeHttp,
    operations: acmeHttp.operations.map((o) =>
      o.id === 'listProducts' ? { ...o, params: [...o.params, { name, in: 'query' as const, type: 'string' as const, required }] } : o,
    ),
  })
  it.each(['Exception', 'BaseException', 'str', 'len', 'dict', 'min', 'max', 'range', 'mcp', 'os', 'json'])('a query parameter named %s is dropped with a gap', (name) => {
    const plan = buildPlan(withParam(name, false))
    expect(plan.gaps.some((g) => g.code === 'param-dropped' && g.path === `listProducts.${name}`)).toBe(true)
    const s = emitPython(plan)
    expect(s).not.toMatch(new RegExp(`def list_products\\([^)]*\\b${name}:`))
  })
  it('a required parameter named Exception omits the tool instead of shadowing the builtin', () => {
    const plan = buildPlan(withParam('Exception', true))
    expect(plan.tools.some((t) => t.name.startsWith('list_product'))).toBe(false)
    expect(plan.gaps.some((g) => g.code === 'tool-omitted' && /Exception/.test(g.message))).toBe(true)
  })
  it('ordinary names that are Python builtins but unused by the templates stay allowed', () => {
    const plan = buildPlan(withParam('id', false))
    expect(plan.tools.find((t) => t.name === 'list_products')!.params.map((p) => p.name)).toContain('id')
  })
})

describe('WR-04: nothing but numbers and identifiers reaches generated code', () => {
  const evil = '0:\n HOSTILE_MARKER' as unknown as number
  it('pyNum, pyIdent and sqlIdent accept only the safe shapes', () => {
    expect(pyNum(5)).toBe('5')
    expect(pyNum(-1.5)).toBe('-1.5')
    expect(() => pyNum(evil)).toThrow()
    expect(() => pyNum(NaN)).toThrow()
    expect(() => pyNum(Infinity)).toThrow()
    expect(() => pyNum(undefined)).toThrow()
    expect(pyIdent('ok_name1')).toBe('ok_name1')
    expect(() => pyIdent('a b')).toThrow()
    expect(() => pyIdent('1a')).toThrow()
    expect(() => pyIdent('a"; DROP')).toThrow()
    expect(sqlIdent('order')).toBe('"order"')
    expect(() => sqlIdent('a"b')).toThrow()
  })
  it('a hostile resultCeiling is dropped with a gap and never emitted', () => {
    for (const bad of [evil, 0, -5, 1.5, NaN, Infinity, 2_000_000_000]) {
      const out = generate(acmeHttp, { limits: { resultCeiling: bad } })
      expect(out.report.gaps.some((g) => g.code === 'limit-invalid' && g.path === 'resultCeiling')).toBe(true)
      for (const f of out.files) expect(f.content).not.toContain('HOSTILE_MARKER')
      expect(out.files.find((f) => f.path === 'server.py')!.content).not.toContain('Result ceiling reached')
    }
  })
  it('a hostile maxResponseItems and maxPageSize fall back to the defaults', () => {
    const out = generate(acmeHttp, { limits: { maxResponseItems: evil, maxPageSize: evil } })
    const s = out.files.find((f) => f.path === 'server.py')!.content
    expect(s).toContain('MAX_RESPONSE_ITEMS = 200')
    expect(s).not.toContain('HOSTILE_MARKER')
    expect(out.report.gaps.filter((g) => g.code === 'limit-invalid').map((g) => g.path).sort()).toEqual(['maxPageSize', 'maxResponseItems'])
  })
  it('a parameter minimum or maximum that is not a number is ignored with a gap', () => {
    const bad: Param = { name: 'rating', in: 'query', type: 'integer', required: false, min: evil, max: 'x' as unknown as number }
    const m = withOp(acmeHttp, 'listProducts', { params: [...acmeHttp.operations[0].params, bad] })
    const out = generate(m)
    expect(out.report.gaps.some((g) => g.code === 'param-limit-invalid')).toBe(true)
    const s = out.files.find((f) => f.path === 'server.py')!.content
    expect(s).not.toContain('HOSTILE_MARKER')
    expect(s).not.toContain('rating = _clamp')
    compiles(m, 'bad-limits')
  })
  it('the emitter itself refuses a plan that carries a non-number ceiling', () => {
    const plan = buildPlan(acmeHttp)
    plan.model.limits.resultCeiling = evil
    expect(() => emitPython(plan)).toThrow()
  })
  it('the emitter refuses an unsafe SQL identifier', () => {
    const plan = buildPlan(structuredClone(acmeSql))
    plan.model.entities[0].fields[0].name = 'x"; DROP TABLE t; --'
    expect(() => emitPython(plan)).toThrow()
  })
  it('entity and column names that exist on Object.prototype stay plain keys', () => {
    const m: SourceModel = {
      ...acmeSql,
      entities: [{ id: '__proto__', label: 'T', fields: [{ name: 'constructor', type: 'string', identifier: true }, { name: 'toString', type: 'string' }], identifierFields: ['constructor'], nested: [] }],
    }
    const s = server(m)
    expect(s).toContain('"__proto__": [')
    expect(s).toMatch(/"constructor": "\\"constructor\\""/)
    compiles(m, 'proto-names')
  })
  it('a projection override for an entity named constructor does not read Object.prototype', () => {
    const m: SourceModel = { ...acmeDataset, entities: acmeDataset.entities.map((e) => ({ ...e, id: 'constructor' })) }
    expect(() => generate(m, { projectionOverride: { other: ['x'] } })).not.toThrow()
    expect(generate(m).files.length).toBeGreaterThan(0)
  })
})

describe('WR-05: the dataset delimiter reaches the generated server', () => {
  const dataset = (delimiter?: string): SourceModel => ({ ...acmeDataset, backend: { ...acmeDataset.backend, ...(delimiter === undefined ? {} : { delimiter }) } })
  it('comma by default, semicolon and tab on request', () => {
    expect(server(dataset())).toContain('DATA_DELIMITER = ","')
    expect(server(dataset(';'))).toContain('DATA_DELIMITER = ";"')
    expect(server(dataset('\t'))).toContain('DATA_DELIMITER = "\\t"')
    expect(server(dataset(';'))).toContain('csv.DictReader(handle, delimiter=DATA_DELIMITER)')
    compiles(dataset('\t'), 'tab')
  })
  it('the generated test file writes its data with the server delimiter', () => {
    expect(tests(dataset(';'))).toContain('csv.writer(handle, delimiter=server.DATA_DELIMITER)')
  })
  it('an unsupported delimiter is reported and a comma is used', () => {
    const out = generate(dataset('|'))
    expect(out.report.gaps.some((g) => g.code === 'delimiter-invalid')).toBe(true)
    expect(out.files.find((f) => f.path === 'server.py')!.content).toContain('DATA_DELIMITER = ","')
  })
  it('the tabular adapter records the detected delimiter and reports it', () => {
    const semi = parseInput({ text: 'item_id;item_name;price\n' }, { adapterId: 'tabular-catalog' })
    expect(semi.ok).toBe(true)
    if (semi.ok) {
      expect(semi.model.backend.delimiter).toBe(';')
      expect(semi.gaps.some((g) => g.code === 'delimiter-detected' && g.severity === 'info')).toBe(true)
      expect(server(semi.model)).toContain('DATA_DELIMITER = ";"')
    }
    const tab = parseInput({ text: 'item_id\titem_name\tprice\n' }, { adapterId: 'tabular-catalog' })
    expect(tab.ok && tab.model.backend.delimiter).toBe('\t')
    const comma = parseInput({ text: 'item_id,item_name,price\n' }, { adapterId: 'tabular-catalog' })
    expect(comma.ok).toBe(true)
    if (comma.ok) {
      expect(comma.model.backend.delimiter).toBeUndefined()
      expect(comma.gaps.some((g) => g.code === 'delimiter-detected')).toBe(false)
    }
  })
  it('the report names the delimiter', () => {
    expect(generate(dataset(';')).report.assumptions.join(' ')).toMatch(/delimiter is a semicolon/)
    expect(generate(dataset()).report.assumptions.join(' ')).toMatch(/delimiter is a comma/)
  })
})

describe('WR-07: equals is case-insensitive on every backend and the docs say how far', () => {
  it('the SQL equals branch uses NOCASE and the SQL docs name the ASCII limit', () => {
    const s = server(acmeSql)
    expect(s).toContain('" = ? COLLATE NOCASE"')
    expect(s).toContain('case-insensitive for ASCII letters only')
  })
  it('the dataset docs keep the plain wording', () => {
    const s = server(acmeDataset)
    expect(s).toContain('equals, contains or startsWith (case-insensitive).')
    expect(s).not.toContain('ASCII letters only')
  })
  it('both local backends ship a mixed-case test', () => {
    for (const m of [acmeDataset, acmeSql]) expect(tests(m)).toContain('def test_equals_ignores_case')
    compiles(acmeSql, 'sql')
  })
})

describe('WR-10: offset paging', () => {
  const offsetOp = (extra: Partial<Operation> = {}): Partial<Operation> => ({
    params: [
      { name: 'offset', in: 'query', type: 'integer', required: false, min: 0 },
      { name: 'limit', in: 'query', type: 'integer', required: false, min: 1, max: 50 },
      { name: 'category', in: 'query', type: 'string', required: false },
    ],
    pageParam: undefined,
    pageSizeParam: 'limit',
    offsetParam: 'offset',
    ...extra,
  })
  const model = (extra: Partial<Operation> = {}) => withOp(acmeHttp, 'listProducts', offsetOp(extra))

  it('the offset becomes a real argument that is clamped and passed through', () => {
    const plan = buildPlan(model())
    const list = plan.tools.find((t) => t.name === 'list_products')!
    expect(list.params.map((p) => p.name)).toContain('offset')
    const s = emitPython(plan)
    expect(s).toMatch(/def list_products\([^)]*offset: Optional\[int\] = None/)
    expect(s).toContain('offset = _clamp(offset, 0, 2147483647)')
    expect(s).toContain('query["offset"] = _qv(offset)')
    expect(plan.gaps.some((g) => g.code === 'offset-pagination' && g.severity === 'info' && g.path === 'listProducts')).toBe(true)
    expect(plan.gaps.some((g) => g.code === 'param-dropped' && /offset/.test(g.message))).toBe(false)
  })
  it('a generated test pins the pass-through and the report names the assumption', () => {
    expect(tests(model())).toContain('def test_offset_is_passed_through_to_the_upstream')
    expect(generate(model()).report.assumptions.join(' ')).toMatch(/Offset paging: offsets start at 0/)
    compiles(model(), 'offset')
  })
  it('the derived filter tool walks offsets of one page size and reports truncation', () => {
    const s = server(model())
    expect(s).toMatch(/query\["offset"\] = \(page - 1\) \* 50/)
    expect(s).toMatch(/for page in range\(1, max_pages \+ 1\):/)
    expect(s).toContain('truncated = True')
  })
  it('an offset without a page size cannot be walked: the filter tool is omitted with a gap', () => {
    const plan = buildPlan(model({ pageSizeParam: undefined, params: [{ name: 'offset', in: 'query', type: 'integer', required: false }] }))
    expect(plan.tools.some((t) => t.derived?.kind === 'inMemoryFilter')).toBe(false)
    expect(plan.gaps.some((g) => g.code === 'tool-omitted' && /offset/.test(g.message))).toBe(true)
  })
  it('the OpenAPI adapter records offset and limit parameters', () => {
    const doc = {
      openapi: '3.0.3',
      info: { title: 'Acme Parts' },
      paths: {
        '/parts': {
          get: {
            operationId: 'listParts',
            parameters: [
              { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
              { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 25 } },
            ],
            responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Part' } } } } } },
          },
        },
      },
      components: { schemas: { Part: { type: 'object', properties: { part_id: { type: 'string' }, name: { type: 'string' } } } } },
    }
    const r = parseInput({ text: JSON.stringify(doc) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.model.operations[0]).toMatchObject({ offsetParam: 'offset', pageSizeParam: 'limit' })
      expect(r.model.operations[0].pageParam).toBeUndefined()
      const s = server(r.model)
      expect(s).toContain('def list_parts(')
      expect(s).toContain('query["offset"] = _qv(offset)')
    }
  })
  it('a bare start parameter without a page size is not treated as paging', () => {
    const doc = {
      openapi: '3.0.3',
      info: { title: 'Acme Parts' },
      paths: {
        '/parts': {
          get: {
            operationId: 'listParts',
            parameters: [{ name: 'start', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Part' } } } } } },
          },
        },
      },
      components: { schemas: { Part: { type: 'object', properties: { part_id: { type: 'string' } } } } },
    }
    const r = parseInput({ text: JSON.stringify(doc) })
    expect(r.ok && r.model.operations[0].offsetParam).toBeUndefined()
  })
})

describe('IN-01: tables without a primary key page in rowid order', () => {
  it('uses rowid when no identifier column exists and keeps the key order otherwise', () => {
    const noKey: SourceModel = {
      ...acmeSql,
      entities: acmeSql.entities.map((e) => (e.id === 'order' ? { ...e, identifierFields: [], fields: e.fields.map((f) => ({ ...f, identifier: false })) } : e)),
    }
    const s = server(noKey)
    expect(s).toMatch(/"order": "rowid"/)
    expect(s).toMatch(/"order": "\\"customer_id\\""/)
    compiles(noKey, 'no-key')
  })
})

describe('IN-05: dead parameters are gone', () => {
  it('python.ts no longer silences unused values with void', () => {
    const src = readFileSync(fileURLToPath(new URL('./python.ts', import.meta.url)), 'utf8')
    expect(src).not.toMatch(/\bvoid\s+(op|kind|serverSlug)\b/)
    expect(src).not.toMatch(/\bserverSlug\b/)
  })
})
