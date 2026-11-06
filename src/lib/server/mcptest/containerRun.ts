// Server-only. Runs the in-container driver (plan 15-10) through the Phase 8 ContainerRuntime contract.
// Flow: createAndStart -> putFiles (driver tree, request.json, package) -> exec the driver -> getFiles(/work/out)
// -> remove (always). The container is the isolation; the web process never runs a generated server.
// Verified only against createFakeRuntime; a real engine is a pending human check.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ReportSchema, MAX_REPORT_BYTES, type Report } from '$lib/mcptest/core/report'
import { DriverRequestSchema, type DriverRequest } from '$lib/mcptest/driverRequest'
import { importClosure } from './driverClosure'
import { parseRunnerConfig, type RunnerConfig } from '../tryitout/runnerConfig'
import { publicErrorMessage, publicText, redactSecrets } from '../tryitout/redact'
import {
  LABEL_INSTANCE,
  LABEL_MANAGED,
  LABEL_OWNER,
  WORK_ROOT_IN_CONTAINER,
  isSafeRelativePath,
  isTryItOutRuntimeError,
  type ContainerRuntime,
  type StagedFile
} from '../tryitout/runtime'

export const LABEL_MCPTEST = 'aic.mcptest'
/** User the runner image ends with (Containerfile.mcp-test-runner: USER pi, D-464); a test keeps the two in step. */
export const RUNNER_USER = 'pi'
/**
 * `npm install --prefix /` puts the binary in /node_modules/.bin (CR-04). The absolute path does not depend on PATH;
 * the Containerfile also puts that directory on PATH.
 */
export const DRIVER_CMD = ['/node_modules/.bin/tsx', '/work/src/lib/mcptest/driver.ts']
export const MAX_PKG_FILES = 200
export const MAX_PKG_BYTES = 2_000_000
export const MAX_TREE_FILES = 800
export const MAX_TREE_BYTES = 6_000_000
const MAX_OUT_FILES = 10
const DEFAULT_TIMEOUT_MS = 120_000
const MESSAGE_CAP = 200

export type ContainerRunCode = 'engine_unavailable' | 'exec_failed' | 'output_invalid' | 'timeout'
export type ContainerRunResult =
  | { ok: true; report: Report; reportJson: string }
  | { ok: false; code: ContainerRunCode; message: string }

export interface PackageFile {
  path: string
  content: string
}

export interface ContainerRunOptions {
  timeoutMs?: number
  signal?: AbortSignal
  instanceId?: string
  /** Owner label of the deployment (default APP_INSTANCE_NAME or the hostname, like the Try It Out service). */
  ownerId?: string
  /** Pre-read driver tree (tests); default reads src/lib/mcptest and src/lib/mcpgen from disk. */
  driverTree?: StagedFile[]
}

/** Runner configuration for the test runner image: internal network, no egress, no LLM proxy, no tools. */
export function mcpTestRunnerConfig(env: Record<string, string | undefined> = process.env): RunnerConfig {
  const open = env.MCPTEST_ALLOW_OPEN_EGRESS?.trim().toLowerCase()
  if (open === 'true' || open === '1') throw new Error('MCPTEST_ALLOW_OPEN_EGRESS is not supported: the test runner never gets egress')
  const cfg = parseRunnerConfig({
    PI_RUNNER_IMAGE: env.MCPTEST_RUNNER_IMAGE || 'localhost/mcp-test-runner:latest',
    PI_RUNNER_NETWORK: env.MCPTEST_NETWORK || 'aic-mcptest-internal',
    PI_RUNNER_SOCKET: env.PI_RUNNER_SOCKET,
    XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR,
    PI_RUNNER_ALLOW_OPEN_EGRESS: 'false',
    PI_RUNNER_FS_MODE: 'tmpfs',
    PI_RUNNER_JOB_TIMEOUT_MS: env.MCPTEST_JOB_TIMEOUT_MS,
    PI_RUNNER_MEMORY_MB: env.MCPTEST_MEMORY_MB,
    PI_RUNNER_MAX_OUTPUT_BYTES: String(MAX_REPORT_BYTES + 100_000),
    PI_RUNNER_MAX_OUTPUT_FILES: String(MAX_OUT_FILES)
  })
  const out: RunnerConfig = {
    ...cfg,
    proxyUrl: '',
    allowOpenEgress: false,
    tools: [],
    jobTokenBudget: 0,
    jobRequestBudget: 0,
    fallbackEnabled: false,
    // CR-03: this image has user 'node' and no /home/pi/agent.
    runUser: RUNNER_USER,
    mountAgentDir: false
  }
  if (out.allowOpenEgress) throw new Error('open egress is forbidden for the test runner')
  return out
}

const TREE_ROOTS = ['src/lib/mcptest', 'src/lib/mcpgen']
// .jsonl (golden checks) and .csv (fixtures) were missing before CR-01.
const TEXT_EXT = new Set(['.ts', '.json', '.jsonl', '.yaml', '.yml', '.md', '.mjs', '.csv'])
const DRIVER_ENTRY = 'src/lib/mcptest/driver.ts'
const SUITE_PREFIX = 'src/lib/mcptest/suite/'

/**
 * The first candidate directory that holds the driver entry, else the last one. In dev the module sits in the repo,
 * so the root is four levels above it. In the built server import.meta.url is a bundled chunk (/app/build/...) and that
 * guess is wrong (CR-47): the runtime image copies the driver sources next to the build, so the working directory
 * (or MCPTEST_DRIVER_ROOT) finds them.
 */
export function resolveDriverRoot(candidates: (string | undefined)[]): string {
  const list = candidates.filter((c): c is string => typeof c === 'string' && c !== '')
  for (const c of list) if (existsSync(join(c, DRIVER_ENTRY))) return c
  return list[list.length - 1] ?? ''
}

function repoRoot(): string {
  return resolveDriverRoot([process.env.MCPTEST_DRIVER_ROOT, fileURLToPath(new URL('../../../../', import.meta.url)), process.cwd()])
}

/**
 * Reads the driver source tree (text files only, no tests, goldens or testing dirs). Everything under the suite
 * directory is staged whatever its extension, and the tree is rejected when a suite case lacks its golden.jsonl
 * (CR-01: the in-container suite must equal the host suite, or the run would score nothing).
 */
export function readDriverTree(root: string = repoRoot()): StagedFile[] {
  const files: StagedFile[] = []
  let bytes = 0
  const walk = (abs: string) => {
    for (const ent of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ent.isSymbolicLink()) continue
      const p = join(abs, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === '__golden__' || ent.name === 'testing' || ent.name === 'node_modules') continue
        walk(p)
      } else if (ent.isFile()) {
        const rel = relative(root, p).split(sep).join('/')
        if (ent.name.endsWith('.test.ts')) continue
        if (!rel.startsWith(SUITE_PREFIX)) {
          const dot = ent.name.lastIndexOf('.')
          if (dot < 0 || !TEXT_EXT.has(ent.name.slice(dot))) continue
        }
        const size = statSync(p).size
        bytes += size
        if (files.length + 1 > MAX_TREE_FILES || bytes > MAX_TREE_BYTES) throw new Error('driver tree exceeds its caps')
        files.push({ path: rel, content: readFileSync(p, 'utf8') })
      }
    }
  }
  for (const r of TREE_ROOTS) walk(join(root, r))
  // D2: files outside the roots that the driver imports (src/lib/spec/security.ts via core/redact.ts) are staged too.
  const closure = importClosure(root, [DRIVER_ENTRY])
  if (closure.unresolved.length > 0) throw new Error(`driver imports unresolved: ${closure.unresolved.map((u) => `${u.from} -> ${u.spec}`).join(', ')}`)
  const have = new Set(files.map((f) => f.path))
  for (const rel of closure.files) {
    if (have.has(rel)) continue
    const size = statSync(join(root, rel)).size
    bytes += size
    if (files.length + 1 > MAX_TREE_FILES || bytes > MAX_TREE_BYTES) throw new Error('driver tree exceeds its caps')
    files.push({ path: rel, content: readFileSync(join(root, rel), 'utf8') })
  }
  const missing = missingGoldens(files)
  if (missing.length > 0) throw new Error(`driver tree lacks golden.jsonl for: ${missing.join(', ')}`)
  return files
}

/** Suite case directories (those with a case.yaml) that have no golden.jsonl in the staged files. */
export function missingGoldens(files: { path: string }[]): string[] {
  const paths = new Set(files.map((f) => f.path))
  const out: string[] = []
  for (const f of files) {
    if (!f.path.startsWith(SUITE_PREFIX) || !f.path.endsWith('/case.yaml')) continue
    const dir = f.path.slice(0, -'case.yaml'.length)
    if (!paths.has(`${dir}golden.jsonl`)) out.push(dir.slice(SUITE_PREFIX.length, -1))
  }
  return out
}

function withDirs(prefix: string, files: { path: string; content: string }[]): StagedFile[] {
  const dirs = new Set<string>()
  const out: StagedFile[] = []
  for (const f of files) {
    const full = prefix ? `${prefix}/${f.path}` : f.path
    const parts = full.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
    out.push({ path: full, content: f.content })
  }
  const dirEntries = [...dirs].sort().map((d): StagedFile => ({ path: d, type: 'dir' }))
  return [...dirEntries, ...out]
}

function checkPackage(files: PackageFile[]): string | null {
  if (files.length > MAX_PKG_FILES) return 'package has too many files'
  let bytes = 0
  for (const f of files) {
    if (typeof f.path !== 'string' || !isSafeRelativePath(f.path)) return 'package path rejected'
    bytes += Buffer.byteLength(f.content, 'utf8')
    if (bytes > MAX_PKG_BYTES) return 'package is too large'
  }
  return null
}

const fail = (code: ContainerRunCode, message: string): ContainerRunResult => ({
  ok: false,
  code,
  message: publicText(message).slice(0, MESSAGE_CAP)
})

function mapError(err: unknown): ContainerRunResult {
  if (isTryItOutRuntimeError(err)) {
    const msg = publicErrorMessage(err)
    switch (err.code) {
      case 'output_invalid':
        return fail('output_invalid', msg)
      case 'exec_failed':
        return fail('exec_failed', msg)
      default:
        return fail('engine_unavailable', msg)
    }
  }
  return fail('exec_failed', publicErrorMessage(err))
}

class RunTimeout extends Error {}
class RunAborted extends Error {}

function guard<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RunAborted('aborted'))
      return
    }
    const timer = setTimeout(() => reject(new RunTimeout('timeout')), ms)
    const onAbort = () => reject(new RunAborted('aborted'))
    signal?.addEventListener('abort', onAbort, { once: true })
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    p.then(
      (v) => {
        done()
        resolve(v)
      },
      (e) => {
        done()
        reject(e)
      }
    )
  })
}

export async function runInContainer(
  runtime: ContainerRuntime,
  request: DriverRequest,
  packageFiles: PackageFile[],
  opts: ContainerRunOptions = {}
): Promise<ContainerRunResult> {
  // Everything is validated before the engine is touched.
  const parsed = DriverRequestSchema.safeParse(request)
  if (!parsed.success) return fail('exec_failed', 'invalid driver request')
  const bad = checkPackage(packageFiles)
  if (bad) return fail('exec_failed', bad)
  if (request.subject.kind === 'fake' && packageFiles.length > 0) return fail('exec_failed', 'a fake subject takes no package')
  let tree: StagedFile[]
  try {
    tree = opts.driverTree ?? readDriverTree()
  } catch {
    return fail('exec_failed', 'driver sources could not be read')
  }
  // CR-01: never run against a suite whose goldens were not staged.
  if (missingGoldens(tree).length > 0) return fail('exec_failed', 'driver sources are incomplete')

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let containerId: string | null = null
  // WR-04: the create call is tracked so a timeout that fires while it is in flight can still remove the container.
  let created: Promise<string> | null = null
  const execAbort = new AbortController()
  const stderrTail: string[] = []
  try {
    const run = async (): Promise<ContainerRunResult> => {
      await runtime.ensureNetwork()
      // aic.tryitout + aic.owner make the existing Try It Out orphan sweep find a leaked container too.
      created = runtime.createAndStart({
        name: `mcptest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        labels: {
          [LABEL_MANAGED]: '1',
          [LABEL_MCPTEST]: '1',
          [LABEL_INSTANCE]: opts.instanceId ?? 'mcptest',
          [LABEL_OWNER]: opts.ownerId ?? (process.env.APP_INSTANCE_NAME?.trim() || hostname())
        },
        env: []
      })
      containerId = await created
      const id = containerId
      const staged: StagedFile[] = [
        // D1: /work is a tmpfs, so a package.json in the image would not help. Without it tsx compiles the driver
        // as CommonJS and rejects its top-level await (ERR_REQUIRE_ASYNC_MODULE).
        { path: 'package.json', content: '{"type":"module"}' },
        { path: 'in', type: 'dir' },
        { path: 'out', type: 'dir', mode: 0o777 },
        { path: 'in/request.json', content: JSON.stringify(parsed.data) },
        ...withDirs('', tree.map((f) => ({ path: f.path, content: String(f.content ?? '') }))),
        ...(packageFiles.length > 0 ? withDirs('pkg', packageFiles) : [])
      ]
      await runtime.putFiles(id, WORK_ROOT_IN_CONTAINER, dedupeDirs(staged))
      const { exitCode } = await runtime.exec(id, {
        cmd: DRIVER_CMD,
        workingDir: WORK_ROOT_IN_CONTAINER,
        signal: execAbort.signal,
        onStdout: () => {},
        onStderr: (c) => {
          stderrTail.push(c.toString('utf8'))
          if (stderrTail.length > 20) stderrTail.shift()
        }
      })
      const files = await runtime.getFiles(id, `${WORK_ROOT_IN_CONTAINER}/out`, {
        maxBytes: MAX_REPORT_BYTES + 100_000,
        maxFiles: MAX_OUT_FILES
      })
      const rep = files['report.json']
      if (!rep) {
        const errFile = files['error.json']
        if (errFile) {
          let msg = 'driver reported an error'
          try {
            const j = JSON.parse(Buffer.from(errFile).toString('utf8')) as { error?: unknown }
            if (typeof j.error === 'string') msg = j.error
          } catch {
            /* keep the generic text */
          }
          return fail('output_invalid', msg)
        }
        if (exitCode !== 0) {
          const tail = redactSecrets(stderrTail.join('')).slice(-100).replace(/\s+/g, ' ').trim()
          return fail('exec_failed', `driver exited with code ${exitCode ?? 'null'}${tail ? `: ${tail}` : ''}`)
        }
        return fail('output_invalid', 'no report was produced')
      }
      if (rep.byteLength > MAX_REPORT_BYTES) return fail('output_invalid', 'report exceeds the size cap')
      let json: unknown
      const text = Buffer.from(rep).toString('utf8')
      try {
        json = JSON.parse(text)
      } catch {
        return fail('output_invalid', 'report is not valid JSON')
      }
      const checked = ReportSchema.safeParse(json)
      if (!checked.success) return fail('output_invalid', 'report does not match the schema')
      // WR-05: store and serve the validated data (unknown keys stripped by the schema), never the raw bytes the
      // container wrote, so content a subject smuggled into report.json cannot reach the host store.
      const reportJson = JSON.stringify(checked.data)
      if (Buffer.byteLength(reportJson, 'utf8') > MAX_REPORT_BYTES) return fail('output_invalid', 'report exceeds the size cap')
      return { ok: true, report: checked.data, reportJson }
    }
    return await guard(run(), timeoutMs, opts.signal)
  } catch (err) {
    if (err instanceof RunTimeout) return fail('timeout', 'the container run timed out')
    if (err instanceof RunAborted) return fail('exec_failed', 'the run was cancelled')
    return mapError(err)
  } finally {
    execAbort.abort()
    const id = containerId
    if (id) {
      try {
        await runtime.remove(id)
      } catch {
        /* cleanup is best effort; the labelled orphan sweep covers leftovers */
      }
    } else if (created) {
      // The create call was still in flight (timeout or abort): remove whatever it produces once it settles.
      void (created as Promise<string>)
        .then((late) => runtime.remove(late))
        .catch(() => {})
    }
  }
}

function dedupeDirs(files: StagedFile[]): StagedFile[] {
  const seen = new Set<string>()
  return files.filter((f) => {
    if (f.type !== 'dir') return true
    if (seen.has(f.path)) return false
    seen.add(f.path)
    return true
  })
}
