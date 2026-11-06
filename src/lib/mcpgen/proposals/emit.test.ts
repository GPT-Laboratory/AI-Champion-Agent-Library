// Emitter-level tests: the signature the plan promises equals the emitted def line, determinism, and the same
// code invariants the baseline has (no URL, no secret, no raw exception text, structured errors, clamps) for
// merge, split and composite tools. No Python is executed.
import { describe, expect, it } from 'vitest'
import { generate, generateFromPlan } from '../generate.js'
import { buildPlan } from '../plan.js'
import { acmeDataset, acmeHttp, acmeSql } from '../testing/sample-models.js'
import { serverInvariantProblems } from '../../mcptest/proposalEval.js'
import { buildInventory } from './inventory.js'
import { evaluateProposals, fingerprintOf } from './index.js'
import { baselineSignature, finalSignature } from './signature.js'
import { ProposalSetSchema, proposalJsonSchema, OP_TYPES } from './schema.js'
import { buildExamples } from './examples.js'
import { doc, loadFixture, run, SCENARIOS } from './testkit.js'

const server = (files: { path: string; content: string }[]) => files.find((f) => f.path === 'server.py')!.content

function defParams(src: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const m of src.matchAll(/^def (\w+)\((.*)\) -> dict:$/gm)) out.set(m[1], m[2] === '' ? [] : m[2].split(/,\s*(?![^\[]*\])/).map((p) => p.split(':')[0].trim()))
  return out
}

describe('signatures', () => {
  for (const [label, model] of [['http', acmeHttp], ['dataset', acmeDataset], ['sql', acmeSql]] as const) {
    it(`baselineSignature equals the emitted def line (${label})`, () => {
      const plan = buildPlan(model, {})
      const defs = defParams(server(generate(model).files))
      for (const t of plan.tools) expect(baselineSignature(plan, t).map((a) => a.name), t.name).toEqual(defs.get(t.name))
    })
  }
  for (const kind of ['http', 'sql'] as const) {
    it(`finalSignature equals the emitted def line for every scenario (${kind})`, () => {
      const fx = loadFixture(kind === 'http' ? 'acme-openapi.yaml' : 'acme-schema.sql')
      for (const [name, ops] of Object.entries(SCENARIOS[kind])) {
        const ev = run(fx, ops)
        const defs = defParams(server(generateFromPlan(ev.plan!).files))
        for (const t of ev.plan!.tools) expect(finalSignature(ev.plan!, t).map((a) => a.name), `${name}/${t.name}`).toEqual(defs.get(t.name))
      }
    })
  }
})

describe('baseline is untouched by the proposal layer', () => {
  it('an empty proposal set renders the baseline byte for byte, except for provenance text', () => {
    const fx = loadFixture('acme-openapi.yaml')
    const ev = run(fx, [])
    expect(ev.ok).toBe(true)
    expect(server(generateFromPlan(ev.plan!).files)).toBe(server(generateFromPlan(fx.plan).files))
  })
})

describe('determinism', () => {
  for (const kind of ['http', 'sql'] as const) {
    it(`same input and same proposal file give byte-identical packages (${kind})`, () => {
      const fx = loadFixture(kind === 'http' ? 'acme-openapi.yaml' : 'acme-schema.sql')
      const all = Object.values(SCENARIOS[kind]).filter((o) => !JSON.stringify(o).includes('merge_tools') || o === SCENARIOS[kind].merge)
      for (const ops of all.slice(0, 4)) {
        const text = doc(fx, ops)
        const a = generateFromPlan(evaluateProposals({ model: fx.model, text }).plan!)
        const b = generateFromPlan(evaluateProposals({ model: fx.model, text }).plan!)
        expect(a.files).toEqual(b.files)
      }
    })
  }
  it('the provenance hash is the hash of the file text and appears in report.json and the README', () => {
    const fx = loadFixture('acme-openapi.yaml')
    const text = doc(fx, SCENARIOS.http.hide)
    const ev = evaluateProposals({ model: fx.model, text })
    const out = generateFromPlan(ev.plan!)
    const report = JSON.parse(out.files.find((f) => f.path === 'report.json')!.content)
    expect(report.proposals.sha256).toBe(ev.fileSha256)
    expect(report.proposals.fingerprint).toBe(fx.fingerprint)
    expect(out.files.find((f) => f.path === 'README.generated.md')!.content).toContain(ev.fileSha256)
    expect(report.toolsDropped.some((d: { id: string }) => d.id === 'filter_part_by_features')).toBe(true)
  })
  it('the order of ops does not change the output', () => {
    const fx = loadFixture('acme-openapi.yaml')
    const ops = [...SCENARIOS.http['rename-describe'], ...SCENARIOS.http.hide]
    const f = (list: typeof ops) => server(generateFromPlan(evaluateProposals({ model: fx.model, text: doc(fx, list) }).plan!).files)
    expect(f(ops)).toBe(f([...ops].reverse()))
  })
})

describe('generated code invariants for proposal-assisted packages', () => {
  for (const kind of ['http', 'sql'] as const) {
    const fx = loadFixture(kind === 'http' ? 'acme-openapi.yaml' : 'acme-schema.sql')
    for (const [name, ops] of Object.entries(SCENARIOS[kind])) {
      it(`${kind} ${name}`, () => {
        const out = generateFromPlan(run(fx, ops).plan!)
        const src = server(out.files)
        expect(serverInvariantProblems(src)).toEqual([])
        for (const line of src.split('\n')) if (!line.trim().startsWith('#')) expect(line).not.toMatch(/https?:\/\//)
        expect(src).not.toMatch(/os\.environ\[/)
        for (const h of ['_clamp', '_project', '_err', '_no_results']) expect(src).toContain(`def ${h}(`)
        // Structured errors only: every _err call uses the fixed helper; wrappers never format an exception.
        expect(src).not.toContain('str(e')
        expect(src).not.toContain('Traceback')
      })
    }
  }
  it('merge, split and composite tools call the baseline functions, and keep clamps by doing so', () => {
    const fx = loadFixture('acme-openapi.yaml')
    const src = server(generateFromPlan(run(fx, [...SCENARIOS.http.split]).plan!).files)
    expect(src).toContain('def quick_part_search(')
    expect(src).toContain('_op_search_part(**_kw(page_size=5')
    expect(src).toContain('page_size = _clamp(page_size, 1, 50)') // the clamp lives in the one baseline function
  })
  it('composite output is bounded: fixed call budget, list cap, honest empty result', () => {
    const fx = loadFixture('acme-openapi.yaml')
    const src = server(generateFromPlan(run(fx, SCENARIOS.http['composite-fanout']).plan!).files)
    expect(src).toContain('_budget = [0, 6]')
    expect(src).toContain('_as_list(_sel(_ctx, ("find", "results")), 5)')
    expect(src).toContain('_no_results(')
    expect(src).toContain('raise _Stop(_err("limit"')
  })
  it('a merged dispatch tool answers a bad value with the structured error before any upstream call', () => {
    const fx = loadFixture('acme-openapi.yaml')
    const src = server(generateFromPlan(run(fx, SCENARIOS.http.merge).plan!).files)
    expect(src).toMatch(/if operation not in \("lookup", "search",\):\n\s+return _err\("invalid_argument"/)
  })
  it('hidden and consumed tools are private functions and are not registered', () => {
    const fx = loadFixture('acme-openapi.yaml')
    const src = server(generateFromPlan(run(fx, SCENARIOS.http.merge).plan!).files)
    const reg = src.slice(src.indexOf('for _tool in ('))
    expect(reg).toContain('part_finder,')
    expect(reg).not.toContain('lookup_part_by_id')
    expect(src).toContain('def _op_lookup_part_by_id(')
  })
  it('the proposal-assisted test file does not call upstream and lists exactly the exposed tools', () => {
    const fx = loadFixture('acme-schema.sql')
    const t = generateFromPlan(run(fx, SCENARIOS.sql.split).plan!).files.find((f) => f.path === 'test_server.py')!.content
    expect(t).toContain('EXPECTED_TOOLS')
    expect(t).toContain('customers_exact')
    expect(t).not.toContain('"query_customer"')
  })
})

describe('schema and examples', () => {
  it('the JSON Schema covers every op type and rejects unknown keys', () => {
    const j = JSON.stringify(proposalJsonSchema())
    for (const t of OP_TYPES) expect(j).toContain(`"${t}"`)
    expect(j).toContain('"additionalProperties":false')
    expect(j).not.toMatch(/"(code|script|python|eval|expression)"/)
  })
  it('ProposalSetSchema (strict patterns) rejects a bad name that the shape schema leaves to gate 3', () => {
    const bad = { version: 1, baseline: { fingerprint: 'a'.repeat(64) }, ops: [{ op: 'rename_tool', id: 'a', reason: 'x', tool: 't', name: 'Bad Name' }] }
    expect(ProposalSetSchema.safeParse(bad).success).toBe(false)
  })
  it('every example the builder offers passes the real gates; one per op type that applies', () => {
    for (const [name, model] of [['acme-openapi.yaml', loadFixture('acme-openapi.yaml')], ['acme-schema.sql', loadFixture('acme-schema.sql')]] as const) {
      const { examples, skipped } = buildExamples(model.model, model.options, [], model.plan, model.fingerprint)
      expect(examples.length + skipped.length, name).toBe(OP_TYPES.length)
      for (const e of examples) {
        const ev = evaluateProposals({ model: model.model, text: JSON.stringify(e.set) })
        expect(ev.ok, `${name} ${e.op}`).toBe(true)
        expect((e.set.ops as { op: string }[]).every((o) => o.op === e.op)).toBe(true)
      }
      expect(skipped.map((s) => s.op)).toEqual(['derived_filter'])
    }
  })
  it('a derived-filter example exists when a nested collection has no derived filter yet', () => {
    const model = {
      ...acmeHttp,
      entities: acmeHttp.entities.map((e) => ({ ...e, nested: [...e.nested, { field: 'extras', itemFields: [], keyFields: ['k'], valueFields: ['v'] }], fields: [...e.fields, { name: 'extras', type: 'array' as const }] })),
      // A parameter named like the nested field stops structural detection, so the proposal may add the filter.
      operations: acmeHttp.operations.map((o, i) => (i === 0 ? { ...o, params: [...o.params, { name: 'k', in: 'query' as const, type: 'string' as const, required: false }] } : o)),
    }
    const plan = buildPlan(model, {})
    const fp = fingerprintOf(plan)
    const { examples } = buildExamples(model, {}, [], plan, fp)
    const d = examples.find((e) => e.op === 'derived_filter')
    expect(d).toBeDefined()
    const ev = evaluateProposals({ model, text: JSON.stringify(d!.set) })
    expect(ev.ok).toBe(true)
    expect(ev.plan!.derived.some((x) => x.origin === 'proposed')).toBe(true)
    const src = server(generateFromPlan(ev.plan!).files)
    expect(src).toContain('def filter_product_by_extras(')
  })
  it('the inventory lists every baseline tool id', () => {
    const fx = loadFixture('acme-openapi.yaml')
    expect(buildInventory(fx.plan, fx.fingerprint).tools.map((t) => t.id)).toEqual(fx.plan.tools.map((t) => t.name))
  })
})
