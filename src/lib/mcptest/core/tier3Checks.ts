// Tier 3 special checks: grounding, profile, composite, large_response.
// Run against any ToolCaller plus a MockView; never throw. Core purity: no $lib imports.
import type { CheckResult, CheckStatus, Dimension, FlagHit, MockView, ToolCaller, ToolOutcome } from './types'
import { leakReason, RUNTIME_LEAK_EXTRA } from './leak'
import { findAllProducts, payload, textBlob } from './walk'

export interface SpecialCtx {
  caller: ToolCaller
  mock: MockView
  mockB?: MockView
  stderr?: () => string
  canary?: string
  bind: (kind: string) => { tool?: string; args: Record<string, unknown>; boundBy: 'explicit' | 'hint' | 'none'; error?: string }
  config: Record<string, unknown>
  now?: () => number
  redact?: (s: string) => string
}

export const MAX_REASON = 200

/** Builds a CheckResult with a capped, redacted reason. */
export function makeResult(
  ctx: SpecialCtx,
  r: { id: string; kind: CheckResult['kind']; dimension: Dimension; boundBy?: CheckResult['boundBy'] },
  status: CheckStatus,
  reason: string,
  flags?: FlagHit[]
): CheckResult {
  let text = reason
  try {
    if (ctx.redact) text = ctx.redact(text)
  } catch {
    text = '[redactor failed]'
  }
  if (text.length > MAX_REASON) text = text.slice(0, MAX_REASON - 3) + '...'
  const out: CheckResult = { id: r.id, kind: r.kind, dimension: r.dimension, status, boundBy: r.boundBy ?? 'none', reason: text }
  if (flags && flags.length > 0) out.flags = flags
  return out
}

export const leakOf = (o: ToolOutcome): string | null => leakReason(textBlob(o), RUNTIME_LEAK_EXTRA)

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Calls a tool and converts a thrown caller into a transport_error outcome. */
export async function safeCall(ctx: SpecialCtx, name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<ToolOutcome> {
  try {
    return await ctx.caller.call(name, args, timeoutMs === undefined ? undefined : { timeoutMs })
  } catch (e) {
    return { kind: 'transport_error', message: errMsg(e) }
  }
}

export const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt)

type Bound = { tool: string; args: Record<string, unknown>; boundBy: CheckResult['boundBy'] }

/** Binds a kind. Returns a ready CheckResult when unbound (ERROR ambiguous, FAIL no tool). */
export function bindOrResult(
  ctx: SpecialCtx,
  kind: string,
  r: { id: string; kind: CheckResult['kind']; dimension: Dimension }
): { bound: Bound } | { result: CheckResult } {
  const spec = ctx.bind(kind)
  if (spec.error) return { result: makeResult(ctx, { ...r, boundBy: spec.boundBy }, 'ERROR', spec.error) }
  if (!spec.tool) return { result: makeResult(ctx, { ...r, boundBy: spec.boundBy }, 'FAIL', 'no tool') }
  return { bound: { tool: spec.tool, args: spec.args, boundBy: spec.boundBy } }
}

// ---- grounding ----------------------------------------------------------

async function grounding(ctx: SpecialCtx): Promise<CheckResult[]> {
  const meta = { id: 'grounding', kind: 'grounding' as const, dimension: 'D3' as const }
  const table = (ctx.config.traceTable ?? {}) as Record<string, unknown>
  const toolArgs = (ctx.config.toolArgs ?? {}) as Record<string, Record<string, unknown>>
  const untraceable = ctx.caller.tools.map((t) => t.name).filter((n) => typeof table[n] !== 'string' || table[n] === '')
  if (untraceable.length > 0) {
    return [makeResult(ctx, meta, 'FAIL', `untraceable tool: ${untraceable.join(', ')} has no documented operation`)]
  }
  ctx.mock.reset()
  for (const t of ctx.caller.tools) await safeCall(ctx, t.name, toolArgs[t.name] ?? {})
  const bad = ctx.mock.log().filter((e) => e.undocumented)
  if (bad.length > 0) {
    const routes = Array.from(new Set(bad.map((e) => `${e.method} ${e.rawPath}`))).join(', ')
    return [makeResult(ctx, meta, 'FAIL', `undocumented route called: ${routes}`)]
  }
  return [makeResult(ctx, meta, 'PASS', `${ctx.caller.tools.length} tools traced; no undocumented routes called`)]
}

// ---- profile ------------------------------------------------------------

async function profile(ctx: SpecialCtx): Promise<CheckResult[]> {
  const base = { kind: 'profile' as const, dimension: 'D3' as const }
  const cfg = (ctx.config.profile ?? {}) as { requiredTools?: string[]; namePattern?: string; requireDescriptions?: boolean }
  const tools = ctx.caller.tools
  const out: CheckResult[] = []

  const required = cfg.requiredTools
  if (!Array.isArray(required)) out.push(makeResult(ctx, { ...base, id: 'profile.required_tools' }, 'NA', 'no required tools configured'))
  else {
    const have = new Set(tools.map((t) => t.name))
    const missing = required.filter((n) => !have.has(n))
    out.push(
      makeResult(ctx, { ...base, id: 'profile.required_tools' }, missing.length ? 'FAIL' : 'PASS', missing.length ? `missing tools: ${missing.join(', ')}` : `all ${required.length} required tools present`)
    )
  }

  if (typeof cfg.namePattern !== 'string') out.push(makeResult(ctx, { ...base, id: 'profile.naming' }, 'NA', 'no name pattern configured'))
  else {
    let re: RegExp | null = null
    try {
      re = new RegExp(cfg.namePattern)
    } catch {
      /* invalid pattern reported below */
    }
    if (!re) out.push(makeResult(ctx, { ...base, id: 'profile.naming' }, 'ERROR', 'invalid namePattern regex'))
    else {
      const re2 = re
      const bad = tools.map((t) => t.name).filter((n) => !re2.test(n))
      out.push(makeResult(ctx, { ...base, id: 'profile.naming' }, bad.length ? 'FAIL' : 'PASS', bad.length ? `names not matching pattern: ${bad.join(', ')}` : 'all tool names match the pattern'))
    }
  }

  if (!cfg.requireDescriptions) out.push(makeResult(ctx, { ...base, id: 'profile.descriptions' }, 'NA', 'descriptions not required'))
  else {
    const bad = tools.filter((t) => !t.description || t.description.trim().length === 0).map((t) => t.name)
    out.push(makeResult(ctx, { ...base, id: 'profile.descriptions' }, bad.length ? 'FAIL' : 'PASS', bad.length ? `tools without description: ${bad.join(', ')}` : 'all tools have descriptions'))
  }
  return out
}

// ---- composite ----------------------------------------------------------

const PARTIAL_RE = /partial|unavailable|could not (reach|load)/i

async function composite(ctx: SpecialCtx): Promise<CheckResult[]> {
  const meta = { id: 'composite', kind: 'composite' as const, dimension: 'D2' as const }
  const b = bindOrResult(ctx, 'composite', meta)
  if ('result' in b) return [b.result]
  const m = { ...meta, boundBy: b.bound.boundBy }
  if (!ctx.mockB) return [makeResult(ctx, m, 'ERROR', 'no backend B mock view supplied')]
  const keys = Array.isArray(ctx.config.expectedKeys) ? (ctx.config.expectedKeys as unknown[]).map(String) : []
  if (keys.length === 0) return [makeResult(ctx, m, 'ERROR', 'config.expectedKeys is empty')]
  const hasAll = (o: ToolOutcome) => {
    const t = textBlob(o).toLowerCase()
    return keys.every((k) => t.includes(k.toLowerCase()))
  }

  ctx.mock.reset()
  ctx.mockB.reset()
  const first = await safeCall(ctx, b.bound.tool, b.bound.args)
  if (first.kind !== 'result' || first.isError) return [makeResult(ctx, m, 'FAIL', `joined call failed (${first.kind})`)]
  if (!hasAll(first)) return [makeResult(ctx, m, 'FAIL', 'joined result lacks fields from both backends')]

  ctx.mockB.inject({ fault: 'reset', times: 99 })
  let second: ToolOutcome
  try {
    second = await safeCall(ctx, b.bound.tool, b.bound.args)
  } finally {
    ctx.mockB.clearFaults()
  }
  const leak = leakOf(second)
  if (leak) return [makeResult(ctx, m, 'FAIL', `leak while backend B down (${leak})`, [{ id: 'LEAK', severity: 'blocker', detail: leak }])]
  if (second.kind === 'transport_error') return [makeResult(ctx, m, 'FAIL', 'transport failure while backend B down')]
  if (second.kind === 'rpc_error') return [makeResult(ctx, m, 'PASS', 'clean protocol error while backend B down')]
  if (second.isError) return [makeResult(ctx, m, 'PASS', 'clean error while backend B down')]
  if (PARTIAL_RE.test(second.text)) return [makeResult(ctx, m, 'PASS', 'explicit partial notice while backend B down')]
  return [makeResult(ctx, m, 'FAIL', 'confident answer without partial notice while backend B down')]
}

// ---- large_response -----------------------------------------------------

const TRUNC_RE = /truncat|showing \d+ of|more results/i

async function largeResponse(ctx: SpecialCtx): Promise<CheckResult[]> {
  const meta = { id: 'large_response', kind: 'large_response' as const, dimension: 'D4' as const }
  const b = bindOrResult(ctx, 'large_response', meta)
  if ('result' in b) return [b.result]
  const m = { ...meta, boundBy: b.bound.boundBy }
  const maxBytes = num(ctx.config.maxBytes, 65536)
  const maxItems = num(ctx.config.maxItems, 100)
  const o = await safeCall(ctx, b.bound.tool, b.bound.args)
  if (o.kind !== 'result') return [makeResult(ctx, m, 'FAIL', `no data (${o.kind})`)]
  if (o.isError) return [makeResult(ctx, m, 'FAIL', 'tool returned an error for the bulk query')]
  const blob = textBlob(o)
  const bytes = Buffer.byteLength(blob, 'utf8')
  const tokens = Math.ceil(bytes / 4) // documented approximation: bytes / 4
  const p = payload(o)
  const shown = findAllProducts(p).length
  const declared = p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>).total : undefined
  const total = typeof declared === 'number' ? declared : num(ctx.config.totalItems, 5000)
  if (bytes > maxBytes) return [makeResult(ctx, m, 'FAIL', `${bytes} bytes > ${maxBytes} (~${tokens} tokens, bytes/4)`)]
  if (shown > maxItems) return [makeResult(ctx, m, 'FAIL', `${shown} items > ${maxItems} (~${tokens} tokens, bytes/4)`)]
  const structured = o.structured as Record<string, unknown> | undefined
  const signal = (structured && typeof structured === 'object' && structured.truncated === true) || TRUNC_RE.test(o.text ?? '')
  if (shown < total && !signal) return [makeResult(ctx, m, 'FAIL', `silent cap: ${shown} of ${total} items shown without a truncation signal`)]
  return [makeResult(ctx, m, 'PASS', `${shown} items, ${bytes} bytes (~${tokens} tokens, bytes/4)${signal ? ', truncation signalled' : ''}`)]
}

export async function runTier3Check(
  kind: 'grounding' | 'profile' | 'composite' | 'large_response',
  ctx: SpecialCtx
): Promise<CheckResult[]> {
  try {
    switch (kind) {
      case 'grounding':
        return await grounding(ctx)
      case 'profile':
        return await profile(ctx)
      case 'composite':
        return await composite(ctx)
      case 'large_response':
        return await largeResponse(ctx)
    }
  } catch (e) {
    const dim: Dimension = kind === 'composite' ? 'D2' : kind === 'large_response' ? 'D4' : 'D3'
    return [makeResult(ctx, { id: kind, kind, dimension: dim }, 'ERROR', `check exception: ${errMsg(e)}`)]
  }
  return []
}
