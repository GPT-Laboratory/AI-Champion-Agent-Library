// Stage 2 of the proposal layer (D-593): score the deterministic baseline package and the proposal-assisted
// package through the Phase 15 runner and compare. Lives outside core/ and mcpgen/, so it may import both.
// No model call, no network, and generated Python is never executed: stdio launches are not allowed
// here, so real-server cells stay PENDING_HUMAN exactly as in `npm run mcp-test`. What IS scored is
// everything the generator subject measures before a server runs (the generator-side checks), plus two
// checks added for proposals: the emitted binding still resolves against the emitted tools, and the
// emitted server keeps the code invariants (no URL, no secret, no raw exception text, no dynamic code).
import { BindingSchema } from './core/bindingSchema'
import { runSuite } from './core/runner'
import type { Report } from './core/report'
import { ReportSchema } from './core/report'
import { loadSuite, type SuiteCase } from './core/suite'
import type { RunnableSubject } from './core/subjects'
import type { CheckResult, PrepareResult } from './core/types'
import { generatorSubjects } from './generatorSubject'
import { BINDING_FILE } from '../mcpgen/binding'
import { runPipeline } from '../mcpgen/pipeline'
import { prepareInput } from '../mcpgen/registry'
import type { GenerateOptions } from '../mcpgen/types'

export const DEFAULT_MAX_SCORE_DROP = 0

/** Python imports a generated server may contain (the baseline emitter's own set). */
const ALLOWED_IMPORTS = new Set(['math', 'os', 'json', 'time', 'urllib.parse', 'csv', 'pathlib', 'sqlite3', 'httpx', 're', 'datetime'])
const cap = (s: string, n = 200) => (s.length > n ? s.slice(0, n) : s)

export interface PipelineArgs {
  input: string
  filename: string
  adapterId?: string
  options?: GenerateOptions
}

/** Code invariants of a generated server.py (text checks; nothing is executed). Reasons carry no input text. */
export function serverInvariantProblems(server: string): string[] {
  const out: string[] = []
  const code = server.split('\n').filter((l) => !l.trim().startsWith('#'))
  if (code.some((l) => /https?:\/\//.test(l))) out.push('URL literal in code')
  if (/os\.environ\[/.test(server)) out.push('os.environ indexing')
  if (/\bstr\((?:e|ex|exc|err|error)\)/.test(server) || server.includes('Traceback')) out.push('raw exception text')
  for (const re of [/\beval\(/, /\bexec\(/, /__import__/, /\bgetattr\(/, /(?<![\w.])compile\(/, /\bsubprocess\b/, /\bpickle\b/, /\bsetattr\(/]) {
    if (re.test(code.join('\n'))) out.push(`dynamic code (${re.source})`)
  }
  for (const l of code) {
    const m = /^(?:import ([\w.]+)|from ([\w.]+) import )/.exec(l)
    const mod = m?.[1] ?? m?.[2]
    if (mod && !ALLOWED_IMPORTS.has(mod) && mod !== 'typing' && mod !== 'fastmcp') out.push('unexpected import')
  }
  return [...new Set(out)]
}

/** Def line parameter names by function name, from the emitted server text. */
function defParams(server: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const m of server.matchAll(/^def (\w+)\((.*)\) -> dict:$/gm)) {
    out.set(
      m[1],
      m[2]
        .split(/,\s*(?![^\[]*\])/)
        .map((p) => p.trim().split(':')[0].trim())
        .filter(Boolean),
    )
  }
  return out
}

function res(id: string, status: CheckResult['status'], reason: string): CheckResult {
  return { id, kind: 'generator_side', dimension: 'D1', status, boundBy: 'none', reason: cap(reason) }
}

/** Binding and invariant checks over the emitted files of one pipeline run. Pure. */
export function packageChecks(files: { path: string; content: string }[], toolsEmitted: string[]): CheckResult[] {
  const server = files.find((f) => f.path === 'server.py')?.content ?? ''
  const bindingText = files.find((f) => f.path === BINDING_FILE)?.content ?? ''
  const checks: CheckResult[] = []
  // binding_resolves
  let binding: ReturnType<typeof BindingSchema.safeParse> | undefined
  try {
    binding = BindingSchema.safeParse(JSON.parse(bindingText))
  } catch {
    binding = undefined
  }
  if (!binding || !binding.success) checks.push(res('binding_resolves', 'FAIL', 'mcptest-binding.json is missing or off-schema'))
  else {
    const params = defParams(server)
    const problems: string[] = []
    for (const [key, e] of Object.entries(binding.data)) {
      if (!toolsEmitted.includes(e.tool)) problems.push(`${key}: unknown tool`)
      for (const to of Object.values(e.argMap ?? {})) if (!(params.get(e.tool) ?? []).includes(to)) problems.push(`${key}: argMap target not an argument`)
    }
    checks.push(problems.length === 0 ? res('binding_resolves', 'PASS', `every binding entry names an emitted tool and real arguments (${Object.keys(binding.data).length} entries)`) : res('binding_resolves', 'FAIL', problems.slice(0, 3).join('; ')))
  }
  // invariants_hold
  const bad = serverInvariantProblems(server)
  checks.push(bad.length === 0 ? res('invariants_hold', 'PASS', 'no URL, secret, raw exception text or dynamic code in the emitted server') : res('invariants_hold', 'FAIL', bad.join('; ')))
  return checks
}

/** A generator subject over the caller's input; the T1 case gets the package checks appended. */
export function proposalGeneratorSubject(label: string, args: PipelineArgs, proposals?: { text: string; lenient?: boolean }): RunnableSubject {
  const pipe = ((text: string, o: Parameters<typeof runPipeline>[1] = {}) =>
    runPipeline(text, { ...o, adapterId: args.adapterId, options: args.options, ...(proposals ? { proposals } : {}) })) as typeof runPipeline
  const [inner] = generatorSubjects({ runPipelineFn: pipe, samples: [{ id: 'custom', file: '', filename: args.filename, text: args.input }] })
  return {
    ...inner,
    id: `generator:custom:${label}`,
    async prepare(c, workdir): Promise<PrepareResult> {
      const p = await inner.prepare(c, workdir)
      if (p.status !== 'PASS' || c.id !== 'T1-STD-CATALOG') return p
      const r = pipe(args.input, { filename: args.filename })
      if (!r.ok) return p
      return { ...p, extraChecks: [...(p.extraChecks ?? []), ...packageChecks(r.files, r.report.toolsEmitted)] }
    },
  } as RunnableSubject
}

// ---- comparison ----

export interface Side {
  label: string
  report: Report
  /** The Tier 1 case's generator-side checks all passed (null: none ran). */
  genGate: boolean | null
  /** Percent of generator-side checks that passed, over all cases (null: none ran). */
  genRate: number | null
}

export interface CheckDelta {
  caseId: string
  check: string
  baseline: string
  proposed: string
}

export interface Comparison {
  baseline: Side
  proposed: Side
  deltas: CheckDelta[]
  regressions: string[]
  maxScoreDrop: number
}

function side(label: string, report: Report): Side {
  const t1 = report.cases.filter((c) => c.tier === 1).flatMap((c) => c.checks.filter((k) => k.kind === 'generator_side' && k.status !== 'NA'))
  const all = report.cases.flatMap((c) => c.checks.filter((k) => k.kind === 'generator_side' && k.status !== 'NA'))
  return {
    label,
    report,
    genGate: t1.length === 0 ? null : t1.every((k) => k.status === 'PASS'),
    genRate: all.length === 0 ? null : Math.round((all.filter((k) => k.status === 'PASS').length / all.length) * 1000) / 10,
  }
}

export function compareReports(base: Report, prop: Report, maxScoreDrop = DEFAULT_MAX_SCORE_DROP, labels: [string, string] = ['baseline', 'proposed']): Comparison {
  const b = side(labels[0], base)
  const p = side(labels[1], prop)
  const deltas: CheckDelta[] = []
  const ids = [...new Set([...base.cases, ...prop.cases].map((c) => c.caseId))].sort()
  for (const id of ids) {
    const bc = base.cases.find((c) => c.caseId === id)
    const pc = prop.cases.find((c) => c.caseId === id)
    const checks = [...new Set([...(bc?.checks ?? []), ...(pc?.checks ?? [])].map((k) => k.id))].sort()
    for (const k of checks) {
      const bs = bc?.checks.find((x) => x.id === k)?.status ?? '-'
      const ps = pc?.checks.find((x) => x.id === k)?.status ?? '-'
      if (bs !== ps) deltas.push({ caseId: id, check: k, baseline: bs, proposed: ps })
    }
    if (bc && pc && bc.state !== pc.state) deltas.push({ caseId: id, check: '(case state)', baseline: bc.state, proposed: pc.state })
  }
  const regressions: string[] = []
  if (base.summary.gate === 'pass' && prop.summary.gate !== 'pass') regressions.push(`Tier 1 gate: ${base.summary.gate} -> ${prop.summary.gate}`)
  if (b.genGate === true && p.genGate !== true) regressions.push(`Tier 1 generator-side gate: pass -> ${p.genGate === null ? 'not run' : 'fail'}`)
  const bs = base.summary.score.value
  const ps = prop.summary.score.value
  if (bs !== null && (ps === null || ps < bs - maxScoreDrop)) regressions.push(`headline score: ${bs} -> ${ps === null ? 'not scored' : ps} (allowed drop ${maxScoreDrop})`)
  if (b.genRate !== null && (p.genRate === null || p.genRate < b.genRate - maxScoreDrop)) regressions.push(`generator-side pass rate: ${b.genRate}% -> ${p.genRate === null ? 'none' : `${p.genRate}%`} (allowed drop ${maxScoreDrop})`)
  if (prop.summary.flags.blockers > base.summary.flags.blockers) regressions.push(`blocker flags: ${base.summary.flags.blockers} -> ${prop.summary.flags.blockers}`)
  return { baseline: b, proposed: p, deltas, regressions, maxScoreDrop }
}

const fmt = (v: unknown) => (v === null || v === undefined ? 'n/a' : String(v))

export function renderComparison(c: Comparison, format: 'text' | 'markdown' = 'text'): string {
  const rows: [string, string, string][] = [
    ['Tier 1 gate (runner)', c.baseline.report.summary.gate, c.proposed.report.summary.gate],
    ['Tier 1 generator-side gate', fmt(c.baseline.genGate === null ? null : c.baseline.genGate ? 'pass' : 'fail'), fmt(c.proposed.genGate === null ? null : c.proposed.genGate ? 'pass' : 'fail')],
    ['Headline score (runner)', fmt(c.baseline.report.summary.score.value), fmt(c.proposed.report.summary.score.value)],
    ['Generator-side pass rate %', fmt(c.baseline.genRate), fmt(c.proposed.genRate)],
    ['Blocker flags', fmt(c.baseline.report.summary.flags.blockers), fmt(c.proposed.report.summary.flags.blockers)],
    ['Warnings', fmt(c.baseline.report.summary.flags.warnings), fmt(c.proposed.report.summary.flags.warnings)],
    ['Verdict', c.baseline.report.summary.verdict, c.proposed.report.summary.verdict],
  ]
  const md = format === 'markdown'
  const out: string[] = []
  const line = (cells: string[]) => (md ? `| ${cells.join(' | ')} |` : cells.map((x, i) => (i === 0 ? x.padEnd(30) : x.padEnd(16))).join(' ').trimEnd())
  out.push(line(['', c.baseline.label, c.proposed.label]))
  if (md) out.push('| --- | --- | --- |')
  for (const r of rows) out.push(line(r))
  out.push('')
  out.push(c.deltas.length === 0 ? 'Per-check deltas: none (every check has the same result in both runs).' : 'Per-check deltas:')
  for (const d of c.deltas) out.push(md ? `- ${d.caseId} / ${d.check}: ${d.baseline} -> ${d.proposed}` : `  ${d.caseId} / ${d.check}: ${d.baseline} -> ${d.proposed}`)
  out.push('')
  out.push('Real-server cells stay PENDING_HUMAN: the generated Python is never executed here. Run the written packages with `npm run mcp-test -- --subject cmd:"python3 <dir>/server.py" --allow-local-exec` on a machine you control.')
  out.push('')
  out.push(c.regressions.length === 0 ? 'Result: no regression.' : `Result: REGRESSION\n${c.regressions.map((r) => `  - ${r}`).join('\n')}`)
  return out.join('\n') + '\n'
}

// ---- running ----

export interface PairOptions {
  reruns?: number
  maxScoreDrop?: number
  cases?: SuiteCase[]
  now?: () => Date
  labels?: [string, string]
}

/** Run two subjects through the runner and compare them. Subject-agnostic, so tests can use fake subjects. */
export async function runPair(baseline: RunnableSubject, proposed: RunnableSubject, o: PairOptions = {}): Promise<Comparison> {
  let cases = o.cases
  if (!cases) {
    const suite = await loadSuite()
    if (!suite.ok) throw new Error('The test suite failed to load.')
    cases = suite.cases
  }
  const run = async (subject: RunnableSubject): Promise<Report> =>
    ReportSchema.parse(await runSuite({ subject, cases: cases!, reruns: o.reruns ?? 1, runtime: subject.kind === 'fake' ? 'fake' : 'local-cli', allowStdioExec: false, now: o.now }))
  const [b, p] = [await run(baseline), await run(proposed)]
  return compareReports(b, p, o.maxScoreDrop ?? DEFAULT_MAX_SCORE_DROP, o.labels)
}

export interface ProposalEvalInput extends PipelineArgs {
  proposalsText: string
  lenient?: boolean
}
export type ProposalEvalResult = { kind: 'compared'; comparison: Comparison } | { kind: 'rejected'; gaps: { code: string; message: string }[] } | { kind: 'baseline-failed'; gaps: { code: string; message: string }[] }

export async function evaluateProposalEffect(i: ProposalEvalInput, o: PairOptions = {}): Promise<ProposalEvalResult> {
  // Load the on-demand parsers (the OData XML reader) before the synchronous pipeline runs (CR-20, CR-32).
  await prepareInput({ text: i.input, filename: i.filename }, { adapterId: i.adapterId })
  const base = runPipeline(i.input, { filename: i.filename, adapterId: i.adapterId, options: i.options })
  if (!base.ok) return { kind: 'baseline-failed', gaps: base.gaps.map((g) => ({ code: g.code, message: g.message })) }
  const prop = runPipeline(i.input, { filename: i.filename, adapterId: i.adapterId, options: i.options, proposals: { text: i.proposalsText, lenient: i.lenient } })
  if (!prop.ok) return { kind: 'rejected', gaps: prop.gaps.map((g) => ({ code: g.code, message: g.message })) }
  const comparison = await runPair(proposalGeneratorSubject('baseline', i), proposalGeneratorSubject('proposed', i, { text: i.proposalsText, lenient: i.lenient }), { ...o, labels: ['baseline', 'proposed'] })
  return { kind: 'compared', comparison }
}
