// Tier 4 special checks: fault handling, secret and write safety, domain codes. Raise risk flags.
// Run against any ToolCaller plus a MockView; never throw. Core purity: no $lib imports.
import type { CheckResult, FlagHit, ToolOutcome } from './types'
import { findAllProducts, payload, textBlob } from './walk'
import { bindOrResult, errMsg, leakOf, makeResult, num, safeCall, type SpecialCtx } from './tier3Checks'

export type { SpecialCtx } from './tier3Checks'

const D4 = 'D4' as const
const leakFlag = (rule: string): FlagHit => ({ id: 'LEAK', severity: 'blocker', detail: rule })

const isErrorish = (o: ToolOutcome) => o.kind === 'rpc_error' || (o.kind === 'result' && o.isError)

/** First string-valued argument key of the bound args, else the fallback. */
function firstStringKey(args: Record<string, unknown>, fallback: string): string {
  return Object.keys(args).find((k) => typeof args[k] === 'string') ?? fallback
}

// ---- fault_retry --------------------------------------------------------

const MIN_ATTEMPTS = 2
const MAX_ATTEMPTS = 6 // tolerant window (Pitfall 9): any bounded retry count in [2, 6] is accepted

async function faultRetry(ctx: SpecialCtx): Promise<CheckResult[]> {
  const meta = { id: 'fault_retry', kind: 'fault_retry' as const, dimension: D4 }
  const b = bindOrResult(ctx, 'fault_retry', meta)
  if ('result' in b) return [b.result]
  const m = { ...meta, boundBy: b.bound.boundBy }
  const route = typeof ctx.config.route === 'string' ? ctx.config.route : '/items'
  const callTimeout = num(ctx.config.callTimeoutMs, 15000)
  const scenarios = [
    { label: '429', status: 429, times: 2, headers: { 'Retry-After': '0' } },
    { label: '500', status: 500, times: 1, headers: undefined },
    { label: '503', status: 503, times: 1, headers: undefined }
  ]
  const problems: string[] = []
  const flags: FlagHit[] = []
  for (const s of scenarios) {
    ctx.mock.reset()
    ctx.mock.inject({ route, fault: 'status', status: s.status, times: s.times, headers: s.headers })
    const o = await safeCall(ctx, b.bound.tool, b.bound.args, callTimeout)
    const attempts = ctx.mock.log().filter((e) => e.rawPath.startsWith(route)).length
    ctx.mock.clearFaults()
    const leak = leakOf(o)
    if (leak) {
      problems.push(`${s.label}: leak`)
      flags.push(leakFlag(leak))
      continue
    }
    const success = o.kind === 'result' && !o.isError
    if (attempts > MAX_ATTEMPTS) problems.push(`${s.label}: unbounded retries (${attempts} attempts)`)
    else if (attempts < MIN_ATTEMPTS && !success) {
      problems.push(`${s.label}: no retry (${attempts} attempt)`)
      flags.push({ id: 'NO_RETRY', severity: 'warning', detail: `${s.label} not retried` })
    } else if (!success) problems.push(`${s.label}: still failing after ${attempts} attempts`)
  }
  if (problems.length === 0) return [makeResult(ctx, m, 'PASS', 'transient 429/500/503 retried within bounds and recovered')]
  return [makeResult(ctx, m, 'FAIL', problems.join('; '), flags)]
}

// ---- fault_timeout ------------------------------------------------------

async function faultTimeout(ctx: SpecialCtx): Promise<CheckResult[]> {
  const meta = { id: 'fault_timeout', kind: 'fault_timeout' as const, dimension: D4 }
  const b = bindOrResult(ctx, 'fault_timeout', meta)
  if ('result' in b) return [b.result]
  const m = { ...meta, boundBy: b.bound.boundBy }
  const now = ctx.now ?? Date.now
  const timeoutMs = num(ctx.config.timeoutMs, 2000)
  const slackMs = num(ctx.config.slackMs, 3000)
  ctx.mock.reset()
  ctx.mock.inject({ fault: 'timeout', times: 1 })
  const t0 = now()
  const o = await safeCall(ctx, b.bound.tool, b.bound.args, timeoutMs)
  const elapsed = now() - t0
  ctx.mock.clearFaults()
  const leak = leakOf(o)
  if (leak) return [makeResult(ctx, m, 'FAIL', `leak on timeout (${leak})`, [leakFlag(leak)])]
  if (o.kind === 'transport_error') {
    return [makeResult(ctx, m, 'FAIL', o.timedOut ? `no response before the ${timeoutMs}ms deadline` : 'transport failure instead of a tool-level answer')]
  }
  if (elapsed > timeoutMs + slackMs) return [makeResult(ctx, m, 'FAIL', `answered after ${elapsed}ms, deadline ${timeoutMs}ms + ${slackMs}ms slack`)]
  if (o.kind === 'result' && !o.isError && findAllProducts(payload(o)).length > 0) {
    return [makeResult(ctx, m, 'FAIL', 'returned items although the upstream timed out')]
  }
  return [makeResult(ctx, m, 'PASS', `returned a clean answer within ${elapsed}ms`)]
}

// ---- fault_malformed ----------------------------------------------------

const MALFORMED_MODES = ['truncated_json', 'html', 'empty', 'wrong_content_type'] as const

async function faultMalformed(ctx: SpecialCtx): Promise<CheckResult[]> {
  const meta = { id: 'fault_malformed', kind: 'fault_malformed' as const, dimension: D4 }
  const b = bindOrResult(ctx, 'fault_malformed', meta)
  if ('result' in b) return [b.result]
  const m = { ...meta, boundBy: b.bound.boundBy }
  const callTimeout = num(ctx.config.callTimeoutMs, 15000)
  const problems: string[] = []
  const flags: FlagHit[] = []
  for (const mode of MALFORMED_MODES) {
    ctx.mock.reset()
    ctx.mock.inject({ fault: 'malformed', mode, times: 1 })
    const o = await safeCall(ctx, b.bound.tool, b.bound.args, callTimeout)
    ctx.mock.clearFaults()
    const leak = leakOf(o)
    if (leak) {
      problems.push(`${mode}: leak`)
      flags.push(leakFlag(leak))
    } else if (o.kind === 'transport_error') problems.push(`${mode}: transport failure`)
    else if (isErrorish(o)) continue
    else if (findAllProducts(payload(o)).length > 0) {
      problems.push(`${mode}: items returned from a malformed upstream`)
      flags.push({ id: 'CONFIDENT_WRONG', severity: 'blocker', detail: `${mode}: fabricated items` })
    }
  }
  if (problems.length === 0) return [makeResult(ctx, m, 'PASS', 'malformed upstream bodies reported cleanly')]
  return [makeResult(ctx, m, 'FAIL', problems.join('; '), flags)]
}

// ---- secret_canary ------------------------------------------------------

const WRITE_NAME_RE = /^(delete|create|update|remove|post|put|patch|write|insert)_/i
const INJECTIONS: { label: string; value: string }[] = [
  { label: 'path traversal', value: '../etc/x' },
  { label: 'sql-like quote', value: "'; --" },
  { label: 'encoded NUL', value: '%00' },
  { label: 'long string', value: 'a'.repeat(5000) }
]

async function secretCanary(ctx: SpecialCtx): Promise<CheckResult[]> {
  const base = { kind: 'secret_canary' as const, dimension: D4 }
  const b = bindOrResult(ctx, 'secret_canary', { id: 'secret_canary', ...base })
  if ('result' in b) return [b.result]
  const m = { ...base, boundBy: b.bound.boundBy }
  const callTimeout = num(ctx.config.callTimeoutMs, 15000)
  const out: CheckResult[] = []

  // 1. canary echo across every tool and stderr
  ctx.mock.reset()
  let echoedIn: string | null = null
  const leaks: string[] = []
  for (const t of ctx.caller.tools) {
    const args = t.name === b.bound.tool ? b.bound.args : {}
    const o = await safeCall(ctx, t.name, args, callTimeout)
    const blob = textBlob(o)
    if (ctx.canary && blob.includes(ctx.canary) && !echoedIn) echoedIn = `tool output of ${t.name}`
    const leak = leakOf(o)
    if (leak) leaks.push(leak)
  }
  let err = ''
  try {
    err = ctx.stderr ? ctx.stderr() : ''
  } catch {
    /* stderr unavailable */
  }
  if (ctx.canary && !echoedIn && err.includes(ctx.canary)) echoedIn = 'server stderr'
  const echoFlags: FlagHit[] = []
  if (echoedIn) echoFlags.push({ id: 'SECRET_ECHO', severity: 'blocker', detail: `canary found in ${echoedIn}` })
  if (leaks.length) echoFlags.push(leakFlag(leaks[0]))
  if (!ctx.canary) out.push(makeResult(ctx, { ...m, id: 'secret_canary.echo' }, 'ERROR', 'no canary value configured'))
  else if (echoFlags.length) out.push(makeResult(ctx, { ...m, id: 'secret_canary.echo' }, 'FAIL', echoedIn ? `canary found in ${echoedIn}` : `leak (${leaks[0]})`, echoFlags))
  else out.push(makeResult(ctx, { ...m, id: 'secret_canary.echo' }, 'PASS', 'canary absent from tool output and stderr'))

  // 2. write detection (names, annotations, non-GET upstream traffic from step 1)
  const writeTools = ctx.caller.tools.filter((t) => WRITE_NAME_RE.test(t.name) || t.annotations?.readOnlyHint === false).map((t) => t.name)
  const nonGet = ctx.mock.log().filter((e) => e.method !== 'GET' && e.method !== 'HEAD')
  if (writeTools.length || nonGet.length) {
    const why = [
      writeTools.length ? `write-like tools: ${writeTools.join(', ')}` : '',
      nonGet.length ? `non-GET upstream requests: ${Array.from(new Set(nonGet.map((e) => e.method))).join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('; ')
    out.push(makeResult(ctx, { ...m, id: 'secret_canary.write_tools' }, 'FAIL', why, [{ id: 'WRITE_TOOL', severity: 'blocker', detail: why }]))
  } else out.push(makeResult(ctx, { ...m, id: 'secret_canary.write_tools' }, 'PASS', 'read-only tool surface and GET-only upstream traffic'))

  // 3. injection through the bound lookup tool
  const argKey = typeof ctx.config.injectionArg === 'string' ? ctx.config.injectionArg : firstStringKey(b.bound.args, 'q')
  const problems: string[] = []
  const injFlags: FlagHit[] = []
  for (const inj of INJECTIONS) {
    ctx.mock.reset()
    const o = await safeCall(ctx, b.bound.tool, { ...b.bound.args, [argKey]: inj.value }, callTimeout)
    const leak = leakOf(o)
    if (leak) {
      problems.push(`${inj.label}: leak`)
      injFlags.push(leakFlag(leak))
    }
    const bad = ctx.mock.log().find((e) => e.rawPath.includes('/../') || e.rawPath.includes('\0') || e.rawPath.includes("'; --"))
    if (bad) problems.push(`${inj.label}: unescaped input reached the upstream path`)
  }
  out.push(
    problems.length
      ? makeResult(ctx, { ...m, id: 'secret_canary.injection' }, 'FAIL', problems.join('; '), injFlags)
      : makeResult(ctx, { ...m, id: 'secret_canary.injection' }, 'PASS', 'hostile input reached the upstream only escaped')
  )
  return out
}

// ---- i18n_codes ---------------------------------------------------------

async function i18nCodes(ctx: SpecialCtx): Promise<CheckResult[]> {
  const base = { kind: 'i18n_codes' as const, dimension: D4 }
  const b = bindOrResult(ctx, 'i18n_codes', { id: 'i18n_codes', ...base })
  if ('result' in b) return [b.result]
  const m = { ...base, boundBy: b.bound.boundBy }
  const cfg = ctx.config as { invalidCode?: unknown; validCode?: unknown; expectedName?: unknown; codeArg?: unknown; route?: unknown }
  if (typeof cfg.invalidCode !== 'string' || typeof cfg.validCode !== 'string' || typeof cfg.expectedName !== 'string') {
    return [makeResult(ctx, { ...m, id: 'i18n_codes.invalid' }, 'ERROR', 'config needs invalidCode, validCode and expectedName')]
  }
  const route = typeof cfg.route === 'string' ? cfg.route : '/products'
  const key = typeof cfg.codeArg === 'string' ? cfg.codeArg : firstStringKey(b.bound.args, 'code')
  const callTimeout = num(ctx.config.callTimeoutMs, 15000)
  const out: CheckResult[] = []

  ctx.mock.reset()
  const bad = await safeCall(ctx, b.bound.tool, { ...b.bound.args, [key]: cfg.invalidCode }, callTimeout)
  const forwarded = ctx.mock.hits(route)
  if (forwarded > 0) {
    const detail = `invalid code was forwarded upstream (${forwarded} request${forwarded === 1 ? '' : 's'})`
    out.push(makeResult(ctx, { ...m, id: 'i18n_codes.invalid' }, 'FAIL', detail, [{ id: 'UNVALIDATED_CODE', severity: 'warning', detail }]))
  } else if (!isErrorish(bad)) out.push(makeResult(ctx, { ...m, id: 'i18n_codes.invalid' }, 'FAIL', 'invalid code did not produce an error'))
  else out.push(makeResult(ctx, { ...m, id: 'i18n_codes.invalid' }, 'PASS', 'invalid code rejected before any upstream request'))

  ctx.mock.reset()
  const good = await safeCall(ctx, b.bound.tool, { ...b.bound.args, [key]: cfg.validCode }, callTimeout)
  if (good.kind !== 'result' || good.isError) out.push(makeResult(ctx, { ...m, id: 'i18n_codes.roundtrip' }, 'FAIL', `valid code failed (${good.kind})`))
  else if (textBlob(good).includes(cfg.expectedName)) out.push(makeResult(ctx, { ...m, id: 'i18n_codes.roundtrip' }, 'PASS', 'non-ASCII name round-tripped intact'))
  else out.push(makeResult(ctx, { ...m, id: 'i18n_codes.roundtrip' }, 'FAIL', 'expected non-ASCII name missing or corrupted'))
  return out
}

export async function runTier4Check(
  kind: 'fault_retry' | 'fault_timeout' | 'fault_malformed' | 'secret_canary' | 'i18n_codes',
  ctx: SpecialCtx
): Promise<CheckResult[]> {
  try {
    switch (kind) {
      case 'fault_retry':
        return await faultRetry(ctx)
      case 'fault_timeout':
        return await faultTimeout(ctx)
      case 'fault_malformed':
        return await faultMalformed(ctx)
      case 'secret_canary':
        return await secretCanary(ctx)
      case 'i18n_codes':
        return await i18nCodes(ctx)
    }
  } catch (e) {
    return [makeResult(ctx, { id: kind, kind, dimension: D4 }, 'ERROR', `check exception: ${errMsg(e)}`)]
  }
  return []
}
