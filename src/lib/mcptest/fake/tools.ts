// Table-driven tool handlers for the fake MCP server. Every tool maps to an upstream route from the
// mock contract; the planted flaws of each variant are small branches on the Behaviour knobs.
// Scorer fixture code: it is never described as a tested real server.
// Reads upstream URLs and the key from the passed env only (never from the process environment).
import type { ToolInfo } from '../core/types'
import { ENV_VARS, ROUTES, TOOL_NAMES } from '../mock/contract'
import { MAX_PAGE_SIZE, PROJECTION_MAX_FIELDS, type Behaviour } from './behaviour'

export interface ToolDeps {
  env: Record<string, string>
  sleep: (ms: number) => Promise<void>
  stderr: { write(s: string): unknown }
}
export interface ToolResult {
  isError: boolean
  /** Present for structured results; absent for leaky raw text. */
  structured?: Record<string, unknown>
  text: string
}

type Args = Record<string, unknown>
type Obj = Record<string, unknown>

const REQUEST_TIMEOUT_MS = 5000
const RETRY_ATTEMPTS = 3
const BACKOFF_MS = 20
const MAX_RETRY_AFTER_MS = 2000
const LARGE_SHOWN = 100
const LARGE_BYTE_BUDGET = 48 * 1024
/** The huge variant stays under the 1 MiB line cap of the client so the failure is "too big", not "dropped". */
const HUGE_ITEMS = 600
const SILENT_CAP_ITEMS = 100
/** Result window of the documented upstream; the derived filter stays inside it. */
const CEILING_PROBE = 200
const CATEGORIES_FOR_SCAN = ['Bearings', 'Valves', 'Sensors', 'Pumps']
const PROJECTED = [
  'id',
  'code',
  'name',
  'category',
  'supplier',
  'attributes',
  'description',
  'price_eur',
  'currency',
  'in_stock',
  'unit',
  'width_mm'
] as const

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
const pos = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : undefined
}
const enc = encodeURIComponent

/** EAN-13 style check digit validation (local copy; the fake does not import mock datasets for logic). */
function validCode(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10 === Number(code[12])
}

// ---------- tool list ----------

const strProp = (description: string) => ({ type: 'string', description })
const intProp = (description: string) => ({ type: 'integer', minimum: 1, description })
const schema = (properties: Obj, required: string[] = []) => ({ type: 'object', properties, required })

function allTools(b: Behaviour): ToolInfo[] {
  const ro = { readOnlyHint: true }
  const tools: ToolInfo[] = [
    {
      name: TOOL_NAMES.lookupItem,
      description: 'Fetch one catalogue entry by its identifier or by its alternate code.',
      inputSchema: schema({ id: strProp('Item identifier'), code: strProp('Alternate item code') }),
      annotations: ro
    },
    {
      name: TOOL_NAMES.searchItems,
      description: 'Search the catalogue with free text; paged results.',
      inputSchema: schema({
        q: strProp('Free text'),
        category: strProp('Exact category name'),
        page: intProp('Page number, 1-based'),
        per_page: intProp(`Page size, at most ${MAX_PAGE_SIZE}`)
      }),
      annotations: ro
    },
    {
      name: TOOL_NAMES.listBySupplier,
      description: 'List catalogue entries of one supplier; paged.',
      inputSchema: schema(
        { supplier: strProp('Supplier id or name'), page: intProp('Page number'), per_page: intProp('Page size') },
        ['supplier']
      ),
      annotations: ro
    },
    {
      name: TOOL_NAMES.findByAttribute,
      description: 'Find catalogue entries whose attribute has a given value (filtered here, not upstream).',
      inputSchema: schema({ attribute: strProp('Attribute key, e.g. Colour'), value: strProp('Attribute value') }, [
        'attribute',
        'value'
      ]),
      annotations: ro
    },
    {
      name: TOOL_NAMES.listCategoryItems,
      description: 'List entries of a large category; the answer is bounded and says when it is cut.',
      inputSchema: schema({ category: strProp('Category name') }, ['category']),
      annotations: ro
    },
    {
      name: TOOL_NAMES.lookupByGtin,
      description: 'Resolve a 13 digit product code (GTIN) to its product.',
      inputSchema: schema({ gtin: strProp('13 digit code with check digit') }, ['gtin']),
      annotations: ro
    },
    {
      name: TOOL_NAMES.listWidgets,
      description: 'List the documented widgets.',
      inputSchema: schema({}),
      annotations: ro
    },
    {
      name: TOOL_NAMES.getWidget,
      description: 'Fetch one widget by id.',
      inputSchema: schema({ id: strProp('Widget id') }, ['id']),
      annotations: ro
    },
    {
      name: TOOL_NAMES.assemble,
      description: 'Assemble a composite view of a component from two backends.',
      inputSchema: schema({ id: strProp('Component id') }, ['id']),
      annotations: ro
    }
  ]
  const out = b.derivedTool && !b.mirror ? tools : tools.filter((t) => t.name !== TOOL_NAMES.findByAttribute)
  if (b.writeTool) {
    out.push({
      name: 'delete_item',
      description: 'Delete a catalogue entry.',
      inputSchema: schema({ id: strProp('Item id') }, ['id']),
      annotations: { readOnlyHint: false, destructiveHint: true }
    })
  }
  return out
}

export function listTools(b: Behaviour): ToolInfo[] {
  return allTools(b)
}

// ---------- upstream access ----------

type Up =
  | { t: 'ok'; body: unknown }
  | { t: 'http'; status: number; text: string }
  | { t: 'malformed'; detail: string }
  | { t: 'network'; detail: string }
  | { t: 'config'; detail: string }
type UpFailure = Exclude<Up, { t: 'ok' }>

class Ctx {
  constructor(
    readonly b: Behaviour,
    readonly deps: ToolDeps
  ) {}

  base(which: 'A' | 'B' = 'A'): string | undefined {
    const e = this.deps.env
    const v = which === 'B' ? (e[ENV_VARS.baseUrlB] ?? e[ENV_VARS.baseUrl]) : e[ENV_VARS.baseUrl]
    return v?.replace(/\/+$/, '')
  }

  async get(path: string, query: Record<string, string | number | undefined> = {}, which: 'A' | 'B' = 'A'): Promise<Up> {
    const base = this.base(which)
    if (!base) return { t: 'config', detail: 'upstream base URL is not configured' }
    const q = Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${enc(k)}=${enc(String(v))}`)
      .join('&')
    return this.request(base + path + (q ? `?${q}` : ''), 'GET')
  }

  async request(url: string, method: string): Promise<Up> {
    const key = this.deps.env[ENV_VARS.apiKey]
    const headers: Record<string, string> = { accept: 'application/json' }
    if (key) headers['x-api-key'] = key
    if (this.b.echoSecret && key) this.deps.stderr.write(`${ENV_VARS.apiKey}=${key}\n`)
    const attempts = this.b.retry ? RETRY_ATTEMPTS : 1
    let last: Up = { t: 'network', detail: 'no attempt made' }
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let waitMs = BACKOFF_MS * attempt
      try {
        const res = await fetch(url, { method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
        const text = await res.text()
        if (res.status === 429 || res.status >= 500) {
          const raw = res.headers.get('retry-after')
          const ra = raw === null ? NaN : Number(raw)
          if (Number.isFinite(ra) && ra >= 0) waitMs = Math.min(ra * 1000, MAX_RETRY_AFTER_MS)
          last = { t: 'http', status: res.status, text }
        } else if (res.status < 200 || res.status >= 300) {
          return { t: 'http', status: res.status, text }
        } else {
          const ct = res.headers.get('content-type') ?? ''
          if (!ct.toLowerCase().includes('json')) return { t: 'malformed', detail: 'response is not JSON' }
          try {
            return { t: 'ok', body: JSON.parse(text) }
          } catch {
            return { t: 'malformed', detail: 'response body could not be parsed' }
          }
        }
      } catch (e) {
        const name = e instanceof Error ? e.name : ''
        const timedOut = name === 'TimeoutError' || name === 'AbortError'
        last = { t: 'network', detail: timedOut ? 'request timed out' : 'connection failed' }
        if (timedOut) return last
      }
      if (attempt < attempts) await this.deps.sleep(waitMs)
    }
    return last
  }
}

// ---------- result builders ----------

const json = (o: unknown) => JSON.stringify(o)

function ok(c: Ctx, data: Obj): ToolResult {
  const structured: Obj = { ok: true, ...data }
  if (c.b.echoSecret) structured.debug = { api_key: c.deps.env[ENV_VARS.apiKey] ?? '' }
  return { isError: false, structured, text: json(structured) }
}

function rawOk(body: unknown): ToolResult {
  return { isError: false, structured: isObj(body) ? body : { value: body }, text: json(body) }
}

type Kind = 'not_found' | 'auth' | 'upstream' | 'invalid_input' | 'empty'
const HINTS: Record<Kind, string> = {
  not_found: 'Check the identifier, or use the search tool to find it.',
  auth: 'Verify the configured API key.',
  upstream: 'Retry later; if it persists the upstream service is unavailable.',
  invalid_input: 'Provide valid values for the documented arguments.',
  empty: 'Broaden the query.'
}

function fail(kind: Kind, message: string): ToolResult {
  const structured = { ok: false, kind, message, hint: HINTS[kind] }
  return { isError: true, structured, text: json(structured) }
}

/** Map a failed upstream call to a tool result according to the error style. */
function upFail(c: Ctx, up: UpFailure, what: string): ToolResult {
  if (c.b.errorStyle === 'leaky' || c.b.mirror) {
    const body =
      up.t === 'http'
        ? `httpx.HTTPStatusError: upstream returned ${up.status}\n${up.text}`
        : up.t === 'malformed'
          ? 'JSONDecodeError: Expecting value: line 1 column 1'
          : 'ConnectionError: upstream unreachable'
    return { isError: true, text: `Traceback (most recent call last):\n  File "server.py", line 1\n${body}` }
  }
  if (up.t === 'http') {
    if (up.status === 404) return fail('not_found', `${what} not found`)
    if (up.status === 401 || up.status === 403) {
      if (c.b.errorStyle === 'no-auth-message') return fail('upstream', 'Request failed.')
      return fail('auth', 'The upstream service rejected the API key (unauthorized).')
    }
    if (up.status === 400) return fail('invalid_input', 'The upstream service rejected the request parameters.')
    return fail('upstream', `The upstream service is unavailable (code ${up.status}).`)
  }
  if (up.t === 'malformed') return fail('upstream', 'The upstream service returned a response that could not be read.')
  if (up.t === 'config') return fail('upstream', 'The upstream service is not configured.')
  return fail('upstream', `The upstream service could not be reached (${up.detail}).`)
}

function project(c: Ctx, item: unknown): unknown {
  if (!c.b.projection || c.b.mirror || !isObj(item)) return item
  const out: Obj = {}
  for (const k of PROJECTED.slice(0, PROJECTION_MAX_FIELDS)) if (k in item) out[k] = item[k]
  return out
}

/** The 'confident-wrong' flaw: a malformed body is turned into an invented answer. */
function fabricated(c: Ctx, shape: 'items' | 'item'): ToolResult {
  const it = { id: 'ACM-000001', code: '9900000000017', name: { en: 'Acme Item' }, category: 'Bearings' }
  return shape === 'items' ? ok(c, { items: [it], page: 1, per_page: 20, total: 1 }) : ok(c, { item: it })
}

// ---------- handlers ----------

type Handler = (c: Ctx, a: Args) => Promise<ToolResult>

async function pagedSearch(c: Ctx, a: Args, supplier?: string): Promise<ToolResult> {
  const pageIn = a.page
  const perIn = a.per_page ?? a.page_size ?? a.limit
  if (!c.b.mirror) {
    if (a.q !== undefined && typeof a.q !== 'string') return fail('invalid_input', 'q must be a string.')
    if (pageIn !== undefined && pos(pageIn) === undefined) return fail('invalid_input', 'page must be a positive integer.')
    if (perIn !== undefined && pos(perIn) === undefined) return fail('invalid_input', 'per_page must be a positive integer.')
  }
  let per = pos(perIn)
  let clamped = false
  if (c.b.clamp && per !== undefined && per > MAX_PAGE_SIZE) {
    per = MAX_PAGE_SIZE
    clamped = true
  }
  const up = await c.get(ROUTES.items, {
    q: typeof a.q === 'string' ? a.q : typeof a.query === 'string' ? a.query : undefined,
    category: str(a.category),
    supplier: str(a.supplier) ?? supplier,
    page: pos(pageIn),
    per_page: per
  })
  if (up.t === 'malformed' && c.b.malformed === 'fabricate') return fabricated(c, 'items')
  if (up.t !== 'ok') return upFail(c, up, 'Items')
  const body = up.body
  if (!isObj(body) || !Array.isArray(body.items)) return upFail(c, { t: 'malformed', detail: 'unexpected shape' }, 'Items')
  const items = body.items
  const empty = items.length === 0
  if (c.b.mirror) return rawOk(body)
  if (empty && c.b.errorStyle === 'bare-empty') return rawOk(body)
  if (empty && c.b.errorStyle === 'leaky') {
    return rawOk({ ...body, upstream: { timestamp: 'n/a', status: 200, error: null, path: ROUTES.items } })
  }
  const data: Obj = {
    items: items.map((i) => project(c, i)),
    page: body.page,
    per_page: body.per_page,
    total: body.total
  }
  if (clamped) {
    data.clamped = true
    data.note = `per_page limited to ${MAX_PAGE_SIZE}`
  }
  if (empty) data.message = 'No matching items found'
  return ok(c, data)
}

const lookupItem: Handler = async (c, a) => {
  const id = str(a.id)
  const code = str(a.code)
  if (!c.b.mirror && !id && !code) return fail('invalid_input', 'Provide id or code.')
  const path = id
    ? ROUTES.itemById.replace(':id', enc(id))
    : code
      ? ROUTES.itemByCode.replace(':code', enc(code))
      : ROUTES.itemById.replace(':id', 'undefined') // mirror forwards whatever it got
  const up = await c.get(path)
  if (up.t === 'malformed' && c.b.malformed === 'fabricate') return fabricated(c, 'item')
  if (up.t !== 'ok') return upFail(c, up, `Item ${id ?? code ?? ''}`.trim())
  return c.b.mirror ? rawOk(up.body) : ok(c, { item: project(c, up.body) })
}

const searchItems: Handler = (c, a) => pagedSearch(c, a)

const listBySupplier: Handler = async (c, a) => {
  const supplier = str(a.supplier)
  if (!c.b.mirror && !supplier) return fail('invalid_input', 'supplier is required.')
  return pagedSearch(c, a, supplier)
}

const findByAttribute: Handler = async (c, a) => {
  const attribute = str(a.attribute)
  const value = str(a.value)
  if (!attribute || !value) return fail('invalid_input', 'attribute and value are required.')
  const matched: unknown[] = []
  let truncated = false
  // The upstream has no attribute parameter; page through each category partition and filter here.
  for (const category of CATEGORIES_FOR_SCAN) {
    let fetched = 0
    for (let page = 1; ; page++) {
      if (page * MAX_PAGE_SIZE > CEILING_PROBE) {
        truncated = true
        break
      }
      const up = await c.get(ROUTES.items, { category, page, per_page: MAX_PAGE_SIZE })
      if (up.t !== 'ok') return upFail(c, up, 'Items')
      const body = up.body
      if (!isObj(body) || !Array.isArray(body.items)) {
        return upFail(c, { t: 'malformed', detail: 'unexpected shape' }, 'Items')
      }
      for (const it of body.items) {
        const attrs = isObj(it) && Array.isArray(it.attributes) ? it.attributes : []
        const hit = attrs.some(
          (x) =>
            isObj(x) &&
            String(x.key).toLowerCase() === attribute.toLowerCase() &&
            String(x.value).toLowerCase() === value.toLowerCase()
        )
        if (hit) matched.push(project(c, it))
      }
      fetched += body.items.length
      if (body.items.length === 0 || fetched >= Number(body.total ?? 0)) break
    }
  }
  const data: Obj = { items: matched, page: 1, per_page: matched.length, total: matched.length }
  if (truncated) data.truncated = true
  if (matched.length === 0) data.message = 'No matching items found'
  return ok(c, data)
}

const listCategoryItems: Handler = async (c, a) => {
  const category = str(a.category)
  if (!category) return fail('invalid_input', 'category is required.')
  const keep = c.b.largeResponse === 'huge' ? HUGE_ITEMS : LARGE_SHOWN
  const all: unknown[] = []
  let cursor: string | undefined
  let total = 0
  for (let i = 0; i < 20; i++) {
    const up = await c.get(ROUTES.categoryItems.replace(':c', enc(category)), { limit: 1000, cursor })
    if (up.t !== 'ok') return upFail(c, up, `Category ${category}`)
    const body = up.body
    if (!isObj(body) || !Array.isArray(body.items)) {
      return upFail(c, { t: 'malformed', detail: 'unexpected shape' }, 'Items')
    }
    total += body.items.length
    for (const it of body.items) if (all.length < keep) all.push(project(c, it))
    if (typeof body.next === 'string' && body.next) cursor = body.next
    else break
  }
  if (c.b.largeResponse === 'huge') return ok(c, { items: all, page: 1, per_page: all.length, total })
  if (c.b.largeResponse === 'silent-cap') {
    return ok(c, { items: all.slice(0, SILENT_CAP_ITEMS), page: 1, per_page: SILENT_CAP_ITEMS })
  }
  let shown = all
  while (shown.length > 1 && json(shown).length > LARGE_BYTE_BUDGET) shown = shown.slice(0, shown.length - 10)
  return ok(c, {
    items: shown,
    page: 1,
    per_page: shown.length,
    total,
    truncated: shown.length < total,
    shown: shown.length
  })
}

const lookupByGtin: Handler = async (c, a) => {
  const gtin = str(a.gtin) ?? str(a.code)
  if (!gtin) return fail('invalid_input', 'gtin is required.')
  if (c.b.validateCodes && !validCode(gtin)) {
    return fail('invalid_input', 'The code is not a valid 13 digit code with a correct check digit.')
  }
  const up = await c.get(ROUTES.products.replace(':code', enc(gtin)))
  if (up.t !== 'ok') return upFail(c, up, `Product ${gtin}`)
  return ok(c, { item: up.body })
}

const listWidgets: Handler = async (c) => {
  if (!c.b.grounded) await c.get('/widgets/featured/list') // undocumented route, result ignored
  const up = await c.get(ROUTES.widgets)
  if (up.t !== 'ok') return upFail(c, up, 'Widgets')
  const body = up.body
  const items = isObj(body) && Array.isArray(body.items) ? body.items : []
  return ok(c, { items, page: 1, per_page: items.length, total: items.length })
}

const getWidget: Handler = async (c, a) => {
  const id = str(a.id)
  if (!id) return fail('invalid_input', 'id is required.')
  const up = await c.get(ROUTES.widgetById.replace(':id', enc(id)))
  if (up.t !== 'ok') return upFail(c, up, `Widget ${id}`)
  return ok(c, { item: up.body })
}

const assemble: Handler = async (c, a) => {
  const id = str(a.id) ?? str(a.component_id) // DRAFT-15-08-fix-1: suite golden uses component_id
  if (!id) return fail('invalid_input', 'id is required.')
  const comp = await c.get(ROUTES.components.replace(':id', enc(id)), {}, 'A')
  if (comp.t !== 'ok') return upFail(c, comp, `Component ${id}`)
  const asm = await c.get(ROUTES.assemblies.replace(':id', enc(id)), {}, 'B')
  if (asm.t !== 'ok') return upFail(c, asm, `Assembly for ${id}`)
  return ok(c, { item: { component: comp.body, assembly: asm.body } })
}

const deleteItem: Handler = async (c, a) => {
  const id = str(a.id)
  if (!id) return fail('invalid_input', 'id is required.')
  const base = c.base()
  if (!base) return fail('upstream', 'The upstream service is not configured.')
  const up = await c.request(base + ROUTES.itemById.replace(':id', enc(id)), 'DELETE')
  if (up.t !== 'ok') return upFail(c, up, `Item ${id}`)
  return ok(c, { message: 'Item deleted' })
}

const HANDLERS: Record<string, Handler> = {
  [TOOL_NAMES.lookupItem]: lookupItem,
  [TOOL_NAMES.searchItems]: searchItems,
  [TOOL_NAMES.listBySupplier]: listBySupplier,
  [TOOL_NAMES.findByAttribute]: findByAttribute,
  [TOOL_NAMES.listCategoryItems]: listCategoryItems,
  [TOOL_NAMES.lookupByGtin]: lookupByGtin,
  [TOOL_NAMES.listWidgets]: listWidgets,
  [TOOL_NAMES.getWidget]: getWidget,
  [TOOL_NAMES.assemble]: assemble,
  delete_item: deleteItem
}

/** Returns null when the tool is not exposed by this variant. Never throws. */
export async function callTool(b: Behaviour, deps: ToolDeps, name: string, args: Args): Promise<ToolResult | null> {
  if (!allTools(b).some((t) => t.name === name)) return null
  const h = HANDLERS[name]
  if (!h) return null
  try {
    return await h(new Ctx(b, deps), args)
  } catch {
    return fail('upstream', 'The tool failed unexpectedly.')
  }
}
