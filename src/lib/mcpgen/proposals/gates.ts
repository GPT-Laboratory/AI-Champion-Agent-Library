// Gates 2 to 4 of the proposal layer (gate 1 is the schema, gate 5 the fingerprint; see index.ts).
// All deterministic and pure. Every issue has a stable code and names the op id; messages never
// contain a proposal value except through show(), which replaces anything secret-looking.
//
//   2 grounding : every referenced tool, argument, entity, field, nested collection and step exists
//   3 safety    : names, text hygiene, constants, selector grammar
//   4 structure : counts, collisions, conflicts, orphans, cycles, read-only composites, last tool
import { DERIVED_MAX_PAGES, MAX_TOOL_NAME, PROJECTION_MAX_FIELDS, PY_KEYWORDS, RESERVED_NAMES, effectiveMaxPageSize, entityFieldNames, safeParamName, toolKind } from '../plan.js'
import type { Entity, PlannedTool, ServerPlan } from '../types.js'
import { show, textCodes } from './hygiene.js'
import type { Const, SigArg } from './model.js'
import { LIMITS, MAX_NEW_TOOLS, NAME_RE, type ProposalOp } from './schema.js'
import { parseSelector } from './selector.js'
import { baselineSignature } from './signature.js'

export interface Issue {
  gate: 1 | 2 | 3 | 4 | 5
  code: string
  opId: string
  message: string
}

const WRITE_VERB = /^(?:create|update|delete|post|put|patch|remove|write|drop|insert|set|execute|exec|run|truncate|alter|save|send|add)_/
const SECRET_ARG = /key|token|secret|passw|auth|credential|bearer|session|cookie/i
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export interface GateCtx {
  plan: ServerPlan
  tools: Map<string, PlannedTool>
  sigs: Map<string, SigArg[]>
  entities: Map<string, Entity>
  allowedNumbers: Set<number>
}

/** Context over the (expanded) baseline plan the ops are grounded in. */
export function makeCtx(plan: ServerPlan): GateCtx {
  const tools = new Map(plan.tools.map((t) => [t.name, t]))
  const sigs = new Map(plan.tools.map((t) => [t.name, baselineSignature(plan, t)]))
  const entities = new Map(plan.model.entities.map((e) => [e.id, e]))
  const nums = new Set<number>([1, PROJECTION_MAX_FIELDS, DERIVED_MAX_PAGES, LIMITS.compositeTotalCalls, LIMITS.compositeSteps, LIMITS.mergeFanout])
  for (const t of plan.tools) {
    const op = plan.model.operations.find((o) => o.id === t.operation)
    nums.add(effectiveMaxPageSize(plan.model, op))
  }
  nums.add(effectiveMaxPageSize(plan.model))
  nums.add(plan.model.limits.maxResponseItems)
  if (plan.model.limits.resultCeiling !== undefined) nums.add(plan.model.limits.resultCeiling)
  return { plan, tools, sigs, entities, allowedNumbers: nums }
}

type Push = (gate: Issue['gate'], code: string, op: { id: string }, message: string) => void

function nameCodes(kind: 'tool' | 'arg' | 'value' | 'step', name: string): string[] {
  const out: string[] = []
  if (!NAME_RE[kind].test(name)) out.push('bad-name')
  if (kind === 'tool') {
    if (name.length > MAX_TOOL_NAME) out.push('bad-name')
    if (PY_KEYWORDS.has(name) || RESERVED_NAMES.has(name)) out.push('reserved-name')
    if (WRITE_VERB.test(name)) out.push('write-verb-name')
  } else if (kind === 'arg') {
    if (!safeParamName(name, new Set(), true)) out.push('reserved-name')
  } else if (kind === 'step') {
    if (['input', 'item'].includes(name) || PY_KEYWORDS.has(name)) out.push('reserved-name')
  }
  return [...new Set(out)]
}

function checkName(push: Push, op: { id: string }, kind: 'tool' | 'arg' | 'value' | 'step', name: string, what: string) {
  for (const c of nameCodes(kind, name)) {
    const code = c === 'bad-name' ? `bad-${what}-name` : c === 'reserved-name' ? `reserved-${what}-name` : c
    push(3, code, op, `The ${what} name ${show(name)} is not allowed (${c}).`)
  }
}

function checkText(push: Push, op: { id: string }, ctx: GateCtx, text: string, kind: 'description' | 'constant' | 'reason', limit: number, label: string) {
  if (text.length > limit) push(3, 'text-too-long', op, `The ${label} is longer than ${limit} characters.`)
  for (const c of textCodes(text, { kind, allowedNumbers: ctx.allowedNumbers })) push(3, c, op, `The ${label} was rejected (${c}).`)
}

/** Problems with a constant given for an argument (default, pin, preset, composite constant). */
function constIssues(push: Push, op: { id: string }, ctx: GateCtx, a: SigArg, v: Const, tool: string) {
  const where = `${show(tool)}.${show(a.name)}`
  if (SECRET_ARG.test(a.name)) push(3, 'secret-arg', op, `${where} looks like a credential argument; a constant can never be set for it.`)
  if (a.type === 'array') return void push(3, 'value-not-scalar', op, `${where} takes a list; only scalar arguments can be set to a constant.`)
  const okType =
    (a.type === 'string' && typeof v === 'string') ||
    (a.type === 'integer' && typeof v === 'number' && Number.isInteger(v)) ||
    (a.type === 'number' && typeof v === 'number' && Number.isFinite(v)) ||
    (a.type === 'boolean' && typeof v === 'boolean')
  if (!okType) return void push(3, 'value-type', op, `The value for ${where} does not match its type (${a.type}).`)
  if (typeof v === 'string') {
    for (const c of textCodes(v, { kind: 'constant' })) push(3, c === 'text-credential' ? 'value-secret' : `value-${c.slice(5)}`, op, `The value for ${where} was rejected (${c}).`)
  }
  if (a.enum && a.enum.length > 0 && !a.enum.includes(String(v))) push(3, 'value-enum', op, `The value for ${where} is not one of the allowed values.`)
  if (typeof v === 'number') {
    if (a.min !== undefined && v < a.min) push(3, 'value-range', op, `The value for ${where} is below its minimum.`)
    if (a.max !== undefined && v > a.max) push(3, 'value-range', op, `The value for ${where} is above its maximum.`)
  }
}

// ---- shapes of tool results, for selector grounding ----

type Shape = 'any' | 'scalar' | { obj: Map<string, Shape> } | { list: Shape }

function rowShape(ctx: GateCtx, tool: PlannedTool, available: string[]): Shape {
  if (tool.entity === '*') return 'any'
  void ctx
  return { obj: new Map(available.map((f) => [f, 'any' as Shape])) }
}

function calleeShape(ctx: GateCtx, tool: PlannedTool, available: string[]): Shape {
  const kind = toolKind(ctx.plan, tool)
  if (kind === 'describe') return 'any'
  const row = rowShape(ctx, tool, available)
  const scalar = (...k: string[]) => k.map((x) => [x, 'scalar' as Shape] as const)
  if (kind === 'get') return { obj: new Map<string, Shape>([...scalar('ok', 'message', 'hint', 'kind'), ['result', row]]) }
  return {
    obj: new Map<string, Shape>([
      ...scalar('ok', 'count', 'page', 'page_size', 'offset', 'limit', 'total_matches', 'warning', 'message', 'hint'),
      ['coverage', 'any'],
      ['results', { list: row }],
    ]),
  }
}

/** Follow a path through a shape; returns the reached shape or an error code. */
function walkShape(shape: Shape, path: (string | number)[], entityFields: Set<string>): { shape: Shape } | { code: string } {
  let cur = shape
  for (const seg of path) {
    if (cur === 'any') return { shape: 'any' }
    if (cur === 'scalar') return { code: 'unknown-selector-target' }
    if ('list' in cur) {
      if (typeof seg !== 'number') return { code: 'unknown-selector-target' }
      cur = cur.list
    } else {
      if (typeof seg !== 'string') return { code: 'unknown-selector-target' }
      const next = cur.obj.get(seg)
      if (next === undefined) return { code: entityFields.has(seg) ? 'field-not-projected' : 'unknown-selector-target' }
      cur = next
    }
  }
  return { shape: cur }
}

/** Final projection per entity: a set_projection op wins over the baseline. */
function projectionOf(ctx: GateCtx, ops: ProposalOp[], entity: string): string[] {
  for (const o of ops) if (o.op === 'set_projection' && o.entity === entity) return o.fields
  return ctx.plan.tools.find((t) => t.entity === entity)?.projection ?? []
}

/** Runs gates 2 to 4 over shape-valid ops. Order of issues is stable: by op order, then gate, then code. */
export function checkOps(ops: ProposalOp[], ctx: GateCtx): Issue[] {
  const issues: Issue[] = []
  const push: Push = (gate, code, op, message) => issues.push({ gate, code, opId: op.id, message })
  const baseNames = new Set(ctx.tools.keys())
  const created = new Map<string, string>() // new tool name -> op id
  const createdRefs = new Map<string, string[]>() // created name -> created names it refers to

  // ---- op ids ----
  const seenIds = new Set<string>()
  for (const op of ops) {
    if (seenIds.has(op.id)) push(4, 'duplicate-op-id', op, `The op id ${show(op.id)} is used more than once.`)
    seenIds.add(op.id)
  }
  if (ops.length > 64) push(4, 'too-many-ops', { id: '-' }, 'The proposal has more than 64 ops.')

  // Names of tools the ops create (needed to tell "unknown tool" from "refers to a proposed tool").
  for (const op of ops) {
    if (op.op === 'merge_tools' || op.op === 'composite_tool') created.set(op.name, op.id)
    if (op.op === 'split_tool') for (const t of op.tools) created.set(t.name, op.id)
  }

  const toolGround = (op: { id: string }, name: string): PlannedTool | undefined => {
    const hit = ctx.tools.get(name)
    if (hit) return hit
    if (created.has(name) && !baseNames.has(name)) push(4, 'ref-to-proposed-tool', op, `${show(name)} is a tool another op creates; ops may only refer to baseline tools.`)
    else push(2, 'unknown-tool', op, `The tool ${show(name)} is not in the baseline inventory.`)
    return undefined
  }
  const argGround = (op: { id: string }, tool: PlannedTool, arg: string): SigArg | undefined => {
    const a = (ctx.sigs.get(tool.name) ?? []).find((x) => x.name === arg)
    if (!a) push(2, 'unknown-arg', op, `The tool ${show(tool.name)} has no argument ${show(arg)}.`)
    return a
  }
  const entityGround = (op: { id: string }, id: string): Entity | undefined => {
    const e = ctx.entities.get(id)
    if (!e) push(2, 'unknown-entity', op, `The entity ${show(id)} is not in the source model.`)
    return e
  }

  // Per-tool bookkeeping for gate 4.
  const consumed = new Map<string, string>()
  const hidden = new Map<string, string>()
  const renamed = new Map<string, { id: string; name: string }>()
  const edits = new Map<string, { id: string; kind: string }[]>() // `${tool}\u0000${arg}`
  const toolTouched = new Map<string, { id: string; kind: string }[]>()
  const note = (m: Map<string, { id: string; kind: string }[]>, key: string, id: string, kind: string) => m.set(key, [...(m.get(key) ?? []), { id, kind }])
  const argRenames = new Map<string, { id: string; arg: string; name: string }[]>() // tool -> rename_arg ops (CR-26)
  const projSeen = new Set<string>()
  const referenced = new Set<string>() // baseline tools referenced by composite steps
  let newToolCount = 0

  for (const op of ops) {
    // The reason is free text for the reviewer; it is never emitted, but it is shown in reviews and reports.
    checkText(push, op, ctx, op.reason, 'reason', LIMITS.reason, 'reason')
    switch (op.op) {
      case 'rename_tool': {
        const t = toolGround(op, op.tool)
        checkName(push, op, 'tool', op.name, 'tool')
        if (t) {
          renamed.set(t.name, { id: op.id, name: op.name })
          note(toolTouched, t.name, op.id, 'rename')
        }
        break
      }
      case 'rename_arg': {
        const t = toolGround(op, op.tool)
        checkName(push, op, 'arg', op.name, 'arg')
        if (t) {
          const a = argGround(op, t, op.arg)
          if (a) {
            note(edits, `${t.name}\u0000${a.name}`, op.id, 'rename')
            argRenames.set(t.name, [...(argRenames.get(t.name) ?? []), { id: op.id, arg: a.name, name: op.name }])
          }
          note(toolTouched, t.name, op.id, 'edit')
        }
        break
      }
      case 'describe_tool': {
        const t = toolGround(op, op.tool)
        checkText(push, op, ctx, op.text, 'description', LIMITS.toolDescription, 'description')
        if (t) note(toolTouched, t.name, op.id, 'describe')
        break
      }
      case 'describe_arg': {
        const t = toolGround(op, op.tool)
        checkText(push, op, ctx, op.text, 'description', LIMITS.argDescription, 'argument description')
        if (t) {
          const a = argGround(op, t, op.arg)
          if (a) note(edits, `${t.name}\u0000${a.name}`, op.id, 'describe')
          note(toolTouched, t.name, op.id, 'edit')
        }
        break
      }
      case 'hide_tool': {
        const t = toolGround(op, op.tool)
        if (t) {
          if (toolKind(ctx.plan, t) === 'describe') push(4, 'hide-describe', op, 'The describe tool cannot be hidden; the query tools point to it.')
          hidden.set(t.name, op.id)
          note(toolTouched, t.name, op.id, 'hide')
        }
        break
      }
      case 'set_arg_default':
      case 'pin_arg': {
        const t = toolGround(op, op.tool)
        if (t) {
          const a = argGround(op, t, op.arg)
          if (a) {
            constIssues(push, op, ctx, a, op.value, t.name)
            note(edits, `${t.name}\u0000${a.name}`, op.id, op.op === 'pin_arg' ? 'pin' : 'default')
          }
          note(toolTouched, t.name, op.id, 'edit')
        }
        break
      }
      case 'set_paging_default': {
        const t = toolGround(op, op.tool)
        if (t) {
          const a = argGround(op, t, op.arg)
          if (a) {
            constIssues(push, op, ctx, a, op.value, t.name)
            const hi = a.max ?? (op.arg === 'max_pages' ? DERIVED_MAX_PAGES : undefined)
            if (op.value < 1 || (hi !== undefined && op.value > hi)) push(3, 'paging-out-of-range', op, `The paging default for ${show(t.name)}.${op.arg} is outside the clamp.`)
            note(edits, `${t.name}\u0000${a.name}`, op.id, 'default')
          }
          note(toolTouched, t.name, op.id, 'edit')
        }
        break
      }
      case 'set_projection': {
        const e = entityGround(op, op.entity)
        if (e) {
          const known = new Set(entityFieldNames(e))
          const seen = new Set<string>()
          for (const f of op.fields) {
            if (!known.has(f)) push(2, 'unknown-field', op, `The entity ${show(op.entity)} has no field ${show(f)}.`)
            if (seen.has(f)) push(4, 'projection-duplicate', op, `The field ${show(f)} is listed twice.`)
            seen.add(f)
          }
          if (op.fields.length > PROJECTION_MAX_FIELDS) push(4, 'projection-too-many', op, `A projection has at most ${PROJECTION_MAX_FIELDS} fields.`)
          if (projSeen.has(op.entity)) push(4, 'op-conflict', op, `The projection of ${show(op.entity)} is set by more than one op.`)
          projSeen.add(op.entity)
          if (!ctx.plan.tools.some((t) => t.entity === op.entity)) push(2, 'unknown-entity', op, `No tool serves the entity ${show(op.entity)}.`)
        }
        break
      }
      case 'derived_filter': {
        // The derived-filter template walks REST list results; an OData service filters server-side with $filter.
        if (ctx.plan.model.backend.kind === 'http' && ctx.plan.model.operations.some((o) => o.protocol === 'odata')) {
          push(4, 'odata-unsupported-op', op, 'A derived filter is not available on an OData model, and this is final: OData tools already filter on the server with $filter, and the OData adapter models no nested collections (navigation properties are never expanded).')
          newToolCount++
          break
        }
        const e = entityGround(op, op.entity)
        checkText(push, op, ctx, op.description, 'description', LIMITS.toolDescription, 'description')
        if (e) {
          const n = e.nested.find((x) => x.field === op.source)
          if (!n) push(2, 'unknown-nested', op, `The entity ${show(op.entity)} has no nested collection ${show(op.source)}.`)
          else if (n.keyFields.length === 0 && n.valueFields.length === 0) push(2, 'unknown-nested', op, `The nested collection ${show(op.source)} has no key or value fields.`)
        }
        newToolCount++
        break
      }
      case 'merge_tools': {
        newToolCount++
        checkName(push, op, 'tool', op.name, 'tool')
        checkText(push, op, ctx, op.description, 'description', LIMITS.toolDescription, 'description')
        const dispatchArg = op.dispatchArg ?? 'operation'
        if (op.dispatchArg !== undefined) checkName(push, op, 'arg', op.dispatchArg, 'arg')
        const cap = op.mode === 'fanout' ? LIMITS.mergeFanout : LIMITS.mergeDispatch
        if (op.sources.length > cap) push(4, 'too-many-sources', op, `A ${op.mode} merge has at most ${cap} sources.`)
        const tools = new Set<string>()
        const values = new Set<string>()
        const union = new Map<string, SigArg>()
        for (const s of op.sources) {
          checkName(push, op, 'value', s.value, 'dispatch-value')
          if (values.has(s.value)) push(4, 'duplicate-dispatch-value', op, `The dispatch value ${show(s.value)} is used twice.`)
          values.add(s.value)
          const t = toolGround(op, s.tool)
          if (!t) continue
          if (tools.has(t.name)) push(4, 'duplicate-source', op, `The tool ${show(t.name)} is merged twice.`)
          tools.add(t.name)
          if (toolKind(ctx.plan, t) === 'describe') push(4, 'merge-kind', op, `The describe tool ${show(t.name)} cannot be merged.`)
          if (consumed.has(t.name)) push(4, 'op-conflict', op, `The tool ${show(t.name)} is already merged or split by another op.`)
          consumed.set(t.name, op.id)
          note(toolTouched, t.name, op.id, 'consume')
          for (const a of ctx.sigs.get(t.name) ?? []) {
            const have = union.get(a.name)
            if (have && (have.type !== a.type || JSON.stringify(have.enum ?? null) !== JSON.stringify(a.enum ?? null)))
              push(4, 'merge-arg-conflict', op, `The argument ${show(a.name)} has different types or allowed values in the merged tools.`)
            else if (!have) union.set(a.name, a)
          }
        }
        if (union.has(dispatchArg)) push(4, 'dispatch-arg-clash', op, `The dispatch argument ${show(dispatchArg)} is also an argument of a merged tool.`)
        createdRefs.set(op.name, [])
        break
      }
      case 'split_tool': {
        const t = toolGround(op, op.tool)
        const sig = t ? (ctx.sigs.get(t.name) ?? []) : []
        if (t) {
          if (toolKind(ctx.plan, t) === 'describe') push(4, 'split-kind', op, `The describe tool ${show(t.name)} cannot be split.`)
          if (!op.keepOriginal) {
            if (consumed.has(t.name)) push(4, 'op-conflict', op, `The tool ${show(t.name)} is already merged or split by another op.`)
            consumed.set(t.name, op.id)
          }
          note(toolTouched, t.name, op.id, 'split')
        }
        const names = new Set<string>()
        for (const p of op.tools) {
          newToolCount++
          checkName(push, op, 'tool', p.name, 'tool')
          checkText(push, op, ctx, p.description, 'description', LIMITS.toolDescription, 'description')
          if (names.has(p.name)) push(4, 'name-collision', op, `The preset tool name ${show(p.name)} is used twice.`)
          names.add(p.name)
          const keys = Object.keys(p.fixed)
          if (keys.length === 0) push(4, 'split-empty-preset', op, `The preset tool ${show(p.name)} fixes no argument.`)
          for (const k of keys) {
            const a = sig.find((x) => x.name === k)
            if (t && !a) push(2, 'unknown-arg', op, `The tool ${show(t.name)} has no argument ${show(k)}.`)
            else if (a && own(p.fixed, k)) constIssues(push, op, ctx, a, p.fixed[k], t!.name)
          }
          createdRefs.set(p.name, [])
        }
        break
      }
      case 'composite_tool': {
        newToolCount++
        checkName(push, op, 'tool', op.name, 'tool')
        checkText(push, op, ctx, op.description, 'description', LIMITS.toolDescription, 'description')
        checkComposite(op, ctx, ops, { push, toolGround, argGround, referenced, createdRefs, note, toolTouched })
        break
      }
    }
  }

  // ---- gate 4 across ops ----
  if (newToolCount > MAX_NEW_TOOLS) push(4, 'too-many-new-tools', { id: ops[ops.length - 1]?.id ?? '-' }, `A proposal creates at most ${MAX_NEW_TOOLS} tools.`)

  for (const [key, list] of edits) {
    const kinds = list.map((x) => x.kind)
    const dup = kinds.filter((k, i) => kinds.indexOf(k) !== i)
    const [tool, arg] = key.split('\u0000')
    if (dup.length > 0) push(4, 'op-conflict', { id: list[kinds.lastIndexOf(dup[0])].id }, `The argument ${show(tool)}.${show(arg)} gets the same kind of edit twice.`)
    if (kinds.includes('pin') && (kinds.includes('default') || kinds.includes('rename')))
      push(4, 'op-conflict', { id: list[list.length - 1].id }, `The argument ${show(tool)}.${show(arg)} is pinned and also renamed or given a default.`)
  }
  for (const [tool, list] of toolTouched) {
    const kinds = list.map((x) => x.kind)
    const last = list[list.length - 1]
    if (kinds.filter((k) => k === 'rename').length > 1) push(4, 'op-conflict', { id: list[kinds.lastIndexOf('rename')].id }, `The tool ${show(tool)} is renamed twice.`)
    if (kinds.filter((k) => k === 'describe').length > 1) push(4, 'op-conflict', { id: list[kinds.lastIndexOf('describe')].id }, `The tool ${show(tool)} is described twice.`)
    if (kinds.includes('consume') || kinds.includes('split')) {
      if (kinds.some((k) => ['rename', 'hide', 'edit', 'describe'].includes(k))) push(4, 'op-conflict', { id: last.id }, `The tool ${show(tool)} is merged or split and cannot also be edited, renamed or hidden.`)
    }
    if (kinds.includes('hide') && kinds.some((k) => ['rename', 'edit', 'describe'].includes(k))) push(4, 'op-conflict', { id: last.id }, `The tool ${show(tool)} is hidden and also edited.`)
  }
  // Rename targets: the emitted signature must not repeat a name (SyntaxError), and the sequential prologue
  // (`new = old`) cannot implement a swap or a rename onto a name another argument still has, pinned or not (CR-26).
  for (const [tool, list] of argRenames) {
    const sig = ctx.sigs.get(tool) ?? []
    const taken = new Map<string, string>() // new name -> op id
    for (const r of list) {
      const clash = sig.some((x) => x.name === r.name && x.name !== r.arg)
      const twice = taken.get(r.name)
      if (clash || twice !== undefined) push(4, 'name-collision', { id: r.id }, `The argument name ${show(r.name)} would be used twice in ${show(tool)} (another argument has it, or two arguments are renamed to it).`)
      taken.set(r.name, r.id)
    }
  }
  // A tool a composite calls must keep the arguments the composite passes (checked in checkComposite);
  // consumed tools may not be hidden away from a composite (they are internal anyway).

  // Final names: baseline tools that stay exposed (renamed or not) plus created tools.
  const finalNames = new Map<string, string>() // name -> op id ('' for baseline)
  const claim = (name: string, id: string, op: { id: string }) => {
    const owner = finalNames.get(name)
    if (owner !== undefined) push(4, 'name-collision', owner !== '' ? { id: owner } : op, `The tool name ${show(name)} would be used by two tools.`)
    else finalNames.set(name, id)
  }
  for (const t of ctx.plan.tools) {
    if (hidden.has(t.name) || consumed.has(t.name)) continue
    const r = renamed.get(t.name)
    claim(r ? r.name : t.name, r ? r.id : '', { id: r ? r.id : '-' })
  }
  for (const op of ops) {
    if (op.op === 'merge_tools' || op.op === 'composite_tool') claim(op.name, op.id, op)
    if (op.op === 'split_tool') for (const p of op.tools) claim(p.name, op.id, op)
  }
  // Names also must not collide with the private base functions (they are _op_ names, so only an exact clash).
  const exposed = finalNames.size
  if (exposed === 0 && ops.length > 0) {
    const lastHide = [...ops].reverse().find((o) => o.op === 'hide_tool' || o.op === 'merge_tools' || o.op === 'split_tool')
    push(4, 'last-tool', lastHide ?? { id: '-' }, 'The proposal would leave the server without any tool.')
  }

  // Reference graph among created tools: only baseline tools may be referenced, so a cycle needs a created
  // name in a ref; detect explicitly for a precise code.
  const stateOf = new Map<string, 0 | 1 | 2>()
  const dfs = (n: string, op: { id: string }): boolean => {
    stateOf.set(n, 1)
    for (const m of createdRefs.get(n) ?? []) {
      if (stateOf.get(m) === 1) return true
      if (!stateOf.has(m) && dfs(m, op)) return true
    }
    stateOf.set(n, 2)
    return false
  }
  for (const [n, id] of created) if (!stateOf.has(n) && dfs(n, { id })) push(4, 'cyclic-reference', { id }, 'Created tools refer to each other in a cycle.')

  return issues.sort((a, b) => ops.findIndex((o) => o.id === a.opId) - ops.findIndex((o) => o.id === b.opId) || a.gate - b.gate || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
}

interface CompositeHelpers {
  push: Push
  toolGround: (op: { id: string }, name: string) => PlannedTool | undefined
  argGround: (op: { id: string }, tool: PlannedTool, arg: string) => SigArg | undefined
  referenced: Set<string>
  createdRefs: Map<string, string[]>
  note: (m: Map<string, { id: string; kind: string }[]>, key: string, id: string, kind: string) => void
  toolTouched: Map<string, { id: string; kind: string }[]>
}

function checkComposite(op: Extract<ProposalOp, { op: 'composite_tool' }>, ctx: GateCtx, ops: ProposalOp[], h: CompositeHelpers) {
  const { push } = h
  const refs: string[] = []
  // Declared arguments.
  const declared = new Map<string, SigArg>()
  for (const a of op.args) {
    checkName(push, op, 'arg', a.name, 'arg')
    if (declared.has(a.name)) push(4, 'name-collision', op, `The composite argument ${show(a.name)} is declared twice.`)
    const sa: SigArg = { name: a.name, type: a.type, required: a.required ?? a.default === undefined, ...(a.min !== undefined ? { min: a.min } : {}), ...(a.max !== undefined ? { max: a.max } : {}), ...(a.enum ? { enum: a.enum } : {}) }
    if (a.description) checkText(push, op, ctx, a.description, 'description', LIMITS.argDescription, 'argument description')
    // CR-29: the shape-only schema has no name patterns, so enum values and bounds are checked here.
    const seenEnum = new Set<string>()
    for (const v of a.enum ?? []) {
      checkName(push, op, 'value', v, 'enum-value')
      if (seenEnum.has(v)) push(4, 'name-collision', op, `The enum value ${show(v)} of ${show(a.name)} is listed twice.`)
      seenEnum.add(v)
    }
    if (a.min !== undefined && a.max !== undefined && a.min > a.max) push(3, 'value-range', op, `The minimum of ${show(a.name)} is greater than its maximum.`)
    if (a.type === 'integer' && ((a.min !== undefined && !Number.isInteger(a.min)) || (a.max !== undefined && !Number.isInteger(a.max)))) push(3, 'value-range', op, `The bounds of the integer argument ${show(a.name)} must be whole numbers.`)
    if (a.default !== undefined) constIssues(push, op, ctx, sa, a.default, op.name)
    declared.set(a.name, sa)
  }
  if (op.args.length > LIMITS.compositeArgs) push(4, 'too-many-args', op, `A composite tool has at most ${LIMITS.compositeArgs} arguments.`)
  if (op.steps.length > LIMITS.compositeSteps) push(4, 'too-many-steps', op, `A composite tool has at most ${LIMITS.compositeSteps} steps.`)

  const usedInputs = new Set<string>()
  const usedSteps = new Set<string>()
  const stepShapes = new Map<string, Shape>()
  const stepIndex = new Map<string, number>()
  let total = 0
  const outputKeys = op.output ? Object.keys(op.output) : []
  if (outputKeys.length > LIMITS.compositeOutputKeys) push(4, 'too-many-output-keys', op, `A composite output has at most ${LIMITS.compositeOutputKeys} keys.`)

  const resolveSel = (
    text: string,
    where: string,
    stepIdx: number,
    inFanout: boolean,
    itemShape: Shape | undefined,
    fields: Set<string>,
  ): { shape: Shape } | undefined => {
    const parsed = parseSelector(text)
    if (!parsed.ok) {
      push(3, 'selector-syntax', op, `The selector in ${where} is outside the allowed grammar (${parsed.reason}).`)
      return undefined
    }
    const [root, ...rest] = parsed.path
    if (root === 'input') {
      const name = rest[0]
      if (typeof name !== 'string' || !declared.has(name)) {
        push(2, 'unknown-input', op, `The selector in ${where} names an input that is not a declared argument.`)
        return undefined
      }
      usedInputs.add(name)
      if (rest.length > 1) {
        push(2, 'unknown-selector-target', op, `The selector in ${where} reaches into a scalar input.`)
        return undefined
      }
      return { shape: 'scalar' }
    }
    if (root === 'item') {
      if (!inFanout || !itemShape) {
        push(4, 'item-outside-foreach', op, `The selector in ${where} uses item outside a forEach step.`)
        return undefined
      }
      const w = walkShape(itemShape, rest as (string | number)[], fields)
      if ('code' in w) {
        push(2, w.code, op, `The selector in ${where} does not match the shape of the step result.`)
        return undefined
      }
      return w
    }
    const idx = typeof root === 'string' ? stepIndex.get(root) : undefined
    if (idx === undefined) {
      push(2, 'unknown-step', op, `The selector in ${where} names a step that does not exist.`)
      return undefined
    }
    if (idx >= stepIdx) {
      push(4, 'composite-cycle', op, `The selector in ${where} refers to its own step or a later one.`)
      return undefined
    }
    usedSteps.add(root as string)
    const w = walkShape(stepShapes.get(root as string) ?? 'any', rest as (string | number)[], fields)
    if ('code' in w) {
      push(2, w.code, op, `The selector in ${where} does not match the shape of the step result.`)
      return undefined
    }
    return w
  }

  // Pre-register step ids so a forward reference gives composite-cycle, not unknown-step.
  op.steps.forEach((s, i) => {
    if (stepIndex.has(s.id)) push(4, 'duplicate-step-id', op, `The step id ${show(s.id)} is used twice.`)
    checkName(push, op, 'step', s.id, 'step')
    stepIndex.set(s.id, i)
  })

  op.steps.forEach((s, i) => {
    const t = h.toolGround(op, s.tool)
    const where = `step ${show(s.id)}`
    if (!t) {
      stepShapes.set(s.id, 'any')
      total += s.forEach ? s.forEach.max : 1
      return
    }
    refs.push(t.name)
    h.referenced.add(t.name)
    h.note(h.toolTouched, t.name, op.id, 'reference')
    const kind = toolKind(ctx.plan, t)
    const operation = ctx.plan.model.operations.find((o) => o.id === t.operation)
    if (t.proposed?.wrapper || (operation && !['GET', 'SELECT', 'DATASET'].includes(operation.method))) push(4, 'composite-not-read-only', op, `The step ${show(s.id)} calls ${show(t.name)}, which is not a grounded read-only tool.`)
    const sig = ctx.sigs.get(t.name) ?? []
    const entity = ctx.entities.get(t.entity)
    const entityFields = new Set(entity ? entityFieldNames(entity) : [])
    // Fields the step can read from its rows.
    let available = t.entity === '*' ? [] : projectionOf(ctx, ops, t.entity)
    if (s.select) {
      if (!sig.some((a) => a.name === 'fields')) push(4, 'select-unsupported', op, `The tool ${show(t.name)} has no fields argument for select.`)
      for (const f of s.select) if (!entityFields.has(f)) push(2, 'unknown-field', op, `The entity of ${show(t.name)} has no field ${show(f)}.`)
      if (s.select.length > PROJECTION_MAX_FIELDS) push(4, 'projection-too-many', op, `A select has at most ${PROJECTION_MAX_FIELDS} fields.`)
      available = s.select
    }
    const base = calleeShape(ctx, t, available)
    let itemShape: Shape | undefined
    if (s.forEach) {
      const r = resolveSel(s.forEach.from, `${where} forEach`, i, false, undefined, entityFields)
      if (r && r.shape !== 'any' && !(typeof r.shape === 'object' && 'list' in r.shape)) push(4, 'foreach-not-list', op, `The forEach of ${where} does not select a list.`)
      if (r && typeof r.shape === 'object' && 'list' in r.shape) itemShape = r.shape.list
      else itemShape = 'any'
      total += s.forEach.max
      stepShapes.set(s.id, { obj: new Map<string, Shape>([['ok', 'scalar'], ['count', 'scalar'], ['results', { list: base }]]) })
    } else {
      total += 1
      stepShapes.set(s.id, base)
    }
    // Arguments passed to the callee.
    const passed = new Set<string>()
    for (const k of Object.keys(s.args)) {
      const a = h.argGround(op, t, k)
      const v = s.args[k]
      passed.add(k)
      if (!a) continue
      const pinnedBy = ops.find((o) => o.op === 'pin_arg' && o.tool === t.name && o.arg === k)
      if (pinnedBy) push(4, 'pinned-arg-passed', op, `The step ${show(s.id)} passes ${show(t.name)}.${show(k)}, which another op pins.`)
      if ('const' in v) constIssues(push, op, ctx, a, v.const, t.name)
      else resolveSel(v.from, `${where} argument ${show(k)}`, i, !!s.forEach, itemShape, entityFields)
    }
    for (const a of sig) {
      const pinnedBy = ops.find((o) => o.op === 'pin_arg' && o.tool === t.name && o.arg === a.name)
      const defaulted = ops.some((o) => o.op === 'set_arg_default' && o.tool === t.name && o.arg === a.name)
      if (a.required && !passed.has(a.name) && !pinnedBy && !defaulted) push(4, 'missing-required-arg', op, `The step ${show(s.id)} does not pass the required argument ${show(a.name)} of ${show(t.name)}.`)
    }
    void kind
  })
  if (total > LIMITS.compositeTotalCalls) push(4, 'call-cap', op, `A composite tool makes at most ${LIMITS.compositeTotalCalls} calls in total; this one allows ${total}.`)

  for (const k of outputKeys) {
    checkName(push, op, 'arg', k, 'output-key')
    resolveSel(op.output![k], `output ${show(k)}`, op.steps.length, false, undefined, new Set(ctx.plan.model.entities.flatMap((e) => entityFieldNames(e))))
  }
  for (const name of declared.keys()) if (!usedInputs.has(name)) push(4, 'orphan-arg', op, `The composite argument ${show(name)} is never used by a step or the output.`)
  op.steps.forEach((s, i) => {
    if ((op.output !== undefined || i < op.steps.length - 1) && !usedSteps.has(s.id)) push(4, 'orphan-step', op, `The result of step ${show(s.id)} is never used.`)
  })
  h.createdRefs.set(op.name, refs.filter((r) => !ctx.tools.has(r)))
}
