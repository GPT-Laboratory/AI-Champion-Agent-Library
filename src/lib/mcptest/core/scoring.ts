// Scoring rollup: per-case evaluation (thresholds, D1-D6), tier rollup, flags, verdict.
// Pure and total (never throws). Core purity: no $lib, svelte or @sveltejs imports.
import type { CellState, CheckResult, FlagHit, FlagId } from './types'

export const FLAG_SEVERITY: Record<FlagId, 'blocker' | 'warning'> = {
  LEAK: 'blocker',
  SECRET_ECHO: 'blocker',
  WRITE_TOOL: 'blocker',
  CONFIDENT_WRONG: 'blocker',
  NO_RETRY: 'warning',
  SILENT_GUESS: 'warning',
  UNVALIDATED_CODE: 'warning',
  STDOUT_NOISE: 'warning'
}

export interface Pct {
  pct: number
  passed: number
  scored: number
}

export interface CaseRun {
  caseId: string
  tier: 1 | 2 | 3 | 4
  state: CellState
  checks: CheckResult[]
  d1?: { pass: boolean }
  thresholds?: Record<string, number | boolean>
  caseMs?: number
  generationMs?: number | null
  reproducibility?: { reruns: number; equivalent: boolean }
  d3Basis?: 'advisory' | 'manual' | 'not_scored'
}

export interface ThresholdResult {
  key: string
  required: number | boolean
  actual: number | boolean | null
  /** null = not scorable (actual unavailable); excluded from the pass decision. */
  met: boolean | null
}

export interface CaseEval {
  caseId: string
  tier: 1 | 2 | 3 | 4
  state: CellState
  /** Percent 0-100 over scored checks (NA excluded, ERROR counted as not passed); null when nothing scored. */
  passRate: number | null
  passed: number
  scored: number
  thresholds: ThresholdResult[]
  unrecognised: string[]
  /** Threshold keys whose actual value was not scorable. */
  unscored: string[]
  dims: {
    D1: boolean | null
    D2: Pct | null
    D3: { score: number | null; max: 3; basis: 'advisory' | 'manual' | 'not_scored' }
    D4: Pct | null
    D5: { basis: 'not_scored' }
    D6: {
      tokens: 0
      cost: 0
      llm: false
      caseMs: number | null
      generationMs: number | null
      reproducibility: { reruns: number; equivalent: boolean } | null
    }
  }
  flags: FlagHit[]
}

const RAN: CellState[] = ['PASS', 'FAIL', 'ERROR']
const NOT_APPLICABLE: CellState[] = ['NA_MODALITY', 'NA_TRANSPORT']

function pctOf(checks: CheckResult[]): Pct | null {
  const scored = checks.filter((c) => c.status !== 'NA')
  if (scored.length === 0) return null
  const passed = scored.filter((c) => c.status === 'PASS').length
  return { pct: (passed / scored.length) * 100, passed, scored: scored.length }
}

function dedupeFlags(checks: CheckResult[]): FlagHit[] {
  const seen = new Set<string>()
  const out: FlagHit[] = []
  for (const c of checks) {
    for (const f of c.flags ?? []) {
      const key = `${f.id}|${f.detail}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...f, severity: FLAG_SEVERITY[f.id] ?? f.severity })
    }
  }
  return out
}

const ALIASES: Record<string, string> = { d2_functional_pct: 'd2_pct' }

function evalThreshold(key: string, required: unknown, checks: CheckResult[], dims: CaseEval['dims']): ThresholdResult | null {
  const canon = ALIASES[key] ?? key
  const num = (actual: number | null): ThresholdResult | null =>
    typeof required === 'number' ? { key, required, actual, met: actual === null ? null : actual >= required } : null
  const bool = (actual: boolean | null): ThresholdResult | null =>
    typeof required === 'boolean'
      ? { key, required, actual, met: actual === null ? null : required ? actual === true : true }
      : null
  const kinds = (ks: string[]) => checks.filter((c) => ks.includes(c.kind) && c.status !== 'NA')
  switch (canon) {
    case 'd1_pass':
      return bool(dims.D1)
    case 'd2_pct':
      return num(dims.D2 ? dims.D2.pct : null)
    case 'd3_score':
      return num(dims.D3.score)
    case 'd4_pct':
      return num(dims.D4 ? dims.D4.pct : null)
    case 'pagination_correct': {
      const cs = kinds(['pagination_ceiling', 'pagesize_clamp'])
      return bool(cs.length === 0 ? null : cs.every((c) => c.status === 'PASS'))
    }
    case 'result_cap_present': {
      const cs = kinds(['large_response', 'pagesize_clamp'])
      return bool(cs.length === 0 ? null : cs.some((c) => c.status === 'PASS'))
    }
    default:
      return null
  }
}

export function evaluateCase(run: CaseRun): CaseEval {
  const checks = run.checks ?? []
  const D2 = pctOf(checks.filter((c) => c.dimension === 'D2'))
  const D4 = pctOf(checks.filter((c) => c.dimension === 'D4'))
  const d3checks = checks.filter((c) => c.dimension === 'D3')
  const d3pct = pctOf(d3checks)
  let D3: CaseEval['dims']['D3']
  if (run.d3Basis === 'manual') D3 = { score: null, max: 3, basis: 'manual' }
  else if (d3pct === null) D3 = { score: null, max: 3, basis: 'not_scored' }
  else D3 = { score: Math.round((3 * d3pct.pct) / 100), max: 3, basis: 'advisory' }

  const dims: CaseEval['dims'] = {
    D1: run.d1 ? run.d1.pass : null,
    D2,
    D3,
    D4,
    D5: { basis: 'not_scored' },
    D6: {
      tokens: 0,
      cost: 0,
      llm: false,
      caseMs: run.caseMs ?? null,
      generationMs: run.generationMs ?? null,
      reproducibility: run.reproducibility ?? null
    }
  }

  const scoredChecks = checks.filter((c) => c.status !== 'NA')
  const passed = scoredChecks.filter((c) => c.status === 'PASS').length
  const passRate = scoredChecks.length === 0 ? null : (passed / scoredChecks.length) * 100

  const thresholds: ThresholdResult[] = []
  const unrecognised: string[] = []
  for (const [key, required] of Object.entries(run.thresholds ?? {})) {
    const t = evalThreshold(key, required, checks, dims)
    if (t) thresholds.push(t)
    else unrecognised.push(key)
  }
  const unscored = thresholds.filter((t) => t.met === null).map((t) => t.key)
  const decisive = thresholds.filter((t) => t.met !== null)

  let state: CellState = run.state
  if (RAN.includes(run.state)) {
    const anyFail = checks.some((c) => c.status === 'FAIL')
    const anyError = checks.some((c) => c.status === 'ERROR')
    // Fail closed (CR-02): a case that measured nothing is never a PASS, whatever its thresholds say.
    const nothingMeasured = scoredChecks.length === 0
    let ok: boolean
    if (nothingMeasured) ok = false
    else if (decisive.length > 0) ok = decisive.every((t) => t.met === true)
    else ok = scoredChecks.every((c) => c.status === 'PASS')
    // The tier 1 gate (D1) is never averaged or thresholded away.
    if (dims.D1 === false) ok = false
    if (ok) state = 'PASS'
    else if (anyError && !anyFail && dims.D1 !== false) state = 'ERROR'
    else if (nothingMeasured && dims.D1 !== false) state = 'ERROR' // a scorer or input problem, not a server verdict
    else state = 'FAIL'
  }

  return {
    caseId: run.caseId,
    tier: run.tier,
    state,
    passRate,
    passed,
    scored: scoredChecks.length,
    thresholds,
    unrecognised,
    unscored,
    dims,
    flags: dedupeFlags(checks)
  }
}

export interface RollUp {
  gate: 'pass' | 'fail' | 'not_run'
  score: { value: number | null; basis: string; casesRun: number; casesApplicable: number }
  flags: { blockers: number; warnings: number; list: FlagHit[] }
  verdict: 'PASS' | 'FAIL' | 'BLOCKED' | 'DISQUALIFIED' | 'INCOMPLETE'
}

// DRAFT-15-06 score formula (revert by editing meanCases)
function meanCases(evals: CaseEval[]): number | null {
  const rates = evals.filter((e) => e.passRate !== null).map((e) => e.passRate as number)
  if (rates.length === 0) return null
  return Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10
}

export function rollUp(evals: CaseEval[]): RollUp {
  const tier1 = evals.filter((e) => e.tier === 1 && RAN.includes(e.state))
  const gate: RollUp['gate'] = tier1.length === 0 ? 'not_run' : tier1.some((e) => e.state !== 'PASS') ? 'fail' : 'pass'

  const scoring = evals.filter((e) => (e.tier === 2 || e.tier === 3) && !NOT_APPLICABLE.includes(e.state))
  const ran = scoring.filter((e) => RAN.includes(e.state))

  const seen = new Set<string>()
  const list: FlagHit[] = []
  for (const e of evals)
    for (const f of e.flags) {
      const k = `${f.id}|${f.detail}`
      if (seen.has(k)) continue
      seen.add(k)
      list.push(f)
    }
  const blockers = list.filter((f) => f.severity === 'blocker').length
  const warnings = list.length - blockers

  const value = gate === 'fail' ? null : meanCases(ran)
  const score = {
    value,
    basis: 'unweighted mean of Tier 2 and Tier 3 case pass-rates (percent), NA excluded; Tier 1 is a gate; Tier 4 flags only',
    casesRun: ran.length,
    casesApplicable: scoring.length
  }

  // DRAFT-15-06 verdict precedence (revert by editing this block)
  let verdict: RollUp['verdict']
  if (blockers > 0) verdict = 'BLOCKED'
  else if (gate === 'fail') verdict = 'DISQUALIFIED'
  else if (ran.length === 0) verdict = 'INCOMPLETE'
  else if (ran.length === scoring.length && ran.every((e) => e.state === 'PASS')) {
    // Fail closed (CR-02, WR-07): PASS needs a passed Tier 1 gate and a measured score; otherwise the
    // verdict says the run did not establish anything.
    verdict = gate === 'pass' && value !== null ? 'PASS' : 'INCOMPLETE'
  } else verdict = 'FAIL'

  return { gate, score, flags: { blockers, warnings, list }, verdict }
}
