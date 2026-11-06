// Report schema (mcptest-report/1), builder and pure renderers. No I/O, no clocks: timestamps live only under
// run.generatedAt and durations only under timings, so everything else is deterministic.
// Core purity: no $lib, svelte or @sveltejs imports.
import { z } from 'zod'
import { majority } from './aggregate'
import { redact, redactName } from './redact'
import { evaluateCase, rollUp, type CaseEval, type CaseRun } from './scoring'
import type { CellState } from './types'

export const REPORT_SCHEMA = 'mcptest-report/1'
export const MAX_REPORT_BYTES = 1_000_000
export const MAX_REASON = 200
/** Bounds for strings the server under test controls (tool names, server name and version, protocol version). */
export const MAX_NAME = 80
export const MAX_TOOL_NAMES = 200

export const CELL_STATES = [
  'PASS',
  'FAIL',
  'NA_MODALITY',
  'SKIPPED_FIXTURE',
  'UNAVAILABLE',
  'INSTALL_FAILED',
  'GEN_FAILED',
  'ERROR',
  'NA_TRANSPORT',
  'PENDING_HUMAN'
] as const satisfies readonly CellState[]

/** One-line meaning of every cell state (used by the legend). */
export const STATE_MEANING: Record<(typeof CELL_STATES)[number], string> = {
  PASS: 'ran and met the case thresholds',
  FAIL: 'ran and did not meet the thresholds',
  NA_MODALITY: 'case does not apply to this subject (input kind or subject kind)',
  SKIPPED_FIXTURE: 'case fixture missing, case skipped',
  UNAVAILABLE: 'subject not available in this runtime',
  INSTALL_FAILED: 'subject could not be installed',
  GEN_FAILED: 'subject generation or preparation failed',
  ERROR: 'scorer problem (unbound or ambiguous binding, internal error), not a server verdict',
  NA_TRANSPORT: 'case needs a transport the subject does not offer',
  PENDING_HUMAN: 'needs a real runtime that this runtime may not execute; a human must run it'
}

const SHORT: Record<string, string> = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  ERROR: 'ERR',
  NA: 'NA',
  NA_MODALITY: 'NA',
  NA_TRANSPORT: 'NA-T',
  SKIPPED_FIXTURE: 'SKIP',
  UNAVAILABLE: 'UNAV',
  INSTALL_FAILED: 'INST',
  GEN_FAILED: 'GEN',
  PENDING_HUMAN: 'PEND'
}

const Reason = z.string().max(MAX_REASON)
const CellStateSchema = z.enum(CELL_STATES)
const Dim = z.enum(['D1', 'D2', 'D3', 'D4', 'D5', 'D6'])
const FlagSchema = z.object({
  id: z.enum(['LEAK', 'SECRET_ECHO', 'WRITE_TOOL', 'CONFIDENT_WRONG', 'NO_RETRY', 'SILENT_GUESS', 'UNVALIDATED_CODE', 'STDOUT_NOISE']),
  severity: z.enum(['blocker', 'warning']),
  detail: Reason
})
const CheckSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.string().min(1).max(60),
  dimension: Dim,
  status: z.enum(['PASS', 'FAIL', 'NA', 'ERROR']),
  boundBy: z.enum(['explicit', 'hint', 'none']),
  reason: Reason
})
const PctSchema = z.object({ passed: z.number(), total: z.number(), pct: z.number() })
const ThresholdSchema = z.object({
  required: z.union([z.number(), z.boolean()]),
  actual: z.union([z.number(), z.boolean(), z.null()]),
  met: z.boolean().nullable()
})

export const ReportSchema = z.object({
  schema: z.literal(REPORT_SCHEMA),
  run: z.object({
    id: z.string().min(1),
    generatedAt: z.string(),
    runtime: z.enum(['fake', 'container', 'local-cli']),
    runtimeLabel: z.string(),
    platformVersion: z.string(),
    reruns: z.number().int().min(1).max(3)
  }),
  subject: z.object({
    id: z.string().min(1),
    kind: z.enum(['fake', 'generator', 'submitted']),
    labelNote: z.string().optional(),
    transport: z.enum(['stdio', 'http']).nullable(),
    // WR-11: these come from the server under test, so they are bounded.
    protocolVersion: z.string().max(MAX_NAME).nullable(),
    serverInfo: z.object({ name: z.string().max(MAX_NAME).optional(), version: z.string().max(MAX_NAME).optional() }),
    toolNames: z.array(z.string().max(MAX_NAME)).max(MAX_TOOL_NAMES)
  }),
  cases: z.array(
    z.object({
      caseId: z.string().min(1),
      tier: z.number().int().min(1).max(4),
      origin: z.enum(['ported', 'native']),
      state: CellStateSchema,
      stateReason: Reason.optional(),
      checks: z.array(CheckSchema),
      dims: z.object({
        D1: z.boolean().nullable(),
        D2: PctSchema.nullable(),
        D3: z.object({ score: z.number().nullable(), max: z.literal(3), basis: z.enum(['advisory', 'manual', 'not_scored']) }),
        D4: PctSchema.nullable(),
        D5: z.object({ basis: z.literal('not_scored') }),
        D6: z.object({
          tokens: z.literal(0),
          cost: z.literal(0),
          llm: z.literal(false),
          reproducibility: z.object({ reruns: z.number(), equivalent: z.boolean() }).nullable()
        })
      }),
      thresholds: z.record(z.string(), ThresholdSchema),
      flags: z.array(FlagSchema),
      findings: z.array(z.object({ kind: z.string().max(60), detail: Reason })),
      reruns: z.array(
        z.object({
          state: CellStateSchema,
          checks: z.array(z.object({ id: z.string(), status: z.enum(['PASS', 'FAIL', 'NA', 'ERROR']) }))
        })
      )
    })
  ),
  summary: z.object({
    gate: z.enum(['pass', 'fail', 'not_run']),
    score: z.object({
      value: z.number().nullable(),
      basis: z.string(),
      casesRun: z.number().int(),
      casesApplicable: z.number().int()
    }),
    flags: z.object({ blockers: z.number().int(), warnings: z.number().int() }),
    verdict: z.enum(['PASS', 'FAIL', 'BLOCKED', 'DISQUALIFIED', 'INCOMPLETE'])
  }),
  pendingHuman: z.array(z.object({ id: z.string(), reason: Reason, command: z.string() })),
  timings: z.object({
    totalMs: z.number(),
    cases: z.record(z.string(), z.object({ caseMs: z.number().nullable(), generationMs: z.number().nullable() }))
  })
})
export type Report = z.infer<typeof ReportSchema>
export type ReportCase = Report['cases'][number]

/** Items a human must run; commands are from the phase research (nothing here is executed by the platform). */
export const PENDING_HUMAN_STATIC: { id: string; reason: string; command: string }[] = [
  {
    id: 'real-fastmcp-run',
    reason: 'A generated Python server must be scored by a person in an unsandboxed shell; CI never executes generated code.',
    command:
      'npm run generate-mcp -- --adapter openapi src/lib/mcpgen/testing/fixtures/acme-openapi.yaml --out /tmp/acme-server ' +
      '&& npm run mcp-test -- --subject cmd:"/tmp/mcp-venv/bin/python /tmp/acme-server/<server-dir>/server.py" --case T2-CATALOG-API --reruns 3 --allow-local-exec --out /tmp/report.json'
  },
  {
    id: 'container-run',
    reason: 'The sandboxed runner image must be built before container runs are possible.',
    command: 'podman build -t localhost/mcp-test-runner:latest -f Containerfile.mcp-test-runner .'
  }
]

export function assertReportSize(report: Report, max: number = MAX_REPORT_BYTES): void {
  const n = Buffer.byteLength(JSON.stringify(report), 'utf8')
  if (n > max) throw new Error(`report is ${n} bytes, over the ${max} byte cap`)
}

export interface ReportCaseInput {
  /** Aggregated run (state = majority of reruns, checks = majority per check id). */
  run: CaseRun
  stateReason?: string
  findings?: { kind: string; detail: string }[]
  reruns?: { state: CellState; checks: { id: string; status: 'PASS' | 'FAIL' | 'NA' | 'ERROR' }[] }[]
  timings?: { caseMs?: number | null; generationMs?: number | null }
  /** Command a human should run when the state is PENDING_HUMAN. */
  pendingCommand?: string
}

export interface BuildInput {
  runId: string
  generatedAt: string
  runtime: 'fake' | 'container' | 'local-cli'
  runtimeLabel: string
  platformVersion: string
  reruns: number
  subject: {
    id: string
    kind: 'fake' | 'generator' | 'submitted'
    transport: 'stdio' | 'http' | null
    protocolVersion?: string | null
    serverInfo?: { name?: string; version?: string }
    toolNames?: string[]
  }
  cases: ReportCaseInput[]
  /** True when the run was aborted: the verdict becomes INCOMPLETE unless a blocker was raised. */
  incomplete?: boolean
  totalMs?: number
  secrets?: string[]
}

const FAKE_NOTE = 'scorer fixture'

function pct(p: { pct: number; passed: number; scored: number } | null) {
  return p ? { passed: p.passed, total: p.scored, pct: Math.round(p.pct * 10) / 10 } : null
}

export function buildReport(input: BuildInput): Report {
  const secrets = input.secrets ?? []
  const clean = (s: string) => redact(s, secrets, MAX_REASON)
  const name = (s: unknown) => redactName(typeof s === 'string' ? s : String(s), secrets, MAX_NAME)
  const evals: CaseEval[] = []
  const cases: ReportCase[] = []
  const timingCases: Report['timings']['cases'] = {}
  const pending: Report['pendingHuman'] = []

  const sorted = [...input.cases].sort((a, b) =>
    a.run.tier !== b.run.tier ? a.run.tier - b.run.tier : a.run.caseId < b.run.caseId ? -1 : a.run.caseId > b.run.caseId ? 1 : 0
  )
  for (const c of sorted) {
    // Durations are reported under timings only.
    const ev = evaluateCase({ ...c.run, caseMs: undefined, generationMs: undefined })
    evals.push(ev)
    timingCases[c.run.caseId] = { caseMs: c.timings?.caseMs ?? null, generationMs: c.timings?.generationMs ?? null }
    const thresholds: ReportCase['thresholds'] = {}
    for (const t of ev.thresholds) thresholds[t.key] = { required: t.required, actual: t.actual, met: t.met }
    cases.push({
      caseId: c.run.caseId,
      tier: c.run.tier,
      origin: 'native',
      state: ev.state,
      ...(c.stateReason ? { stateReason: clean(c.stateReason) } : {}),
      checks: c.run.checks.map((k) => ({
        id: k.id,
        kind: k.kind,
        dimension: k.dimension,
        status: k.status,
        boundBy: k.boundBy,
        reason: clean(k.reason)
      })),
      dims: {
        D1: ev.dims.D1,
        D2: pct(ev.dims.D2),
        D3: ev.dims.D3,
        D4: pct(ev.dims.D4),
        D5: ev.dims.D5,
        D6: { tokens: 0, cost: 0, llm: false, reproducibility: ev.dims.D6.reproducibility }
      },
      thresholds,
      flags: ev.flags.map((f) => ({ id: f.id, severity: f.severity, detail: clean(f.detail) })),
      findings: (c.findings ?? []).slice(0, 20).map((f) => ({ kind: f.kind, detail: clean(f.detail) })),
      reruns: (c.reruns ?? []).map((r) => ({ state: r.state, checks: r.checks }))
    })
    if (ev.state === 'PENDING_HUMAN') {
      pending.push({
        id: c.run.caseId,
        reason: clean(c.stateReason ?? 'needs a real runtime'),
        command: c.pendingCommand ?? PENDING_HUMAN_STATIC[0].command
      })
    }
  }
  const roll = rollUp(evals)
  return {
    schema: REPORT_SCHEMA,
    run: {
      id: input.runId,
      generatedAt: input.generatedAt,
      runtime: input.runtime,
      runtimeLabel: input.runtimeLabel,
      platformVersion: input.platformVersion,
      reruns: Math.min(3, Math.max(1, input.reruns))
    },
    subject: {
      id: input.subject.id,
      kind: input.subject.kind,
      ...(input.subject.kind === 'fake' ? { labelNote: FAKE_NOTE } : {}),
      transport: input.subject.transport,
      protocolVersion: input.subject.protocolVersion == null ? null : name(input.subject.protocolVersion),
      serverInfo: {
        ...(input.subject.serverInfo?.name !== undefined ? { name: name(input.subject.serverInfo.name) } : {}),
        ...(input.subject.serverInfo?.version !== undefined ? { version: name(input.subject.serverInfo.version) } : {})
      },
      toolNames: (input.subject.toolNames ?? []).slice(0, MAX_TOOL_NAMES).map(name)
    },
    cases,
    summary: {
      gate: roll.gate,
      score: roll.score,
      flags: { blockers: roll.flags.blockers, warnings: roll.flags.warnings },
      verdict: input.incomplete && roll.verdict !== 'BLOCKED' ? 'INCOMPLETE' : roll.verdict
    },
    pendingHuman: [...pending, ...PENDING_HUMAN_STATIC],
    timings: { totalMs: input.totalMs ?? 0, cases: timingCases }
  }
}

// ---- renderers ----------------------------------------------------------

/** Majority across reruns (pessimistic ties) per check id; falls back to the aggregated checks. */
function cellStatuses(c: ReportCase): Map<string, string> {
  const out = new Map<string, string>()
  const byId = new Map<string, string[]>()
  for (const r of c.reruns) for (const k of r.checks) byId.set(k.id, [...(byId.get(k.id) ?? []), k.status])
  for (const k of c.checks) out.set(k.id, byId.has(k.id) ? majority(byId.get(k.id) as string[]) : k.status)
  return out
}

function legend(): string[] {
  return CELL_STATES.map((s) => `${SHORT[s]} (${s}): ${STATE_MEANING[s]}`)
}

export function renderMatrix(report: Report, format: 'text' | 'markdown'): string {
  const cols: string[] = []
  for (const c of report.cases) for (const k of c.checks) if (!cols.includes(k.id)) cols.push(k.id)
  const label = (i: number) => (format === 'text' ? `c${String(i + 1).padStart(2, '0')}` : cols[i])
  const rows = report.cases.map((c) => {
    const st = cellStatuses(c)
    const ran = c.state === 'PASS' || c.state === 'FAIL' || c.state === 'ERROR'
    const cells = cols.map((id) => {
      if (!ran && !st.has(id)) return SHORT[c.state] ?? c.state
      return st.has(id) ? (SHORT[st.get(id) as string] ?? String(st.get(id))) : '-'
    })
    return { name: c.caseId, state: SHORT[c.state] ?? c.state, cells }
  })
  const lines: string[] = []
  if (format === 'markdown') {
    lines.push(`| case | state | ${cols.join(' | ')} |`)
    lines.push(`| --- | --- | ${cols.map(() => '---').join(' | ')} |`)
    for (const r of rows) lines.push(`| ${r.name} | ${r.state} | ${r.cells.join(' | ')} |`)
    lines.push('', '**Legend**', '')
    for (const l of legend()) lines.push(`- ${l}`)
    lines.push('- NA: check not applicable; -: check not part of this case')
  } else {
    const w = Math.max(4, ...rows.map((r) => r.name.length))
    lines.push(`${'case'.padEnd(w)}  state  ${cols.map((_, i) => label(i).padEnd(4)).join(' ')}`)
    for (const r of rows) lines.push(`${r.name.padEnd(w)}  ${r.state.padEnd(5)}  ${r.cells.map((x) => x.padEnd(4)).join(' ')}`)
    lines.push('', 'Columns:')
    cols.forEach((id, i) => lines.push(`  ${label(i)} = ${id}`))
    lines.push('', 'Legend:')
    for (const l of legend()) lines.push(`  ${l}`)
    lines.push('  NA: check not applicable; -: check not part of this case')
  }
  return lines.join('\n')
}

export function renderSummary(report: Report, format: 'text' | 'markdown' = 'text'): string {
  const md = format === 'markdown'
  const h = (s: string) => (md ? `## ${s}` : s.toUpperCase())
  const b = (s: string) => (md ? `- ${s}` : `  ${s}`)
  const out: string[] = []
  const s = report.summary
  out.push(h(`Verdict: ${s.verdict}`))
  const flags = report.cases.flatMap((c) => c.flags.map((f) => ({ ...f, caseId: c.caseId })))
  const blockers = flags.filter((f) => f.severity === 'blocker')
  const warnings = flags.filter((f) => f.severity === 'warning')
  if (blockers.length) {
    out.push('Blockers:')
    for (const f of blockers) out.push(b(`${f.id} in ${f.caseId}: ${f.detail}`))
  }
  if (warnings.length) {
    out.push('Warnings:')
    for (const f of warnings) out.push(b(`${f.id} in ${f.caseId}: ${f.detail}`))
  }
  if (!flags.length) out.push('No risk flags raised.')
  out.push('')
  out.push(`Gate (Tier 1): ${s.gate}`)
  out.push(`Score: ${s.score.value === null ? 'none' : s.score.value} (coverage ${s.score.casesRun}/${s.score.casesApplicable} cases ran)`)
  out.push(`Basis: ${s.score.basis}`)
  out.push('D6: tokens 0, cost 0, llm false; human interventions not applicable.')
  if (report.subject.kind === 'fake') {
    out.push('')
    out.push(`Note: subject ${report.subject.id} is a ${FAKE_NOTE} of the platform's own scorer, not a generator score and not a tested real server.`)
  }
  return out.join('\n')
}

/** Legacy 10-check CSV row (arm,timestamp,n_tools,tool_names,<10 check ids>,total_passed) from the T2-CATALOG-API case. */
export const LEGACY_CHECKS = [
  'lookup_by_id',
  'lookup_by_alt_key',
  'partition_filter',
  'derived_filter',
  'projection',
  'pagesize_clamp',
  'pagination_ceiling',
  'bad_input',
  'empty_vs_error',
  'auth_fail'
] as const

export function toLegacyCsvRow(report: Report): string {
  const c = report.cases.find((x) => x.caseId === 'T2-CATALOG-API')
  const st = c ? cellStatuses(c) : new Map<string, string>()
  const cell = (id: string) => {
    const v = st.get(id)
    return v === 'PASS' ? '1' : v === 'FAIL' ? '0' : 'NA'
  }
  const vals = LEGACY_CHECKS.map(cell)
  const total = vals.filter((v) => v === '1').length
  // IN-03: server-controlled text must not become a spreadsheet formula (leading = + - @ tab or CR is neutralised).
  const esc = (raw: string) => {
    const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }
  return [
    esc(report.subject.id),
    report.run.generatedAt,
    String(report.subject.toolNames.length),
    esc(report.subject.toolNames.join(';')),
    ...vals,
    String(total)
  ].join(',')
}
