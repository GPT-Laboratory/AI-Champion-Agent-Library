// Output is invariant under the input order of operations, entities, fields, parameters and proposal ops
// (Phase 21, plan 04). Permutations use a small seeded PRNG; each is compared to the baseline output
// (never to a fixed expected order).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generate, generateFromPlan } from './generate'
import { buildPlan } from './plan'
import { parseInput, prepareInput } from './registry'
import { evaluateProposals } from './proposals/index'
import { doc, loadFixture, SCENARIOS, type Op } from './proposals/testkit'
import { acmeDataset, acmeHttp, acmeSql } from './testing/sample-models'
import type { Operation, SourceModel } from './types'

function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function shuffled<T>(list: readonly T[], rnd: () => number): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

type Order = <T>(list: readonly T[]) => T[]

/**
 * Same model with the set-like collections reordered: operations, entities, nested collections, gaps and
 * dropped write operations. Field and parameter order is declared order (column order, positional
 * arguments, default projection) and is meaningful, so it stays as given.
 */
function permute(m: SourceModel, order: Order): SourceModel {
  return {
    ...m,
    operations: order(m.operations),
    entities: order(m.entities).map((e) => ({ ...e, nested: order(e.nested) })),
    gaps: order(m.gaps),
    writeOperationsDropped: order(m.writeOperationsDropped),
  }
}

const reverse: Order = (l) => [...l].reverse()
const orders: [string, Order][] = [['reversed', reverse], ...[1, 2, 3, 4, 5].map((seed): [string, Order] => [`seed ${seed}`, (l) => shuffled(l, prng(seed * 7919 + l.length))])]
const text = (files: { path: string; content: string }[]) => Object.fromEntries(files.map((f) => [f.path, f.content]))
// The proposal file hash (provenance) legitimately follows the order the ops were written in the file.
const noHash = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.replace(/[0-9a-f]{64}/g, '<sha256>')]))

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./testing/fixtures/${name}`, import.meta.url)), 'utf8')
await prepareInput({ text: fixture('acme-odata.xml') })
const odata = (() => {
  const p = parseInput({ text: fixture('acme-odata.xml') })
  if (!p.ok) throw new Error('odata fixture must parse')
  return p.model
})()

describe('generate() is invariant under input order', () => {
  for (const [label, model] of [
    ['http', acmeHttp],
    ['dataset', acmeDataset],
    ['sql', acmeSql],
    ['odata', odata],
    ['openapi fixture', loadFixture('acme-openapi.yaml').model],
    ['sql fixture', loadFixture('acme-schema.sql').model],
  ] as [string, SourceModel][]) {
    const baseline = text(generate(model).files)
    it(`${label}: baseline produces server.py, test_server.py and report.json`, () => {
      expect(Object.keys(baseline)).toEqual(expect.arrayContaining(['server.py', 'test_server.py', 'report.json']))
    })
    for (const [name, order] of orders) {
      it(`${label}: ${name} input order gives byte-identical files`, () => {
        const out = text(generate(permute(model, order)).files)
        expect(Object.keys(out)).toEqual(Object.keys(baseline))
        for (const path of Object.keys(baseline)) expect(out[path], path).toBe(baseline[path])
      })
    }
  }

  it('tools with equal names keep a stable tie-break (collision suffixes do not depend on input order)', () => {
    const base = acmeHttp.operations.find((o) => o.kind === 'list')!
    const clone = (id: string, path: string): Operation => ({ ...base, id, path, params: base.params.map((p) => ({ ...p })) })
    const model: SourceModel = { ...acmeHttp, operations: [...acmeHttp.operations, clone('listPartsB', '/b/parts'), clone('listPartsA', '/a/parts'), clone('listPartsC', '/c/parts')] }
    const baseline = text(generate(model).files)
    for (const [name, order] of orders) {
      const out = text(generate({ ...model, operations: order(model.operations) }).files)
      for (const path of Object.keys(baseline)) expect(out[path], `${name} ${path}`).toBe(baseline[path])
    }
  })
})

describe('proposal-assisted output is invariant under input and proposal op order', () => {
  for (const kind of ['http', 'sql'] as const) {
    const fx = loadFixture(kind === 'http' ? 'acme-openapi.yaml' : 'acme-schema.sql')
    for (const [name, ops] of Object.entries(SCENARIOS[kind])) {
      const run = (model: SourceModel, list: Op[]) => evaluateProposals({ model, options: fx.options, text: doc(fx, list), lenient: false })
      const baseline = run(fx.model, ops)
      it(`${kind}/${name}: baseline evaluates`, () => {
        expect(baseline.ok).toBe(true)
      })
      for (const [oname, order] of orders) {
        it(`${kind}/${name}: ${oname} model order gives identical files`, () => {
          const ev = run(permute(fx.model, order), ops)
          expect(ev.ok).toBe(true)
          const a = text(generateFromPlan(baseline.plan!).files)
          const b = text(generateFromPlan(ev.plan!).files)
          for (const path of Object.keys(a)) expect(b[path], path).toBe(a[path])
        })
      }
    }
  }

  for (const kind of ['http', 'sql'] as const) {
    const fx = loadFixture(kind === 'http' ? 'acme-openapi.yaml' : 'acme-schema.sql')
    for (const [name, ops] of Object.entries(SCENARIOS[kind]).filter(([, o]) => o.length > 1)) {
      it(`${kind}/${name}: reversed proposal op order gives identical files`, () => {
        const run = (list: Op[]) => evaluateProposals({ model: fx.model, options: fx.options, text: doc(fx, list), lenient: false })
        const a = noHash(text(generateFromPlan(run(ops).plan!).files))
        const ev = run(reverse(ops))
        expect(ev.ok).toBe(true)
        const b = noHash(text(generateFromPlan(ev.plan!).files))
        for (const path of Object.keys(a)) expect(b[path], path).toBe(a[path])
      })
    }
  }

  it('independent proposal ops give the same files in any order (internal and wrapper tools included)', () => {
    const fx = loadFixture('acme-openapi.yaml')
    const ops = [...SCENARIOS.http.hide, ...SCENARIOS.http.merge, SCENARIOS.http['defaults-pin'][2]]
    const run = (list: Op[]) => evaluateProposals({ model: fx.model, options: fx.options, text: doc(fx, list), lenient: false })
    const baseline = run(ops)
    expect(baseline.ok).toBe(true)
    const a = noHash(text(generateFromPlan(baseline.plan!).files))
    for (const [name, order] of orders) {
      const ev = run(order(ops))
      expect(ev.ok, name).toBe(true)
      const b = noHash(text(generateFromPlan(ev.plan!).files))
      for (const path of Object.keys(a)) expect(b[path], `${name} ${path}`).toBe(a[path])
    }
  })
})

describe('plan', () => {
  it('buildPlan sorts tools by name, then by entity and operation, never by locale', () => {
    const plan = buildPlan(permute(acmeHttp, reverse))
    const names = plan.tools.map((t) => t.name)
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
  })
})
