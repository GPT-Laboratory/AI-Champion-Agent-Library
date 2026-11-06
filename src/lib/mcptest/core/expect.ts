// Golden `expect` evaluator. Source key names are kept so source golden files still load.
// clean_not_found is STRICT (deliberate deviation from the lenient source rule).
import type { Expect, ToolOutcome } from './types'
import type { Identity } from './validators'
import { leakReason, RUNTIME_LEAK_EXTRA } from './leak'
import { DEFAULT_ID_ALIASES, findAllProducts, findDictWithField, iterDicts, payload, textBlob } from './walk'

export const NOT_FOUND_RE = /not found|no product|no match|does ?n[o']t exist/i
export const EMPTY_MSG_RE = /no match|no product|no result|0 result|zero result|empty|no matching/i
const MAX_REASON = 200

const cap = (s: string) => (s.length > MAX_REASON ? s.slice(0, MAX_REASON - 3) + '...' : s)

function lookupValues(p: unknown, key: string, aliases: string[]): unknown[] {
  const keys = aliases.length ? aliases : [key]
  const out: unknown[] = []
  for (const d of iterDicts(p)) for (const k of keys) if (k in d) out.push(d[k])
  return out
}

function matches(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a === 'object' || typeof b === 'object') return false
  return String(a).toLowerCase() === String(b).toLowerCase()
}

function statusCategory(outcome: ToolOutcome, p: unknown, text: string, want: string | number): boolean {
  if (typeof want === 'number') {
    if (outcome.kind === 'rpc_error' && outcome.code === want) return true
    return new RegExp(`\\b${want}\\b`).test(text)
  }
  for (const d of iterDicts(p)) {
    if (typeof d.kind === 'string' && d.kind.toLowerCase() === want.toLowerCase()) return true
  }
  const res: Record<string, RegExp> = {
    auth: /auth|api ?key|unauthori[sz]ed|forbidden|invalid key|401|403/i,
    not_found: NOT_FOUND_RE,
    upstream: /upstream|unavailable|timed? ?out|bad gateway|5\d\d|rate limit|429/i
  }
  return (res[want] ?? new RegExp(want, 'i')).test(text)
}

export function evaluateExpect(
  expect: Expect,
  outcome: ToolOutcome,
  identity?: Partial<Identity>
): { ok: boolean; reason: string; leak?: string } {
  const idKeys = identity?.idKeys?.length ? identity.idKeys : DEFAULT_ID_ALIASES
  const text = textBlob(outcome)
  const leak = leakReason(text, RUNTIME_LEAK_EXTRA)
  const isResult = outcome.kind === 'result'
  const p = payload(outcome)
  const items = isResult ? findAllProducts(p, idKeys) : []
  const fail = (why: string) => ({ ok: false, reason: cap(why), ...(leak ? { leak } : {}) })
  const dataNeeded = (key: string) => (isResult ? null : fail(`${key}: no data (${outcome.kind})`))

  if (expect.no_leak && leak) return fail(`leak detected (${leak})`)

  if (expect.no_error) {
    if (!isResult) return fail(`no_error: ${outcome.kind}`)
    if (outcome.isError) return fail('no_error: tool returned isError')
  }

  if (expect.field_value) {
    const bad = dataNeeded('field_value')
    if (bad) return bad
    for (const [key, want] of Object.entries(expect.field_value)) {
      const aliases = identity?.idKeys?.includes(key) ? identity.idKeys : []
      const vals = lookupValues(p, key, aliases)
      if (!vals.some((v) => matches(v, want))) return fail(`field_value: ${key} != expected value`)
    }
  }

  const present = ([] as string[]).concat(expect.field_present ?? [], expect.fields_present ?? [])
  if (present.length) {
    const bad = dataNeeded('field_present')
    if (bad) return bad
    for (const f of present) if (!findDictWithField(p, [f])) return fail(`field_present: missing ${f}`)
  }

  if (expect.clean_not_found) {
    const signal = (isResult && outcome.isError) || outcome.kind === 'rpc_error' || NOT_FOUND_RE.test(text)
    if (leak) return fail(`clean_not_found: leak (${leak})`)
    if (!signal) return fail('clean_not_found: no explicit not-found signal')
    if (items.length > 0) return fail('clean_not_found: an item was returned')
  }

  if (expect.empty_with_message) {
    if (leak) return fail(`empty_with_message: leak (${leak})`)
    if (items.length > 0) return fail(`empty_with_message: ${items.length} items returned`)
    if (!EMPTY_MSG_RE.test(text)) return fail('empty_with_message: no empty-result message')
  }

  if (expect.max_items !== undefined) {
    const bad = dataNeeded('max_items')
    if (bad) return bad
    if (items.length > expect.max_items) return fail(`max_items: ${items.length} > ${expect.max_items}`)
  }

  if (expect.max_fields !== undefined) {
    const bad = dataNeeded('max_fields')
    if (bad) return bad
    const widest = items.reduce((m, d) => Math.max(m, Object.keys(d).length), 0)
    if (widest > expect.max_fields) return fail(`max_fields: ${widest} > ${expect.max_fields}`)
  }

  if (expect.status_category !== undefined) {
    if (!statusCategory(outcome, p, text, expect.status_category)) {
      return fail(`status_category: ${String(expect.status_category)} not signalled`)
    }
  }

  return { ok: true, reason: 'ok', ...(leak ? { leak } : {}) }
}
