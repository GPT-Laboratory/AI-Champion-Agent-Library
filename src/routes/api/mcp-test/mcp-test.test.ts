import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { POST } from './runs/+server'
import { GET as GET_STATUS } from './runs/[id]/+server'
import { GET as GET_REPORT } from './runs/[id]/report/+server'
import { runStore } from '$lib/server/mcptest/jobs'
import { __resetStartLimiterForTests, __setExecutorForTests } from '$lib/server/mcptest/service'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const postSrc = read('./runs/+server.ts')
const statusSrc = read('./runs/[id]/+server.ts')
const reportSrc = read('./runs/[id]/report/+server.ts')

let user = 'a@example.org'
const post = (body: unknown, opts: { raw?: boolean; headers?: Record<string, string>; addr?: string } = {}) =>
  POST({
    request: new Request('http://x/api/mcp-test/runs', {
      method: 'POST',
      body: opts.raw ? (body as string) : JSON.stringify(body),
      headers: opts.headers
    }),
    locals: { user: { email: user } },
    cookies: { get: () => undefined, set: () => {} },
    url: new URL('http://x/api/mcp-test/runs'),
    getClientAddress: () => opts.addr ?? '10.0.0.1'
  } as never) as Promise<Response>

const status = (id: string) => GET_STATUS({ params: { id } } as never) as Response | Promise<Response>
const report = (id: string) => GET_REPORT({ params: { id } } as never) as Response | Promise<Response>

let prev: string | undefined
beforeEach(() => {
  prev = process.env.MCP_TESTER
  process.env.MCP_TESTER = '1'
  user = 'a@example.org'
  runStore.reset()
  __resetStartLimiterForTests()
  __setExecutorForTests(() => new Promise(() => {}))
})
afterEach(() => {
  if (prev === undefined) delete process.env.MCP_TESTER
  else process.env.MCP_TESTER = prev
  __setExecutorForTests(null)
  runStore.reset()
  vi.restoreAllMocks()
})

describe('flag off', () => {
  it('answers 404 on all three endpoints before touching the store', async () => {
    delete process.env.MCP_TESTER
    const spy = vi.spyOn(runStore, 'getRun')
    const spy2 = vi.spyOn(runStore, 'createRun')
    const spy3 = vi.spyOn(runStore, 'tryAcquire')
    await expect(post({ subject: 'fake:good' })).rejects.toMatchObject({ status: 404 })
    const id = '11111111-1111-4111-8111-111111111111'
    expect(() => status(id)).toThrowError(expect.objectContaining({ status: 404 }))
    expect(() => report(id)).toThrowError(expect.objectContaining({ status: 404 }))
    expect(spy).not.toHaveBeenCalled()
    expect(spy2).not.toHaveBeenCalled()
    expect(spy3).not.toHaveBeenCalled()
  })

  it('treats the flag-first rule as a source property', () => {
    for (const src of [postSrc, statusSrc, reportSrc]) {
      const body = src.slice(src.indexOf('export const'))
      const first = body.split('\n').slice(1).find((l) => l.trim().length > 0)!
      expect(first.trim()).toBe("if (!mcpTesterEnabled()) error(404, 'Not found')")
    }
  })
})

describe('POST /api/mcp-test/runs', () => {
  it('returns 202 {id,status} immediately even when the executor never finishes', async () => {
    const res = await post({ subject: 'fake:good', cases: ['T1-STD-CATALOG'], reruns: 2 })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['id', 'status'])
    expect(body.status).toBe('queued')
    expect(runStore.getRun(body.id)).not.toBeNull()
  })

  it('accepts generator samples', async () => {
    expect((await post({ subject: 'generator:openapi' })).status).toBe(202)
  })

  it('rejects malformed and out-of-allowlist requests with 400', async () => {
    const bad: unknown[] = [
      'not json',
      [],
      5,
      {},
      { subject: 5 },
      { subject: 'fake:nope' },
      { subject: 'cmd:python server.py' },
      { subject: 'upload:server.py' },
      { subject: 'fake:good', cases: ['T9-NOPE'] },
      { subject: 'fake:good', cases: [] },
      { subject: 'fake:good', cases: 'T1-STD-CATALOG' },
      { subject: 'fake:good', reruns: 0 },
      { subject: 'fake:good', reruns: 4 },
      { subject: 'fake:good', reruns: 1.5 },
      { subject: 'fake:good', extra: 1 },
      { subject: 'fake:good', cmd: 'ls' },
      { subject: 'fake:good', cases: Array(13).fill('T1-STD-CATALOG') }
    ]
    for (const b of bad) {
      const res = await post(b, { raw: typeof b === 'string' })
      expect(res.status, JSON.stringify(b)).toBe(400)
      expect((await res.json()).ok).toBe(false)
    }
    expect(runStore.activeCount()).toBe(0)
  })

  it('413s on a body over 4 KiB (content-length and actual text)', async () => {
    const big = JSON.stringify({ subject: 'fake:good', pad: 'x'.repeat(5000) })
    expect((await post(big, { raw: true, headers: { 'content-length': String(big.length) } })).status).toBe(413)
    const res = await POST({
      request: new Request('http://x/', { method: 'POST', body: big }),
      locals: {},
      cookies: { get: () => undefined, set: () => {} },
      url: new URL('http://x/'),
      getClientAddress: () => '10.0.0.2'
    } as never)
    expect(res.status).toBe(413)
  })

  it('429s while a run is active globally or for the session', async () => {
    expect((await post({ subject: 'fake:good' })).status).toBe(202)
    expect((await post({ subject: 'fake:good' })).status).toBe(429)
    user = 'b@example.org'
    expect((await post({ subject: 'fake:good' })).status).toBe(429)
    expect(runStore.activeCount()).toBe(1)
  })

  it('429s after the per-client start limit', async () => {
    __resetStartLimiterForTests(2)
    __setExecutorForTests(async (id) => {
      runStore.setStatus(id, 'done')
    })
    for (let i = 0; i < 2; i++) {
      expect((await post({ subject: 'fake:good' })).status).toBe(202)
      await new Promise((r) => setTimeout(r, 5))
    }
    expect((await post({ subject: 'fake:good' })).status).toBe(429)
    // another client is unaffected
    expect((await post({ subject: 'fake:good' }, { addr: '10.9.9.9' })).status).toBe(202)
  })

  it('never awaits the executor and never spreads records (source)', () => {
    expect(postSrc).not.toMatch(/await\s+(executeRun|startRun)/)
    for (const src of [postSrc, statusSrc, reportSrc]) expect(src).not.toMatch(/\.\.\.\s*run\b/)
    expect(postSrc).toContain('startRun(')
    expect(postSrc).toContain('sessionKey({ locals, cookies, url })')
  })
})

describe('GET /api/mcp-test/runs/:id', () => {
  it('404s on invalid and unknown ids, validating before lookup', async () => {
    const spy = vi.spyOn(runStore, 'getRun')
    expect(() => status('../etc/passwd')).toThrowError(expect.objectContaining({ status: 404 }))
    expect(() => status('not-a-uuid')).toThrowError(expect.objectContaining({ status: 404 }))
    expect(spy).not.toHaveBeenCalled()
    expect(() => status('11111111-1111-4111-8111-111111111111')).toThrowError(expect.objectContaining({ status: 404 }))
  })

  it('returns a literal body that shows progress and hides internals', async () => {
    const { id } = await (await post({ subject: 'fake:good' })).json()
    runStore.setStatus(id, 'running')
    runStore.setProgress(id, { done: 1, total: 3, current: 'T1-STD-CATALOG' })
    runStore.addEvent(id, 'case T1-STD-CATALOG')
    const res = await status(id)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['error', 'events', 'progress', 'status'])
    expect(body.status).toBe('running')
    expect(body.progress).toEqual({ done: 1, total: 3, current: 'T1-STD-CATALOG' })
    expect(body.events).toHaveLength(1)
    expect(body.error).toBeNull()
    const text = JSON.stringify(body)
    expect(text).not.toContain('a@example.org')
    expect(text).not.toContain('sessionKey')
  })
})

describe('GET /api/mcp-test/runs/:id/report', () => {
  it('409 while running, 200 verbatim when done, 404 when failed', async () => {
    const { id } = await (await post({ subject: 'fake:good' })).json()
    expect((await report(id)).status).toBe(409)
    runStore.setReport(id, '{"schema":"mcptest-report/1","x":1}')
    const ok = await report(id)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('application/json')
    expect(ok.headers.get('content-disposition')).toBe('attachment; filename="mcptest-report.json"')
    expect(await ok.text()).toBe('{"schema":"mcptest-report/1","x":1}')

    const second = runStore.createRun('other')
    runStore.setStatus(second.id, 'failed', 'boom')
    const failed = await report(second.id)
    expect(failed.status).toBe(404)
    expect((await failed.json()).message).toMatch(/failed/)
  })

  it('404s on invalid or unknown ids', () => {
    expect(() => report('x')).toThrowError(expect.objectContaining({ status: 404 }))
    expect(() => report('11111111-1111-4111-8111-111111111111')).toThrowError(expect.objectContaining({ status: 404 }))
  })
})

describe('end to end with the real executor', () => {
  it('runs a fake subject to done and serves the report', async () => {
    __setExecutorForTests(null)
    const res = await post({ subject: 'fake:good', cases: ['T1-STD-CATALOG'] })
    const { id } = await res.json()
    for (let i = 0; i < 200 && runStore.getRun(id)?.status !== 'done'; i++) await new Promise((r) => setTimeout(r, 50))
    expect(runStore.getRun(id)?.status).toBe('done')
    const rep = await report(id)
    expect(rep.status).toBe(200)
    expect(JSON.parse(await rep.text()).schema).toBe('mcptest-report/1')
  }, 30_000)
})
