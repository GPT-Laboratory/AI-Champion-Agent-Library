// The signature a baseline tool has in the emitted Python, derived from the plan. It mirrors the
// builders in emit/python.ts; signature.test.ts compares it with the emitted `def` lines for every
// golden sample, so the two cannot drift apart unnoticed.
import { DERIVED_MAX_PAGES, effectiveMaxPageSize, toolKind } from '../plan.js'
import type { Operation, Param, PlannedTool, ServerPlan } from '../types.js'
import type { ArgEdit, ArgType, SigArg } from './model.js'

const I32 = 2147483647

function fromParam(p: Param): SigArg {
  const a: SigArg = {
    name: p.name,
    type: (p.type === 'unknown' ? 'string' : p.type) as ArgType,
    required: p.required || p.in === 'path',
  }
  if (p.enum && p.enum.length > 0) a.enum = p.enum.map(String)
  if (p.min !== undefined) a.min = p.min
  if (p.max !== undefined) a.max = p.max
  if (p.description) a.description = p.description
  return a
}

const FIELDS: SigArg = { name: 'fields', type: 'array', required: false }

function opOf(plan: ServerPlan, tool: PlannedTool): Operation | undefined {
  return plan.model.operations.find((o) => o.id === tool.operation)
}

const STD_DESC: Record<string, string> = {
  fields: 'Optional list of field names to return (at most 12; unknown names are ignored).',
  page: 'Page number, starting at 1.',
  page_size: 'Rows per page; larger values are reduced to the maximum.',
  limit: 'Rows to return; larger values are reduced to the maximum.',
  offset: 'Rows to skip, for paging.',
  field: 'Field to filter on.',
  value: 'Value to match.',
  match: 'equals, contains or startsWith.',
  key: 'Key to look for in the nested entries.',
  max_pages: 'Candidate pages to scan, 1 to 10.',
}

/** Baseline signature, in emitted order. Tools a proposal created carry their own `wrapper.params`. */
export function baselineSignature(plan: ServerPlan, tool: PlannedTool): SigArg[] {
  if (tool.proposed?.wrapper) {
    const ps = tool.proposed.wrapper.params
    return [...ps.filter((p) => p.required && p.default === undefined), ...ps.filter((p) => !(p.required && p.default === undefined))]
  }
  const own = new Set(tool.params.map((p) => p.name))
  return rawSignature(plan, tool).map((a) => (a.description || own.has(a.name) || !STD_DESC[a.name] ? a : { ...a, description: STD_DESC[a.name] }))
}

function rawSignature(plan: ServerPlan, tool: PlannedTool): SigArg[] {
  const kind = toolKind(plan, tool)
  const required = tool.params.filter((p) => p.required || p.in === 'path').map(fromParam)
  const optional = tool.params.filter((p) => !(p.required || p.in === 'path')).map(fromParam)
  if (kind === 'describe') return []
  if (kind === 'query') {
    const max = effectiveMaxPageSize(plan.model)
    return [
      { name: 'field', type: 'string', required: false },
      { name: 'value', type: 'string', required: false },
      { name: 'match', type: 'string', required: false, default: 'equals', enum: ['equals', 'contains', 'startsWith'] },
      FIELDS,
      { name: 'limit', type: 'integer', required: false, default: Math.min(20, max), min: 1, max },
      { name: 'offset', type: 'integer', required: false, default: 0, min: 0, max: 1_000_000_000 },
    ]
  }
  const op = opOf(plan, tool)
  if (!op) return [...required, ...optional, FIELDS]
  if (kind === 'get') return [...required, ...optional, FIELDS]
  const max = effectiveMaxPageSize(plan.model, op)
  if (kind === 'filter') {
    return [
      ...required,
      { name: 'key', type: 'string', required: true },
      { name: 'value', type: 'string', required: false },
      ...optional,
      { name: 'max_pages', type: 'integer', required: false, default: Math.min(5, DERIVED_MAX_PAGES), min: 1, max: DERIVED_MAX_PAGES },
      FIELDS,
    ]
  }
  const out: SigArg[] = [...required]
  if (op.pageParam) out.push({ name: 'page', type: 'integer', required: false, default: 1, min: 1, max: 1_000_000 })
  if (op.pageSizeParam) out.push({ name: 'page_size', type: 'integer', required: false, default: Math.min(20, max), min: 1, max })
  out.push(...optional, FIELDS)
  return out
}

/** Signature after the argument edits of the tool (pins removed, renames and defaults applied). */
export function finalSignature(plan: ServerPlan, tool: PlannedTool): SigArg[] {
  const edits = tool.proposed?.args
  const base = baselineSignature(plan, tool)
  if (!edits || tool.proposed?.wrapper) return base
  const out: SigArg[] = []
  for (const a of base) {
    const e: ArgEdit | undefined = Object.prototype.hasOwnProperty.call(edits, a.name) ? edits[a.name] : undefined
    if (!e) {
      out.push(a)
      continue
    }
    if (e.pin !== undefined) continue
    const next: SigArg = { ...a, name: e.name ?? a.name }
    if (e.description) next.description = e.description
    if (e.keepAlias && e.name) {
      // New name optional with no default; the alias keeps the effective default (the emitter does the same).
      const effective = e.default !== undefined ? e.default : a.default
      const alias: SigArg = { ...a, required: false, description: `Alias of ${e.name}.` }
      delete alias.default
      if (effective !== undefined) alias.default = effective
      const fresh: SigArg = { ...next, required: false }
      delete fresh.default
      out.push(fresh, alias)
      continue
    }
    if (e.default !== undefined) {
      next.default = e.default
      next.required = false
    }
    out.push(next)
  }
  // Python needs arguments without a default first; the stable partition is what the emitter does.
  return [...out.filter((x) => x.required), ...out.filter((x) => !x.required)]
}

/** Largest value an integer argument may take (the signature clamp), or undefined. */
export function argMax(a: SigArg): number | undefined {
  return a.max === undefined || a.max >= I32 ? undefined : a.max
}

/** Scalar arguments may be fixed or defaulted to a constant; lists may not. */
export function isScalar(a: SigArg): boolean {
  return a.type !== 'array'
}
