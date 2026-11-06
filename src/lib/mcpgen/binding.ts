// Per-case tool binding for the MCP test platform (E10 D3, answers the Phase 14 open question "where does the
// per-case binding config live": next to the server, in the package, as mcptest-binding.json).
// ONE derivation: generate() calls deriveBinding with the plan's tools and emits the result; the in-process
// generator subject of the test platform reads that same emitted file instead of deriving again.
// Pure: no fs, no network. Keys are suite check ids (a line id such as search_keyword) or behaviour kinds
// (lookup_by_id, pagesize_clamp ...). The platform stays free to ignore keys it does not know.
import type { PlannedTool, ServerPlan } from './types.js'
import { toolKind, type ToolKind } from './plan.js'
import { finalSignature } from './proposals/signature.js'

export const BINDING_FILE = 'mcptest-binding.json'

export interface BindingEntry {
  tool: string
  /** Replaces the suite's arguments entirely. */
  args?: Record<string, unknown>
  /** Renames suite argument names to this tool's parameter names; values are kept (templates included). */
  argMap?: Record<string, string>
}
export type Binding = Record<string, BindingEntry>

export interface ToolDesc {
  name: string
  kind?: ToolKind
  /** Argument names the emitted tool accepts, when known. */
  params?: string[]
}

/** Tool descriptions from the plan: kind from the planner, parameter names as the emitted Python signature has them. */
export function describeTools(plan: ServerPlan): ToolDesc[] {
  return plan.tools.map((t: PlannedTool) => {
    const kind = toolKind(plan, t)
    // A tool a proposal changed or created: the argument names come from its final signature.
    if (t.proposed) return { name: t.name, kind, params: finalSignature(plan, t).map((a) => a.name) }
    const params = t.params.map((p) => p.name)
    const op = t.operation ? plan.model.operations.find((o) => o.id === t.operation) : undefined
    if (!t.derived && op && (kind === 'list' || kind === 'search')) {
      if (op.pageParam || op.offsetParam) params.push('page')
      if (op.pageSizeParam) params.push('page_size')
    }
    if (t.derived?.kind === 'inMemoryFilter') params.push('key', 'value')
    return { name: t.name, kind, params: [...new Set(params)] }
  })
}

const LOOKUP_NAME = /^(get|lookup|query)_/
const FREE_TEXT = ['q', 'query', 'search', 'keyword', 'keywords', 'text', 'term', 'free_text']

function kindOf(t: ToolDesc): ToolKind | undefined {
  if (t.kind) return t.kind
  if (LOOKUP_NAME.test(t.name)) return t.name.startsWith('query_') ? 'query' : 'get'
  if (t.name.startsWith('search_')) return 'search'
  if (t.name.startsWith('list_')) return 'list'
  if (t.name.startsWith('filter_')) return 'filter'
  return undefined
}

/** Suite check ids and behaviour kinds by role. Documented in docs/mcp-test-platform.md. */
const LOOKUP_LINES = ['lookup_by_id', 'projection', 'bad_input', 'empty_vs_error', 'lookup_first_item', 'bad_id', 'multilingual_fields']
const SEARCH_LINES = [
  'search_keyword',
  'search_empty',
  'pagination_page2',
  'auth_failure',
  'search_pump',
  'search_gasket',
  'search_valve',
  'search_sensor',
  'search_bearing',
  'auth_fail',
  'fault_retry',
  'fault_timeout',
  'fault_malformed',
  'secret_canary',
  'rerun_variance'
]

/** Pure: map emitted tools to bindings. Roles with no matching tool are omitted (the check FAILs 'no tool'). */
export function deriveBinding(tools: (string | ToolDesc)[]): Binding {
  const ts: ToolDesc[] = tools.map((t) => (typeof t === 'string' ? { name: t } : t))
  const ofKind = (...k: ToolKind[]) =>
    ts.filter((t) => {
      const x = kindOf(t)
      return x !== undefined && k.includes(x)
    })
  const gets = ts.filter((t) => {
    const k = kindOf(t)
    return k !== 'proposed' && (k === 'get' || k === 'query' || LOOKUP_NAME.test(t.name))
  })
  const lookup = gets[0]
  const search = ofKind('search')[0]
  const list = ofKind('list')[0]
  const filter = ofKind('filter')[0]
  const b: Binding = {}
  const entry = (t: ToolDesc, map: [string, string[]][]): BindingEntry => {
    const argMap: Record<string, string> = {}
    for (const [from, candidates] of map) {
      const to = candidates.find((c) => t.params?.includes(c))
      if (to && to !== from) argMap[from] = to
    }
    return Object.keys(argMap).length > 0 ? { tool: t.name, argMap } : { tool: t.name }
  }
  if (lookup) {
    // The identifier argument is the one required path parameter when the plan says so; otherwise the suite's own name stays.
    const idParam = lookup.kind === 'get' ? (lookup.params ?? []).filter((p) => !['fields'].includes(p)) : []
    const e: BindingEntry =
      idParam.length === 1 && idParam[0] !== 'id' ? { tool: lookup.name, argMap: { id: idParam[0] } } : { tool: lookup.name }
    for (const id of LOOKUP_LINES) b[id] = { ...e }
    b.tool_exists_lookup = { tool: lookup.name }
    if (gets.length > 1) {
      const alt = gets[1]
      const altParams = (alt.params ?? []).filter((p) => p !== 'fields')
      b.lookup_by_alt_key =
        altParams.length === 1 && altParams[0] !== 'code' ? { tool: alt.name, argMap: { code: altParams[0] } } : { tool: alt.name }
    }
  }
  const pager = list ?? search
  const searcher = search ?? list
  if (searcher) {
    for (const id of SEARCH_LINES)
      b[id] = entry(searcher, [
        ['query', FREE_TEXT],
        ['per_page', ['page_size', 'limit']]
      ])
    b.tool_exists_search = { tool: searcher.name }
  }
  if (pager) {
    b.pagesize_clamp = entry(pager, [
      ['query', FREE_TEXT],
      ['per_page', ['page_size', 'limit']]
    ])
    b.pagination_ceiling = entry(pager, [
      ['query', FREE_TEXT],
      ['per_page', ['page_size', 'limit']]
    ])
  }
  const filt = filter ?? list
  if (filt) b.derived_filter = filter ? entry(filter, [['attribute', ['key']]]) : { tool: filt.name }
  return b
}

/** Stable JSON text of the binding for the package file. */
export function emitBinding(plan: ServerPlan): string {
  const b = deriveBinding(describeTools(plan))
  const sorted: Binding = {}
  for (const k of Object.keys(b).sort()) sorted[k] = b[k]
  return JSON.stringify(sorted, null, 2) + '\n'
}
