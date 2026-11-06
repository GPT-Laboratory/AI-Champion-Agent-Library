// Emitter pieces for an applied proposal set (docs/mcp-generator-proposals.md). Everything here
// is a fixed template: names are checked identifiers (pyIdent), constants go through pyLit, free text
// goes through cleanText, selector paths are tuples of checked keys. No eval, no exec, no getattr,
// no generated lambdas, no string-built code from proposal text. Merge, split and composite tools
// call the SAME generated tool functions the baseline has, so clamps, projection caps, honest empty
// results and structured safe errors are inherited, not re-implemented.
import { cleanText, pyIdent, pyLit, pyNum, pyStr } from './pyutil.js'
import { paramChecks } from './python.js'
import type { Param, PlannedTool, ServerPlan } from '../types.js'
import type { ArgEdit, CompositeStep, Const, SigArg, SelectorPath, ValueSpec, WrapperSpec } from '../proposals/model.js'
import { finalSignature } from '../proposals/signature.js'

const ind = (n: number, s: string) => '    '.repeat(n) + s
const PYTYPE: Record<string, string> = { string: 'str', integer: 'int', number: 'float', boolean: 'bool', array: 'list[str]' }

/** Runtime helpers, emitted only when the plan has a merge, split or composite tool. Fixed text. */
export const RUNTIME_PROPOSED = `

class _Stop(Exception):
    """Ends a composite tool early with a ready, caller-safe response."""

    def __init__(self, response):
        super().__init__("stop")
        self.response = response


def _kw(**kwargs):
    return {key: value for key, value in kwargs.items() if value is not None}


def _tag(result, source):
    if isinstance(result, dict) and result.get("ok") is True:
        tagged = dict(result)
        tagged["source"] = source
        return tagged
    return result


def _count_of(result):
    count = result.get("count")
    if isinstance(count, int):
        return count
    return 1 if result.get("result") else 0


def _merged(parts):
    good = [key for key, value in parts.items() if isinstance(value, dict) and value.get("ok") is True]
    if not good:
        for value in parts.values():
            return value
    return {
        "ok": True,
        "sources": parts,
        "count": sum(_count_of(parts[key]) for key in good),
        "failed": [key for key in parts if key not in good],
    }


def _sel(ctx, path):
    """Walk dictionaries and lists along a fixed path. Missing anything gives None. No attribute access."""
    current = ctx
    for part in path:
        if isinstance(part, int):
            if isinstance(current, list) and -len(current) <= part < len(current):
                current = current[part]
            else:
                return None
        elif isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return None
    return current


def _as_list(value, cap):
    return list(value)[:cap] if isinstance(value, list) else []


def _step(budget, fn, args, required, soft=False):
    """One grounded call of a read-only tool function, counted against the total call cap."""
    for name in required:
        if args.get(name) is None:
            if soft:
                return _no_results("item", "The previous step gave no value for this call.")
            raise _Stop(_no_results("result", "An earlier step returned nothing to continue with."))
    budget[0] += 1
    if budget[0] > budget[1]:
        raise _Stop(_err("limit", "The call limit of this tool was reached.", "Narrow the request."))
    result = fn(**{key: value for key, value in args.items() if value is not None})
    if isinstance(result, dict) and result.get("ok") is True:
        return result
    failure = _err(
        result.get("kind", "internal") if isinstance(result, dict) else "internal",
        result.get("message", _INTERNAL_MESSAGE) if isinstance(result, dict) else _INTERNAL_MESSAGE,
        result.get("hint") if isinstance(result, dict) else None,
    )
    if soft:
        return failure
    raise _Stop(failure)
`

/** The Python function name of a baseline tool inside the emitted module. */
function callee(plan: ServerPlan, base: string): PlannedTool {
  const all = [...plan.tools, ...(plan.internal ?? [])]
  const t = all.find((x) => !x.proposed?.wrapper && (x.proposed?.baseName ?? x.name) === base)
  if (!t) throw new Error('A proposal refers to a tool that is not in the plan.')
  return t
}

function editsOf(tool: PlannedTool): Record<string, ArgEdit> {
  return tool.proposed?.args ?? {}
}
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** The argument name a baseline argument has in the emitted function (undefined: pinned, not an argument). */
export function finalArgName(tool: PlannedTool, base: string): string | undefined {
  const e = editsOf(tool)
  if (!own(e, base)) return base
  if (e[base].pin !== undefined) return undefined
  return e[base].name ?? base
}

// ---- argument edits on an emitted baseline tool function ---------------------------------------

function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = false
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === '\\') cur += s[++i] ?? ''
      else if (c === '"') quote = false
    } else if (c === '"') {
      quote = true
      cur += c
    } else if (c === '[' || c === '(') {
      depth++
      cur += c
    } else if (c === ']' || c === ')') {
      depth--
      cur += c
    } else if (c === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

interface Entry {
  name: string
  type: string
  dflt?: string
}
function parseEntry(s: string): Entry {
  const m = /^(\w+): (.+?)(?: = (.+))?$/.exec(s)
  if (!m) throw new Error('Unexpected signature entry.')
  return { name: m[1], type: m[2], dflt: m[3] }
}
const entryText = (e: Entry) => `${e.name}: ${e.type}${e.dflt !== undefined ? ` = ${e.dflt}` : ''}`
const bare = (t: string) => (/^Optional\[(.+)\]$/.exec(t)?.[1] ?? t)

/**
 * Apply the argument edits of a tool to the lines its baseline builder produced: the signature, the
 * Args section of the docstring, and a short prologue that gives the unchanged function body the
 * variable names it already uses (so no body line is rewritten).
 */
export function applyArgEdits(lines: string[], tool: PlannedTool): string[] {
  const edits = editsOf(tool)
  if (Object.keys(edits).length === 0) return lines
  const head = /^def (\w+)\((.*)\) -> dict:$/.exec(lines[0])
  if (!head) throw new Error('Unexpected function header.')
  const entries = splitTop(head[2]).map(parseEntry)
  const out: Entry[] = []
  const prologue: string[] = []
  const docEdit = new Map<string, { name?: string; text?: string; drop?: boolean; alias?: string }>()
  const fixed: string[] = []
  for (const e of entries) {
    if (!own(edits, e.name)) {
      out.push(e)
      continue
    }
    const ed = edits[e.name]
    const wasRequired = e.dflt === undefined
    if (ed.pin !== undefined) {
      prologue.push(ind(2, `${pyIdent(e.name)} = ${pyLit(ed.pin)}`))
      docEdit.set(e.name, { drop: true })
      fixed.push(`${e.name} is always ${typeof ed.pin === 'string' ? cleanText(ed.pin, 80) : String(ed.pin)}.`)
      continue
    }
    const name = ed.name ?? e.name
    pyIdent(name)
    const doc: { name?: string; text?: string; alias?: string } = {}
    if (name !== e.name) doc.name = name
    if (ed.description !== undefined) doc.text = cleanText(ed.description, 160)
    if (ed.keepAlias && name !== e.name) {
      // The new name is optional (None); the old name stays as an optional alias that carries the default.
      // The body keeps using the old name: it takes the new value when one is given.
      const effective = ed.default !== undefined ? pyLit(ed.default) : e.dflt
      out.push(
        { name, type: `Optional[${bare(e.type)}]`, dflt: 'None' },
        { name: e.name, type: wasRequired && effective === undefined ? `Optional[${bare(e.type)}]` : e.type, dflt: effective ?? 'None' },
      )
      prologue.push(ind(2, `if ${name} is not None:`), ind(3, `${e.name} = ${name}`))
      if (wasRequired && ed.default === undefined) {
        prologue.push(ind(2, `if ${e.name} is None:`), ind(3, `return _err("invalid_argument", ${pyStr(`${name} is required.`)})`))
      }
      doc.alias = `Alias of ${name} (kept for compatibility).`
    } else {
      const next: Entry = { name, type: e.type, dflt: e.dflt }
      if (ed.default !== undefined) {
        next.dflt = pyLit(ed.default)
        if (wasRequired) next.type = bare(e.type)
      }
      out.push(next)
      if (name !== e.name) prologue.push(ind(2, `${e.name} = ${name}`))
    }
    docEdit.set(e.name, doc)
  }
  const ordered = [...out.filter((x) => x.dflt === undefined), ...out.filter((x) => x.dflt !== undefined)]
  const result = [`def ${head[1]}(${ordered.map(entryText).join(', ')}) -> dict:`]
  let inDoc = false
  let docDone = false
  let tryDone = false
  for (let i = 1; i < lines.length; i++) {
    let line = lines[i]
    if (!docDone) {
      if (i === 1) inDoc = true
      else if (inDoc && line === '    """') {
        for (const f of fixed) result.push('', ind(1, `Fixed: ${f}`))
        inDoc = false
        docDone = true
      } else if (inDoc) {
        const m = /^ {8}(\w+): (.*)$/.exec(line)
        if (m && docEdit.has(m[1])) {
          const d = docEdit.get(m[1])!
          if (d.drop) continue
          line = ind(2, `${d.name ?? m[1]}: ${d.text ?? m[2]}`)
          result.push(line)
          if (d.alias) result.push(ind(2, `${m[1]}: ${d.alias}`))
          continue
        }
      }
    }
    result.push(line)
    if (!tryDone && line === '    try:') {
      result.push(...prologue)
      tryDone = true
    }
  }
  if (!tryDone) throw new Error('Unexpected function body.')
  return result
}

// ---- merge, split and composite tools ---------------------------------------------------------

function sigText(a: SigArg): string {
  const t = PYTYPE[a.type] ?? 'str'
  pyIdent(a.name)
  if (a.default !== undefined) return `${a.name}: ${t} = ${pyLit(a.default)}`
  return a.required ? `${a.name}: ${t}` : `${a.name}: Optional[${t}] = None`
}

function sigOf(params: SigArg[]): string {
  return [...params.filter((p) => p.required && p.default === undefined), ...params.filter((p) => !(p.required && p.default === undefined))].map(sigText).join(', ')
}

function docLines(summary: string, params: SigArg[], notes: string[]): string[] {
  const out = [ind(1, `"""${cleanText(summary, 400)}`)]
  for (const n of notes) out.push('', ind(1, cleanText(n, 300)))
  if (params.length) {
    out.push('', ind(1, 'Args:'))
    for (const p of params) out.push(ind(2, `${p.name}: ${cleanText(p.description || (p.required ? 'Required.' : 'Optional.'), 160)}`))
  }
  out.push(ind(1, '"""'))
  return out
}

const TAIL = ['    except _Stop as stop:', '        return stop.response', '    except Exception:', '        return _err("internal", _INTERNAL_MESSAGE)']

const toParam = (a: SigArg): Param => ({
  name: a.name,
  in: 'query',
  type: a.type === 'array' ? 'string' : a.type,
  required: a.required && a.default === undefined,
  ...(a.min !== undefined ? { min: a.min } : {}),
  ...(a.max !== undefined ? { max: a.max } : {}),
  ...(a.enum ? { enum: a.enum } : {}),
})

function kwCall(fn: string, names: [string, string][], consts: [string, Const][] = []): string {
  const parts = [...consts.map(([k, v]) => `${pyIdent(k)}=${pyLit(v)}`), ...names.map(([k, v]) => `${pyIdent(k)}=${pyIdent(v)}`)]
  return `${pyIdent(fn)}(**_kw(${parts.join(', ')}))`
}

function mergeBody(plan: ServerPlan, w: Extract<WrapperSpec, { kind: 'merge' }>): string[] {
  const wrapperNames = new Set(w.params.map((p) => p.name))
  const body: string[] = []
  const values = w.sources.map((s) => pyStr(s.value)).join(', ')
  const args = (srcTool: PlannedTool): [string, string][] => {
    const sig = finalSignature(plan, srcTool)
    return sig.filter((a) => wrapperNames.has(a.name)).map((a) => [a.name, a.name])
  }
  const requiredOf = (srcTool: PlannedTool) => finalSignature(plan, srcTool).filter((a) => a.required && a.default === undefined).map((a) => a.name)
  if (w.mode === 'dispatch') {
    body.push(ind(2, `if ${pyIdent(w.dispatchArg)} not in (${values},):`))
    body.push(ind(3, `return _err("invalid_argument", ${pyStr(`Invalid value for ${w.dispatchArg}; allowed values: ${w.sources.map((s) => s.value).join(', ')}.`)})`))
    for (const s of w.sources) {
      const t = callee(plan, s.tool)
      body.push(ind(2, `if ${pyIdent(w.dispatchArg)} == ${pyStr(s.value)}:`))
      for (const r of requiredOf(t)) {
        body.push(ind(3, `if ${pyIdent(r)} is None:`))
        body.push(ind(4, `return _err("invalid_argument", ${pyStr(`${r} is required when ${w.dispatchArg} is ${s.value}.`)})`))
      }
      body.push(ind(3, `return _tag(${kwCall(t.name, args(t))}, ${pyStr(s.value)})`))
    }
    body.push(ind(2, `return _err("invalid_argument", ${pyStr(`Invalid value for ${w.dispatchArg}.`)})`))
  } else {
    const req = new Set<string>()
    for (const s of w.sources) for (const r of requiredOf(callee(plan, s.tool))) req.add(r)
    for (const r of [...req].sort()) {
      body.push(ind(2, `if ${pyIdent(r)} is None:`))
      body.push(ind(3, `return _err("invalid_argument", ${pyStr(`${r} is required.`)})`))
    }
    body.push(ind(2, 'parts = {}'))
    for (const s of w.sources) {
      const t = callee(plan, s.tool)
      body.push(ind(2, `parts[${pyStr(s.value)}] = ${kwCall(t.name, args(t))}`))
    }
    body.push(ind(2, 'return _merged(parts)'))
  }
  return body
}

function splitBody(plan: ServerPlan, w: Extract<WrapperSpec, { kind: 'split' }>): string[] {
  const t = callee(plan, w.base)
  const consts = Object.keys(w.fixed).sort().map((k) => [k, w.fixed[k]] as [string, Const])
  const names = w.params.map((p) => [p.name, p.name] as [string, string])
  void t
  return [ind(2, `return ${kwCall(t.name, names, consts)}`)]
}

const selTuple = (path: SelectorPath) => `(${path.map((p) => (typeof p === 'number' ? pyNum(p) : pyStr(p))).join(', ')}${path.length === 1 ? ',' : ''})`
const valueExpr = (v: ValueSpec) => ('const' in v ? pyLit(v.const) : `_sel(_ctx, ${selTuple(v.from)})`)

function compositeBody(plan: ServerPlan, w: Extract<WrapperSpec, { kind: 'composite' }>): string[] {
  const body: string[] = []
  for (const p of w.params) body.push(...paramChecks(toParam(p)))
  body.push(ind(2, `_ctx = {"input": {${w.params.map((p) => `${pyStr(p.name)}: ${pyIdent(p.name)}`).join(', ')}}}`))
  body.push(ind(2, `_budget = [0, ${pyNum(w.totalCalls)}]`))
  for (const s of w.steps) body.push(...stepLines(plan, s))
  if (w.output) {
    const keys = Object.keys(w.output).sort()
    body.push(ind(2, `return {"ok": True, "result": {${keys.map((k) => `${pyStr(k)}: _sel(_ctx, ${selTuple(w.output![k])})`).join(', ')}}}`))
  } else body.push(ind(2, `return _ctx[${pyStr(w.steps[w.steps.length - 1].id)}]`))
  return body
}

function stepLines(plan: ServerPlan, s: CompositeStep): string[] {
  const t = callee(plan, s.tool)
  const pairs: string[] = []
  const required: string[] = []
  const sigNames = new Map(finalSignature(plan, t).map((a) => [a.name, a]))
  for (const k of Object.keys(s.args).sort()) {
    const name = finalArgName(t, k)
    if (name === undefined) throw new Error('A composite step passes a pinned argument.')
    pairs.push(`${pyStr(name)}: ${valueExpr(s.args[k])}`)
    if (sigNames.get(name)?.required && !('const' in s.args[k])) required.push(name)
  }
  if (s.select && s.select.length > 0 && sigNames.has('fields')) pairs.push(`"fields": ${pyLit(s.select)}`)
  const reqTuple = `(${required.map((r) => pyStr(r)).join(', ')}${required.length === 1 ? ',' : ''})`
  const id = pyStr(s.id)
  if (!s.forEach) return [ind(2, `_ctx[${id}] = _step(_budget, ${pyIdent(t.name)}, {${pairs.join(', ')}}, ${reqTuple})`)]
  return [
    ind(2, `_outs = []`),
    ind(2, `for _item in _as_list(_sel(_ctx, ${selTuple(s.forEach.from)}), ${pyNum(s.forEach.max)}):`),
    ind(3, `_ctx["item"] = _item`),
    ind(3, `_outs.append(_step(_budget, ${pyIdent(t.name)}, {${pairs.join(', ')}}, ${reqTuple}, True))`),
    ind(2, `_ctx.pop("item", None)`),
    ind(2, `_ctx[${id}] = {"ok": True, "results": _outs, "count": len(_outs)}`),
  ]
}

/** Function text of a merge, split or composite tool. */
export function emitWrapper(plan: ServerPlan, tool: PlannedTool): string[] {
  const w = tool.proposed!.wrapper!
  const notes: string[] = []
  let body: string[]
  if (w.kind === 'merge') {
    body = mergeBody(plan, w)
    notes.push(w.mode === 'dispatch' ? `Choose the operation with ${w.dispatchArg}; arguments that do not apply to it are ignored.` : 'Calls every source operation with the same arguments and labels each result by its source; a failing source is reported, not hidden.')
  } else if (w.kind === 'split') body = splitBody(plan, w)
  else {
    body = compositeBody(plan, w)
    notes.push(`Runs at most ${w.totalCalls} read-only calls in a fixed order and reports an honest empty result when an earlier step finds nothing.`)
  }
  return [
    `def ${pyIdent(tool.name)}(${sigOf(w.params)}) -> dict:`,
    ...docLines(tool.description, w.params, notes),
    ind(1, 'try:'),
    ...body,
    ...TAIL,
  ]
}
