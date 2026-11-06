// D-461: every API error body is JSON with a string `message` (auth 401, MCP tester, MCP generator, method fallback).
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllEnvs())

type H = (e: unknown) => Promise<Response> | Response
const base = { locals: { user: null }, cookies: { get: () => undefined, set() {} }, url: new URL('http://x/api'), getClientAddress: () => '127.0.0.1' }
const post = (body: string) => new Request('http://x/api', { method: 'POST', body })

describe('API error bodies use { message } (D-461)', () => {
  it('POST /api/mcp-generate 400 and 422 carry message (gaps kept)', async () => {
    vi.stubEnv('MCP_GENERATOR', 'on')
    const { POST } = await import('./api/mcp-generate/+server')
    const bad = await (POST as unknown as H)({ ...base, request: post('nope') })
    expect(bad.status).toBe(400)
    const b = await bad.json()
    expect(typeof b.message).toBe('string')
    expect(Array.isArray(b.gaps)).toBe(true)
    const unparsable = await (POST as unknown as H)({ ...base, request: post(JSON.stringify({ input: 'not a spec at all' })) })
    expect(unparsable.status).toBe(422)
    expect(typeof (await unparsable.json()).message).toBe('string')
  })

  it('POST /api/mcp-test/runs 400 carries message, not error', async () => {
    vi.stubEnv('MCP_TESTER', 'on')
    const { POST } = await import('./api/mcp-test/runs/+server')
    const res = await (POST as unknown as H)({ ...base, request: post('nope') })
    expect(res.status).toBe(400)
    const b = await res.json()
    expect(b).toEqual({ ok: false, message: 'Body must be JSON.' })
    expect('error' in b).toBe(false)
  })

  it('method fallback 405 carries message', async () => {
    vi.stubEnv('MCP_TESTER', 'on')
    const { fallback } = await import('./api/mcp-test/runs/+server')
    const res = await (fallback as unknown as H)({})
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ ok: false, message: 'Method not allowed.' })
  })
})
