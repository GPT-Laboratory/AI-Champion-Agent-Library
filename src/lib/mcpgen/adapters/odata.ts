// odata adapter (D-561..D-572): OData $metadata documents, CSDL JSON (4.0, 4.01) and EDMX XML (4.0, 4.01),
// into the http backend of the SourceModel. GET only: a list operation per entity set (paged with $top and
// $skip) and, when the key is usable, a lookup by key (single or composite). Typed fields are filterable
// (the emitter compiles them into $filter). Navigation properties are reported, never expanded; actions are
// writes (reported as dropped); functions, singletons, external references and external annotations are
// reported. V2 and V3 documents are rejected with `odata-version-unsupported`. Nothing is fetched.
import { gap } from '../diagnostics.js'
import { serverSlug, snake } from '../plan.js'
import type { Entity, Field, FieldType, Gap, GenerateOptions, InputAdapter, ODataKind, Operation, ParseResult, Param, RawInput, SourceModel } from '../types.js'
import { readCsdlJson, readEdmx, type DocIR, type EntityTypeIR, type EnumIR, type ReadResult, type SchemaIR, type SetIR } from './odata-csdl.js'
import { loadXmlParser, parseXml } from './odata-xml.js'
import { MAX_COLUMNS, MAX_TABLES, SAFE, makeGapSink, title } from './sql-common.js'

const QUALIFIED = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/
const MAX_NAME = 128
const MAX_HIERARCHY = 20
/** Tool arguments the generated tools already use; a key property with such a name gets a `_key` suffix. */
const TAKEN_ARGS = new Set(['page', 'page_size', 'fields', 'field', 'value', 'match', 'key', 'limit', 'offset', 'max_pages'])

interface Prim {
  type: FieldType
  kind?: ODataKind
  precision?: boolean
}
const PRIMS: Record<string, Prim> = {
  'Edm.String': { type: 'string', kind: 'string' },
  'Edm.Guid': { type: 'string', kind: 'guid' },
  'Edm.Boolean': { type: 'boolean', kind: 'boolean' },
  'Edm.Byte': { type: 'integer', kind: 'number' },
  'Edm.SByte': { type: 'integer', kind: 'number' },
  'Edm.Int16': { type: 'integer', kind: 'number' },
  'Edm.Int32': { type: 'integer', kind: 'number' },
  'Edm.Int64': { type: 'string', kind: 'number', precision: true },
  'Edm.Decimal': { type: 'string', kind: 'number', precision: true },
  'Edm.Single': { type: 'number', kind: 'number' },
  'Edm.Double': { type: 'number', kind: 'number' },
  'Edm.Date': { type: 'string', kind: 'date' },
  'Edm.DateTimeOffset': { type: 'string', kind: 'datetimeoffset' },
  'Edm.TimeOfDay': { type: 'string', kind: 'timeofday' },
  'Edm.Duration': { type: 'string' },
}

const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function sniff(text: string): { xml: boolean; json: boolean } {
  const head = text.replace(/^\uFEFF/, '').trimStart()
  return { xml: head.startsWith('<'), json: head.startsWith('{') }
}

function detect(input: RawInput): number {
  try {
    const text = typeof input?.text === 'string' ? input.text : ''
    const { xml, json } = sniff(text)
    if (xml) {
      const head = text.slice(0, 8192)
      return /<(?:[A-Za-z_][\w.-]*:)?Edmx[\s>]/.test(head) && /docs\.oasis-open\.org\/odata\/ns\/edmx|schemas\.microsoft\.com\/ado\/2007\/06\/edmx/.test(head) ? 0.95 : 0
    }
    if (!json) return 0
    const doc: unknown = JSON.parse(text)
    if (!plain(doc) || typeof doc.$Version !== 'string') return 0
    if ('openapi' in doc || 'swagger' in doc) return 0.5 // parse reports ambiguous-input
    return typeof doc.$EntityContainer === 'string' || plain(doc.$Reference) ? 0.95 : 0.5
  } catch {
    return 0
  }
}

function reject(g: Gap[]): ParseResult {
  return { rejected: g }
}

function parseText(text: string, extra: Gap[]): ReadResult {
  const { xml, json } = sniff(text)
  if (xml) {
    const r = parseXml(text)
    if ('gap' in r) return { rejected: [r.gap] }
    return readEdmx(r.root)
  }
  if (json) {
    let doc: unknown
    try {
      doc = JSON.parse(text)
    } catch {
      return { rejected: [gap('parse-failed', 'The JSON text could not be parsed.', { severity: 'error' })] }
    }
    if (!plain(doc)) return { rejected: [gap('parse-failed', 'The JSON document is not an object.', { severity: 'error' })] }
    if ('openapi' in doc || 'swagger' in doc) extra.push(gap('ambiguous-input', 'The document looks like both OpenAPI or Swagger and OData CSDL JSON; it was read as OData metadata. Force --adapter openapi to read it as OpenAPI.', { severity: 'warn' }))
    return readCsdlJson(doc)
  }
  return { rejected: [gap('odata-not-metadata', 'The text is neither an EDMX XML document nor a CSDL JSON object.', { severity: 'error' })] }
}

interface Index {
  entityTypes: Map<string, { type: EntityTypeIR; schema: SchemaIR }>
  complex: Set<string>
  enums: Map<string, { en: EnumIR; qname: string }>
  typeDefs: Map<string, string>
}

function buildIndex(doc: DocIR): Index {
  const ix: Index = { entityTypes: new Map(), complex: new Set(), enums: new Map(), typeDefs: new Map() }
  for (const s of doc.schemas) {
    for (const prefix of s.alias ? [s.namespace, s.alias] : [s.namespace]) {
      for (const t of s.entityTypes) ix.entityTypes.set(`${prefix}.${t.name}`, { type: t, schema: s })
      for (const c of s.complexTypes) ix.complex.add(`${prefix}.${c}`)
      for (const e of s.enums) ix.enums.set(`${prefix}.${e.name}`, { en: e, qname: `${s.namespace}.${e.name}` })
      for (const d of s.typeDefs) ix.typeDefs.set(`${prefix}.${d.name}`, d.underlying)
    }
  }
  return ix
}

function nameFlags(name: string): Pick<Field, 'nameLike' | 'classLike'> {
  const out: Pick<Field, 'nameLike' | 'classLike'> = {}
  if (/^(name|title|label)$/i.test(name) || /name$/i.test(name)) out.nameLike = true
  if (/^(category|class|type|kind|group|status)$/i.test(name)) out.classLike = true
  return out
}

function chooseContainer(doc: DocIR, push: (g: Gap) => void): { container: SchemaIR['containers'][number]; schema: SchemaIR } | undefined {
  const all = doc.schemas.flatMap((s) => s.containers.map((container) => ({ container, schema: s })))
  if (all.length === 0) return undefined
  if (doc.containerName) {
    const hit = all.find(({ container, schema }) => doc.containerName === `${schema.namespace}.${container.name}` || (schema.alias !== undefined && doc.containerName === `${schema.alias}.${container.name}`))
    if (hit) return hit
    push(gap('odata-container-unresolved', 'The default entity container named by the document was not found; the first container was used.', { severity: 'warn' }))
  } else if (all.length > 1) {
    push(gap('odata-multiple-containers', 'The document declares several entity containers; the first was used.', { severity: 'warn' }))
  }
  return all[0]
}

function buildModel(doc: DocIR, options: GenerateOptions | undefined, extra: Gap[]): ParseResult {
  const sink = makeGapSink()
  const push = sink.push
  for (const g of extra) push(g)
  const ix = buildIndex(doc)
  const picked = chooseContainer(doc, push)
  if (!picked || picked.container.sets.length === 0) {
    return reject([gap('no-entity-sets', 'The metadata declares no entity container with entity sets; nothing can be generated.', { severity: 'error' })])
  }
  const { container, schema: home } = picked
  push(gap('odata-version-detected', `OData ${doc.version} metadata (${doc.format === 'csdl-json' ? 'CSDL JSON' : 'EDMX XML'}) was read; it is never fetched or sent anywhere.`, { severity: 'info' }))
  if (doc.references > 0) push(gap('external-reference-not-fetched', `The document references ${doc.references} external schema document(s); they are never fetched, so types defined only there are unknown.`, { severity: 'warn' }))
  const external = doc.schemas.reduce((n, s) => n + s.externalAnnotations, 0)
  if (external > 0) push(gap('odata-external-annotations-ignored', `${external} Annotations block(s) apply annotations to other targets; they are not applied.`, { severity: 'info' }))
  const ignored = doc.schemas.reduce((n, s) => n + s.annotationsIgnored, 0)
  if (ignored > 0) push(gap('odata-annotations-ignored', `${ignored} annotation(s) other than Core.Description, Capabilities.FilterRestrictions and Authorization were ignored.`, { severity: 'info' }))
  push(gap('odata-nextlink-not-followed', 'Server-driven paging links (@odata.nextLink) are never followed; lists are paged with $top and $skip. When a service caps its responses, the generated list tool returns a warning naming the page size to use.', { severity: 'info' }))

  const entities: Entity[] = []
  const operations: Operation[] = []
  const usedIds = new Set<string>()
  let sets = container.sets
  if (sets.length > MAX_TABLES) {
    push(gap('too-many-entity-sets', `The container declares ${sets.length} entity sets; only the first ${MAX_TABLES} were read.`, { severity: 'warn' }))
    sets = sets.slice(0, MAX_TABLES)
  }
  const precisionPaths: string[] = []

  for (const set of sets) {
    if (!SAFE.test(set.name) || set.name.length > MAX_NAME) {
      push(gap('unsafe-identifier', 'An entity set name has characters that cannot be used safely; the set was left out.'))
      continue
    }
    const hit = ix.entityTypes.get(set.type)
    if (!hit) {
      push(gap('odata-type-unresolved', `The entity type of set ${set.name} is not defined in the document (it may live in a referenced schema); the set was left out.`, { path: set.name }))
      continue
    }
    const built = buildEntity(set, hit.type, ix, usedIds, push, precisionPaths)
    if (!built) continue
    entities.push(built.entity)
    const summary = set.description ?? hit.type.description
    operations.push({
      id: `list_${set.name}`,
      kind: 'list',
      method: 'GET',
      protocol: 'odata',
      path: `/${set.name}`,
      entity: built.entity.id,
      pageParam: 'skip',
      pageSizeParam: 'top',
      params: [
        { name: 'top', wireName: '$top', in: 'query', type: 'integer', required: false, min: 1, ...(options?.limits?.maxPageSize !== undefined ? { max: options.limits.maxPageSize } : {}) },
        { name: 'skip', wireName: '$skip', in: 'query', type: 'integer', required: false, min: 0 },
      ],
      ...(summary ? { summary } : {}),
    })
    if (built.keyParams) {
      operations.push({ id: `get_${set.name}`, kind: 'get', method: 'GET', protocol: 'odata', path: `/${set.name}`, entity: built.entity.id, params: built.keyParams, ...(summary ? { summary } : {}) })
    }
  }
  if (precisionPaths.length > 0) {
    push(gap('odata-precision-as-string', `Int64 and Decimal properties are typed as text so no precision is lost (${precisionPaths.slice(0, 8).join(', ')}${precisionPaths.length > 8 ? ', ...' : ''}); filters still use number literals.`, { severity: 'info' }))
  }
  if (container.singletons.length > 0) push(gap('odata-singleton-unsupported', `${container.singletons.length} singleton(s) are not exposed (${container.singletons.slice(0, 5).join(', ')}).`, { severity: 'info' }))
  const functions = doc.schemas.flatMap((s) => s.functions.map((f) => `${s.namespace}.${f}`))
  if (functions.length > 0) push(gap('odata-function-unsupported', `${new Set(functions).size} function(s) are not exposed: a function call is a different request shape (${[...new Set(functions)].slice(0, 5).join(', ')}).`, { severity: 'info' }))
  const dropped = [...new Set(doc.schemas.flatMap((s) => s.actions.map((a) => `${s.namespace}.${a}`)))].sort().slice(0, 100)

  // Authorization annotations on the container choose the credential variable; nothing else does.
  const prefix = serverSlug({ name: home.namespace.replace(/\./g, ' ') } as SourceModel).toUpperCase()
  let auth: SourceModel['auth'] = { scheme: 'none' }
  const kinds = container.auth
  const oauth = kinds.find((a) => a.kind === 'oauth2')
  const bearer = kinds.find((a) => a.kind === 'bearer')
  const apiKey = kinds.find((a) => a.kind === 'apiKeyHeader' || a.kind === 'apiKeyQuery')
  if (oauth) {
    auth = { scheme: 'bearer', envVar: `${prefix}_ACCESS_TOKEN`, oauth2: true }
    push(gap('oauth2-flow-not-implemented', `The service declares OAuth2 or OpenID Connect; no flow is implemented. The server reads an access token you obtained from ${prefix}_ACCESS_TOKEN and sends it as a bearer token; it never stores or refreshes it.`, { severity: 'warn' }))
  } else if (bearer) auth = { scheme: 'bearer', envVar: `${prefix}_TOKEN` }
  else if (apiKey) auth = { scheme: apiKey.kind as 'apiKeyHeader' | 'apiKeyQuery', paramName: apiKey.name, envVar: `${prefix}_API_KEY` }
  if (kinds.length > 0 && auth.scheme === 'none') push(gap('auth-unsupported', 'The declared authorization (for example HTTP basic) is not supported (only API key in header or query, bearer, and OAuth2 as a supplied access token); the server sends no credentials.', { severity: 'warn' }))

  sink.flush()
  const model: SourceModel = {
    name: title(home.namespace.replace(/\./g, ' ')) || 'OData Service',
    backend: { kind: 'http', baseUrlEnv: `${prefix}_BASE_URL` },
    auth,
    entities,
    operations,
    limits: { maxResponseItems: 200, ...(options?.limits?.maxPageSize !== undefined ? { maxPageSize: options.limits.maxPageSize } : {}) },
    gaps: [],
    writeOperationsDropped: dropped,
  }
  return { model: { ...model, gaps: sink.gaps }, gaps: sink.gaps }
}

function buildEntity(
  set: SetIR,
  type: EntityTypeIR,
  ix: Index,
  usedIds: Set<string>,
  push: (g: Gap) => void,
  precisionPaths: string[],
): { entity: Entity; keyParams?: Param[] } | undefined {
  // Entity id: the type name, or the set name when two sets share one type.
  let id = SAFE.test(type.name) && type.name.length <= MAX_NAME ? type.name : set.name
  if (usedIds.has(id)) id = set.name
  if (usedIds.has(id)) {
    push(gap('duplicate-table', 'Two entity sets resolve to the same entity name; the second was left out.', { path: set.name }))
    return undefined
  }
  usedIds.add(id)
  if (id !== type.name) push(gap('odata-entity-renamed', `Entity set ${set.name} is exposed as ${id} (the type name was unusable or already taken).`, { severity: 'info', path: set.name }))

  // Base type chain, root first.
  const chain: EntityTypeIR[] = []
  let cur: EntityTypeIR | undefined = type
  const seen = new Set<EntityTypeIR>()
  while (cur && !seen.has(cur) && chain.length < MAX_HIERARCHY) {
    seen.add(cur)
    chain.unshift(cur)
    if (!cur.base) break
    const next = ix.entityTypes.get(cur.base)
    if (!next) {
      push(gap('odata-type-unresolved', `The base type of ${type.name} is not defined in the document; its inherited properties are unknown.`, { path: set.name }))
      break
    }
    cur = next.type
  }
  // A chain that stopped although the next base type exists was cut by the cycle or depth guard (CR-23).
  const top = chain[0]
  if (top.base !== undefined && ix.entityTypes.has(top.base)) {
    push(gap('odata-type-unresolved', `The base type chain of ${type.name} is cyclic or longer than ${MAX_HIERARCHY} levels; inherited properties and keys beyond that are unknown.`, { path: set.name }))
  }
  const hasSubtypes = [...ix.entityTypes.values()].some((e) => e.type.base !== undefined && ix.entityTypes.get(e.type.base)?.type === type)
  if (hasSubtypes) push(gap('odata-derived-types-flattened', `Entity set ${set.name} may return derived types; only the properties of ${type.name} and its base types are exposed.`, { severity: 'info', path: set.name }))
  if (chain.some((t) => t.open)) push(gap('odata-open-type', `${type.name} is an open type; dynamic properties are not exposed.`, { severity: 'info', path: set.name }))
  const navs = [...new Set(chain.flatMap((t) => t.navs))]
  if (navs.length > 0) push(gap('odata-navigation-not-expanded', `${type.name} has ${navs.length} navigation propert${navs.length === 1 ? 'y' : 'ies'} (${navs.slice(0, 8).join(', ')}${navs.length > 8 ? ', ...' : ''}); $expand is not used and related entities are not returned.`, { severity: 'info', path: set.name }))

  const nonFilterable = new Set(set.nonFilterable)
  const fields: Field[] = []
  const names = new Set<string>()
  const unsupported: string[] = []
  const unresolved: string[] = []
  for (const t of chain) {
    for (const p of t.props) {
      if (names.has(p.name)) continue
      if (!SAFE.test(p.name) || p.name.length > MAX_NAME) {
        push(gap('unsafe-identifier', `A property name of ${type.name} has characters that cannot be used safely; it was left out.`, { path: set.name }))
        continue
      }
      if (fields.length >= MAX_COLUMNS) {
        push(gap('odata-too-many-properties', `${type.name} has more than ${MAX_COLUMNS} properties; the rest were left out.`, { path: set.name }))
        break
      }
      names.add(p.name)
      const f = resolveProp(p.name, p.type, p.collection, ix, set.filterable && !nonFilterable.has(p.name))
      if (f === 'unsupported') {
        unsupported.push(p.name)
        names.delete(p.name)
        continue
      }
      if (f === 'unresolved') {
        unresolved.push(p.name)
        names.delete(p.name)
        continue
      }
      if (f.precision) precisionPaths.push(`${id}.${p.name}`)
      fields.push({ ...f.field, ...nameFlags(p.name) })
    }
  }
  if (unsupported.length > 0) push(gap('unsupported-type', `${type.name}: ${unsupported.length} property(ies) with a binary, stream or geospatial type were left out (${unsupported.slice(0, 8).join(', ')}).`, { path: set.name }))
  if (unresolved.length > 0) push(gap('odata-type-unresolved', `${type.name}: ${unresolved.length} property(ies) have a type that is not defined in the document (${unresolved.slice(0, 8).join(', ')}); they were left out.`, { path: set.name }))

  // Key: the first type in the chain that declares one.
  const keyType = chain.find((t) => t.key.length > 0 || t.keyUnsupported)
  const key = keyType?.key ?? []
  let keyParams: Param[] | undefined
  if (!keyType || (key.length === 0 && !keyType.keyUnsupported)) {
    push(gap('no-identifier', `${type.name} declares no key; only the list tool is generated, no lookup.`, { path: set.name }))
  } else if (keyType.keyUnsupported) {
    push(gap('odata-key-unsupported', `${type.name} has a key defined through an alias path; no lookup tool is generated.`, { path: set.name }))
  } else {
    const byName = new Map(fields.map((f) => [f.name, f]))
    const usable = key.every((k) => byName.get(k)?.odata !== undefined && byName.get(k)!.type !== 'object' && byName.get(k)!.type !== 'array')
    if (!usable) push(gap('odata-key-unsupported', `A key property of ${type.name} is missing or has a type that cannot be written in a key predicate; no lookup tool is generated.`, { path: set.name }))
    else {
      const args = new Set<string>()
      keyParams = key.map((k) => {
        let arg = snake(k)
        if (TAKEN_ARGS.has(arg)) arg = `${arg}_key`
        while (args.has(arg)) arg = `${arg}_x`
        args.add(arg)
        return { name: arg, wireName: k, in: 'path' as const, type: byName.get(k)!.type, required: true }
      })
      for (const k of key) byName.get(k)!.identifier = true
    }
  }
  const entity: Entity = {
    id,
    label: title(type.name),
    fields,
    identifierFields: keyParams ? [...key] : [],
    nested: [],
  }
  return { entity, keyParams }
}

function resolveProp(
  name: string,
  rawType: string,
  collection: boolean,
  ix: Index,
  filterOk: boolean,
): { field: Field; precision: boolean } | 'unsupported' | 'unresolved' {
  let type = rawType
  // One level of TypeDefinition resolves to its underlying primitive.
  const def = ix.typeDefs.get(type)
  if (def) type = def
  if (collection) {
    if (type.startsWith('Edm.') && !PRIMS[type]) return 'unsupported'
    if (!type.startsWith('Edm.') && !ix.enums.has(type) && !ix.complex.has(type) && !ix.entityTypes.has(type)) return 'unresolved'
    return { field: { name, type: 'array' }, precision: false }
  }
  if (type.startsWith('Edm.')) {
    const prim = PRIMS[type]
    if (!prim) return 'unsupported'
    const field: Field = { name, type: prim.type }
    if (prim.kind) field.odata = { kind: prim.kind, filterable: filterOk }
    return { field, precision: prim.precision === true }
  }
  const en = ix.enums.get(type)
  if (en) {
    const okMembers = en.en.members.length > 0 && en.en.members.every((m) => SAFE.test(m) && m.length <= 64)
    const field: Field = { name, type: 'string', enum: en.en.members.filter((m) => SAFE.test(m) && m.length <= 64) }
    if (okMembers && QUALIFIED.test(en.qname)) field.odata = { kind: 'enum', filterable: filterOk, enumType: en.qname }
    return { field, precision: false }
  }
  if (ix.complex.has(type)) return { field: { name, type: 'object' }, precision: false }
  return 'unresolved'
}

export const odataAdapter: InputAdapter = {
  id: 'odata',
  label: 'OData metadata ($metadata: CSDL JSON or EDMX XML)',
  detect,
  async prepare(input: RawInput) {
    if (sniff(typeof input?.text === 'string' ? input.text : '').xml) await loadXmlParser()
  },
  parse(input: RawInput, options?: GenerateOptions): ParseResult {
    try {
      const extra: Gap[] = []
      const r = parseText(typeof input.text === 'string' ? input.text : '', extra)
      if ('rejected' in r) return r
      return buildModel(r.doc, options, [...extra, ...r.gaps])
    } catch {
      return reject([gap('adapter-failed', 'The OData metadata could not be parsed.', { severity: 'error' })])
    }
  },
}

