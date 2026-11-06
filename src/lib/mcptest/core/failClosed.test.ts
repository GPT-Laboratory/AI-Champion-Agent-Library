// Review fixes CR-01, CR-02, WR-07: a run that measured nothing, or whose Tier 1 gate never ran, is never a PASS.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadCaseDir } from './cases'
import { runSuite } from './runner'
import { evaluateCase, rollUp, type CaseRun } from './scoring'
import { loadSuite, type SuiteCase } from './suite'
import { fakeSubject } from './subjects'
import type { CheckResult } from './types'

const chk = (status: CheckResult['status'], dimension: CheckResult['dimension'] = 'D2'): CheckResult => ({
  id: `c-${status}-${dimension}`,
  kind: 'lookup_by_id',
  dimension,
  status,
  boundBy: 'explicit',
  reason: ''
})
const run = (over: Partial<CaseRun> & Pick<CaseRun, 'tier'>): CaseRun => ({ caseId: `C${over.tier}`, state: 'PASS', checks: [], ...over })

describe('evaluateCase fails closed (CR-02)', () => {
  it('a Tier 1 case with D1 true and no checks is not a PASS', () => {
    const e = evaluateCase(run({ tier: 1, d1: { pass: true } }))
    expect(e.state).toBe('ERROR')
  })
  it('a case with only NA checks is not a PASS', () => {
    const e = evaluateCase(run({ tier: 2, checks: [chk('NA'), chk('NA')] }))
    expect(e.state).toBe('ERROR')
    expect(e.passRate).toBeNull()
  })
  it('thresholds cannot turn a case with nothing measured into a PASS', () => {
    const e = evaluateCase(run({ tier: 1, d1: { pass: true }, thresholds: { d1_pass: true } }))
    expect(e.thresholds[0].met).toBe(true)
    expect(e.state).toBe('ERROR')
  })
  it('a failed D1 with no checks stays FAIL, not ERROR', () => {
    expect(evaluateCase(run({ tier: 1, d1: { pass: false } })).state).toBe('FAIL')
  })
  it('a case that measured something still passes', () => {
    expect(evaluateCase(run({ tier: 2, checks: [chk('PASS')] })).state).toBe('PASS')
  })
})

describe('rollUp never PASSes without a passed gate and a score (CR-02, WR-07)', () => {
  const passing = (tier: 2 | 3) => evaluateCase(run({ tier, checks: [chk('PASS')] }))
  const gate = evaluateCase(run({ tier: 1, d1: { pass: true }, checks: [chk('PASS', 'D1')] }))

  it('gate not_run with every Tier 2/3 case passing is INCOMPLETE', () => {
    const r = rollUp([passing(2), passing(3)])
    expect(r.gate).toBe('not_run')
    expect(r.verdict).toBe('INCOMPLETE')
  })
  it('a Tier 1 case that never ran (PENDING_HUMAN) leaves the gate not_run and the verdict INCOMPLETE', () => {
    const pending = evaluateCase(run({ tier: 1, state: 'PENDING_HUMAN' }))
    expect(rollUp([pending, passing(2)])).toMatchObject({ gate: 'not_run', verdict: 'INCOMPLETE' })
  })
  it('a failing Tier 2 case still reports FAIL when the gate did not run', () => {
    const failing = evaluateCase(run({ tier: 2, state: 'FAIL', checks: [chk('FAIL')] }))
    expect(rollUp([failing]).verdict).toBe('FAIL')
  })
  it('with a passed gate and measured cases the verdict is PASS and the score is set', () => {
    const r = rollUp([gate, passing(2), passing(3)])
    expect(r.gate).toBe('pass')
    expect(r.score.value).toBe(100)
    expect(r.verdict).toBe('PASS')
  })
  it('zero scored checks never yields PASS with a null score', () => {
    const empty = evaluateCase(run({ tier: 2 }))
    const r = rollUp([gate, empty])
    expect(r.verdict).not.toBe('PASS')
  })
})

describe('golden.jsonl is required for suite cases (CR-01)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcptest-failclosed-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const CASE = 'id: T2-ACME-A\ntier: 2\nx-upstream: { a: { datasets: [catalog] } }\nx-applies-to: [fake]\n'

  it('loadCaseDir with requireGolden rejects a missing golden.jsonl', async () => {
    await writeFile(join(dir, 'case.yaml'), CASE)
    const r = await loadCaseDir(dir, { requireGolden: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.file === 'golden.jsonl')).toBe(true)
  })
  it('loadCaseDir with requireGolden rejects an empty golden.jsonl', async () => {
    await writeFile(join(dir, 'case.yaml'), CASE)
    await writeFile(join(dir, 'golden.jsonl'), '# nothing\n')
    const r = await loadCaseDir(dir, { requireGolden: true })
    expect(r.ok).toBe(false)
  })
  it('loadCaseDir without the option keeps the lenient default', async () => {
    await writeFile(join(dir, 'case.yaml'), CASE)
    expect((await loadCaseDir(dir)).ok).toBe(true)
  })
  it('loadSuite fails when a case directory has no golden.jsonl', async () => {
    const d = join(dir, 'T2-ACME-A')
    await mkdir(d)
    await writeFile(join(d, 'case.yaml'), CASE)
    const r = await loadSuite(dir)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toContain('golden.jsonl')
  })
})

describe('runSuite with empty goldens (reproduction of the review)', () => {
  let cases: SuiteCase[]
  beforeAll(async () => {
    const s = await loadSuite()
    if (!s.ok) throw new Error(s.errors.join('\n'))
    cases = s.cases.filter((c) => ['T1-STD-CATALOG', 'T2-CATALOG-API', 'T3-RT-DOCS'].includes(c.def.id)).map((c) => ({ ...c, golden: [] }))
  })

  it('reports ERROR cases and never a PASS verdict', async () => {
    const report = await runSuite({ subject: fakeSubject('good'), cases, runtime: 'fake', timeoutMs: 1500 })
    expect(report.cases.map((c) => c.state)).toEqual(['ERROR', 'ERROR', 'ERROR'])
    expect(report.summary.verdict).not.toBe('PASS')
    expect(report.cases[0].stateReason).toContain('no golden checks')
  })
})
