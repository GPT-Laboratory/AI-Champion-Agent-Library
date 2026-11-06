import { describe, expect, it } from 'vitest'
import { redact } from './redact'
import {
  assertReportSize,
  buildReport,
  CELL_STATES,
  PENDING_HUMAN_STATIC,
  renderMatrix,
  renderSummary,
  ReportSchema,
  toLegacyCsvRow,
  type BuildInput
} from './report'
import type { CheckResult } from './types'

const chk = (id: string, status: CheckResult['status'], over: Partial<CheckResult> = {}): CheckResult => ({
  id,
  kind: 'call',
  dimension: 'D2',
  status,
  boundBy: 'hint',
  reason: 'ok',
  ...over
})

function input(over: Partial<BuildInput> = {}): BuildInput {
  return {
    runId: 'run-1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    runtime: 'fake',
    runtimeLabel: 'fake runtime',
    platformVersion: '0.0.0',
    reruns: 1,
    subject: { id: 'fake:good', kind: 'fake', transport: 'stdio', toolNames: ['a', 'b'] },
    cases: [
      { run: { caseId: 'T2-CATALOG-API', tier: 2, state: 'PASS', checks: [chk('lookup_by_id', 'PASS', { kind: 'lookup_by_id' }), chk('auth_fail', 'FAIL', { kind: 'auth_fail', dimension: 'D4' })] } },
      { run: { caseId: 'T1-STD-CATALOG', tier: 1, state: 'PASS', d1: { pass: true }, checks: [chk('x', 'PASS')] } }
    ],
    ...over
  }
}

describe('ReportSchema and buildReport', () => {
  it('validates built reports and sorts cases by tier then id', () => {
    const r = buildReport(input())
    expect(ReportSchema.safeParse(r).success).toBe(true)
    expect(r.cases.map((c) => c.caseId)).toEqual(['T1-STD-CATALOG', 'T2-CATALOG-API'])
    expect(r.subject.labelNote).toBe('scorer fixture')
  })
  it('rejects unknown states and long reasons', () => {
    const r = buildReport(input())
    expect(ReportSchema.safeParse({ ...r, cases: [{ ...r.cases[0], state: 'WEIRD' }] }).success).toBe(false)
    const long = structuredClone(r)
    long.cases[0].checks[0].reason = 'x'.repeat(201)
    expect(ReportSchema.safeParse(long).success).toBe(false)
  })
  it('caps and redacts reasons, keeping the canary out of the JSON', () => {
    const canary = 'canary-0123456789abcdef'
    const r = buildReport(
      input({
        secrets: [canary],
        cases: [{ run: { caseId: 'T4-SEC-SECRETS', tier: 4, state: 'FAIL', checks: [chk('s', 'FAIL', { reason: `found ${canary} ${'y'.repeat(400)}` })] }, stateReason: canary }]
      })
    )
    const json = JSON.stringify(r)
    expect(json).not.toContain(canary)
    expect(r.cases[0].checks[0].reason.length).toBeLessThanOrEqual(200)
    expect(ReportSchema.safeParse(r).success).toBe(true)
  })
  it('lists PENDING_HUMAN cells and the static items', () => {
    const r = buildReport(input({ cases: [{ run: { caseId: 'T2-CATALOG-DUMP', tier: 2, state: 'PENDING_HUMAN', checks: [] }, stateReason: 'needs real runtime' }] }))
    expect(r.pendingHuman.map((p) => p.id)).toEqual(['T2-CATALOG-DUMP', ...PENDING_HUMAN_STATIC.map((p) => p.id)])
    expect(r.summary.score.casesApplicable).toBe(1)
    expect(r.summary.score.casesRun).toBe(0)
  })
  it('keeps timestamps and durations out of everything but run.generatedAt and timings', () => {
    const a = buildReport(input({ generatedAt: 'A', totalMs: 5, cases: [{ run: { caseId: 'T2-X-Y', tier: 2, state: 'PASS', checks: [chk('c', 'PASS')], caseMs: 9 }, timings: { caseMs: 9 } }] }))
    const b = buildReport(input({ generatedAt: 'B', totalMs: 77, cases: [{ run: { caseId: 'T2-X-Y', tier: 2, state: 'PASS', checks: [chk('c', 'PASS')], caseMs: 1 }, timings: { caseMs: 1 } }] }))
    const strip = (r: typeof a) => ({ ...r, run: { ...r.run, generatedAt: '' }, timings: null })
    expect(strip(a)).toEqual(strip(b))
  })
  it('size helper throws over the cap', () => {
    expect(() => assertReportSize(buildReport(input()), 100)).toThrow()
    expect(() => assertReportSize(buildReport(input()))).not.toThrow()
  })
})

describe('renderers', () => {
  const r = buildReport(
    input({
      cases: [
        {
          run: { caseId: 'T2-CATALOG-API', tier: 2, state: 'FAIL', checks: [chk('lookup_by_id', 'PASS', { kind: 'lookup_by_id' }), chk('auth_fail', 'FAIL', { kind: 'auth_fail' })] },
          reruns: [
            { state: 'PASS', checks: [{ id: 'lookup_by_id', status: 'PASS' }, { id: 'auth_fail', status: 'PASS' }] },
            { state: 'FAIL', checks: [{ id: 'lookup_by_id', status: 'PASS' }, { id: 'auth_fail', status: 'FAIL' }] }
          ]
        },
        { run: { caseId: 'T4-SEC-SECRETS', tier: 4, state: 'FAIL', checks: [chk('echo', 'FAIL', { flags: [{ id: 'SECRET_ECHO', severity: 'blocker', detail: 'canary in stderr' }, { id: 'NO_RETRY', severity: 'warning', detail: 'slow' }] })] } },
        { run: { caseId: 'T2-CATALOG-DUMP', tier: 2, state: 'PENDING_HUMAN', checks: [] } }
      ]
    })
  )
  it('matrix: text labels, pessimistic tie, legend of all 10 states', () => {
    for (const fmt of ['text', 'markdown'] as const) {
      const m = renderMatrix(r, fmt)
      for (const s of CELL_STATES) expect(m).toContain(s)
      expect(m).toContain('PEND')
      expect(m).toContain('FAIL')
      expect(renderMatrix(r, fmt)).toBe(m)
    }
    const md = renderMatrix(r, 'markdown')
    const row = md.split('\n').find((l) => l.startsWith('| T2-CATALOG-API'))
    expect(row).toContain('FAIL')
  })
  it('summary: verdict first, blockers before warnings, coverage, honest D6, fake note', () => {
    const t = renderSummary(r)
    expect(t.split('\n')[0]).toContain('BLOCKED')
    expect(t.indexOf('SECRET_ECHO')).toBeLessThan(t.indexOf('NO_RETRY'))
    expect(t).toMatch(/coverage \d+\/\d+/)
    expect(t).toContain('tokens 0, cost 0, llm false')
    expect(t).toContain('scorer fixture')
    expect(renderSummary(r, 'markdown')).toContain('## Verdict: BLOCKED')
    expect(renderSummary({ ...r, subject: { ...r.subject, kind: 'generator' } })).not.toContain('scorer fixture')
  })
  it('legacy CSV row has 15 columns and NA when absent', () => {
    const cols = toLegacyCsvRow(r).split(',')
    expect(cols).toHaveLength(15)
    expect(cols[4]).toBe('1')
    expect(cols[13]).toBe('0')
    expect(cols[14]).toBe('1')
    const none = toLegacyCsvRow(buildReport(input({ cases: [] }))).split(',')
    expect(none.slice(4, 14).every((x) => x === 'NA')).toBe(true)
  })
})

describe('redact', () => {
  it('masks secrets, bearer tokens and key-like tokens and caps length', () => {
    const out = redact('key=secretvalue Bearer abc.def and ' + 'k'.repeat(40), ['secretvalue'])
    expect(out).not.toContain('secretvalue')
    expect(out).not.toContain('abc.def')
    expect(out).not.toContain('kkkkkkkk')
    expect(redact('z '.repeat(500)).length).toBeLessThanOrEqual(200)
    expect(redact('z '.repeat(500), [], 50).length).toBeLessThanOrEqual(50)
  })
})
