// Offline mock upstream: node:http bound to 127.0.0.1 on an ephemeral port, one per cell.
// Strict on purpose (unknown params rejected, auth checked, ceiling enforced) so lenient servers earn no free passes.
// Imports nothing from $lib, svelte or @sveltejs; makes no outbound connections.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ROUTES } from './contract'
import {
  assembliesDataset,
  bulkItems,
  catalogItems,
  codesDataset,
  componentsDataset,
  docsDataset,
  isValidCode,
  VOCABULARIES,
  type CatalogItem,
} from './datasets'
import { FaultController, faultLabel } from './faults'
import {
  UpstreamSpec,
  type FaultSpec,
  type LogEntry,
  type MockHandle,
  type MockOptions,
  type UpstreamSpecInput,
} from './spec'

type RouteName = keyof typeof ROUTES

interface Matched {
  name: RouteName
  pattern: string
  params: Record<string, string>
}

const ROUTE_TABLE = (Object.entries(ROUTES) as [RouteName, string][]).map(([name, pattern]) => ({
  name,
  pattern,
  segs: pattern.split('/').filter(Boolean),
}))

const ALLOWED_PARAMS: Record<RouteName, readonly string[]> = {
  items: ['q', 'category', 'supplier', 'page', 'per_page'],
  itemById: [],
  itemByCode: [],
  categoryItems: ['limit', 'cursor'],
  products: [],
  vocab: [],
  widgets: [],
  widgetById: [],
  components: [],
  assemblies: [],
  health: [],
}

const REQUIRED_DATASET: Record<RouteName, string | null> = {
  items: 'catalog',
  itemById: 'catalog',
  itemByCode: 'catalog',
  categoryItems: 'bulk',
  products: 'codes',
  vocab: 'catalog',
  widgets: 'docs',
  widgetById: 'docs',
  components: 'components',
  assemblies: 'products',
  health: null,
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function matchRoute(rawPath: string): Matched | null {
  // Strict: no normalisation, no trailing-slash tolerance.
  const parts = rawPath.split('/')
  if (parts[0] !== '') return null
  const segs = parts.slice(1)
  for (const r of ROUTE_TABLE) {
    if (r.segs.length !== segs.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < segs.length; i++) {
      const want = r.segs[i]
      if (want.startsWith(':')) {
        if (segs[i] === '') {
          ok = false
          break
        }
        params[want.slice(1)] = safeDecode(segs[i])
      } else if (want !== segs[i]) {
        ok = false
        break
      }
    }
    if (ok) return { name: r.name, pattern: r.pattern, params }
  }
  return null
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export async function createMockUpstream(specInput: UpstreamSpecInput, opts: MockOptions = {}): Promise<MockHandle> {
  const spec = UpstreamSpec.parse(specInput)
  const now = opts.now ?? Date.now
  const faults = new FaultController()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let seed = spec.seed
  let cache = new Map<string, unknown>()
  let entries: LogEntry[] = []
  let firstT: number | null = null
  let counter = 0

  const ds = <T>(key: string, make: () => T): T => {
    if (!cache.has(key)) cache.set(key, make())
    return cache.get(key) as T
  }
  const catalog = () => ds('catalog', () => catalogItems(seed, spec.size))
  const bulk = () => ds('bulk', () => bulkItems(seed))
  const codes = () => ds('codes', () => codesDataset(seed))
  const docs = () => ds('docs', () => docsDataset(seed))
  const components = () => ds('components', () => componentsDataset(seed))
  const assemblies = () => ds('products', () => assembliesDataset(seed))

  const wait = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
  }

  function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    if (res.destroyed) return
    const text = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      ...headers,
    })
    res.end(text)
  }
  function sendText(res: ServerResponse, status: number, text: string, type = 'text/plain; charset=utf-8') {
    if (res.destroyed) return
    res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(text) })
    res.end(text)
  }
  const envelope = (status: number, error: string, path: string) => ({
    timestamp: new Date(now()).toISOString(),
    status,
    error,
    path,
  })

  function applyFault(f: FaultSpec, req: IncomingMessage, res: ServerResponse, rawPath: string, proceed: () => void) {
    switch (f.fault) {
      case 'status': {
        const status = f.status ?? 500
        const body = f.envelope ? envelope(status, 'Injected failure', rawPath) : { message: 'Upstream failure' }
        sendJson(res, status, body, f.headers ?? {})
        return
      }
      case 'latency':
        wait(f.ms ?? 50, () => {
          if (!res.destroyed) proceed()
        })
        return
      case 'timeout':
        // Hold the socket; released when the client aborts or close() destroys connections.
        return
      case 'reset':
        req.socket.destroy()
        return
      case 'huge': {
        const bytes = f.bytes ?? 1_000_000
        sendText(res, 200, `{"items":[],"pad":"${'a'.repeat(bytes)}"}`, 'application/json')
        return
      }
      case 'malformed': {
        switch (f.mode ?? 'truncated_json') {
          case 'truncated_json':
            sendText(res, 200, '{"items":[{"id":"ACM-0', 'application/json')
            return
          case 'html':
            sendText(res, 200, '<html><body>Bad gateway</body></html>', 'text/html; charset=utf-8')
            return
          case 'empty':
            sendText(res, 200, '', 'application/json')
            return
          case 'wrong_content_type':
            sendText(res, 200, '{"items":[],"total":0}', 'text/plain; charset=utf-8')
            return
          case 'slow_drip': {
            const body = '{"items":[],"total":0}'
            const step = f.ms ?? 25
            res.writeHead(200, { 'content-type': 'application/json' })
            let i = 0
            const tick = () => {
              if (res.destroyed || res.writableEnded) return
              if (i >= body.length) {
                res.end()
                return
              }
              res.write(body[i++])
              wait(step, tick)
            }
            tick()
            return
          }
        }
      }
    }
  }

  function readInt(v: string | undefined, dflt: number): number | null {
    if (v === undefined) return dflt
    if (!/^\d+$/.test(v)) return null
    return Number(v)
  }

  function handle(m: Matched, q: URLSearchParams, res: ServerResponse, rawPath: string) {
    const first = (k: string) => q.get(k) ?? undefined
    switch (m.name) {
      case 'health':
        return sendJson(res, 200, { ok: true })
      case 'items': {
        const page = readInt(first('page'), 1)
        const perPage = readInt(first('per_page'), Math.min(20, spec.maxPageSize))
        if (page === null || page < 1) return sendJson(res, 400, { message: 'Invalid page' })
        if (perPage === null || perPage < 1) return sendJson(res, 400, { message: 'Invalid per_page' })
        if (perPage > spec.maxPageSize * 5) return sendJson(res, 400, { message: 'per_page too large' })
        if (spec.ceiling !== null && page * perPage > spec.ceiling) {
          return sendText(res, 500, 'Result window too large: all shards failed')
        }
        const text = (first('q') ?? '').toLowerCase()
        const category = first('category')?.toLowerCase()
        const supplier = first('supplier')?.toLowerCase()
        let list: CatalogItem[] = catalog()
        if (text)
          list = list.filter((i) =>
            [i.id, i.name.en, i.name.fi, i.name.sv].some((s) => s.toLowerCase().includes(text)),
          )
        if (category) list = list.filter((i) => i.category.toLowerCase() === category)
        if (supplier)
          list = list.filter((i) => i.supplier.id.toLowerCase() === supplier || i.supplier.name.toLowerCase() === supplier)
        const start = (page - 1) * perPage
        return sendJson(res, 200, { items: list.slice(start, start + perPage), page, per_page: perPage, total: list.length })
      }
      case 'itemById': {
        const it = catalog().find((i) => i.id === m.params.id)
        return it ? sendJson(res, 200, it) : sendJson(res, 404, { message: 'Item not found' })
      }
      case 'itemByCode': {
        const it = catalog().find((i) => i.code === m.params.code)
        return it ? sendJson(res, 200, it) : sendJson(res, 404, { message: 'Item not found' })
      }
      case 'categoryItems': {
        const limit = readInt(first('limit'), 100)
        const cursor = readInt(first('cursor'), 0)
        if (limit === null || limit < 1 || cursor === null) return sendJson(res, 400, { message: 'Invalid paging' })
        const all = bulk()
        const n = Math.min(limit, 1000)
        const end = Math.min(cursor + n, all.length)
        return sendJson(res, 200, { items: all.slice(cursor, end), next: end < all.length ? String(end) : null })
      }
      case 'products': {
        const code = m.params.code
        if (!isValidCode(code)) return sendJson(res, 400, { message: 'Invalid code' })
        const p = codes().valid.find((x) => x.gtin === code)
        return p ? sendJson(res, 200, p) : sendJson(res, 404, { message: 'Product not found' })
      }
      case 'vocab': {
        const v = VOCABULARIES[m.params.name]
        return v ? sendJson(res, 200, { name: m.params.name, values: v }) : sendJson(res, 404, { message: 'Vocabulary not found' })
      }
      case 'widgets':
        return sendJson(res, 200, { items: docs().widgets, total: docs().widgets.length })
      case 'widgetById': {
        const w = docs().widgets.find((x) => x.id === m.params.id)
        return w ? sendJson(res, 200, w) : sendJson(res, 404, { message: 'Widget not found' })
      }
      case 'components': {
        const c = components().find((x) => x.id === m.params.id)
        return c ? sendJson(res, 200, c) : sendJson(res, 404, { message: 'Component not found' })
      }
      case 'assemblies': {
        const a = assemblies().find((x) => x.componentId === m.params.id)
        return a ? sendJson(res, 200, a) : sendJson(res, 404, { message: 'Assembly not found' })
      }
    }
    void rawPath
  }

  function onRequest(req: IncomingMessage, res: ServerResponse) {
    const t = now()
    if (firstT === null) firstT = t
    const url = req.url ?? '/'
    const qi = url.indexOf('?')
    const rawPath = qi === -1 ? url : url.slice(0, qi)
    const params = new URLSearchParams(qi === -1 ? '' : url.slice(qi + 1))
    const query: Record<string, string[]> = {}
    for (const [k, v] of params) (query[k] ??= []).push(v)
    const matched = matchRoute(rawPath)
    const entry: LogEntry = {
      n: ++counter,
      tMs: t - firstT,
      method: req.method ?? 'GET',
      rawPath,
      query,
      headerNames: Object.keys(req.headers).sort(),
      route: matched?.pattern ?? '(unmatched)',
    }
    if (opts.label) entry.backend = opts.label
    entries.push(entry)

    const hostName = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (!LOOPBACK_HOSTS.has(hostName)) return sendJson(res, 421, { message: 'Misdirected request' })

    const fault = faults.take(rawPath, entry.route)
    const proceed = () => {
      if (spec.auth && matched?.name !== 'health') {
        const got = req.headers['x-api-key']
        if (typeof got !== 'string' || got !== (opts.apiKey ?? '')) {
          const status = Number(spec.auth.mode)
          return sendJson(res, status, envelope(status, status === 401 ? 'Unauthorized' : 'Forbidden', rawPath))
        }
      }
      if (spec.documentedRoutes && !(matched && spec.documentedRoutes.includes(matched.pattern))) {
        entry.undocumented = true
        return sendJson(res, 404, { message: 'Not found' })
      }
      if (!matched) return sendJson(res, 404, { message: 'Not found' })
      const need = REQUIRED_DATASET[matched.name]
      if (need && !spec.datasets.includes(need as (typeof spec.datasets)[number])) {
        return sendJson(res, 404, { message: 'Not found' })
      }
      if (spec.rejectUnknownParams) {
        for (const k of params.keys()) {
          if (!ALLOWED_PARAMS[matched.name].includes(k)) return sendJson(res, 400, { message: `Unknown parameter ${k}` })
        }
      }
      handle(matched, params, res, rawPath)
    }
    if (fault) {
      entry.fault = faultLabel(fault)
      applyFault(fault, req, res, rawPath, proceed)
    } else proceed()
  }

  const server: Server = createServer(onRequest)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  let closed: Promise<void> | null = null

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    log: () => entries.map((e) => structuredClone(e)),
    hits: (prefix) =>
      prefix === undefined
        ? entries.length
        : entries.filter((e) => e.rawPath.startsWith(prefix) || e.route.startsWith(prefix)).length,
    inject: (f) => faults.inject(f),
    clearFaults: () => faults.clear(),
    reset: () => {
      entries = []
      firstT = null
      counter = 0
      faults.clear()
    },
    setSeed: (n) => {
      seed = n
      cache = new Map()
    },
    close: () => {
      closed ??= new Promise<void>((resolve) => {
        for (const t of timers) clearTimeout(t)
        timers.clear()
        server.close(() => resolve())
        server.closeAllConnections()
      })
      return closed
    },
  }
}
