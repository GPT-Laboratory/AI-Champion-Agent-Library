// Apply = a pure function: (baseline plan, gated ops) -> a new plan that the normal emitter renders.
// Nothing here reads a file, the clock or the environment. Ops refer to BASELINE tool names, so the
// result never depends on the order of ops. Derived-filter ops are handled earlier (the plan is
// rebuilt with the extra derived tools so the existing planner, templates and validation produce them).
import { cmp, gap } from '../diagnostics.js'
import { gapOrder } from '../plan.js'
import type { PlannedTool, ServerPlan } from '../types.js'
import type { ArgEdit, CompositeStep, ProposedBehavior, SigArg, ValueSpec, WrapperSpec } from './model.js'
import type { ProposalOp } from './schema.js'
import { parseSelector } from './selector.js'
import { baselineSignature } from './signature.js'

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const byName = (a: PlannedTool, b: PlannedTool) => cmp(a.name, b.name) || cmp(a.entity, b.entity)

function path(text: string): (string | number)[] {
  const p = parseSelector(text)
  if (!p.ok) throw new Error('A selector reached apply without passing gate 3.')
  return p.path
}

function valueSpec(v: { const: string | number | boolean } | { from: string }): ValueSpec {
  return 'const' in v ? { const: v.const } : { from: path(v.from) }
}

export function applyOps(plan: ServerPlan, ops: ProposalOp[]): ServerPlan {
  const renamed = new Map<string, string>()
  const hidden = new Set<string>()
  const consumed = new Set<string>()
  const referenced = new Set<string>()
  const described = new Map<string, string>()
  const argEdits = new Map<string, Record<string, ArgEdit>>()
  const projections = new Map<string, string[]>()
  const touched = new Map<string, string[]>()
  const wrappers: PlannedTool[] = []
  const tag = (tool: string, id: string) => touched.set(tool, [...(touched.get(tool) ?? []), id])
  const edit = (tool: string, arg: string, id: string, patch: ArgEdit) => {
    const m = argEdits.get(tool) ?? {}
    m[arg] = { ...(own(m, arg) ? m[arg] : {}), ...patch }
    argEdits.set(tool, m)
    tag(tool, id)
  }
  const tools = new Map(plan.tools.map((t) => [t.name, t]))
  const sig = (name: string): SigArg[] => baselineSignature(plan, tools.get(name)!)

  for (const op of ops) {
    switch (op.op) {
      case 'rename_tool':
        renamed.set(op.tool, op.name)
        tag(op.tool, op.id)
        break
      case 'rename_arg':
        edit(op.tool, op.arg, op.id, { name: op.name, ...(op.keepAlias ? { keepAlias: true } : {}) })
        break
      case 'describe_tool':
        described.set(op.tool, op.text)
        tag(op.tool, op.id)
        break
      case 'describe_arg':
        edit(op.tool, op.arg, op.id, { description: op.text })
        break
      case 'hide_tool':
        hidden.add(op.tool)
        tag(op.tool, op.id)
        break
      case 'set_arg_default':
        edit(op.tool, op.arg, op.id, { default: op.value })
        break
      case 'set_paging_default':
        edit(op.tool, op.arg, op.id, { default: op.value })
        break
      case 'pin_arg':
        edit(op.tool, op.arg, op.id, { pin: op.value })
        break
      case 'set_projection':
        projections.set(op.entity, op.fields)
        break
      case 'derived_filter':
        break
      case 'merge_tools': {
        const dispatchArg = op.dispatchArg ?? 'operation'
        const union = new Map<string, SigArg>()
        const reqAny = new Set<string>()
        for (const s of op.sources) {
          consumed.add(s.tool)
          tag(s.tool, op.id)
          for (const a of sig(s.tool)) {
            if (!union.has(a.name)) union.set(a.name, a)
            if (a.required && a.default === undefined) reqAny.add(a.name)
          }
        }
        const params: SigArg[] = []
        if (op.mode === 'dispatch') {
          params.push({ name: dispatchArg, type: 'string', required: true, enum: op.sources.map((s) => s.value), description: `Which operation to run: ${op.sources.map((s) => s.value).join(', ')}.` })
        }
        for (const a of union.values()) {
          const p: SigArg = { name: a.name, type: a.type, required: op.mode === 'fanout' && reqAny.has(a.name) }
          if (a.description) p.description = a.description
          params.push(p)
        }
        const wrapper: WrapperSpec = { kind: 'merge', mode: op.mode, dispatchArg, sources: op.sources.map((s) => ({ value: s.value, tool: s.tool })), params }
        wrappers.push({ name: op.name, description: op.description, entity: '*', params: [], projection: [], proposed: { wrapper, ops: [op.id] } })
        break
      }
      case 'split_tool': {
        if (!op.keepOriginal) consumed.add(op.tool)
        referenced.add(op.tool)
        tag(op.tool, op.id)
        for (const p of op.tools) {
          const fixed: Record<string, string | number | boolean> = {}
          for (const k of Object.keys(p.fixed).sort()) fixed[k] = p.fixed[k]
          const params = sig(op.tool).filter((a) => !own(fixed, a.name))
          const wrapper: WrapperSpec = { kind: 'split', base: op.tool, fixed, params }
          wrappers.push({ name: p.name, description: p.description, entity: '*', params: [], projection: [], proposed: { wrapper, ops: [op.id] } })
        }
        break
      }
      case 'composite_tool': {
        const steps: CompositeStep[] = op.steps.map((s) => {
          referenced.add(s.tool)
          tag(s.tool, op.id)
          const args: Record<string, ValueSpec> = {}
          for (const k of Object.keys(s.args).sort()) args[k] = valueSpec(s.args[k])
          const step: CompositeStep = { id: s.id, tool: s.tool, args }
          if (s.select) step.select = s.select
          if (s.forEach) step.forEach = { from: path(s.forEach.from), max: s.forEach.max }
          return step
        })
        const total = steps.reduce((n, s) => n + (s.forEach ? s.forEach.max : 1), 0)
        const params: SigArg[] = op.args.map((a) => {
          const p: SigArg = { name: a.name, type: a.type, required: a.required ?? a.default === undefined }
          if (a.default !== undefined) p.default = a.default
          if (a.enum) p.enum = a.enum
          if (a.min !== undefined) p.min = a.min
          if (a.max !== undefined) p.max = a.max
          if (a.description) p.description = a.description
          return p
        })
        const output = op.output ? Object.fromEntries(Object.keys(op.output).sort().map((k) => [k, path(op.output![k])])) : undefined
        const wrapper: WrapperSpec = { kind: 'composite', steps, params, totalCalls: total, ...(output ? { output } : {}) }
        wrappers.push({ name: op.name, description: op.description, entity: '*', params: [], projection: [], proposed: { wrapper, ops: [op.id] } })
        break
      }
    }
  }

  const exposed: PlannedTool[] = []
  const internal: PlannedTool[] = []
  const gaps = [...plan.gaps]
  for (const t of plan.tools) {
    const ids = touched.get(t.name) ?? []
    const projection = projections.get(t.entity)
    const changed = ids.length > 0 || projection !== undefined
    if (!changed) {
      exposed.push(t)
      continue
    }
    const proposed: ProposedBehavior = { baseName: t.name, ops: [...new Set(ids)] }
    const args = argEdits.get(t.name)
    if (args) proposed.args = args
    const nt: PlannedTool = { ...t, projection: projection ?? t.projection, description: described.get(t.name) ?? t.description, proposed }
    if (consumed.has(t.name) || hidden.has(t.name)) {
      if (consumed.has(t.name) || referenced.has(t.name)) {
        internal.push({ ...nt, name: `_op_${t.name}` })
      } else {
        gaps.push(gap('proposal-hidden', `Tool ${t.name} was hidden by a proposal and is not part of the server.`, { severity: 'info', path: t.name }))
      }
      continue
    }
    if (renamed.has(t.name)) nt.name = renamed.get(t.name)!
    exposed.push(nt)
  }
  // A hidden tool that is not consumed but referenced by a composite is internal (handled above).
  // Tools that only a composite references and nothing else touches stay exposed and unchanged.
  exposed.push(...wrappers)
  exposed.sort(byName)
  internal.sort(byName)
  gaps.sort(gapOrder)
  return { ...plan, tools: exposed, internal: internal.length > 0 ? internal : undefined, gaps }
}
