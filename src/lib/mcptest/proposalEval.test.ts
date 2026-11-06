// Stage 2 evaluation: comparison logic against fake subjects (scorer fixtures), the generator-subject
// integration over the Acme fixtures, and the exit-code rule. Generated Python is never executed.
import { describe, expect, it } from 'vitest'
import { fakeSubject } from './core/subjects'
import { loadSuite } from './core/suite'
import { compareReports, evaluateProposalEffect, packageChecks, renderComparison, runPair, serverInvariantProblems } from './proposalEval'
import { runPipeline } from '../mcpgen/pipeline'
import { doc, fixtureText, loadFixture, op, SCENARIOS } from '../mcpgen/proposals/testkit'
import { main, type EvalIo } from '../../../scripts/mcp-propose-eval'

const http = loadFixture('acme-openapi.yaml')
const sql = loadFixture('acme-schema.sql')
const fixed = () => new Date('2026-10-14T00:00:00Z')

async function subset(ids: string[]) {
  const suite = await loadSuite()
  if (!suite.ok) throw new Error('suite')
  return suite.cases.filter((c) => ids.includes(c.def.id))
}

describe('runPair with fake subjects', () => {
  it('good against good: no regression, no deltas', async () => {
    const c = await runPair(fakeSubject('good'), fakeSubject('good'), { now: fixed, cases: await subset(['T1-STD-CATALOG', 'T2-CATALOG-API', 'T2-CATALOG-HTTP']) })
    expect(c.regressions).toEqual([])
    expect(c.deltas).toEqual([])
    expect(c.baseline.report.summary.gate).toBe('pass')
  })
  it('good against a variant whose server dies: the Tier 1 gate and the score regress and the table shows deltas', async () => {
    const c = await runPair(fakeSubject('good'), fakeSubject('crash-on-init'), { now: fixed, cases: await subset(['T1-STD-CATALOG', 'T2-CATALOG-API']) })
    expect(c.regressions.join(' ')).toContain('Tier 1 gate')
    expect(c.deltas.length).toBeGreaterThan(0)
    const t = renderComparison(c, 'text')
    expect(t).toContain('Result: REGRESSION')
    expect(t).toContain('PENDING_HUMAN')
    expect(renderComparison(c, 'markdown')).toContain('| --- |')
  })
  it('a variant that only lowers the score is a regression unless inside the allowed drop', async () => {
    const cases = await subset(['T1-STD-CATALOG', 'T3-LARGE-RESP'])
    const worse = await runPair(fakeSubject('good'), fakeSubject('huge-payload'), { now: fixed, cases })
    const base = worse.baseline.report.summary.score.value
    const prop = worse.proposed.report.summary.score.value
    expect(base).not.toBeNull()
    expect(prop !== null && base !== null && prop < base).toBe(true)
    expect(worse.regressions.some((r) => r.startsWith('headline score'))).toBe(true)
    const allowed = compareReports(worse.baseline.report, worse.proposed.report, 100)
    expect(allowed.regressions.filter((r) => r.startsWith('headline score'))).toEqual([])
  })
  it('reruns are handled by the runner (majority, ties fail): 3 reruns of good stay identical', async () => {
    const c = await runPair(fakeSubject('good'), fakeSubject('good'), { now: fixed, reruns: 3, cases: await subset(['T1-STD-CATALOG', 'T2-CATALOG-HTTP']) })
    expect(c.regressions).toEqual([])
  })
})

describe('generator subject over the Acme fixtures', () => {
  const run = (fx: typeof http, text: string, name: string, lenient = false) =>
    evaluateProposalEffect({ input: fixtureText(name), filename: name, proposalsText: text, lenient }, { now: fixed })

  for (const [fx, name, kind] of [[http, 'acme-openapi.yaml', 'http'], [sql, 'acme-schema.sql', 'sql']] as const) {
    for (const [scenario, ops] of Object.entries(SCENARIOS[kind])) {
      it(`${kind} ${scenario}: no regression, real-server cells stay pending`, async () => {
        const r = await run(fx, doc(fx, ops), name)
        expect(r.kind).toBe('compared')
        if (r.kind !== 'compared') return
        expect(r.comparison.regressions, scenario).toEqual([])
        expect(r.comparison.proposed.genGate).toBe(true)
        expect(r.comparison.proposed.report.cases.some((c) => c.state === 'PENDING_HUMAN')).toBe(true)
        expect(r.comparison.proposed.report.cases.every((c) => c.state !== 'PASS' || c.checks.length > 0)).toBe(true)
      })
    }
  }
  it('a rejected proposal scores nothing', async () => {
    const r = await run(http, doc(http, [op('rename_tool', 'x', { tool: 'ghost', name: 'find_ghost' })]), 'acme-openapi.yaml')
    expect(r.kind).toBe('rejected')
  })
  it('an unusable baseline is reported as such', async () => {
    const r = await evaluateProposalEffect({ input: 'just prose', filename: 'x.txt', proposalsText: '{}' })
    expect(r.kind).toBe('baseline-failed')
  })
  it('a renamed argument keeps the emitted test binding resolvable (binding_resolves is scored in Tier 1)', async () => {
    // Renaming the page size argument of the only searchable tool away from the names the binding can map to.
    const ops = [op('rename_arg', 'r', { tool: 'search_part', arg: 'page_size', name: 'rows_wanted' })]
    const r = await run(http, doc(http, ops), 'acme-openapi.yaml')
    expect(r.kind).toBe('compared')
    if (r.kind !== 'compared') return
    // The binding is derived from the plan; with the new name it either still resolves (argMap) or the check fails.
    const check = r.comparison.proposed.report.cases.flatMap((c) => c.checks).find((k) => k.id === 'binding_resolves')
    expect(check?.status).toBe('PASS')
  })
})

describe('package checks', () => {
  it('binding_resolves fails for a binding that names a tool the package does not emit', () => {
    const r = runPipeline(fixtureText('acme-openapi.yaml'), { filename: 'acme-openapi.yaml' })
    if (!r.ok) throw new Error('baseline')
    const files = r.files.map((f) => (f.path === 'mcptest-binding.json' ? { ...f, content: JSON.stringify({ lookup_by_id: { tool: 'ghost_tool' } }) } : f))
    const checks = packageChecks(files, r.report.toolsEmitted)
    expect(checks.find((c) => c.id === 'binding_resolves')!.status).toBe('FAIL')
    const bad = r.files.map((f) => (f.path === 'mcptest-binding.json' ? { ...f, content: JSON.stringify({ lookup_by_id: { tool: 'lookup_part_by_id', argMap: { id: 'no_such_arg' } } }) } : f))
    expect(packageChecks(bad, r.report.toolsEmitted).find((c) => c.id === 'binding_resolves')!.status).toBe('FAIL')
    expect(packageChecks(r.files, r.report.toolsEmitted).every((c) => c.status === 'PASS')).toBe(true)
  })
  it('invariants_hold flags URLs, dynamic code and unexpected imports in a server text', () => {
    const evil = ['eval', '(x)'].join('')
    expect(serverInvariantProblems(`import os\nx = "http://a.example/"\n${evil}\nimport subprocess\n`).length).toBeGreaterThanOrEqual(3)
    expect(serverInvariantProblems('import os\n# http://in-a-comment.example\n')).toEqual([])
  })
})

describe('mcp-propose-eval CLI', () => {
  const files: Record<string, string> = {}
  const logs: string[] = []
  const errs: string[] = []
  const io: EvalIo = {
    readFile: async (p) => {
      if (!(p in files)) throw new Error('ENOENT')
      return files[p]
    },
    fileSize: async (p) => Buffer.byteLength(files[p] ?? '', 'utf8'),
    writeFile: async (p, c) => {
      files[p] = c
    },
    mkdir: async () => {},
    log: (s) => logs.push(s),
    error: (s) => errs.push(s),
  }
  files['in.yaml'] = fixtureText('acme-openapi.yaml')
  files['p.json'] = doc(http, SCENARIOS.http.hide)
  it('exits 0 with the table when nothing regresses and writes both packages on request', async () => {
    logs.length = 0
    expect(await main(['in.yaml', '--proposals', 'p.json', '--write-packages', '/virtual/out'], io)).toBe(0)
    const t = logs.join('\n')
    expect(t).toContain('Tier 1 generator-side gate')
    expect(t).toContain('Result: no regression.')
    expect(Object.keys(files).some((k) => k.endsWith('baseline/server.py'))).toBe(true)
    expect(Object.keys(files).some((k) => k.endsWith('proposed/server.py'))).toBe(true)
  })
  it('exits 2 for a rejected proposal, 64 for usage errors, 2 for env files', async () => {
    files['bad.json'] = doc(http, [op('hide_tool', 'h', { tool: 'ghost' })])
    expect(await main(['in.yaml', '--proposals', 'bad.json'], io)).toBe(2)
    expect(await main(['in.yaml'], io)).toBe(64)
    expect(await main(['in.yaml', '--proposals', 'p.json', '--reruns', '9'], io)).toBe(64)
    files['.env'] = '{}'
    expect(await main(['in.yaml', '--proposals', '.env'], io)).toBe(2)
  })
})
