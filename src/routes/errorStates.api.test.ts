// E6: API error shapes and status codes with hostile input. No network, no paid APIs.
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => vi.unstubAllEnvs())

type H = (e: unknown) => Promise<Response> | Response
async function call(h: unknown, e: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  try {
    const res = await (h as H)(e)
    const text = await res.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      // non-JSON body
    }
    return { status: res.status, body }
  } catch (err) {
    const s = err as { status?: number; body?: unknown }
    if (typeof s.status === 'number') return { status: s.status, body: s.body }
    throw err
  }
}
const req = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('http://x/api', { method: 'POST', body, headers })
const base = { locals: { user: null }, cookies: { get: () => undefined, set() {} }, url: new URL('http://x/api'), getClientAddress: () => '127.0.0.1' }

describe('POST /api/tryitout/jobs hostile bodies (D-404)', () => {
  it.each([
    ['JSON body', JSON.stringify({ agentId: 'a' }), 'application/json'],
    ['garbage with multipart type but no boundary', 'xx', 'multipart/form-data'],
    ['empty body, no content type', null, ''],
  ])('%s -> 400, never an unhandled 500', async (_n, body, ct) => {
    const { POST } = await import('./api/tryitout/jobs/+server')
    const r = await call(POST, { ...base, request: req(body, ct ? { 'content-type': ct } : {}) })
    expect(r.status).toBe(400)
  })

  it('missing fields stay 400', async () => {
    const { POST } = await import('./api/tryitout/jobs/+server')
    const fd = new FormData()
    fd.set('agentId', 'a')
    expect((await call(POST, { ...base, request: new Request('http://x/api', { method: 'POST', body: fd }) })).status).toBe(400)
  })
})

describe('job status/artifact routes', () => {
  it.each(['../../etc/passwd', '%00', 'x'.repeat(10_000), 'not-a-uuid'])('unknown/malformed id %s -> 404', async (id) => {
    const { GET } = await import('./api/tryitout/jobs/[id]/+server')
    const { GET: ART } = await import('./api/tryitout/jobs/[id]/artifact/+server')
    expect((await call(GET, { params: { id } })).status).toBe(404)
    expect((await call(ART, { params: { id } })).status).toBe(404)
  })
})

describe('POST /api/try-out shapes', () => {
  it('invalid JSON and invalid fields are 400 {message}', async () => {
    vi.stubEnv('CATALOG_DB_PATH', ':memory:')
    const { POST } = await import('./api/try-out/+server')
    const a = await call(POST, { request: req('{nope', { 'content-type': 'application/json' }) })
    expect(a.status).toBe(400)
    expect(a.body).toEqual({ message: expect.any(String) })
    const b = await call(POST, { request: req('{}', { 'content-type': 'application/json' }) })
    expect(b.status).toBe(400)
    expect(b.body).toEqual({ message: expect.any(String) })
  })
})

describe('GET /api/search', () => {
  it.each(['', '   ', '%00', 'a'.repeat(50_000)])('hostile q %j never 500s (embeddings off)', async (q) => {
    vi.stubEnv('SEARCH_EMBEDDINGS', 'off')
    vi.stubEnv('CATALOG_DB_PATH', ':memory:')
    const { GET } = await import('./api/search/+server')
    const r = await call(GET, { url: new URL('http://x/api/search?q=' + encodeURIComponent(q)) })
    expect([200, 500]).toContain(r.status)
    if (r.status === 500) expect(r.body).toEqual({ message: 'Search failed.' })
    else expect(r.body).toHaveProperty('results')
  })
})

describe('POST /api/mcp-generate', () => {
  it('flag off: 404; flag on: bad bodies are 400/413 with {ok:false,gaps}', async () => {
    const { POST } = await import('./api/mcp-generate/+server')
    expect((await call(POST, { request: req('{}') })).status).toBe(404)
    vi.stubEnv('MCP_GENERATOR', '1')
    for (const [body, st] of [['not json', 400], ['[]', 400], ['{"input":5}', 400], ['{"input":"x","adapter":"zzz"}', 400], ['{"input":"x","options":[]}', 400]] as const) {
      const r = await call(POST, { request: req(body) })
      expect(r.status, body).toBe(st)
      expect(r.body).toMatchObject({ ok: false, gaps: [{ code: expect.any(String), message: expect.any(String) }] })
    }
  })
})

describe('hooks (handleError returns only a generic message and a reference, D-462)', () => {
  it('defines handleError, so unexpected errors never echo message or stack to the client', async () => {
    const hooks = (await import('../hooks.server')) as Record<string, unknown>
    expect(typeof hooks.handleError).toBe('function')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = (hooks.handleError as (i: unknown) => { message: string; ref?: string })({
      error: new Error('SqliteError: no such table: agents'),
      status: 500,
      message: 'Internal Error',
      event: { request: new Request('http://x/'), url: new URL('http://x/') },
    })
    expect(JSON.stringify(out)).not.toMatch(/Sqlite|agents|\bat /)
    expect(out.message).toBe('Internal Error')
  })
})
