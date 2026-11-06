// One run of one case against one subject: connect through the black-box client, run the golden lines,
// return check results. Never throws (callers still wrap it). Core purity: no $lib/svelte imports.
import { PassThrough } from 'node:stream'
import { createMockUpstream } from '../mock/upstream'
import type { MockHandle, UpstreamSpecInput } from '../mock/spec'
import { ENV_VARS, HINTS } from '../mock/contract'
import { McpClient, type Finding } from './client'
import { lineChannel } from './jsonrpc'
import { evaluateExpect } from './expect'
import { bindTool, boundArgs } from './binding'
import { makeRedactor } from './redact'
import type { SuiteCase } from './suite'
import type { PrepareWithStderr, RunnableSubject } from './subjects'
import { httpChannel, type HttpChannel } from './transports/streamableHttp'
import { spawnStdioChannel } from './transports/stdio'
import { runTier3Check, type SpecialCtx } from './tier3Checks'
import { runTier4Check } from './tier4Checks'
import { runBehaviourCheck, type Identity, type ValidatorCtx } from './validators'
import type {
  BehaviourKind,
  CheckResult,
  FlagHit,
  Launch,
  ToolCaller,
  ToolInfo,
  ToolOutcome
} from './types'

const BEHAVIOUR: BehaviourKind[] = [
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
]
const TIER3 = ['grounding', 'profile', 'composite', 'large_response'] as const
const TIER4 = ['fault_retry', 'fault_timeout', 'fault_malformed', 'secret_canary', 'i18n_codes'] as const
const SKIPPED_KINDS = ['generator_side', 'rerun_variance']

const LEAK_REASON = /\bleak\b[^()]{0,20}\(/i
const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n - 3) + '...' : s)
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface CellInput {
  sc: SuiteCase
  subject: RunnableSubject
  prep: PrepareWithStderr
  canary: string
  timeoutMs: number
  allowStdioExec: boolean
}

export interface CellResult {
  checks: CheckResult[]
  d1?: { pass: boolean }
  findings: Finding[]
  protocolVersion?: string
  serverInfo?: { name?: string; version?: string }
  allToolNames: string[]
  transport: 'stdio' | 'http'
}

interface Conn {
  client: McpClient
  close(): Promise<void>
  health?: () => Promise<{ ok: boolean }>
  stderr: () => string
  /** Reason the in-process serve rejected, when it did. */
  crashed?: () => string | null
}

/** Env names: case x-env by default, PrepareResult.envNames when present. */
export function envNamesFor(sc: SuiteCase, prep: PrepareWithStderr) {
  const e = sc.x.env
  return {
    baseUrl: prep.envNames?.baseUrl ?? e?.baseUrl ?? ENV_VARS.baseUrl,
    apiKey: prep.envNames?.apiKey ?? e?.apiKey,
    baseUrlB: prep.envNames?.baseUrlB ?? e?.baseUrlB,
    dataPath: prep.envNames?.dataPath ?? e?.dataPath
  }
}

function dumpPath(sc: SuiteCase): string | undefined {
  const f = sc.fixtureFiles.find((x) => x.path.startsWith('dump/'))
  return f ? `${sc.dir}/fixture/${f.path}` : undefined
}

export function buildEnv(sc: SuiteCase, prep: PrepareWithStderr, a: MockHandle, b: MockHandle | undefined, canary: string) {
  const n = envNamesFor(sc, prep)
  const env: Record<string, string> = { [n.baseUrl]: a.url }
  if (b && n.baseUrlB) env[n.baseUrlB] = b.url
  if (n.apiKey) env[n.apiKey] = canary
  // Data path only for real-runtime cases (a tabular or SQL subject reads a file, not a URL).
  if (sc.x.requires === 'real-runtime' && n.dataPath) {
    const p = dumpPath(sc)
    if (p) env[n.dataPath] = p
  }
  return { env, keyName: n.apiKey ?? ENV_VARS.apiKey }
}

async function connect(
  sc: SuiteCase,
  subject: RunnableSubject,
  prep: PrepareWithStderr,
  env: Record<string, string>,
  o: { timeoutMs: number; allowStdioExec: boolean }
): Promise<Conn> {
  const transport = sc.def.transport === 'http' ? 'http' : 'stdio'
  if (transport === 'http') {
    if (!subject.startHttp) throw new Error('subject has no HTTP flavour')
    const srv = await subject.startHttp(env)
    const ch: HttpChannel = httpChannel({ url: srv.url, healthPath: sc.x.config?.healthPath })
    const client = McpClient.connect(ch, { timeoutMs: o.timeoutMs })
    return {
      client,
      health: () => ch.healthCheck(),
      stderr: () => '',
      close: async () => {
        await client.close()
        await srv.close()
      }
    }
  }
  const launch = prep.launch as Launch
  if (launch.kind === 'inproc') {
    const toServer = new PassThrough()
    const fromServer = new PassThrough()
    let crashed: string | null = null
    const served = Promise.resolve()
      .then(() => launch.serve(toServer, fromServer, env))
      .catch((e: unknown) => {
        crashed = errText(e)
        fromServer.end()
      })
    const client = McpClient.connect(lineChannel(fromServer, toServer), { timeoutMs: o.timeoutMs })
    return {
      client,
      stderr: () => prep.stderrText?.() ?? '',
      crashed: () => crashed,
      close: async () => {
        await client.close()
        let t: ReturnType<typeof setTimeout> | undefined
        await Promise.race([served, new Promise<void>((r) => (t = setTimeout(r, 2000)))])
        if (t) clearTimeout(t)
      }
    }
  }
  if (launch.kind === 'stdio') {
    const ch = spawnStdioChannel({ command: launch.command, args: launch.args, cwd: launch.cwd, env, allowLocalExec: o.allowStdioExec })
    const client = McpClient.connect(ch, { timeoutMs: o.timeoutMs })
    return { client, stderr: () => ch.stderrText?.() ?? '', close: () => client.close() }
  }
  const ch = httpChannel({ url: launch.url, healthPath: launch.healthPath })
  const client = McpClient.connect(ch, { timeoutMs: o.timeoutMs })
  return { client, health: () => ch.healthCheck(), stderr: () => '', close: () => client.close() }
}

const mk = (
  id: string,
  kind: CheckResult['kind'],
  dimension: CheckResult['dimension'],
  status: CheckResult['status'],
  reason: string,
  boundBy: CheckResult['boundBy'] = 'none',
  flags?: FlagHit[]
): CheckResult => ({ id, kind, dimension, status, boundBy, reason: clip(reason), ...(flags && flags.length ? { flags } : {}) })

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])

function defaultIdentity(): Identity {
  return { idKeys: [], altKeys: [], partitionKeys: [], knownId: '', badId: '', partitionValue: '', expectedDerivedIds: [], maxPage: 50 }
}

function specialConfig(kind: string, sc: SuiteCase): Record<string, unknown> {
  const cfg = sc.x.config
  switch (kind) {
    case 'grounding':
      return { traceTable: cfg?.grounding?.traceTable ?? {} }
    case 'profile':
      return { profile: cfg?.profile }
    case 'composite':
      return { expectedKeys: cfg?.composite?.expectedKeys }
    case 'large_response':
      return { ...(cfg?.large_response ?? {}) }
    case 'i18n_codes':
      return { ...(cfg?.i18n ?? {}) }
    case 'fault_timeout':
      // DRAFT-15-08-e: the deadline must exceed a well-behaved server's own upstream timeout (5 s in the fake).
      return { timeoutMs: 8000, slackMs: 3000 }
    default:
      return {}
  }
}

/** Mock upstreams for a cell; the caller closes them. */
export async function startMocks(sc: SuiteCase, canary: string): Promise<{ a: MockHandle; b?: MockHandle }> {
  const specA: UpstreamSpecInput = sc.x.upstream?.a ?? { datasets: ['catalog'] }
  const a = await createMockUpstream(specA, { apiKey: canary, label: 'A' })
  if (!sc.x.upstream?.b) return { a }
  try {
    return { a, b: await createMockUpstream(sc.x.upstream.b, { apiKey: canary, label: 'B' }) }
  } catch (e) {
    await a.close()
    throw e
  }
}

export async function runOnce(inp: CellInput): Promise<CellResult> {
  const { sc, subject, prep, canary } = inp
  const transport: 'stdio' | 'http' = sc.def.transport === 'http' ? 'http' : 'stdio'
  const redact = makeRedactor([canary])
  const result: CellResult = { checks: [], findings: [], allToolNames: [], transport }
  const extra = prep.extraChecks ?? []
  const open: Conn[] = []
  let mocks: { a: MockHandle; b?: MockHandle } | undefined
  try {
    mocks = await startMocks(sc, canary)
    const { a: mockA, b: mockB } = mocks
    const { env, keyName } = buildEnv(sc, prep, mockA, mockB, canary)
    const copt = { timeoutMs: inp.timeoutMs, allowStdioExec: inp.allowStdioExec }
    const conn = await connect(sc, subject, prep, env, copt)
    open.push(conn)
    const client = conn.client

    const init = await client.initialize()
    if (!init.ok) {
      result.findings = client.findings
      const crash = conn.crashed?.()
      if (crash) {
        // The subject's own serve rejected: a harness-side problem, not a D1 verdict.
        result.checks = [mk('initialize', 'tool_exists', 'D1', 'ERROR', `subject serve failed: ${redact(crash)}`), ...extra]
        return result
      }
      result.d1 = { pass: false }
      result.checks = [mk('initialize', 'tool_exists', 'D1', 'FAIL', `initialize failed: ${redact(init.reason)}`), ...extra]
      return result
    }
    result.protocolVersion = init.protocolVersion
    result.serverInfo = init.serverInfo
    const allTools = await client.listTools()
    result.allToolNames = allTools.map((t) => t.name)
    const health = conn.health ? await conn.health().catch(() => ({ ok: false })) : { ok: true }
    const d1ok = allTools.length > 0 && health.ok
    result.d1 = { pass: d1ok }
    if (!d1ok) {
      result.findings = client.findings
      result.checks = [mk('tools_list', 'tool_exists', 'D1', 'FAIL', allTools.length === 0 ? 'tools/list returned no tools' : 'health check failed'), ...extra]
      return result
    }

    const scope = subject.toolScope?.(sc.def) ?? null
    const tools: ToolInfo[] = scope ? allTools.filter((t) => scope.includes(t.name)) : allTools
    const caller: ToolCaller = {
      tools,
      call: (n, args, o) => client.callTool(n, args, o)
    }
    const identity: Identity = (sc.x.identity as Identity | undefined) ?? defaultIdentity()
    const lineFor = (kind: string) => sc.golden.find((l) => l.check_kind === kind)

    const bind: ValidatorCtx['bind'] & SpecialCtx['bind'] = (kind: string) => {
      const line = lineFor(kind)
      const override = prep.binding?.[kind]
      const spec = { tool: line?.tool, tool_hint: line?.tool_hint ?? (line ? HINTS[kind] : undefined) }
      const r = bindTool(spec, tools, override)
      const args = boundArgs(override, line?.args)
      if (r.status === 'ambiguous') return { args, boundBy: 'none', error: `ambiguous tool binding: ${r.matches.join(', ') || 'bad hint'}` }
      if (r.status === 'no_tool' || !r.tool) return { args, boundBy: 'none' }
      return { tool: r.tool, args, boundBy: r.boundBy }
    }

    const relaunch = async (wrongKey: string): Promise<ToolCaller | null> => {
      try {
        const c = await connect(sc, subject, prep, { ...env, [keyName]: wrongKey }, copt)
        open.push(c)
        const i = await c.client.initialize()
        if (!i.ok) return null
        await c.client.listTools()
        return c.client
      } catch {
        return null
      }
    }

    const vctx: ValidatorCtx = { caller, identity, bind, relaunchWithKey: relaunch, redact }
    const sctx = (kind: string): SpecialCtx => ({
      caller,
      mock: mockA,
      mockB,
      stderr: () => conn.stderr(),
      canary,
      bind,
      config: specialConfig(kind, sc),
      redact
    })

    const checks: CheckResult[] = []
    const done = new Set<string>()
    for (const line of sc.golden) {
      const kind = line.check_kind
      const dim = line.dimension ?? 'D2'
      if (kind && (SKIPPED_KINDS as string[]).includes(kind)) continue
      if (kind && (BEHAVIOUR as string[]).includes(kind)) {
        checks.push(await runBehaviourCheck(kind as BehaviourKind, vctx))
        continue
      }
      if (kind && ((TIER3 as readonly string[]).includes(kind) || (TIER4 as readonly string[]).includes(kind))) {
        if (done.has(kind)) continue
        done.add(kind)
        const rs = (TIER3 as readonly string[]).includes(kind)
          ? await runTier3Check(kind as (typeof TIER3)[number], sctx(kind))
          : await runTier4Check(kind as (typeof TIER4)[number], sctx(kind))
        checks.push(...rs)
        if (kind === 'profile' && sc.x.config?.profile) {
          const si = init.serverInfo
          const okInfo = !!si.name && !!si.version
          checks.push(mk('profile.server_info', 'profile', 'D3', okInfo ? 'PASS' : 'FAIL', okInfo ? 'server name and version reported' : 'initialize lacks server name or version'))
        }
        continue
      }
      if (kind) {
        checks.push(mk(line.id, 'call', dim, 'ERROR', `unknown check_kind ${kind}`))
        continue
      }
      if (line.type === 'tool_exists') {
        const r = bindTool({ tool: line.tool, tool_hint: line.tool_hint }, tools, prep.binding?.[line.id])
        checks.push(
          r.status === 'ok'
            ? mk(line.id, 'tool_exists', dim, 'PASS', `tool ${r.tool} present`, r.boundBy)
            : r.status === 'ambiguous'
              ? mk(line.id, 'tool_exists', dim, 'ERROR', `ambiguous tool hint: ${r.matches.join(', ')}`)
              : mk(line.id, 'tool_exists', dim, 'FAIL', 'no matching tool')
        )
        continue
      }
      checks.push(await runLine(line, tools, caller, identity, mockA, prep, dim, relaunch))
    }

    // Non-JSON stdout is a warning flag carried by an NA check (scored on nothing, flag still counts).
    const noise = client.findings.filter((f) => f.kind === 'stdout_noise')
    if (noise.length > 0) {
      checks.push(
        mk('protocol.stdout_noise', 'call', 'D1', 'NA', `non-JSON stdout lines: ${noise.length}`, 'none', [
          { id: 'STDOUT_NOISE', severity: 'warning', detail: clip(`stdout carried ${noise.length} non-JSON line(s)`) }
        ])
      )
    }
    result.checks = [...checks, ...extra].map(attachLeakFlag)
    result.findings = client.findings
    return result
  } catch (e) {
    result.checks = [mk('run', 'call', 'D1', 'ERROR', `run failed: ${redact(errText(e))}`), ...extra]
    return result
  } finally {
    for (const c of open.reverse()) await c.close().catch(() => {})
    if (mocks?.b) await mocks.b.close().catch(() => {})
    if (mocks) await mocks.a.close().catch(() => {})
  }
}

/** A failing check whose reason reports a leak raises the LEAK blocker unless it already carries it. */
function attachLeakFlag(c: CheckResult): CheckResult {
  if (c.status !== 'FAIL' || !LEAK_REASON.test(c.reason)) return c
  if (c.flags?.some((f) => f.id === 'LEAK')) return c
  return { ...c, flags: [...(c.flags ?? []), { id: 'LEAK', severity: 'blocker', detail: clip(c.reason) }] }
}

async function runLine(
  line: SuiteCase['golden'][number],
  tools: ToolInfo[],
  caller: ToolCaller,
  identity: Identity,
  mock: MockHandle,
  prep: PrepareWithStderr,
  dim: CheckResult['dimension'],
  relaunch: (k: string) => Promise<ToolCaller | null>
): Promise<CheckResult> {
  const r = bindTool({ tool: line.tool, tool_hint: line.tool_hint }, tools, prep.binding?.[line.id])
  const kind = line.type === 'auth' ? 'auth' : 'call'
  if (r.status === 'ambiguous') return mk(line.id, kind, dim, 'ERROR', `ambiguous tool hint: ${r.matches.join(', ')}`)
  if (r.status !== 'ok' || !r.tool) return mk(line.id, kind, dim, 'FAIL', 'no tool')
  const args = boundArgs(prep.binding?.[line.id], line.args)
  let target: ToolCaller = caller
  if (line.type === 'auth') {
    const re = await relaunch('wrong-key-0000')
    if (!re) return mk(line.id, kind, dim, 'ERROR', 'relaunch with a wrong key failed', r.boundBy)
    target = re
  }
  let last: ToolOutcome = { kind: 'transport_error', message: 'not called' }
  let verdict = { ok: true, reason: 'ok', leak: undefined as string | undefined }
  try {
    for (let i = 0; i < (line.repeat ?? 1); i++) {
      for (const f of arr(line.inject)) mock.inject(f)
      last = await target.call(r.tool, args)
      mock.clearFaults()
      const ev = line.expect
        ? evaluateExpect(line.expect, last, identity)
        : last.kind === 'result' && !last.isError
          ? { ok: true, reason: 'ok' }
          : { ok: false, reason: `no_error: ${last.kind}` }
      verdict = { ok: ev.ok, reason: ev.reason, leak: (ev as { leak?: string }).leak }
      if (!ev.ok) break
    }
  } catch (e) {
    mock.clearFaults()
    return mk(line.id, kind, dim, 'ERROR', `call failed: ${errText(e)}`, r.boundBy)
  }
  const flags: FlagHit[] = !verdict.ok && verdict.leak ? [{ id: 'LEAK', severity: 'blocker', detail: clip(verdict.leak) }] : []
  return mk(line.id, kind, dim, verdict.ok ? 'PASS' : 'FAIL', verdict.reason, r.boundBy, flags)
}
