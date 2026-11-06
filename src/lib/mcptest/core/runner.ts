// Cell runner: orchestrates cases x reruns for one subject and builds the report. NEVER throws: every failure
// is a cell state. Resolution order (from the source runner): unavailable, install_failed, modality
// (NA_MODALITY / SKIPPED_FIXTURE), prepare (GEN_FAILED), run checks; additive NA_TRANSPORT and PENDING_HUMAN.
// Core purity: no $lib/svelte imports. Imports ../mock and ../fake only through subjects/cellRun.
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { equivalentRuns, majority } from './aggregate'
import { runOnce, type CellResult } from './cellRun'
import { assertReportSize, buildReport, type BuildInput, type Report, type ReportCaseInput } from './report'
import { makeRedactor } from './redact'
import { evaluateCase, type CaseRun } from './scoring'
import type { SuiteCase } from './suite'
import type { PrepareWithStderr, RunnableSubject } from './subjects'
import type { CellState, CheckResult } from './types'

export interface RunOptions {
  subject: RunnableSubject
  cases: SuiteCase[]
  /** Default 1, clamped to 1..3. */
  reruns?: number
  runtime: 'fake' | 'container' | 'local-cli'
  allowStdioExec?: boolean
  timeoutMs?: number
  signal?: AbortSignal
  onProgress?: (p: { done: number; total: number; current?: string }) => void
  runId?: string
  now?: () => Date
  platformVersion?: string
}

const RUNTIME_LABEL: Record<RunOptions['runtime'], string> = {
  fake: 'fake runtime (in-process scorer fixtures)',
  container: 'container runtime (sandboxed)',
  'local-cli': 'local CLI runtime (unsandboxed, human only)'
}

const clamp = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(3, Math.max(1, Math.floor(n))) : 1)
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const tier = (sc: SuiteCase): 1 | 2 | 3 | 4 => (Math.min(4, Math.max(1, sc.def.tier)) as 1 | 2 | 3 | 4)

function thresholds(sc: SuiteCase): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {}
  for (const [k, v] of Object.entries(sc.def.pass_thresholds ?? {})) if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
  return out
}

/** Needed fixture directories: docs and dump modalities, and generator-only cases read spec fixtures. */
function missingFixture(sc: SuiteCase): string | null {
  const need: string[] = sc.def.provides_modalities.filter((m) => m === 'docs' || m === 'dump')
  const only = sc.x.appliesTo
  if (only && only.length === 1 && only[0] === 'generator') need.push('spec')
  for (const m of need) if (!sc.fixtureFiles.some((f) => f.path.startsWith(`${m}/`))) return `fixture/${m} is missing`
  return null
}

interface Pre {
  state: CellState
  reason: string
}

function preResolve(sc: SuiteCase, subject: RunnableSubject): Pre | null {
  if (subject.status === 'unavailable') return { state: 'UNAVAILABLE', reason: 'subject is not available in this runtime' }
  if (subject.status === 'install_failed') return { state: 'INSTALL_FAILED', reason: 'subject installation failed' }
  const applies = sc.x.appliesTo
  if (applies && !applies.includes(subject.kind)) return { state: 'NA_MODALITY', reason: `case applies to ${applies.join(', ')} subjects only` }
  if (subject.modality !== 'any' && !sc.def.provides_modalities.includes(subject.modality))
    return { state: 'NA_MODALITY', reason: `case provides ${sc.def.provides_modalities.join(', ')}, subject is ${subject.modality}` }
  const fx = missingFixture(sc)
  if (fx) return { state: 'SKIPPED_FIXTURE', reason: fx }
  if (sc.def.transport === 'http' && (!subject.transports.includes('http') || !subject.startHttp))
    return { state: 'NA_TRANSPORT', reason: 'case needs HTTP, subject offers stdio only' }
  if (sc.x.requires === 'real-runtime' && subject.kind === 'fake')
    return { state: 'PENDING_HUMAN', reason: 'needs a real runtime; a fake subject must not fabricate a result' }
  return null
}

function aggregate(sc: SuiteCase, runs: CellResult[]): { run: CaseRun; reruns: ReportCaseInput['reruns'] } {
  const perRun: CaseRun[] = runs.map((r) => ({
    caseId: sc.def.id,
    tier: tier(sc),
    state: 'PASS' as CellState,
    checks: r.checks,
    d1: r.d1,
    thresholds: thresholds(sc)
  }))
  const states = perRun.map((r) => evaluateCase(r).state)
  const ids: string[] = []
  for (const r of runs) for (const c of r.checks) if (!ids.includes(c.id)) ids.push(c.id)
  const checks: CheckResult[] = ids.map((id) => {
    const all = runs.flatMap((r) => r.checks.filter((c) => c.id === id))
    const status = majority(all.map((c) => c.status))
    const pick = all.find((c) => c.status === status) ?? all[0]
    const flags = new Map<string, NonNullable<CheckResult['flags']>[number]>()
    for (const c of all) for (const f of c.flags ?? []) flags.set(`${f.id}|${f.detail}`, f)
    return { ...pick, status, ...(flags.size ? { flags: [...flags.values()] } : {}) }
  })
  const d1s = runs.map((r) => r.d1).filter((d): d is { pass: boolean } => !!d)
  const d1 = d1s.length === 0 ? undefined : { pass: d1s.every((d) => d.pass) }
  return {
    run: {
      caseId: sc.def.id,
      tier: tier(sc),
      state: majority(states),
      checks,
      d1,
      thresholds: thresholds(sc),
      reproducibility: { reruns: runs.length, equivalent: equivalentRuns(runs.map((r) => r.checks)) }
    },
    reruns: runs.map((r, i) => ({ state: states[i], checks: r.checks.map((c) => ({ id: c.id, status: c.status })) }))
  }
}

export async function runSuite(opts: RunOptions): Promise<Report> {
  const t0 = performance.now()
  const now = opts.now ?? (() => new Date())
  const reruns = clamp(opts.reruns)
  const canary = `canary-${randomBytes(8).toString('hex')}`
  const redact = makeRedactor([canary])
  const timeoutMs = opts.timeoutMs ?? 5000
  const allowExec = opts.allowStdioExec === true
  const total = opts.cases.length * reruns
  let done = 0
  const progress = (current?: string) => {
    try {
      opts.onProgress?.({ done, total, current })
    } catch {
      /* a progress callback must not break the run */
    }
  }
  const caseInputs: ReportCaseInput[] = []
  const seen = { transport: null as 'stdio' | 'http' | null, protocolVersion: null as string | null, serverInfo: {} as { name?: string; version?: string }, tools: [] as string[] }
  let aborted = false

  for (const sc of opts.cases) {
    const id = sc.def.id
    if (opts.signal?.aborted) {
      aborted = true
      caseInputs.push({ run: { caseId: id, tier: tier(sc), state: 'ERROR', checks: [] }, stateReason: 'run aborted before this case' })
      continue
    }
    progress(id)
    const started = performance.now()
    let workdir: string | undefined
    try {
      const pre = preResolve(sc, opts.subject)
      if (pre) {
        caseInputs.push({ run: { caseId: id, tier: tier(sc), state: pre.state, checks: [] }, stateReason: pre.reason })
        done += reruns
        progress(id)
        continue
      }
      workdir = await mkdtemp(join(tmpdir(), 'mcptest-case-'))
      let prep: PrepareWithStderr
      try {
        prep = await opts.subject.prepare(sc.def, workdir)
      } catch (e) {
        prep = { status: 'GEN_FAILED', error: `prepare threw: ${redact(errText(e))}` }
      }
      const extra = prep.extraChecks ?? []
      const timings = { caseMs: 0, generationMs: prep.generationMs ?? null }
      if (prep.status !== 'PASS') {
        caseInputs.push({
          run: { caseId: id, tier: tier(sc), state: prep.status, checks: extra, thresholds: thresholds(sc) },
          stateReason: prep.error ?? prep.notes ?? prep.status,
          timings
        })
        done += reruns
        progress(id)
        continue
      }
      if (!prep.launch) {
        // Generator-side checks only (no server to talk to).
        const state: CellState = extra.length > 0 ? 'PASS' : 'ERROR'
        caseInputs.push({
          run: { caseId: id, tier: tier(sc), state, checks: extra, thresholds: thresholds(sc) },
          stateReason: extra.length > 0 ? undefined : 'subject returned no launch and no checks',
          timings
        })
        done += reruns
        progress(id)
        continue
      }
      if (prep.launch.kind === 'stdio' && !allowExec) {
        caseInputs.push({
          run: { caseId: id, tier: tier(sc), state: 'PENDING_HUMAN', checks: extra, thresholds: thresholds(sc) },
          stateReason: 'stdio launch is not allowed in this runtime; a human must run it',
          timings
        })
        done += reruns
        progress(id)
        continue
      }
      if (sc.golden.length === 0) {
        // Fail closed (CR-01): a case with no checks measures nothing and must never be scored as a pass.
        caseInputs.push({
          run: { caseId: id, tier: tier(sc), state: 'ERROR', checks: extra, thresholds: thresholds(sc) },
          stateReason: 'case declares no golden checks',
          timings
        })
        done += reruns
        progress(id)
        continue
      }
      const results: CellResult[] = []
      for (let i = 0; i < reruns; i++) {
        if (opts.signal?.aborted) {
          aborted = true
          break
        }
        results.push(await runOnce({ sc, subject: opts.subject, prep, canary, timeoutMs, allowStdioExec: allowExec }))
        done += 1
        progress(id)
      }
      if (results.length === 0) {
        caseInputs.push({ run: { caseId: id, tier: tier(sc), state: 'ERROR', checks: [] }, stateReason: 'run aborted before this case' })
        continue
      }
      done += reruns - results.length
      const agg = aggregate(sc, results)
      const first = results.find((r) => r.protocolVersion)
      if (first && !seen.protocolVersion) {
        seen.protocolVersion = first.protocolVersion ?? null
        seen.serverInfo = first.serverInfo ?? {}
        seen.tools = [...first.allToolNames].sort()
      }
      if (first) seen.transport = seen.transport === 'http' || first.transport === 'http' ? 'http' : 'stdio'
      caseInputs.push({
        run: agg.run,
        reruns: agg.reruns,
        findings: results.flatMap((r) => r.findings).slice(0, 20),
        timings: { caseMs: Math.round(performance.now() - started), generationMs: prep.generationMs ?? null }
      })
    } catch (e) {
      caseInputs.push({ run: { caseId: id, tier: tier(sc), state: 'ERROR', checks: [] }, stateReason: `runner error: ${redact(errText(e))}` })
      done += reruns
    } finally {
      if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {})
    }
  }

  const build: BuildInput = {
    runId: opts.runId ?? `run-${randomBytes(6).toString('hex')}`,
    generatedAt: now().toISOString(),
    runtime: opts.runtime,
    runtimeLabel: RUNTIME_LABEL[opts.runtime],
    platformVersion: opts.platformVersion ?? '0.1.0',
    reruns,
    subject: {
      id: opts.subject.id,
      kind: opts.subject.kind,
      transport: seen.transport,
      protocolVersion: seen.protocolVersion,
      serverInfo: seen.serverInfo,
      toolNames: seen.tools
    },
    cases: caseInputs,
    incomplete: aborted,
    totalMs: Math.round(performance.now() - t0),
    secrets: [canary]
  }
  progress()
  try {
    let report = buildReport(build)
    const fits = (r: Report) => {
      try {
        assertReportSize(r)
        return true
      } catch {
        return false
      }
    }
    // Over the size cap: drop rerun detail and findings and shorten reasons; if that is not enough, also drop the
    // tool names and cap the checks per case. The size is re-checked after each step (WR-11); when nothing fits the
    // assertion below throws into the RUNNER-ERROR fallback, so an oversize report is never returned.
    if (!fits(report)) {
      report = {
        ...report,
        cases: report.cases.map((c) => ({ ...c, reruns: [], findings: [], checks: c.checks.map((k) => ({ ...k, reason: k.reason.slice(0, 60) })) }))
      }
    }
    if (!fits(report)) {
      report = {
        ...report,
        subject: { ...report.subject, toolNames: [] },
        cases: report.cases.map((c) => ({
          ...c,
          stateReason: c.stateReason?.slice(0, 60),
          checks: c.checks.slice(0, 100).map((k) => ({ ...k, reason: '' }))
        }))
      }
    }
    assertReportSize(report)
    return report
  } catch (e) {
    return buildReport({ ...build, cases: [{ run: { caseId: 'RUNNER-ERROR', tier: 1, state: 'ERROR', checks: [] }, stateReason: redact(errText(e)) }], incomplete: true })
  }
}
