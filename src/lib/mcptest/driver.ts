// In-container driver (plan 15-10): reads <in>/request.json, validates it, runs the suite and writes
// <out>/report.json. Runs under tsx inside the sandboxed runner image; the container is the isolation,
// so stdio launches are allowed here. It never throws and reads no env other than MCPTEST_IN,
// MCPTEST_OUT and MCPTEST_PKG_ROOT. Relative imports only.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPackageBinding } from './core/packageBinding'
import { loadSuite } from './core/suite'
import { buildReport, MAX_REPORT_BYTES, type Report } from './core/report'
import { runSuite } from './core/runner'
import { fakeSubject, type PrepareWithStderr, type RunnableSubject } from './core/subjects'
import { DRIVER_PKG_ROOT, DRIVER_REQUEST_MAX_BYTES, DriverRequestSchema, type DriverRequest } from './driverRequest'

export interface DriverIo {
  inDir: string
  outDir: string
  /** Where /work/pkg lives (default /work/pkg). */
  pkgRoot: string
}

type Staged = Extract<DriverRequest['subject'], { kind: 'staged' }>

function stagedSubject(s: Staged, pkgRoot: string): RunnableSubject {
  const cwd = s.cwd === DRIVER_PKG_ROOT ? pkgRoot : join(pkgRoot, s.cwd.slice(DRIVER_PKG_ROOT.length + 1))
  return {
    id: s.id,
    kind: s.id.startsWith('generator:') ? 'generator' : 'submitted',
    modality: 'any',
    llm: false,
    networkPolicy: 'container, no network beyond the loopback mock',
    status: 'installed',
    transports: ['stdio'],
    async prepare(): Promise<PrepareWithStderr> {
      // E10 D3: the package's own mcptest-binding.json; a binding in the request wins per key.
      const fromPkg = await loadPackageBinding(join(cwd, dirname(s.args[0])))
      const binding = fromPkg || s.binding ? { ...(fromPkg ?? {}), ...(s.binding ?? {}) } : undefined
      return {
        status: 'PASS',
        launch: { kind: 'stdio', command: s.command, args: s.args, cwd },
        ...(binding ? { binding } : {}),
        ...(s.envNames ? { envNames: s.envNames } : {})
      }
    }
  }
}

function errorReport(message: string): Report {
  return buildReport({
    runId: 'driver-error',
    generatedAt: new Date().toISOString(),
    runtime: 'container',
    runtimeLabel: 'container runtime (sandboxed)',
    platformVersion: '0.1.0',
    reruns: 1,
    subject: { id: 'unknown', kind: 'submitted', transport: null, protocolVersion: null, serverInfo: {}, toolNames: [] },
    cases: [{ run: { caseId: 'DRIVER-ERROR', tier: 1, state: 'ERROR', checks: [] }, stateReason: message.slice(0, 150) }],
    incomplete: true,
    totalMs: 0,
    secrets: []
  })
}

async function writeError(outDir: string, error: string): Promise<void> {
  try {
    await mkdir(outDir, { recursive: true })
    await writeFile(join(outDir, 'error.json'), JSON.stringify({ error: error.slice(0, 200) }), 'utf8')
  } catch {
    /* nothing more can be done */
  }
}

/** Returns 0 when a report was written (whatever its verdict), 1 for an invalid request. Never throws. */
export async function runDriver(io: DriverIo): Promise<number> {
  let req: DriverRequest
  try {
    const buf = await readFile(join(io.inDir, 'request.json'))
    if (buf.length > DRIVER_REQUEST_MAX_BYTES) {
      await writeError(io.outDir, 'request too large')
      return 1
    }
    const parsed = DriverRequestSchema.safeParse(JSON.parse(buf.toString('utf8')))
    if (!parsed.success) {
      const i = parsed.error.issues[0]
      await writeError(io.outDir, `invalid request: ${i ? `${i.path.join('.')}: ${i.message}` : 'schema'}`)
      return 1
    }
    req = parsed.data
  } catch (e) {
    await writeError(io.outDir, `unreadable request: ${e instanceof Error ? e.message : 'error'}`)
    return 1
  }

  let report: Report
  try {
    const suite = await loadSuite()
    // Fail closed (CR-01): a missing golden.jsonl or fixture makes the suite fail to load; nothing is scored.
    if (!suite.ok) throw new Error(`suite failed to load: ${suite.errors[0] ?? 'unknown error'}`.slice(0, 150))
    const wanted = req.cases
    const cases = wanted ? suite.cases.filter((c) => wanted.includes(c.def.id as never)) : suite.cases
    let subject: RunnableSubject
    if (req.subject.kind === 'fake') {
      subject = fakeSubject(req.subject.variant)
    } else {
      subject = stagedSubject(req.subject, io.pkgRoot)
    }
    report = await runSuite({ subject, cases, reruns: req.reruns, runtime: 'container', allowStdioExec: true })
    if (Buffer.byteLength(JSON.stringify(report), 'utf8') > MAX_REPORT_BYTES) report = errorReport('report exceeded the size cap')
  } catch (e) {
    report = errorReport(`run failed: ${e instanceof Error ? e.message : 'error'}`)
  }
  try {
    await mkdir(io.outDir, { recursive: true })
    await writeFile(join(io.outDir, 'report.json'), JSON.stringify(report), 'utf8')
    return 0
  } catch {
    return 1
  }
}

export async function main(): Promise<number> {
  return runDriver({
    inDir: process.env.MCPTEST_IN || '/work/in',
    outDir: process.env.MCPTEST_OUT || '/work/out',
    pkgRoot: process.env.MCPTEST_PKG_ROOT || DRIVER_PKG_ROOT
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main()
}
