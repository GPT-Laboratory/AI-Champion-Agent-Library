// Author-facing MCP test CLI (Phase 15). Like generate-mcp it works regardless of the MCP_TESTER flag
// (the flag is never consulted). It reads no env files, makes no network calls itself, and writes only the
// --out file. cmd: subjects (real servers) spawn only with --allow-local-exec: no shell, argv split,
// scrubbed environment (core/transports/stdio). Exit codes: 0 verdict PASS, 1 other verdict, 2 usage error.
import { realpathSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isReservedEnvName } from '../src/lib/mcptest/core/envNames'
import { loadPackageBinding } from '../src/lib/mcptest/core/packageBinding'
import { ReportSchema, renderMatrix, renderSummary, type Report } from '../src/lib/mcptest/core/report'
import { runSuite } from '../src/lib/mcptest/core/runner'
import { loadSuite, type SuiteCase } from '../src/lib/mcptest/core/suite'
import { listSubjects, resolveSubject, type PrepareWithStderr, type RunnableSubject } from '../src/lib/mcptest/core/subjects'
import { isMainModule } from './is-main.js'

export interface CliIo {
  writeFile: (path: string, content: string) => Promise<void>
  mkdir: (path: string) => Promise<void>
  /** True when the path exists and is a directory. */
  isDirectory: (path: string) => Promise<boolean>
  log: (s: string) => void
  error: (s: string) => void
  now: () => Date
}

export const defaultIo: CliIo = {
  writeFile: (p, c) => writeFile(p, c, 'utf8'),
  mkdir: async (p) => {
    await mkdir(p, { recursive: true })
  },
  isDirectory: async (p) => {
    try {
      return (await stat(p)).isDirectory()
    } catch {
      return false
    }
  },
  log: (s) => console.log(s),
  error: (s) => console.error(s),
  now: () => new Date()
}

const USAGE =
  'Usage: npm run mcp-test -- --subject <fake:good|generator:openapi|cmd:"python3 /path/server.py"> [--case ID ...] [--reruns 1-3] [--format text|markdown|json] [--out report.json] [--allow-local-exec] [--env-base-url NAME] [--env-api-key NAME] [--list]'

const ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/
const MAX_CMD = 1000

/** Split a command line into argv. Double quotes group, backslash escapes inside quotes. No shell. Null on bad input. */
export function splitCommand(s: string): string[] | null {
  if (typeof s !== 'string' || s.length === 0 || s.length > MAX_CMD || /[\u0000-\u001f\u007f]/.test(s)) return null
  const out: string[] = []
  let cur = ''
  let has = false
  let inQ = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQ) {
      if (ch === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) cur += s[++i]
      else if (ch === '"') inQ = false
      else cur += ch
    } else if (ch === '"') {
      inQ = true
      has = true
    } else if (ch === ' ' || ch === '\t') {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (inQ) return null
  if (has || cur) out.push(cur)
  return out.length > 0 ? out : null
}

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Subject for a real server started from a command line (human only). */
export function cmdSubject(argv: string[], envNames: { baseUrl?: string; apiKey?: string }): RunnableSubject {
  return {
    id: `cmd:${basename(argv[0]).slice(0, 60)}`,
    kind: 'submitted',
    modality: 'any',
    llm: false,
    networkPolicy: 'local, unsandboxed (human only)',
    status: 'installed',
    transports: ['stdio'],
    async prepare(): Promise<PrepareWithStderr> {
      // E10 D3: <package>/mcptest-binding.json next to the server script, when present, is the explicit binding.
      const script = argv.slice(1).find((a) => /\.(py|js|mjs|cjs)$/.test(a))
      const binding = script ? await loadPackageBinding(dirname(resolve(script))) : undefined
      return {
        status: 'PASS',
        launch: { kind: 'stdio', command: argv[0], args: argv.slice(1), cwd: process.cwd() },
        ...(binding ? { binding } : {}),
        envNames: { baseUrl: envNames.baseUrl ?? 'ACME_BASE_URL', apiKey: envNames.apiKey ?? 'ACME_API_KEY' }
      }
    }
  }
}

interface Parsed {
  subject?: string
  cases: string[]
  reruns: number
  format: 'text' | 'markdown' | 'json'
  out?: string
  list: boolean
  allowLocalExec: boolean
  envBaseUrl?: string
  envApiKey?: string
}

type ParseResult = { ok: true; p: Parsed } | { ok: false; error: string }

function parseArgs(argv: string[]): ParseResult {
  const p: Parsed = { cases: [], reruns: 1, format: 'text', list: false, allowLocalExec: false }
  const need = (i: number): string | null => {
    const v = argv[i + 1]
    return v === undefined || v.startsWith('--') ? null : v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list') p.list = true
    else if (a === '--allow-local-exec') p.allowLocalExec = true
    else if (['--subject', '--case', '--reruns', '--format', '--out', '--env-base-url', '--env-api-key'].includes(a)) {
      const v = need(i)
      if (v === null) return { ok: false, error: `${a} needs a value` }
      i++
      if (a === '--subject') p.subject = v
      else if (a === '--case') p.cases.push(v)
      else if (a === '--reruns') {
        if (!/^[1-3]$/.test(v)) return { ok: false, error: '--reruns must be 1, 2 or 3' }
        p.reruns = Number(v)
      } else if (a === '--format') {
        if (v !== 'text' && v !== 'markdown' && v !== 'json') return { ok: false, error: '--format must be text, markdown or json' }
        p.format = v
      } else if (a === '--out') p.out = v
      else {
        if (!ENV_NAME.test(v)) return { ok: false, error: `${a} must match ${ENV_NAME.source}` }
        if (isReservedEnvName(v)) return { ok: false, error: `${a} must not name a reserved variable (PATH, HOME, LANG, LD_*, NODE_*, PYTHON* ...)` }
        if (a === '--env-base-url') p.envBaseUrl = v
        else p.envApiKey = v
      }
    } else return { ok: false, error: a.startsWith('--') ? `unknown flag ${a.slice(0, 40)}` : `unexpected argument ${a.slice(0, 40)}` }
  }
  return { ok: true, p }
}

const refusesEnv = (s: string) => basename(s).toLowerCase().startsWith('.env')

function rerunCommand(p: Parsed): string {
  const parts = ['npm run mcp-test --', `--subject ${p.subject?.startsWith('cmd:') ? `cmd:${quote(p.subject.slice(4))}` : p.subject}`]
  for (const c of p.cases) parts.push(`--case ${c}`)
  if (p.reruns !== 1) parts.push(`--reruns ${p.reruns}`)
  if (p.envBaseUrl) parts.push(`--env-base-url ${p.envBaseUrl}`)
  if (p.envApiKey) parts.push(`--env-api-key ${p.envApiKey}`)
  parts.push('--allow-local-exec')
  return parts.join(' ')
}

function listing(cases: SuiteCase[]): string {
  const lines = ['Subjects:']
  for (const s of listSubjects()) lines.push(`  ${s.id}  [${s.kind}]  ${s.runnable ? 'runnable' : 'pending human'}`)
  lines.push('  cmd:"<command and args>"  [submitted]  pending human (needs --allow-local-exec)', '', 'Cases:')
  for (const c of cases) {
    const status = c.x.requires === 'real-runtime' ? 'needs real runtime' : c.x.appliesTo ? `applies to ${c.x.appliesTo.join(', ')}` : 'runs'
    lines.push(`  ${c.def.id}  tier ${c.def.tier}  ${c.def.title ?? ''}  (${status})`)
  }
  return lines.join('\n')
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 300)

/** Returns 0 on PASS (or --list), 1 for another verdict, 2 for usage errors. Never throws. */
export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const usage = (msg: string) => {
    io.error(`mcp-test: ${clean(msg)}`)
    io.error(USAGE)
    return 2
  }
  if (argv.some(refusesEnv)) {
    io.error('mcp-test: refusing to read environment files.')
    return 2
  }
  const parsed = parseArgs(argv)
  if (!parsed.ok) return usage(parsed.error)
  const p = parsed.p
  try {
    const suite = await loadSuite()
    if (!suite.ok) {
      io.error(`mcp-test: suite failed to load: ${clean(suite.errors[0] ?? '')}`)
      return 2
    }
    if (p.list) {
      io.log(listing(suite.cases))
      return 0
    }
    if (!p.subject) return usage('--subject is required')

    let subject: RunnableSubject | null
    let runtime: 'fake' | 'local-cli' = 'local-cli'
    if (p.subject.startsWith('cmd:')) {
      const args = splitCommand(p.subject.slice(4))
      if (!args) return usage('cmd: subject must be a non-empty command line without control characters')
      if (args.some(refusesEnv)) {
        io.error('mcp-test: refusing to read environment files.')
        return 2
      }
      subject = cmdSubject(args, { baseUrl: p.envBaseUrl, apiKey: p.envApiKey })
    } else {
      if (p.envBaseUrl || p.envApiKey) return usage('--env-base-url and --env-api-key apply to cmd: subjects only')
      subject = resolveSubject(p.subject)
      if (subject?.kind === 'fake') runtime = 'fake'
    }
    if (!subject) return usage(`unknown subject ${p.subject.slice(0, 60)} (see --list)`)

    let cases = suite.cases
    if (p.cases.length > 0) {
      const unknown = p.cases.find((c) => !suite.cases.some((s) => s.def.id === c))
      if (unknown) return usage(`unknown case ${unknown.slice(0, 60)} (see --list)`)
      cases = suite.cases.filter((s) => p.cases.includes(s.def.id))
    }

    let outPath: string | undefined
    if (p.out) {
      outPath = resolve(p.out)
      if (await io.isDirectory(outPath)) return usage('--out must be a file path, not a directory')
    }

    const report: Report = await runSuite({
      subject,
      cases,
      reruns: p.reruns,
      runtime,
      allowStdioExec: p.allowLocalExec,
      now: io.now
    })
    const checked = ReportSchema.parse(report)

    if (outPath) {
      await io.mkdir(dirname(outPath))
      await io.writeFile(outPath, JSON.stringify(checked, null, 2))
    }
    if (p.format === 'json') io.log(JSON.stringify(checked, null, 2))
    else {
      io.log(renderSummary(checked, p.format))
      io.log('')
      io.log(renderMatrix(checked, p.format))
      const pending = checked.cases.some((c) => c.state === 'PENDING_HUMAN')
      if (pending && p.subject.startsWith('cmd:') && !p.allowLocalExec) {
        io.log('')
        io.log('Real servers run only with explicit consent. To run this subject on this machine, re-run:')
        io.log(`  ${rerunCommand(p)}`)
      }
    }
    return checked.summary.verdict === 'PASS' ? 0 : 1
  } catch (e) {
    io.error(`mcp-test: ${e instanceof Error ? clean(e.message) : 'error'}`)
    return 1
  }
}

export { isMainModule }

const isMain = isMainModule(import.meta.url, process.argv[1])
if (isMain) {
  process.exitCode = await runCli(process.argv.slice(2))
}
