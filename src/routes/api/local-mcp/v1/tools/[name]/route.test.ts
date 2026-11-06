import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { __resetProxy, beginJob, registerLeaseToken } from '$lib/server/tryitout/llmProxy.js'
import { __resetLocalMcp } from '$lib/server/localMcp/proxy.js'
import { POST } from './+server'

vi.mock('$env/dynamic/private', () => ({ env: {} }))

const FIXTURE = fileURLToPath(new URL('../../../../../../lib/server/localMcp/fixtures/fake-mcp-stdio.mjs', import.meta.url))
const saved: Record<string, string | undefined> = {}
const KEYS = ['LOCAL_MCP_AGENTS', 'LOCAL_MCP_LVI_STDIO', 'LOCAL_MCP_LVI_URL', 'LOCAL_MCP_JOB_CALL_BUDGET']

function ev(token: string | null, name: string, body: unknown) {
  const request = new Request(`http://x/api/local-mcp/v1/tools/${name}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  })
  return { request, params: { name } } as unknown as Parameters<typeof POST>[0]
}

beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  __resetProxy()
  __resetLocalMcp()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(async () => {
  const g = globalThis as { __aicLocalMcpUpstream?: { up: { close(): Promise<void> } | null } }
  await g.__aicLocalMcpUpstream?.up?.close()
  delete (globalThis as { __aicLocalMcpUpstream?: unknown }).__aicLocalMcpUpstream
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  vi.restoreAllMocks()
})

describe('POST /api/local-mcp/v1/tools/[name]', () => {
  it('flag off: 404 even without a token, and no upstream or child process is created', async () => {
    process.env.LOCAL_MCP_LVI_STDIO = JSON.stringify(['node', FIXTURE])
    const r = await POST(ev(null, 'lookup_by_lvi_number', { arguments: { lvi_number: '1' } }))
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ message: 'Not found' })
    expect((globalThis as { __aicLocalMcpUpstream?: unknown }).__aicLocalMcpUpstream).toBeUndefined()
  })

  it('flag on, no upstream configured: 503 with a valid token and job', async () => {
    process.env.LOCAL_MCP_AGENTS = 'on'
    const t = registerLeaseToken('l1')
    beginJob('l1', 'j1', { maxTotalTokens: 10, maxRequests: 5 })
    const r = await POST(ev(t, 'lookup_by_lvi_number', { arguments: { lvi_number: '1' } }))
    expect(r.status).toBe(503)
  })

  it('flag on: a fake container call reaches the fake stdio upstream, bounded by the budget', async () => {
    process.env.LOCAL_MCP_AGENTS = 'on'
    process.env.LOCAL_MCP_LVI_STDIO = JSON.stringify(['node', FIXTURE])
    process.env.LOCAL_MCP_JOB_CALL_BUDGET = '2'
    const t = registerLeaseToken('l2')
    beginJob('l2', 'j2', { maxTotalTokens: 10, maxRequests: 5 })
    const r = await POST(ev(t, 'lookup_by_lvi_number', { arguments: { lvi_number: '42' } }))
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b).toMatchObject({ ok: true, tool: 'lookup_by_lvi_number', calls_used: 1, calls_left: 1 })
    expect(b.data).toMatchObject({ _synthetic: true })
    expect((await POST(ev(t, 'search_products', { arguments: {} }))).status).toBe(200)
    expect((await POST(ev(t, 'search_products', { arguments: {} }))).status).toBe(429)
    expect((await POST(ev(t, 'list_suppliers', { arguments: {} }))).status).toBe(403)
  })
})
