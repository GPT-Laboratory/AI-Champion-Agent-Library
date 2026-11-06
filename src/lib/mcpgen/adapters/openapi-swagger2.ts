// Swagger 2.0 normalisation for the openapi adapter family (Phase 14 follow-up, D-520).
//
// Turns the operation-level parts of a Swagger 2.0 document (parameters, responses, produces) into the OpenAPI 3.x
// shape the openapi adapter already reads. The document root is NOT rewritten: `#/definitions/...`,
// `#/parameters/...` and `#/responses/...` stay resolvable in place by the adapter's local $ref pointer, so the
// existing memoisation and budgets apply to Swagger schemas unchanged. host, basePath and schemes are never read
// (the generated server takes a base-URL environment variable instead). consumes only matters for write
// operations, which are dropped. Pure; never throws for hostile input (a reference that does not resolve is left
// in place so the adapter reports it with its usual gap code).
type Obj = Record<string, unknown>
type Deref = (root: Obj, node: unknown) => { node: Obj }

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const own = (o: Obj, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const
const SCHEMA_KEYS = ['type', 'format', 'enum', 'minimum', 'maximum', 'items', 'default', 'minLength', 'maxLength', 'pattern'] as const
const JSON_TYPE = /^application\/(.+\+)?json/i

/** True when the document declares Swagger 2.0 (`swagger: "2.0"`; the unquoted YAML number 2 is the same value). */
export function isSwagger2(doc: Obj): boolean {
  return doc.swagger === '2.0' || doc.swagger === 2
}

/** The JSON media type the operation can produce, or undefined when produces excludes JSON. */
function jsonMediaType(opProduces: unknown, rootProduces: unknown): string | undefined {
  const list = Array.isArray(opProduces) ? opProduces : Array.isArray(rootProduces) ? rootProduces : undefined
  if (list === undefined) return 'application/json'
  // JSON first; `*/*` (common in generated Swagger 2 documents) is accepted like in OpenAPI 3 (CR-03).
  return list.find((p): p is string => typeof p === 'string' && JSON_TYPE.test(p)) ?? list.find((p) => p === '*/*')
}

function tryDeref(deref: Deref, root: Obj, node: unknown): Obj | undefined {
  try {
    return deref(root, node).node
  } catch {
    return undefined
  }
}

function convertParam(deref: Deref, root: Obj, raw: unknown, ignored: { body: boolean }): unknown {
  const d = tryDeref(deref, root, raw)
  if (d === undefined) return raw // unresolved: the adapter reports it
  if (d.in === 'body' || d.in === 'formData') {
    ignored.body = true
    return undefined
  }
  if (d.schema !== undefined) return d // already 3.x shaped (tolerated)
  const schema: Obj = {}
  for (const k of SCHEMA_KEYS) if (d[k] !== undefined) schema[k] = d[k]
  if (d.type === 'file') delete schema.type
  const out: Obj = { name: d.name, in: d.in, required: d.required, schema }
  if (d.description !== undefined) out.description = d.description
  return out
}

function convertResponses(deref: Deref, root: Obj, responses: unknown, media: string | undefined): unknown {
  if (!isObj(responses)) return responses
  const out: Obj = {}
  for (const code of Object.keys(responses)) {
    if (!/^2\d\d$/.test(code)) continue // only success statuses are read
    const raw = responses[code]
    const r = tryDeref(deref, root, raw)
    if (r === undefined) {
      out[code] = raw
      continue
    }
    const res: Obj = { description: r.description }
    if (media !== undefined && r.schema !== undefined) {
      const entry: Obj = { schema: r.schema }
      if (isObj(r.examples) && r.examples[media] !== undefined) entry.example = r.examples[media]
      res.content = { [media]: entry }
    }
    out[code] = res
  }
  return out
}

/**
 * The `paths` object of a Swagger 2.0 document in OpenAPI 3.x shape. `ignoredBodyOps` receives the GET operations
 * that declared a body or formData parameter (not part of a read operation; reported by the caller).
 */
export function swagger2Paths(root: Obj, deref: Deref, ignoredBodyOps: string[]): Obj {
  const out: Obj = {}
  const paths = isObj(root.paths) ? root.paths : {}
  for (const path of Object.keys(paths)) {
    const item = own(paths, path)
    if (!isObj(item)) continue
    const conv: Obj = {}
    // A path item $ref is kept so the caller resolves it or reports ref-unresolved (CR-06).
    if (typeof item.$ref === 'string') conv.$ref = item.$ref
    const itemIgnored = { body: false }
    if (Array.isArray(item.parameters)) {
      conv.parameters = item.parameters.map((p) => convertParam(deref, root, p, itemIgnored)).filter((p) => p !== undefined)
    }
    for (const method of METHODS) {
      const op = own(item, method)
      if (!isObj(op)) continue
      const ignored = { body: itemIgnored.body }
      const c: Obj = { ...op }
      if (Array.isArray(op.parameters)) c.parameters = op.parameters.map((p) => convertParam(deref, root, p, ignored)).filter((p) => p !== undefined)
      c.responses = convertResponses(deref, root, op.responses, jsonMediaType(op.produces, root.produces))
      conv[method] = c
      if (method === 'get' && ignored.body) ignoredBodyOps.push(`GET ${path.slice(0, 120)}`)
    }
    out[path] = conv
  }
  return out
}
