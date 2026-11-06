// Generator-side checks: everything the Phase 14 generator does BEFORE a server runs. Deterministic, in process,
// never throws, never executes generated code. Reasons are capped and never echo input text.
import { createHash } from 'node:crypto'
import { runPipeline } from '../mcpgen/pipeline'
import type { CheckResult, FlagHit } from './core/types'

export type PipelineFn = typeof runPipeline

export interface GeneratorCheckCtx {
  sample: { id: string; input: string; filename?: string }
  runPipelineFn?: PipelineFn
}

type Run = ReturnType<PipelineFn>

const cap = (s: string, n = 200) => (s.length > n ? s.slice(0, n) : s)

function res(
  id: string,
  dimension: CheckResult['dimension'],
  status: CheckResult['status'],
  reason: string,
  flags?: FlagHit[]
): CheckResult {
  const r: CheckResult = { id, kind: 'generator_side', dimension, status, boundBy: 'none', reason: cap(reason) }
  if (flags && flags.length > 0) r.flags = flags
  return r
}

function hashRun(r: Run): string {
  if (!r.ok) return 'fail:' + r.gaps.map((g) => `${g.code}|${g.message}`).join('\n')
  const h = createHash('sha256')
  for (const f of [...r.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)))
    h.update(`${f.path}\0${f.content}\0`)
  return h.digest('hex')
}

function safeRun(fn: PipelineFn, input: string, filename?: string): Run {
  try {
    return fn(input, { filename })
  } catch {
    return { ok: false, gaps: [{ code: 'pipeline-threw', message: 'pipeline threw', severity: 'error' }] }
  }
}

function generates(fn: PipelineFn, c: GeneratorCheckCtx): CheckResult {
  const r = safeRun(fn, c.sample.input, c.sample.filename)
  if (!r.ok) return res('generates', 'D1', 'FAIL', `pipeline failed: ${r.gaps.map((g) => g.code).join(', ')}`)
  const n = r.report.toolsEmitted.length
  return n > 0
    ? res('generates', 'D1', 'PASS', `pipeline ok, ${n} tool(s) emitted`)
    : res('generates', 'D1', 'FAIL', 'pipeline ok but no tools emitted')
}

function reproducible(fn: PipelineFn, c: GeneratorCheckCtx): CheckResult {
  const hashes = [1, 2, 3].map(() => hashRun(safeRun(fn, c.sample.input, c.sample.filename)))
  return new Set(hashes).size === 1
    ? res('reproducible', 'D6', 'PASS', '3 runs produced identical output hashes')
    : res('reproducible', 'D6', 'FAIL', 'output hashes differ across 3 runs')
}

/** The three planted defects of the partial spec, each with how a gap or omission would be recognised. */
const DEFECTS = [
  { name: 'missing response type', gapRe: /getGadgets|\/gadgets(?![/\w])/i, toolRe: /^(list|search|filter|query)_gadget/ },
  { name: 'undocumented required parameter', gapRe: /getGadgets|\/gadgets(?![/\w])|tenant|header/i, toolRe: /^(list|search|filter|query)_gadget/ },
  { name: 'stale example', gapRe: /getGadget\b|\/gadgets\/\{id\}|example|legacy_flag/i, toolRe: /^(lookup|get)_gadget/ }
]

function partialSpec(fn: PipelineFn, c: GeneratorCheckCtx): CheckResult[] {
  const runs = [1, 2, 3].map(() => safeRun(fn, c.sample.input, c.sample.filename))
  const first = runs[0]
  const identical = new Set(runs.map(hashRun)).size === 1
  const silent = (detail: string): CheckResult[] => [
    res('gap_reported', 'D4', 'FAIL', detail, [{ id: 'SILENT_GUESS', severity: 'warning', detail: cap(detail) }]),
    res('reproducible', 'D6', identical ? 'PASS' : 'FAIL', identical ? '3 runs identical' : 'output differs across 3 runs')
  ]
  if (!first.ok) {
    // Refusing the whole input with a gap is reporting, not guessing.
    return [
      res('gap_reported', 'D4', first.gaps.length > 0 ? 'PASS' : 'FAIL', 'whole input rejected with reported gaps'),
      res('reproducible', 'D6', identical ? 'PASS' : 'FAIL', identical ? '3 runs identical' : 'output differs across 3 runs')
    ]
  }
  const { toolsEmitted, toolsDropped, gaps } = first.report
  const misses: string[] = []
  for (const d of DEFECTS) {
    const reported =
      gaps.some((g) => d.gapRe.test(`${g.path ?? ''} ${g.message}`) && g.severity !== 'info') ||
      toolsDropped.some((t) => d.gapRe.test(`${t.id} ${t.reason}`)) ||
      !toolsEmitted.some((t) => d.toolRe.test(t))
    if (!reported) misses.push(d.name)
  }
  if (misses.length > 0 || !identical) {
    const parts = [
      misses.length > 0 ? `silently guessed: ${misses.join(', ')}` : '',
      identical ? '' : 'reruns not byte-identical'
    ].filter(Boolean)
    return silent(parts.join('; '))
  }
  return [
    res('gap_reported', 'D4', 'PASS', 'every planted defect reported or its tool omitted; 3 reruns identical'),
    res('reproducible', 'D6', 'PASS', '3 runs identical')
  ]
}

function credentialRejected(fn: PipelineFn, c: GeneratorCheckCtx): CheckResult {
  const secret = ['sk', '-'].join('') + 'a'.repeat(30)
  const dirty = `${c.sample.input}\n# api_key: ${secret}\n`
  const bad = safeRun(fn, dirty, c.sample.filename)
  if (bad.ok) return res('credential_rejected', 'D4', 'FAIL', 'credential-looking input was accepted')
  const hit = bad.gaps.some((g) => g.code === 'credential-rejected')
  const echoed = bad.gaps.some((g) => `${g.message} ${g.path ?? ''}`.includes(secret))
  if (!hit) return res('credential_rejected', 'D4', 'FAIL', 'input rejected but without a credential gap')
  if (echoed) return res('credential_rejected', 'D4', 'FAIL', 'credential gap echoes the matched value')
  const clean = safeRun(fn, c.sample.input, c.sample.filename)
  return clean.ok
    ? res('credential_rejected', 'D4', 'PASS', 'credential rejected without echo; clean spec accepted')
    : res('credential_rejected', 'D4', 'FAIL', 'clean spec was rejected')
}

export function runGeneratorSideChecks(caseId: string, ctx: GeneratorCheckCtx): CheckResult[] {
  try {
    const fn = ctx.runPipelineFn ?? runPipeline
    switch (caseId) {
      case 'T1-STD-CATALOG':
        return [generates(fn, ctx), reproducible(fn, ctx)]
      case 'T4-PARTIAL-SPEC':
        return partialSpec(fn, ctx)
      case 'T4-SEC-SECRETS':
        return [credentialRejected(fn, ctx)]
      default:
        return []
    }
  } catch {
    return []
  }
}
