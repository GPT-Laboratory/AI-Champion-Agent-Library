// Server-only. Executes one stored run. Default: in-process fake subjects and generator-side checks only
// (a generated Python server is NEVER executed in the web process; its server-side cells are PENDING_HUMAN).
// MCP_TESTER_RUNTIME=container (set by the operator, never by an agent) selects the Phase 8 container path.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import type { StartRunRequest } from '$lib/mcptest/api-contract'
import { loadSuite, type SuiteCase } from '$lib/mcptest/core/suite'
import { runSuite } from '$lib/mcptest/core/runner'
import { listSubjects, resolveSubject } from '$lib/mcptest/core/subjects'
import { DRIVER_PKG_ROOT, KNOWN_CASE_IDS, type DriverRequest } from '$lib/mcptest/driverRequest'
import { createClientLimiter, type ClientLimiter } from '../tryitout/clientLimit'
import { publicErrorMessage, publicText } from '../tryitout/redact'
import type { ContainerRuntime, StagedFile } from '../tryitout/runtime'
import { mcpTestRunnerConfig, runInContainer, type PackageFile } from './containerRun'
import { runStore, type RunStore } from './jobs'

export type RuntimeFactory = () => ContainerRuntime | Promise<ContainerRuntime>
export type Executor = (runId: string, input: StartRunRequest) => Promise<void>

export interface ServiceDeps {
  store?: RunStore
  env?: Record<string, string | undefined>
  runtimeFactory?: RuntimeFactory
  driverTree?: StagedFile[]
  /** Time allowed after the soft deadline before the run is failed whatever the work is doing (tests). Default 10 s. */
  hardGraceMs?: number
}

/** Used when MCPTEST_JOB_TIMEOUT_MS is unset or invalid (the runner config default). */
export const DEFAULT_JOB_TIMEOUT_MS = 300_000
export const HARD_GRACE_MS = 10_000

/** Overall wall-clock budget of one run (WR-08): MCPTEST_JOB_TIMEOUT_MS, parsed and bounded by the runner config. */
export function jobTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  try {
    return mcpTestRunnerConfig(env).jobTimeoutMs
  } catch {
    return DEFAULT_JOB_TIMEOUT_MS
  }
}

/** Subjects the web API accepts: fake variants and generator samples only (no uploads, no cmd:). */
export function allowedSubjectIds(): string[] {
  return listSubjects()
    .filter((s) => s.kind === 'fake' || s.kind === 'generator')
    .map((s) => s.id)
}

export function isAllowedSubject(id: unknown): id is string {
  return typeof id === 'string' && allowedSubjectIds().includes(id)
}

export function isKnownCase(id: unknown): id is string {
  return typeof id === 'string' && (KNOWN_CASE_IDS as readonly string[]).includes(id)
}

export function containerModeSelected(env: Record<string, string | undefined> = process.env): boolean {
  return env.MCP_TESTER_RUNTIME?.trim().toLowerCase() === 'container'
}

const defaultRuntimeFactory: RuntimeFactory = async () => {
  const { createDockerodeRuntime } = await import('../tryitout/runtimeDockerode')
  return createDockerodeRuntime(mcpTestRunnerConfig(process.env), 'mcptest')
}

async function readPackage(dir: string): Promise<PackageFile[]> {
  const out: PackageFile[] = []
  const walk = async (abs: string): Promise<void> => {
    for (const ent of await readdir(abs, { withFileTypes: true })) {
      const p = join(abs, ent.name)
      if (ent.isSymbolicLink()) continue
      if (ent.isDirectory()) await walk(p)
      else if (ent.isFile()) out.push({ path: relative(dir, p).split(sep).join('/'), content: await readFile(p, 'utf8') })
    }
  }
  await walk(dir)
  return out
}

type Staged = Extract<DriverRequest['subject'], { kind: 'staged' }>

/** Generates the package in a temp dir (pure, in process; nothing is executed) and builds the staged subject. */
async function prepareGeneratorRequest(
  subjectId: string,
  suiteCases: SuiteCase[]
): Promise<{ subject: Staged; files: PackageFile[] } | { error: string }> {
  const subject = resolveSubject(subjectId)
  const probe = suiteCases.find((c) => c.def.id === 'T2-CATALOG-API')
  if (!subject || !probe) return { error: 'generator subject could not be resolved' }
  const work = await mkdtemp(join(tmpdir(), 'mcptest-pkg-'))
  try {
    const prep = await subject.prepare(probe.def, work)
    if (prep.status !== 'PASS' || !prep.launch || prep.launch.kind !== 'stdio') return { error: 'the generator did not produce a package' }
    const files = await readPackage(join(work, 'pkg'))
    const cwdRel = relative(join(work, 'pkg'), prep.launch.cwd ?? join(work, 'pkg')).split(sep).join('/')
    const staged: Staged = {
      kind: 'staged',
      command: prep.launch.command === 'node' ? 'node' : 'python3',
      args: prep.launch.args,
      cwd: cwdRel ? `${DRIVER_PKG_ROOT}/${cwdRel}` : DRIVER_PKG_ROOT,
      id: subjectId,
      ...(prep.binding ? { binding: prep.binding } : {}),
      ...(prep.envNames
        ? {
            envNames: {
              ...(prep.envNames.baseUrl ? { baseUrl: prep.envNames.baseUrl } : {}),
              ...(prep.envNames.apiKey ? { apiKey: prep.envNames.apiKey } : {}),
              ...(prep.envNames.baseUrlB ? { baseUrlB: prep.envNames.baseUrlB } : {})
            }
          }
        : {})
    }
    return { subject: staged, files }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Runs one stored run under an overall deadline (WR-03, WR-08). At the budget the run's AbortSignal fires (the host
 * runner stops between cases and the report becomes INCOMPLETE); if the work still has not returned after a short
 * grace the run is failed anyway, so a hung run cannot hold the single-flight slot.
 */
export async function executeRun(runId: string, input: StartRunRequest, deps: ServiceDeps = {}): Promise<void> {
  const store = deps.store ?? runStore
  const env = deps.env ?? process.env
  const budget = jobTimeoutMs(env)
  const ac = new AbortController()
  let soft: ReturnType<typeof setTimeout> | undefined
  let hard: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<'expired'>((resolve) => {
    soft = setTimeout(() => ac.abort(), budget)
    hard = setTimeout(() => resolve('expired'), budget + (deps.hardGraceMs ?? HARD_GRACE_MS))
    soft.unref?.()
    hard.unref?.()
  })
  // After the hard deadline the run is failed for good: late writes from the abandoned work are dropped.
  let abandoned = false
  const guarded: RunStore = {
    ...store,
    setStatus: (...a) => (abandoned ? undefined : store.setStatus(...a)),
    setProgress: (...a) => (abandoned ? undefined : store.setProgress(...a)),
    addEvent: (...a) => (abandoned ? undefined : store.addEvent(...a)),
    setReport: (...a) => (abandoned ? undefined : store.setReport(...a))
  }
  try {
    const outcome = await Promise.race([runBody(runId, input, deps, guarded, env, ac.signal, budget).then(() => 'done' as const), expired])
    if (outcome === 'expired') {
      abandoned = true
      ac.abort()
      store.setStatus(runId, 'failed', 'the run exceeded its time limit')
    }
  } finally {
    clearTimeout(soft)
    clearTimeout(hard)
  }
}

async function runBody(
  runId: string,
  input: StartRunRequest,
  deps: ServiceDeps,
  store: RunStore,
  env: Record<string, string | undefined>,
  signal: AbortSignal,
  budgetMs: number
): Promise<void> {
  const fail = (msg: string) => store.setStatus(runId, 'failed', msg)
  try {
    store.setStatus(runId, 'running')
    const suite = await loadSuite()
    if (!suite.ok) return fail('the test suite could not be loaded')
    const wanted = input.cases
    const cases = wanted ? suite.cases.filter((c) => wanted.includes(c.def.id)) : suite.cases
    if (cases.length === 0) return fail('no matching cases')
    const reruns = input.reruns ?? 1
    store.setProgress(runId, { done: 0, total: cases.length * reruns })
    store.addEvent(runId, `run started: ${input.subject}, ${cases.length} case(s), ${reruns} rerun(s)`)

    if (containerModeSelected(env)) {
      store.addEvent(runId, 'runtime: container (sandboxed)')
      let request: DriverRequest
      let files: PackageFile[] = []
      if (input.subject.startsWith('fake:')) {
        request = { v: 1, subject: { kind: 'fake', variant: input.subject.slice('fake:'.length) }, reruns: reruns as 1 | 2 | 3 }
        if (wanted) request.cases = cases.map((c) => c.def.id as (typeof KNOWN_CASE_IDS)[number])
      } else {
        // The package is generated once from the primary sample; the partial-spec case needs its own input.
        const kept = cases.filter((c) => c.def.id !== 'T4-PARTIAL-SPEC')
        if (kept.length === 0) return fail('this case is not available in container mode')
        const prepared = await prepareGeneratorRequest(input.subject, suite.cases)
        if ('error' in prepared) return fail(prepared.error)
        files = prepared.files
        request = {
          v: 1,
          subject: prepared.subject,
          cases: kept.map((c) => c.def.id as (typeof KNOWN_CASE_IDS)[number]),
          reruns: reruns as 1 | 2 | 3
        }
      }
      const runtime = await (deps.runtimeFactory ?? defaultRuntimeFactory)()
      // The container has its own timeout (the configured budget); the exec is cancelled when it fires.
      const res = await runInContainer(runtime, request, files, {
        timeoutMs: budgetMs,
        ...(deps.driverTree ? { driverTree: deps.driverTree } : {})
      })
      if (!res.ok) return fail(res.message)
      store.setProgress(runId, { done: cases.length * reruns, total: cases.length * reruns })
      store.setReport(runId, res.reportJson)
      store.addEvent(runId, 'run finished')
      return
    }

    const subject = resolveSubject(input.subject)
    if (!subject) return fail('unknown subject')
    let last = ''
    const report = await runSuite({
      subject,
      cases,
      reruns,
      runtime: 'fake',
      // Never true here: a generated server is not executed in the web process.
      allowStdioExec: false,
      signal,
      onProgress: (p) => {
        store.setProgress(runId, { done: p.done, total: p.total, current: p.current ?? null })
        if (p.current && p.current !== last) {
          last = p.current
          store.addEvent(runId, `case ${p.current}`)
        }
      }
    })
    store.setReport(runId, JSON.stringify(report))
    if (store.getRun(runId)?.status === 'done') store.addEvent(runId, 'run finished')
  } catch (err) {
    store.setStatus(runId, 'failed', publicText(publicErrorMessage(err)))
  }
}

let executor: Executor = (id, input) => executeRun(id, input)

/** Test hook: replace the executor (null restores the default). */
export function __setExecutorForTests(fn: Executor | null): void {
  executor = fn ?? ((id, input) => executeRun(id, input))
}

/** Fire-and-forget: never awaited by the caller; failures are recorded on the run. */
export function startRun(runId: string, input: StartRunRequest, store: RunStore = runStore): void {
  void Promise.resolve()
    .then(() => executor(runId, input))
    .catch((err) => store.setStatus(runId, 'failed', publicText(publicErrorMessage(err))))
}

export const STARTS_PER_CLIENT = 10
export const START_WINDOW_MS = 10 * 60 * 1000
let startLimiter: ClientLimiter = createClientLimiter({ max: STARTS_PER_CLIENT, windowMs: START_WINDOW_MS })

/** Per-client start limiter (sliding window); records the admission when it returns true. */
export function admitStart(clientKey: string | undefined): boolean {
  return startLimiter.tryAdmit(clientKey ?? 'unknown')
}

/** Test hook: restore a fresh limiter, optionally with another cap. */
export function __resetStartLimiterForTests(max: number = STARTS_PER_CLIENT): void {
  startLimiter = createClientLimiter({ max, windowMs: START_WINDOW_MS })
}
