// SourceModel -> ServerPlan. Pure functions, no I/O (design doc sections 4-7).
//
// EXTENSION POINT (design doc section 6): a DerivedTool is a tool synthesized for a capability the
// source lacks. `detectDerivedTools` finds them structurally (origin 'detected'); authors add their
// own through the `extraDerived` argument of `buildPlan` (origin 'user'). Both flow through the same
// validation and the same emitter templates. Invalid user entries are reported, never guessed.
import { cmp, gap } from './diagnostics.js'
import { cleanSpecTextFlagged } from './hygiene.js'
import type {
  DerivedTool,
  Entity,
  GenerateOptions,
  Gap,
  NestedCollection,
  Operation,
  Param,
  PlannedTool,
  ServerPlan,
  SourceModel,
} from './types.js'

/** Hard cap on projected fields per entity (RESEARCH-SYNTHESIS 3.2 row 2, PROJECTION_MAX_FIELDS). */
export const PROJECTION_MAX_FIELDS = 12
export const MAX_TOOL_NAME = 48
export const DEFAULT_MAX_PAGE_SIZE = 100
export const DEFAULT_MAX_RESPONSE_ITEMS = 200
/** Upper bound on pages a derived filter tool may scan in one call. */
export const DERIVED_MAX_PAGES = 10
/** Upper bound for any numeric limit written into generated code. */
export const MAX_LIMIT = 1_000_000_000

/** Gap codes that describe something the generator dropped (shown as toolsDropped in the report). */
export const DROP_CODES = ['write-dropped', 'write-not-supported', 'operation-skipped', 'tool-omitted', 'proposal-hidden']

export type ToolKind = 'list' | 'search' | 'get' | 'filter' | 'query' | 'describe' | 'proposed'

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
const PATH_OK = /^\/[A-Za-z0-9_\-.~/{}]*$/
/** An OData entity set path: one safe segment (the set name), written into generated code as a constant. */
const ODATA_SET_PATH = /^\/[A-Za-z_][A-Za-z0-9_]{0,127}$/
const FREE_TEXT = new Set(['q', 'query', 'search', 'keyword', 'keywords', 'text', 'term', 'free_text'])

export const PY_KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type'.split(
    ' ',
  ),
)
/** Names the emitted Python bodies use (builtins, modules, locals). A parameter may not shadow them. */
export const RESERVED_NAMES = new Set(
  (
    'str int float bool len list dict set tuple range min max sum any all sorted isinstance zip enumerate print dir ' +
    'os json time csv math sqlite3 httpx mcp server Any Optional functools urllib pathlib Exception BaseException ' +
    'exc sel query data rows row results item items hits matches scanned truncated needle coverage out ' +
    'base_query spec conn cur sql args col pages hint ident entry ' +
    // builtins and modules the emitted runtime calls or assigns (CR-28)
    'open ord super datetime re parts'
  ).split(' '),
)
export const STANDARD_ARGS = new Set(['page', 'page_size', 'fields', 'limit', 'offset', 'field', 'value', 'match', 'key', 'max_pages'])

export function snake(s: string): string {
  let t = String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (t === '') t = 'x'
  if (/^[0-9]/.test(t)) t = `x_${t}`
  return t
}

export function plural(s: string): string {
  if (/[^aeiou]y$/.test(s)) return `${s.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/.test(s)) return `${s}es`
  return `${s}s`
}

/** Deterministic unique name: truncated to MAX_TOOL_NAME, numeric suffix on collision. */
export function uniqueName(base: string, used: Set<string>): string {
  let name = base.slice(0, MAX_TOOL_NAME).replace(/_+$/, '')
  let n = 2
  while (used.has(name)) {
    const suffix = `_${n++}`
    name = `${base.slice(0, MAX_TOOL_NAME - suffix.length).replace(/_+$/, '')}${suffix}`
  }
  used.add(name)
  return name
}

export function serverSlug(model: SourceModel): string {
  const s = snake(model.name).slice(0, 32).replace(/_+$/, '')
  return IDENT.test(s) ? s : 's'
}

export interface EnvNames {
  baseUrl?: string
  auth?: string
  dataFile?: string
  dsn?: string
}

/** Env var names (never values). Defaults derive from the server name. */
export function resolveEnv(model: SourceModel): EnvNames {
  const prefix = serverSlug(model).toUpperCase()
  const pick = (v: string | undefined, dflt: string) => (v && ENV_NAME.test(v) ? v : dflt)
  const env: EnvNames = {}
  if (model.backend.kind === 'http') env.baseUrl = pick(model.backend.baseUrlEnv, `${prefix}_BASE_URL`)
  if (model.backend.kind === 'dataset') env.dataFile = pick(model.backend.datasetPathEnv, `${prefix}_DATA_FILE`)
  if (model.backend.kind === 'sql') env.dsn = pick(model.backend.dsnEnv, `${prefix}_DSN`)
  if (model.backend.kind === 'http' && model.auth.scheme !== 'none') env.auth = pick(model.auth.envVar, `${prefix}_API_KEY`)
  return env
}

/** Env var purpose for an OAuth2 or OpenID Connect scheme (no flow is implemented, D-521). */
export const OAUTH2_PURPOSE = 'OAuth2 access token obtained by you; never stored'

export interface AuthSpec {
  scheme: SourceModel['auth']['scheme']
  name: string
}
export function resolveAuth(model: SourceModel): AuthSpec {
  const dflt = model.auth.scheme === 'apiKeyQuery' ? 'api_key' : 'X-Api-Key'
  const ok = model.auth.paramName && /^[A-Za-z0-9_-]{1,64}$/.test(model.auth.paramName)
  return { scheme: model.backend.kind === 'http' ? model.auth.scheme : 'none', name: ok ? model.auth.paramName! : dflt }
}

export function effectiveMaxPageSize(model: SourceModel, op?: Operation): number {
  const p = op?.pageSizeParam ? op.params.find((x) => x.name === op.pageSizeParam) : undefined
  const v = p?.max ?? model.limits.maxPageSize
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : DEFAULT_MAX_PAGE_SIZE
}

/** True when the page size comes from the source (not the generator default). */
export function pageSizeKnown(model: SourceModel, op?: Operation): boolean {
  const p = op?.pageSizeParam ? op.params.find((x) => x.name === op.pageSizeParam) : undefined
  const v = p?.max ?? model.limits.maxPageSize
  return typeof v === 'number' && Number.isInteger(v) && v >= 1
}

/** Names usable in `fields` and in filters: entity fields plus nested collection names. */
export function entityFieldNames(entity: Entity): string[] {
  const seen = new Set<string>()
  for (const f of entity.fields) seen.add(f.name)
  for (const n of entity.nested) seen.add(n.field)
  return [...seen]
}

export function projectionFor(entity: Entity, override: string[] | undefined, gaps: Gap[]): string[] {
  const known = new Set(entityFieldNames(entity))
  let list: string[] = []
  // An override with no surviving field falls back to the default projection (CR-41); the gaps above stay.
  if (override) {
    for (const f of override) {
      if (!known.has(f)) gaps.push(gap('projection-unknown-field', `Projection override for ${entity.id} names an unknown field and it was ignored.`, { path: `${entity.id}.${f}` }))
      else if (!list.includes(f)) list.push(f)
    }
  }
  if (list.length === 0) {
    const add = (f: string) => {
      if (known.has(f) && !list.includes(f)) list.push(f)
    }
    entity.identifierFields.forEach(add)
    entity.fields.filter((f) => f.identifier).forEach((f) => add(f.name))
    entity.fields.filter((f) => f.nameLike).forEach((f) => add(f.name))
    entity.fields.filter((f) => f.classLike).forEach((f) => add(f.name))
    entity.nested.forEach((n) => add(n.field))
    if (list.length === 0) {
      list = [...known].slice(0, PROJECTION_MAX_FIELDS)
      gaps.push(gap('projection-default', `No identifier, name-like or class-like field is marked on ${entity.id}; the first fields were used.`, { severity: 'info', path: entity.id }))
    }
  }
  if (list.length > PROJECTION_MAX_FIELDS) {
    gaps.push(gap('projection-capped', `Projection for ${entity.id} was cut to ${PROJECTION_MAX_FIELDS} fields.`, { severity: 'info', path: entity.id }))
    list = list.slice(0, PROJECTION_MAX_FIELDS)
  }
  return list
}

function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Structural rule (synthesis 3.1, design doc section 6): an entity has a nested array of objects with
 * key fields, and no operation on that entity declares a request parameter named like the nested
 * field or one of its key fields. Domain-free.
 */
export function detectDerivedTools(model: SourceModel): DerivedTool[] {
  const out: DerivedTool[] = []
  for (const entity of model.entities) {
    const params = new Set<string>()
    for (const op of model.operations) {
      if (op.entity !== entity.id) continue
      for (const p of op.params) params.add(nameKey(p.name))
    }
    for (const n of entity.nested) {
      if (n.keyFields.length === 0) continue
      const filterable = [n.field, ...n.keyFields].some((x) => params.has(nameKey(x)))
      if (filterable) continue
      out.push({
        id: `${entity.id}.${n.field}`,
        kind: 'inMemoryFilter',
        entity: entity.id,
        source: n.field,
        description: `Find ${plural(snake(entity.id)).replace(/_/g, ' ')} whose ${snake(n.field).replace(/_/g, ' ')} contain a matching entry; candidate pages are fetched and filtered in memory and the scan coverage is reported.`,
        origin: 'detected',
      })
    }
  }
  return out
}

function isFreeText(p: Param): boolean {
  return p.in === 'query' && p.type !== 'array' && p.type !== 'object' && FREE_TEXT.has(p.name.toLowerCase())
}

export function safeParamName(name: string, reserved: Set<string>, allowStandard = false): boolean {
  return (
    IDENT.test(name) &&
    !name.startsWith('_') &&
    !PY_KEYWORDS.has(name) &&
    !RESERVED_NAMES.has(name) &&
    (allowStandard || !STANDARD_ARGS.has(name)) &&
    !reserved.has(name) &&
    !/^[A-Z0-9_]+$/.test(name)
  )
}

/** A limit that is not a finite number is dropped; it would otherwise reach generated code. */
function finiteOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

interface ParamResult {
  params: Param[]
  omit?: string
  dropped: Gap[]
}

/**
 * Request parameters that become tool arguments (paging parameters are handled by the emitter).
 * `keepOffset`: an offset/limit style offset parameter is exposed as an ordinary integer argument
 * (list tools); filter tools iterate it themselves and so leave it out.
 */
function toolParams(op: Operation, reserved: Set<string>, keepOffset = false): ParamResult {
  const dropped: Gap[] = []
  const kept: Param[] = []
  const seen = new Set<string>()
  for (const p0 of op.params) {
    if (p0.name === op.pageParam || p0.name === op.pageSizeParam) continue
    const isOffset = op.offsetParam !== undefined && p0.name === op.offsetParam
    if (isOffset && !keepOffset) continue
    let p: Param = p0
    // Limits reach generated source: only finite numbers may pass (review WR-04).
    const min = finiteOrUndefined(p.min)
    const max = finiteOrUndefined(p.max)
    if (min !== p.min || max !== p.max) {
      dropped.push(gap('param-limit-invalid', `${op.id}: a minimum or maximum for ${p.name} is not a finite number and was ignored.`, { path: `${op.id}.${p.name}` }))
      p = { ...p, min, max }
      if (min === undefined) delete p.min
      if (max === undefined) delete p.max
    }
    if (isOffset) {
      p = { ...p, type: 'integer', required: false, min: Math.max(0, p.min ?? 0), description: p.description ?? 'Number of items to skip (offset paging).' }
    }
    let problem: string | undefined
    if (p.in !== 'query' && p.in !== 'path') problem = `parameter ${p.name} is not a query or path parameter`
    else if (p.type === 'array' || p.type === 'object') problem = `parameter ${p.name} has an unsupported type`
    else if (!safeParamName(p.name, reserved, isOffset)) problem = `parameter ${p.name} cannot be a safe argument name`
    else if (seen.has(p.name)) problem = `parameter ${p.name} is declared twice`
    if (problem) {
      if (p.required || p.in === 'path') return { params: [], omit: problem, dropped }
      dropped.push(gap('param-dropped', `${op.id}: ${problem}; it was left out of the tool.`, { path: `${op.id}.${p.name}` }))
      continue
    }
    seen.add(p.name)
    kept.push(p)
  }
  const ordered = [...kept.filter((p) => p.required || p.in === 'path'), ...kept.filter((p) => !(p.required || p.in === 'path'))]
  return { params: ordered, dropped }
}

/** Split a path template; returns undefined when the path is unsafe or inconsistent with the params. */
export function pathSegments(op: Operation): (string | { param: string })[] | undefined {
  const path = op.path
  if (!path || !PATH_OK.test(path) || path.split('/').includes('..')) return undefined
  const parts: (string | { param: string })[] = []
  let rest = path
  const re = /\{([^{}]+)\}/
  let m: RegExpExecArray | null
  while ((m = re.exec(rest))) {
    if (m.index > 0) parts.push(rest.slice(0, m.index))
    parts.push({ param: m[1] })
    rest = rest.slice(m.index + m[0].length)
  }
  if (/[{}]/.test(rest)) return undefined
  if (rest) parts.push(rest)
  const names = parts.filter((p): p is { param: string } => typeof p !== 'string').map((p) => p.param)
  const declared = op.params.filter((p) => p.in === 'path').map((p) => p.name)
  if (names.some((n) => !declared.includes(n)) || declared.some((n) => !names.includes(n))) return undefined
  return parts
}

function words(s: string): string {
  return snake(s).replace(/_/g, ' ')
}

/** Operation summary as it is published: secrets and model-directed phrases removed (review CR-03, WR-06). */
function summaryNote(op?: Operation): { text: string; flagged: boolean } {
  if (!op?.summary) return { text: '', flagged: false }
  const r = cleanSpecTextFlagged(op.summary.replace(/["\\]+/g, ' '), 8192)
  return { text: r.text.slice(0, 120), flagged: r.flagged }
}

function withSummary(base: string, op?: Operation): string {
  const s = summaryNote(op).text
  return s ? `${base} Source note: ${s}` : base
}

/** Source free text a tool publishes: its operation summary and the descriptions of its arguments. */
function publishesSourceText(op: Operation | undefined, params: Param[]): { copied: boolean; flagged: boolean } {
  const notes = [summaryNote(op), ...params.map((p) => (p.description ? cleanSpecTextFlagged(p.description, 8192) : { text: '', flagged: false }))]
  return { copied: notes.some((n) => n.text !== ''), flagged: notes.some((n) => n.flagged) }
}

/** Which kind of tool a PlannedTool is. Derived from the plan, so the contract types stay unchanged. */
export function toolKind(plan: ServerPlan, tool: PlannedTool): ToolKind {
  if (tool.proposed?.wrapper) return 'proposed'
  if (tool.derived) return tool.derived.kind === 'schemaDiscovery' ? 'describe' : 'filter'
  if (tool.operation) {
    const op = plan.model.operations.find((o) => o.id === tool.operation)
    if (op?.kind === 'get') return 'get'
    if (op?.kind === 'search' || op?.params.some(isFreeText)) return 'search'
    return 'list'
  }
  return 'query'
}

function validateExtra(model: SourceModel, d: DerivedTool, gaps: Gap[]): NestedCollection | undefined {
  const bad = (msg: string) => {
    gaps.push(gap('derived-invalid', `Derived tool ${String(d?.id)} was skipped: ${msg}.`, { path: String(d?.id) }))
    return undefined
  }
  if (!d || typeof d !== 'object') return bad('not an object')
  if (d.kind !== 'inMemoryFilter') return bad(`kind ${String(d.kind)} is not supported yet`)
  const entity = model.entities.find((e) => e.id === d.entity)
  if (!entity) return bad('the entity does not exist')
  const nested = entity.nested.find((n) => n.field === d.source)
  if (!nested) return bad('the source is not a nested collection of the entity')
  if (nested.keyFields.length === 0 && nested.valueFields.length === 0) return bad('the nested collection has no key or value fields')
  return nested
}

/** Own-property lookup, so an entity named constructor or __proto__ never reads Object.prototype. */
function ownList(map: Record<string, string[]> | undefined, key: string): string[] | undefined {
  if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return undefined
  const v = map[key]
  return Array.isArray(v) ? v : undefined
}

const GAP_RANK: Record<string, number> = { error: 0, warn: 1, info: 2 }

/** Total order for gaps: severity, code, path, message (code-unit comparison). */
export function gapOrder(a: Gap, b: Gap): number {
  return (GAP_RANK[a.severity] ?? 3) - (GAP_RANK[b.severity] ?? 3) || cmp(a.code, b.code) || cmp(a.path ?? '', b.path ?? '') || cmp(a.message, b.message)
}

/**
 * The set-like collections of a model in a stable order, so the plan, its fingerprint and every generated file
 * do not depend on the order the adapter (or a test) listed them. Field order, parameter order and key order
 * are declared order (column order, positional arguments, composite keys, default projection) and stay as given.
 */
function canonicalModel(m: SourceModel): SourceModel {
  const opKey = (o: Operation) => `${o.id}\u0000${o.method}\u0000${o.path ?? ''}\u0000${o.entity}`
  return {
    ...m,
    operations: [...m.operations].sort((a, b) => cmp(opKey(a), opKey(b))),
    entities: [...m.entities].sort((a, b) => cmp(a.id, b.id)).map((e) => ({ ...e, nested: [...e.nested].sort((a, b) => cmp(a.field, b.field)) })),
    gaps: [...m.gaps].sort(gapOrder),
    writeOperationsDropped: [...m.writeOperationsDropped].sort(cmp),
  }
}

/** buildPlan(model, options, extraDerived?) -> ServerPlan. Deterministic: tools sorted by name. */
export function buildPlan(input: SourceModel, options: GenerateOptions = {}, extraDerived: DerivedTool[] = []): ServerPlan {
  const model = canonicalModel(input)
  const limits = { ...model.limits, ...(options.limits ?? {}) }
  const gaps: Gap[] = [...model.gaps]
  // Limits are written into generated source: integers in range only (review WR-04).
  const badLimit = (name: string) => gaps.push(gap('limit-invalid', `The limit ${name} is not a whole number in the allowed range and was ignored.`, { path: name }))
  if (limits.maxResponseItems !== undefined && (!Number.isSafeInteger(limits.maxResponseItems) || limits.maxResponseItems < 1 || limits.maxResponseItems > MAX_LIMIT)) {
    badLimit('maxResponseItems')
    limits.maxResponseItems = DEFAULT_MAX_RESPONSE_ITEMS
  } else if (limits.maxResponseItems === undefined) limits.maxResponseItems = DEFAULT_MAX_RESPONSE_ITEMS
  if (limits.resultCeiling !== undefined && (!Number.isSafeInteger(limits.resultCeiling) || limits.resultCeiling < 1 || limits.resultCeiling > MAX_LIMIT)) {
    badLimit('resultCeiling')
    delete limits.resultCeiling
  }
  if (limits.maxPageSize !== undefined && (!Number.isSafeInteger(limits.maxPageSize) || limits.maxPageSize < 1 || limits.maxPageSize > MAX_LIMIT)) {
    badLimit('maxPageSize')
    delete limits.maxPageSize
  }
  // CR-08: a key name the emitter cannot use is replaced by the default; say so (the OData adapter reports it itself).
  if ((model.auth.scheme === 'apiKeyHeader' || model.auth.scheme === 'apiKeyQuery') && model.auth.paramName !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(model.auth.paramName)) {
    gaps.push(gap('auth-name-invalid', `The API key ${model.auth.scheme === 'apiKeyQuery' ? 'query parameter' : 'header'} name in the source is not usable (letters, digits, underscore and hyphen, at most 64); the default name was used.`, { path: 'auth' }))
  }
  let backend = model.backend
  if (backend.delimiter !== undefined && ![',', ';', '\t'].includes(backend.delimiter)) {
    gaps.push(gap('delimiter-invalid', 'The data file delimiter is not a comma, semicolon or tab; a comma was assumed.', { path: 'delimiter' }))
    backend = { ...backend }
    delete backend.delimiter
  }
  const m: SourceModel = { ...model, name: options.serverName?.trim() || model.name, limits, backend }
  const used = new Set<string>()
  const tools: PlannedTool[] = []
  const derived: DerivedTool[] = []
  const entityById = new Map(m.entities.map((e) => [e.id, e]))
  const projections = new Map<string, string[]>()
  const projection = (e: Entity) => {
    let p = projections.get(e.id)
    if (!p) {
      p = projectionFor(e, ownList(options.projectionOverride, e.id), gaps)
      projections.set(e.id, p)
    }
    return p
  }

  // Configuration names: report invalid explicit names, fall back to defaults.
  const b = m.backend
  for (const [label, v] of [['base URL', b.baseUrlEnv], ['dataset file', b.datasetPathEnv], ['DSN', b.dsnEnv], ['API key', m.auth.envVar]] as const) {
    if (v !== undefined && !ENV_NAME.test(v)) gaps.push(gap('env-name-invalid', `The ${label} environment variable name is not valid; a default name was used.`, { path: label }))
  }

  // Writes: never emitted in v1 (D-143).
  const allow = new Set(options.allowWrite ?? [])
  for (const id of [...m.writeOperationsDropped].sort()) {
    if (allow.has(id)) {
      gaps.push(gap('write-not-supported', `Write opt-in for ${id} is recorded but write tools are not emitted in this version.`, { path: id }))
    } else {
      gaps.push(gap('write-dropped', `Write operation ${id} was dropped (read-only server).`, { severity: 'info', path: id }))
    }
  }
  for (const id of [...allow].sort()) {
    if (!m.writeOperationsDropped.includes(id)) gaps.push(gap('allow-write-unknown', `allowWrite names ${id}, which is not a dropped write operation.`, { path: id }))
  }

  const detected = detectDerivedTools(m)

  if (m.backend.kind === 'http') {
    const listOps = new Map<string, Operation>()
    const copiedFrom: string[] = []
    const flaggedIn: string[] = []
    let anyList = false
    for (const op of m.operations) {
      if (op.method !== 'GET') {
        gaps.push(gap('operation-skipped', `Operation ${op.id} is not an HTTP GET and was skipped.`, { path: op.id }))
        continue
      }
      const entity = entityById.get(op.entity)
      if (!entity || !IDENT.test(snake(entity.id))) {
        gaps.push(gap('operation-skipped', `Operation ${op.id} refers to an unknown or unusable entity.`, { path: op.id }))
        continue
      }
      if (op.kind === 'other') {
        gaps.push(gap('operation-skipped', `Operation ${op.id} is neither list, get nor search; no task-oriented tool could be derived.`, { severity: 'info', path: op.id }))
        continue
      }
      if (op.protocol === 'odata') {
        // OData (D-562): the path is the entity set; paging (`$top`/`$skip`), `$select`, `$filter` and the key
        // predicate are written by the emitter's fixed helpers, so only key parameters and the filter arguments are tool arguments.
        const pr = toolParams(op, new Set(), false)
        if (!ODATA_SET_PATH.test(op.path ?? '') || (op.kind !== 'list' && op.kind !== 'get') || pr.omit || (op.kind === 'get' && !pr.params.some((p) => p.in === 'path'))) {
          gaps.push(gap('tool-omitted', `Operation ${op.id} was omitted: ${pr.omit ?? 'an OData operation needs a safe entity set path and, for a lookup, key arguments'}.`, { path: op.id }))
          continue
        }
        gaps.push(...pr.dropped)
        const en = snake(entity.id)
        let name: string
        let description: string
        let params = pr.params
        if (op.kind === 'get') {
          const ident = pr.params.map((p) => snake(p.name)).join('_and_')
          name = uniqueName(`lookup_${en}_by_${ident}`, used)
          description = withSummary(`Look up one ${words(entity.id)} by ${words(ident.replace(/_and_/g, ' and '))}. Says clearly when it does not exist.`, op)
        } else {
          anyList = true
          name = uniqueName(`list_${plural(en)}`, used)
          description = withSummary(`List ${plural(words(entity.id))}, one page at a time.`, op)
          if (entity.fields.some((f) => f.odata?.filterable)) {
            description += ' Give field, value and match to filter on one field (equals, contains or startsWith for text).'
            params = [
              { name: 'field', in: 'column', type: 'string', required: false },
              { name: 'value', in: 'column', type: 'string', required: false },
              { name: 'match', in: 'column', type: 'string', required: false, enum: ['equals', 'contains', 'startsWith'] },
            ]
          } else params = []
        }
        tools.push({ name, description, entity: entity.id, operation: op.id, params, projection: projection(entity) })
        const pub = publishesSourceText(op, params)
        if (pub.copied) copiedFrom.push(name)
        if (pub.flagged) flaggedIn.push(name)
        continue
      }
      if (!pathSegments(op)) {
        gaps.push(gap('tool-omitted', `Operation ${op.id} has an unsafe or inconsistent path and was omitted.`, { path: op.id }))
        continue
      }
      const pr = toolParams(op, new Set(), true)
      if (pr.omit) {
        gaps.push(gap('tool-omitted', `Operation ${op.id} was omitted: ${pr.omit}.`, { path: op.id }))
        continue
      }
      gaps.push(...pr.dropped)
      if (op.offsetParam !== undefined && pr.params.some((p) => p.name === op.offsetParam)) {
        gaps.push(gap('offset-pagination', `${op.id}: pages by offset; the ${op.offsetParam} argument is passed through unchanged and the result ceiling check does not apply to it.`, { severity: 'info', path: op.id }))
      }
      const en = snake(entity.id)
      let name: string
      let description: string
      if (op.kind === 'get') {
        const pathParam = pr.params.find((p) => p.in === 'path') ?? pr.params.find((p) => p.required)
        let ident = pathParam ? snake(pathParam.name) : ''
        if (ident.startsWith(`${en}_`) && ident.length > en.length + 1) ident = ident.slice(en.length + 1)
        name = uniqueName(ident ? `lookup_${en}_by_${ident}` : `lookup_${en}`, used)
        description = withSummary(`Look up one ${words(entity.id)}${ident ? ` by ${words(ident)}` : ''}. Says clearly when it does not exist.`, op)
      } else if (op.kind === 'search' || op.params.some(isFreeText)) {
        name = uniqueName(`search_${en}`, used)
        description = withSummary(`Search ${plural(words(entity.id))} by free text, one page at a time.`, op)
      } else {
        name = uniqueName(`list_${plural(en)}`, used)
        description = withSummary(`List ${plural(words(entity.id))}, one page at a time.`, op)
      }
      if (op.kind !== 'get') {
        anyList = true
        const have = listOps.get(entity.id)
        if (!have || (op.kind === 'list' && have.kind !== 'list')) listOps.set(entity.id, op)
      }
      tools.push({ name, description, entity: entity.id, operation: op.id, params: pr.params, projection: projection(entity) })
      const pub = publishesSourceText(op, pr.params)
      if (pub.copied) copiedFrom.push(name)
      if (pub.flagged) flaggedIn.push(name)
    }
    if (anyList && limits.resultCeiling === undefined) {
      gaps.push(gap('ceiling-unknown', 'No result ceiling is set (limits.resultCeiling); no ceiling warning is emitted. Supply the upstream ceiling if one exists.'))
    }
    if (!m.auth || m.auth.scheme === 'none') {
      gaps.push(gap('auth-none', 'The source declares no authentication; the server sends no credentials.', { severity: 'info' }))
    }

    // Derived filter tools: detected first, then user-supplied (extension point).
    const wanted: { d: DerivedTool; nested: NestedCollection }[] = []
    const seenIds = new Set<string>()
    for (const d of detected) {
      const entity = entityById.get(d.entity)!
      wanted.push({ d, nested: entity.nested.find((n) => n.field === d.source)! })
      seenIds.add(d.id)
    }
    for (const d of extraDerived) {
      const nested = validateExtra(m, d, gaps)
      if (!nested) continue
      if (seenIds.has(d.id)) {
        gaps.push(gap('derived-duplicate', `Derived tool ${d.id} duplicates an existing one and was skipped.`, { severity: 'info', path: d.id }))
        continue
      }
      seenIds.add(d.id)
      wanted.push({ d: { ...d, origin: d.origin === 'proposed' ? 'proposed' : 'user' }, nested })
    }
    for (const { d } of wanted) {
      const entity = entityById.get(d.entity)!
      const op = listOps.get(entity.id)
      if (!op) {
        gaps.push(gap('derived-no-source', `Derived tool ${d.id} needs a list or search operation for ${entity.id} to fetch candidates; none exists.`, { path: d.id }))
        continue
      }
      const pr = toolParams(op, new Set(['key', 'value', 'max_pages']))
      if (op.offsetParam !== undefined && !op.pageParam && !op.pageSizeParam) {
        gaps.push(gap('tool-omitted', `Derived tool ${d.id} was omitted: the list operation pages by offset without a page size parameter, so candidate pages cannot be walked.`, { path: d.id }))
        continue
      }
      if (pr.omit || !pathSegments(op)) {
        gaps.push(gap('tool-omitted', `Derived tool ${d.id} was omitted: ${pr.omit ?? 'unsafe list path'}.`, { path: d.id }))
        continue
      }
      const name = uniqueName(`filter_${snake(entity.id)}_by_${snake(d.source)}`, used)
      derived.push(d)
      tools.push({ name, description: d.description, entity: entity.id, operation: op.id, derived: d, params: pr.params, projection: projection(entity) })
      const pub = publishesSourceText(undefined, pr.params)
      if (pub.copied) copiedFrom.push(name)
      if (pub.flagged) flaggedIn.push(name)
    }
    if (copiedFrom.length > 0) {
      gaps.push(gap('source-text-copied', `Free text from the source document (operation summaries and argument descriptions) is published in the description of ${copiedFrom.length} tool(s). Summaries are labelled "Source note". Review that text before use.`))
    }
    for (const name of flaggedIn) {
      gaps.push(gap('source-text-flagged', `Text addressed to a model was removed from the source text published for tool ${name}.`, { path: name }))
    }
  } else {
    // dataset and sql: schema discovery plus one bounded query tool per entity (synthesis 2.1, 5.3).
    for (const d of extraDerived) {
      gaps.push(gap('derived-invalid', `Derived tool ${String(d?.id)} was skipped: derived filters are only supported for http backends.`, { path: String(d?.id) }))
    }
    for (const d of detected) gaps.push(gap('derived-unsupported-backend', `Nested collection ${d.id} is not filtered for ${m.backend.kind} backends.`, { severity: 'info', path: d.id }))
    const isSql = m.backend.kind === 'sql'
    let entities = m.entities
    if (!isSql && entities.length > 1) {
      gaps.push(gap('dataset-multiple-entities', 'A dataset backend reads one file; only the first entity was emitted.', { path: entities[1].id }))
      entities = entities.slice(0, 1)
    }
    const okEntities: Entity[] = []
    for (const e of entities) {
      if (!IDENT.test(snake(e.id)) || (isSql && (!IDENT.test(e.id) || /^sqlite_/i.test(e.id)))) {
        gaps.push(gap('tool-omitted', `Entity ${e.id} has a name that cannot be used safely and was omitted.`, { path: e.id }))
        continue
      }
      const fields = e.fields.filter((f) => {
        if (isSql && !IDENT.test(f.name)) {
          gaps.push(gap('field-omitted', `Column ${f.name} has an unsafe name and was left out.`, { path: `${e.id}.${f.name}` }))
          return false
        }
        return true
      })
      if (fields.length === 0) {
        gaps.push(gap('tool-omitted', `Entity ${e.id} has no usable fields and was omitted.`, { path: e.id }))
        continue
      }
      okEntities.push({ ...e, fields, nested: [], identifierFields: e.identifierFields.filter((n) => fields.some((f) => f.name === n)) })
    }
    if (okEntities.length > 0) {
      const slug = serverSlug(m)
      const dd: DerivedTool = {
        id: 'describe',
        kind: 'schemaDiscovery',
        entity: '*',
        source: 'schema',
        description: `Describe what ${slug.replace(/_/g, ' ')} contains: entities, fields, labels, filter modes and limits. Call this first.`,
        origin: 'detected',
      }
      derived.push(dd)
      tools.push({ name: uniqueName(`describe_${slug}`, used), description: dd.description, entity: '*', derived: dd, params: [], projection: [] })
    }
    const max = effectiveMaxPageSize(m)
    for (const e of okEntities) {
      const en = snake(e.id)
      const name = uniqueName(`query_${en}`, used)
      const q: Param[] = [
        { name: 'field', in: 'column', type: 'string', required: false },
        { name: 'value', in: 'column', type: 'string', required: false },
        { name: 'match', in: 'column', type: 'string', required: false, enum: ['equals', 'contains', 'startsWith'] },
        { name: 'limit', in: 'query', type: 'integer', required: false, min: 1, max },
        { name: 'offset', in: 'query', type: 'integer', required: false, min: 0 },
      ]
      tools.push({
        name,
        description: `Query ${plural(words(e.id))} by one field using equals, contains or startsWith matching. Returns at most ${max} rows per call.`,
        entity: e.id,
        params: q,
        projection: projection(e),
      })
      entityById.set(e.id, e)
    }
    if (tools.length === 0) gaps.push(gap('no-tools', 'No usable entity was found; nothing can be generated.', { severity: 'error' }))
  }

  if (m.backend.kind === 'http' && tools.length === 0) {
    gaps.push(gap('no-tools', 'No operation could be turned into a tool; nothing can be generated.', { severity: 'error' }))
  }

  tools.sort((a, b) => cmp(a.name, b.name) || cmp(a.entity, b.entity) || cmp(a.operation ?? '', b.operation ?? ''))
  derived.sort((a, b) => cmp(a.id, b.id))
  gaps.sort(gapOrder)
  // The plan carries the filtered entities (dataset/sql) so the emitter never sees dropped ones.
  const finalEntities = m.backend.kind === 'http' ? m.entities : m.entities.map((e) => entityById.get(e.id)!).filter((e, i, arr) => !!e && arr.indexOf(e) === i && tools.some((t) => t.entity === e.id))
  return { model: { ...m, entities: finalEntities }, tools, derived, gaps }
}
