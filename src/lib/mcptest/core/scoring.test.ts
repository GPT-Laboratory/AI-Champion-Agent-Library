import { describe, it, expect } from 'vitest'
import { evaluateCase, rollUp, FLAG_SEVERITY, type CaseRun } from './scoring'
import type { CheckResult, CellState, FlagHit } from './types'

const chk = (
  kind: CheckResult['kind'],
  dimension: CheckResult['dimension'],
  status: CheckResult['status'],
  flags?: FlagHit[]
): CheckResult => ({ id: kind, kind, dimension, status, boundBy: 'explicit', reason: '', flags })

const run = (over: Partial<CaseRun> & Pick<CaseRun, 'tier'>): CaseRun => ({
  caseId: `C${over.tier}`,
  state: 'PASS',
  checks: [],
  ...over
})

const blocker: FlagHit = { id: 'LEAK', severity: 'blocker', detail: 'x' }
const warn: FlagHit = { id: 'NO_RETRY', severity: 'warning', detail: 'y' }

/** A Tier 2/3 case evaluated to the given pass percentage over four D2 checks. */
const caseAt = (tier: 2 | 3, passes: number, state: CellState = 'PASS') =>
  evaluateCase(
    run({
      tier,
      state,
      checks: [0, 1, 2, 3].map((i) => chk('lookup_by_id', 'D2', i < passes ? 'PASS' : 'FAIL'))
    })
  )

describe('FLAG_SEVERITY', () => {
  it('matches the specified table', () => {
    expect(FLAG_SEVERITY).toEqual({
      LEAK: 'blocker',
      SECRET_ECHO: 'blocker',
      WRITE_TOOL: 'blocker',
      CONFIDENT_WRONG: 'blocker',
      NO_RETRY: 'warning',
      SILENT_GUESS: 'warning',
      UNVALIDATED_CODE: 'warning',
      STDOUT_NOISE: 'warning'
    })
  })
})

describe('evaluateCase', () => {
  it('computes passRate with NA excluded and ERROR counted unpassed', () => {
    const e = evaluateCase(
      run({
        tier: 2,
        checks: [chk('lookup_by_id', 'D2', 'PASS'), chk('projection', 'D2', 'NA'), chk('bad_input', 'D4', 'ERROR'), chk('empty_vs_error', 'D4', 'PASS')]
      })
    )
    expect(e.scored).toBe(3)
    expect(e.passed).toBe(2)
    expect(e.passRate).toBeCloseTo(66.67, 1)
    expect(e.dims.D2).toEqual({ pct: 100, passed: 1, scored: 1 })
    expect(e.dims.D4).toEqual({ pct: 50, passed: 1, scored: 2 })
  })

  it('turns state to ERROR when a check errors and none fail', () => {
    const e = evaluateCase(run({ tier: 2, checks: [chk('lookup_by_id', 'D2', 'PASS'), chk('bad_input', 'D4', 'ERROR')] }))
    expect(e.state).toBe('ERROR')
    const f = evaluateCase(run({ tier: 2, checks: [chk('lookup_by_id', 'D2', 'FAIL'), chk('bad_input', 'D4', 'ERROR')] }))
    expect(f.state).toBe('FAIL')
  })

  it('passes without thresholds only if all scored checks pass', () => {
    expect(caseAt(2, 4).state).toBe('PASS')
    expect(caseAt(2, 3).state).toBe('FAIL')
  })

  it('keeps non-run states untouched', () => {
    const e = evaluateCase(run({ tier: 2, state: 'NA_MODALITY' }))
    expect(e.state).toBe('NA_MODALITY')
  })

  it('maps D1 false and D1 true', () => {
    expect(evaluateCase(run({ tier: 1, d1: { pass: false } })).dims.D1).toBe(false)
    const bad = evaluateCase(run({ tier: 1, d1: { pass: false }, thresholds: { d1_pass: false } }))
    expect(bad.state).toBe('FAIL')
    const ok = evaluateCase(run({ tier: 1, d1: { pass: true }, checks: [chk('tool_exists', 'D1', 'PASS')] }))
    expect(ok.dims.D1).toBe(true)
    expect(ok.state).toBe('PASS')
  })

  describe('thresholds', () => {
    it('d2_pct met at 96, unmet at 90 (and alias)', () => {
      const mk = (passed: number, total: number, key: string) =>
        evaluateCase(
          run({
            tier: 2,
            thresholds: { [key]: 95 },
            checks: Array.from({ length: total }, (_, i) => chk('lookup_by_id', 'D2', i < passed ? 'PASS' : 'FAIL'))
          })
        )
      const hi = mk(96, 100, 'd2_pct')
      expect(hi.thresholds[0].met).toBe(true)
      expect(hi.state).toBe('PASS')
      const lo = mk(90, 100, 'd2_functional_pct')
      expect(lo.thresholds[0]).toMatchObject({ key: 'd2_functional_pct', required: 95, met: false })
      expect(lo.state).toBe('FAIL')
    })

    it('thresholds override raw check failures when all are met', () => {
      const checks = [...Array.from({ length: 19 }, () => chk('lookup_by_id', 'D2', 'PASS')), chk('projection', 'D2', 'FAIL')]
      expect(evaluateCase(run({ tier: 2, thresholds: { d2_pct: 95 }, checks })).state).toBe('PASS')
    })

    it('d3_score and d4_pct', () => {
      const e = evaluateCase(
        run({
          tier: 3,
          thresholds: { d3_score: 3, d4_pct: 50 },
          checks: [chk('profile', 'D3', 'PASS'), chk('large_response', 'D4', 'PASS'), chk('pagesize_clamp', 'D4', 'FAIL')]
        })
      )
      expect(e.dims.D3).toEqual({ score: 3, max: 3, basis: 'advisory' })
      expect(e.thresholds.map((t) => t.met)).toEqual([true, true])
    })

    it('pagination_correct requires ceiling and clamp checks to pass', () => {
      const ok = evaluateCase(
        run({ tier: 2, thresholds: { pagination_correct: true }, checks: [chk('pagination_ceiling', 'D4', 'PASS'), chk('pagesize_clamp', 'D4', 'PASS')] })
      )
      expect(ok.thresholds[0]).toMatchObject({ actual: true, met: true })
      const bad = evaluateCase(
        run({ tier: 2, thresholds: { pagination_correct: true }, checks: [chk('pagination_ceiling', 'D4', 'PASS'), chk('pagesize_clamp', 'D4', 'FAIL')] })
      )
      expect(bad.thresholds[0].met).toBe(false)
      expect(bad.state).toBe('FAIL')
    })

    it('result_cap_present accepts large_response or pagesize_clamp', () => {
      const a = evaluateCase(run({ tier: 3, thresholds: { result_cap_present: true }, checks: [chk('large_response', 'D4', 'PASS')] }))
      expect(a.thresholds[0].met).toBe(true)
      const b = evaluateCase(run({ tier: 3, thresholds: { result_cap_present: true }, checks: [chk('pagesize_clamp', 'D4', 'PASS')] }))
      expect(b.thresholds[0].met).toBe(true)
      const c = evaluateCase(run({ tier: 3, thresholds: { result_cap_present: true }, checks: [chk('large_response', 'D4', 'FAIL')] }))
      expect(c.thresholds[0].met).toBe(false)
    })

    it('lists unrecognised keys and wrong-typed values', () => {
      const e = evaluateCase(run({ tier: 2, thresholds: { made_up: 1, d2_pct: true }, checks: [chk('lookup_by_id', 'D2', 'PASS')] }))
      expect(e.unrecognised.sort()).toEqual(['d2_pct', 'made_up'])
    })

    it('reports a null-actual threshold as met:null, unscored, and not decisive', () => {
      const e = evaluateCase(run({ tier: 3, thresholds: { d3_score: 3, d2_pct: 100 }, checks: [chk('lookup_by_id', 'D2', 'PASS')] }))
      expect(e.dims.D3.basis).toBe('not_scored')
      const d3 = e.thresholds.find((t) => t.key === 'd3_score')
      expect(d3).toMatchObject({ actual: null, met: null })
      expect(e.unscored).toEqual(['d3_score'])
      expect(e.state).toBe('PASS')
      const m = evaluateCase(run({ tier: 3, d3Basis: 'manual', thresholds: { d3_score: 3 }, checks: [chk('profile', 'D3', 'PASS')] }))
      expect(m.dims.D3).toEqual({ score: null, max: 3, basis: 'manual' })
      expect(m.unscored).toEqual(['d3_score'])
    })
  })

  it('D3 is advisory round(3 * passrate) when D3 checks exist', () => {
    const e = evaluateCase(run({ tier: 3, checks: [chk('profile', 'D3', 'PASS'), chk('profile', 'D3', 'FAIL'), chk('grounding', 'D3', 'PASS')] }))
    expect(e.dims.D3).toEqual({ score: 2, max: 3, basis: 'advisory' })
  })

  it('D5 not scored, D6 measured parts only', () => {
    const e = evaluateCase(run({ tier: 2, caseMs: 12, generationMs: null, reproducibility: { reruns: 3, equivalent: true } }))
    expect(e.dims.D5).toEqual({ basis: 'not_scored' })
    expect(e.dims.D6).toEqual({ tokens: 0, cost: 0, llm: false, caseMs: 12, generationMs: null, reproducibility: { reruns: 3, equivalent: true } })
  })

  it('dedupes flags and normalises severity from the table', () => {
    const e = evaluateCase(
      run({ tier: 4, checks: [chk('fault_retry', 'D4', 'FAIL', [{ id: 'NO_RETRY', severity: 'blocker', detail: 'y' }]), chk('fault_retry', 'D4', 'FAIL', [warn])] })
    )
    expect(e.flags).toEqual([warn])
  })

  it('never throws on empty runs', () => {
    expect(evaluateCase(run({ tier: 2 })).state).toBe('ERROR')
  })
})

describe('rollUp', () => {
  const t1 = (pass: boolean) =>
    evaluateCase(run({ tier: 1, d1: { pass }, state: pass ? 'PASS' : 'FAIL', checks: [chk('tool_exists', 'D1', pass ? 'PASS' : 'FAIL')] }))

  it('Tier 1 failure is a gate: score null, DISQUALIFIED', () => {
    const r = rollUp([t1(false), caseAt(2, 4)])
    expect(r.gate).toBe('fail')
    expect(r.score.value).toBeNull()
    expect(r.verdict).toBe('DISQUALIFIED')
  })

  it('blocker beats a failed gate and a perfect score', () => {
    const flagged = evaluateCase(run({ tier: 4, state: 'FAIL', checks: [chk('secret_canary', 'D4', 'FAIL', [blocker])] }))
    const a = rollUp([t1(false), caseAt(2, 4), flagged])
    expect(a.verdict).toBe('BLOCKED')
    expect(a.score.value).toBeNull()
    const b = rollUp([t1(true), caseAt(2, 4), flagged])
    expect(b.verdict).toBe('BLOCKED')
    expect(b.score.value).toBe(100)
    expect(b.flags.blockers).toBe(1)
  })

  it('means unweighted case pass-rates; casesRun reported', () => {
    const r = rollUp([t1(true), caseAt(2, 4), caseAt(3, 2, 'FAIL')])
    expect(r.score.value).toBe(75)
    expect(r.score.casesRun).toBe(2)
    expect(r.score.casesApplicable).toBe(2)
    expect(r.gate).toBe('pass')
    expect(r.verdict).toBe('FAIL')
  })

  it('excludes NA states from applicable; PENDING_HUMAN is applicable but not run', () => {
    const na = evaluateCase(run({ tier: 2, state: 'NA_MODALITY' }))
    const nt = evaluateCase(run({ tier: 2, state: 'NA_TRANSPORT' }))
    const pending = evaluateCase(run({ tier: 3, state: 'PENDING_HUMAN' }))
    const r = rollUp([t1(true), caseAt(2, 4), na, nt, pending])
    expect(r.score.casesApplicable).toBe(2)
    expect(r.score.casesRun).toBe(1)
    expect(r.verdict).toBe('FAIL')
    const all = rollUp([t1(true), caseAt(2, 4), na, nt])
    expect(all.verdict).toBe('PASS')
  })

  it('is INCOMPLETE when nothing in Tier 2/3 ran', () => {
    expect(rollUp([]).verdict).toBe('INCOMPLETE')
    expect(rollUp([t1(true)]).verdict).toBe('INCOMPLETE')
    expect(rollUp([t1(true), evaluateCase(run({ tier: 2, state: 'SKIPPED_FIXTURE' }))]).verdict).toBe('INCOMPLETE')
  })

  it('Tier 4 results never add to the score; warnings do not change PASS', () => {
    const t4 = evaluateCase(run({ tier: 4, state: 'FAIL', checks: [chk('fault_retry', 'D4', 'FAIL', [warn])] }))
    const r = rollUp([t1(true), caseAt(2, 4), t4])
    expect(r.score.value).toBe(100)
    expect(r.score.casesRun).toBe(1)
    expect(r.flags).toMatchObject({ blockers: 0, warnings: 1 })
    expect(r.verdict).toBe('PASS')
  })

  it('treats a Tier 1 ERROR as a failed gate', () => {
    const e = evaluateCase(run({ tier: 1, state: 'PASS', checks: [chk('tool_exists', 'D1', 'ERROR')] }))
    expect(rollUp([e, caseAt(2, 4)]).gate).toBe('fail')
  })
})
