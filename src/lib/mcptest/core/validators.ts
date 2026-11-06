// The 10 generic behaviour checks, pure over a ToolCaller. Never throws.
// Argument templating: string values in bound args may contain {{badId}}, {{pageSize}}, {{page}};
// they are substituted per check (a whole-string placeholder becomes a number where numeric).
import type { BehaviourKind, CheckResult, Dimension, ToolCaller, ToolOutcome } from './types'
import { leakReason, RUNTIME_LEAK_EXTRA } from './leak'
import { DEFAULT_ID_ALIASES, findAllProducts, findProductByValue, payload, productBelongsToPartition, textBlob } from './walk'
import { EMPTY_MSG_RE, NOT_FOUND_RE } from './expect'

export interface Identity {
  idKeys: string[]
  altKeys: string[]
  partitionKeys: string[]
  knownId: string
  knownAlt?: string
  badId: string
  partitionValue: string
  derivedKey?: string
  derivedValue?: string
  expectedDerivedIds: string[]
  maxPage: number
  projectionMax?: number
  ceilingPage?: number | null
  keyEnv?: string
}

export interface ValidatorCtx {
  caller: ToolCaller
  identity: Identity
  bind: (kind: BehaviourKind) => { tool?: string; args: Record<string, unknown>; boundBy: 'explicit' | 'hint' | 'none'; error?: string }
  relaunchWithKey?: (wrongKey: string) => Promise<ToolCaller | null>
  redact?: (s: string) => string
}

export const AUTH_RE = /auth|api ?key|unauthori[sz]ed|forbidden|invalid key|401|403/i
export const WRONG_KEY = 'wrong-key-0000'
const MAX_REASON = 200

const DIMENSIONS: Record<BehaviourKind, Dimension> = {
  lookup_by_id: 'D2',
  lookup_by_alt_key: 'D2',
  partition_filter: 'D2',
  derived_filter: 'D2',
  projection: 'D2',
  pagesize_clamp: 'D4',
  pagination_ceiling: 'D4',
  bad_input: 'D4',
  empty_vs_error: 'D4',
  auth_fail: 'D4'
}
export function behaviourDimension(kind: BehaviourKind): Dimension {
  return DIMENSIONS[kind]
}

type Verdict = { status: CheckResult['status']; reason: string }
const pass = (reason: string): Verdict => ({ status: 'PASS', reason })
const fail = (reason: string): Verdict => ({ status: 'FAIL', reason })
const na = (reason: string): Verdict => ({ status: 'NA', reason })

type Bound = { tool: string; args: Record<string, unknown> }

function fill(args: Record<string, unknown>, vars: Record<string, string | number>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string') {
      const whole = /^\{\{(\w+)\}\}$/.exec(v)
      if (whole && whole[1] in vars) out[k] = vars[whole[1]]
      else out[k] = v.replace(/\{\{(\w+)\}\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m))
    } else out[k] = v
  }
  return out
}

const leakOf = (o: ToolOutcome) => leakReason(textBlob(o), RUNTIME_LEAK_EXTRA)
const itemsOf = (o: ToolOutcome, ctx: ValidatorCtx) =>
  o.kind === 'result' ? findAllProducts(payload(o), ctx.identity.idKeys.length ? ctx.identity.idKeys : DEFAULT_ID_ALIASES) : []

type Check = (b: Bound, ctx: ValidatorCtx) => Promise<Verdict>
const run = (ctx: ValidatorCtx, b: Bound, args = b.args) => ctx.caller.call(b.tool, args)

const lookup = (valueOf: (i: Identity) => string | undefined, keysOf: (i: Identity) => string[]): Check => async (b, ctx) => {
  const o = await run(ctx, b)
  const value = valueOf(ctx.identity) as string
  if (o.kind !== 'result') return fail(`${o.kind}: no data`)
  const keys = Array.from(new Set([...keysOf(ctx.identity), ...(ctx.identity.idKeys ?? [])]))
  return findProductByValue(payload(o), keys, value) ? pass('item found under an id alias') : fail('known item not found in response')
}

const CHECKS: Record<BehaviourKind, Check> = {
  lookup_by_id: lookup((i) => i.knownId, (i) => i.idKeys),
  lookup_by_alt_key: lookup((i) => i.knownAlt, (i) => i.altKeys),

  async partition_filter(b, ctx) {
    const o = await run(ctx, b)
    const items = itemsOf(o, ctx)
    if (items.length === 0) return fail('no items returned')
    const { partitionKeys, partitionValue } = ctx.identity
    const stray = items.filter((it) => !productBelongsToPartition(it, partitionKeys, partitionValue)).length
    return stray === 0 ? pass(`${items.length} items all in partition`) : fail(`${stray} of ${items.length} items outside partition`)
  },

  async derived_filter(b, ctx) {
    const ids = ctx.identity.expectedDerivedIds
    if (!ids.length) return na('no expected derived ids')
    const o = await run(ctx, b)
    const text = textBlob(o).toLowerCase()
    const missing = ids.filter((id) => !text.includes(id.toLowerCase()))
    return missing.length === 0 ? pass('all expected ids present') : fail(`missing ${missing.length} of ${ids.length} expected ids`)
  },

  async projection(b, ctx) {
    const o = await run(ctx, b)
    const items = itemsOf(o, ctx)
    if (items.length === 0) return fail('no item returned')
    const cap = ctx.identity.projectionMax ?? 12
    const widest = Math.max(...items.map((d) => Object.keys(d).length))
    return widest <= cap ? pass(`widest item ${widest} <= ${cap} fields`) : fail(`item has ${widest} fields > ${cap}`)
  },

  async pagesize_clamp(b, ctx) {
    const max = ctx.identity.maxPage
    const o = await run(ctx, b, fill(b.args, { pageSize: max * 5 }))
    const leak = leakOf(o)
    if (leak) return fail(`leak (${leak})`)
    if (o.kind === 'result' && o.isError) return pass('clean reject of oversize page')
    if (o.kind === 'rpc_error') return pass('clean protocol reject of oversize page')
    const n = itemsOf(o, ctx).length
    return n > max ? fail(`${n} items > max ${max}`) : pass(`${n} items <= max ${max}`)
  },

  async pagination_ceiling(b, ctx) {
    const ceiling = ctx.identity.ceilingPage as number
    const o = await run(ctx, b, fill(b.args, { page: ceiling + 1 }))
    const leak = leakOf(o)
    return leak ? fail(`leak (${leak})`) : pass('no leak beyond ceiling')
  },

  async bad_input(b, ctx) {
    const o = await run(ctx, b, fill(b.args, { badId: ctx.identity.badId }))
    const leak = leakOf(o)
    if (leak) return fail(`leak (${leak})`)
    const signal = (o.kind === 'result' && o.isError) || o.kind === 'rpc_error' || NOT_FOUND_RE.test(textBlob(o))
    if (signal) return pass('explicit not-found signal')
    if (itemsOf(o, ctx).length > 0) return fail('returned an item for a bad id')
    return fail('no explicit not-found signal')
  },

  async empty_vs_error(b, ctx) {
    const o = await run(ctx, b)
    const leak = leakOf(o)
    if (leak) return fail(`leak (${leak})`)
    if (itemsOf(o, ctx).length > 0) return fail('items returned for an empty query')
    return EMPTY_MSG_RE.test(textBlob(o)) ? pass('empty result with message') : fail('raw empty result without message')
  },

  async auth_fail(b, ctx) {
    const relaunch = ctx.relaunchWithKey ? await ctx.relaunchWithKey(WRONG_KEY) : null
    if (!relaunch) return na('relaunch unavailable')
    const o = await relaunch.call(b.tool, b.args)
    const text = textBlob(o)
    const leak = leakReason(text, RUNTIME_LEAK_EXTRA)
    if (leak) return fail(`leak (${leak})`)
    if (o.kind === 'transport_error') return AUTH_RE.test(text) ? pass('transport error names auth') : fail('transport error without auth wording')
    return AUTH_RE.test(text) ? pass('auth failure reported') : fail('response does not signal an auth failure')
  }
}

/** Kinds that return NA before a tool is needed. */
function preNa(kind: BehaviourKind, ctx: ValidatorCtx): string | null {
  if (kind === 'lookup_by_alt_key' && !ctx.identity.knownAlt) return 'no alt key configured'
  if (kind === 'pagination_ceiling' && (ctx.identity.ceilingPage === null || ctx.identity.ceilingPage === undefined)) return 'case sets no ceiling'
  if (kind === 'auth_fail' && !ctx.relaunchWithKey) return 'relaunch unavailable'
  return null
}

export async function runBehaviourCheck(kind: BehaviourKind, ctx: ValidatorCtx): Promise<CheckResult> {
  let boundBy: CheckResult['boundBy'] = 'none'
  const finish = (status: CheckResult['status'], reason: string): CheckResult => {
    let r = reason
    try {
      if (ctx.redact) r = ctx.redact(r)
    } catch {
      r = '[redactor failed]'
    }
    if (r.length > MAX_REASON) r = r.slice(0, MAX_REASON - 3) + '...'
    return { id: kind, kind, dimension: DIMENSIONS[kind], status, boundBy, reason: r }
  }
  try {
    const skip = preNa(kind, ctx)
    if (skip) return finish('NA', skip)
    const spec = ctx.bind(kind)
    boundBy = spec.boundBy
    if (spec.error) return finish('ERROR', spec.error)
    if (!spec.tool) return finish('FAIL', 'no tool')
    const v = await CHECKS[kind]({ tool: spec.tool, args: spec.args }, ctx)
    return finish(v.status, v.reason)
  } catch (e) {
    return finish('ERROR', `validator exception: ${e instanceof Error ? e.message : String(e)}`)
  }
}
