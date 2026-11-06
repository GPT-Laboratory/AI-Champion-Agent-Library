import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { POST } from './+server'

const fx = (n: string) => readFileSync(new URL(`../../../lib/mcpgen/testing/fixtures/${n}`, import.meta.url), 'utf8')
const src = readFileSync(new URL('./+server.ts', import.meta.url), 'utf8')

const call = (body: unknown, raw = false) =>
  POST({
    request: new Request('http://x/api/mcp-generate', {
      method: 'POST',
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  } as never) as Promise<Response>

let prev: string | undefined
beforeEach(() => {
  prev = process.env.MCP_GENERATOR
  process.env.MCP_GENERATOR = '1'
})
afterEach(() => {
  if (prev === undefined) delete process.env.MCP_GENERATOR
  else process.env.MCP_GENERATOR = prev
  vi.restoreAllMocks()
})

describe('POST /api/mcp-generate', () => {
  it('404s when the flag is off', async () => {
    delete process.env.MCP_GENERATOR
    await expect(call({ input: 'x' })).rejects.toMatchObject({ status: 404 })
  })

  for (const f of ['acme-openapi.yaml', 'acme-catalog-header.csv', 'acme-schema.sql']) {
    it(`returns a zip for ${f}`, async () => {
      const res = await call({ input: fx(f) })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/zip')
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[a-z0-9_-]+-mcp\.zip"$/)
      expect(res.headers.get('x-mcp-gaps')).toMatch(/^\d+$/)
      const names = Object.keys(unzipSync(new Uint8Array(await res.arrayBuffer())))
      expect(names.some((n) => n.endsWith('/server.py'))).toBe(true)
    })
  }

  it('accepts adapter and options, drops unknown keys', async () => {
    const res = await call({
      adapter: 'openapi',
      input: fx('acme-openapi.yaml'),
      options: { limits: { maxPageSize: 99999999 }, evil: 1 },
    })
    expect(res.status).toBe(200)
  })

  it('400s on malformed requests', async () => {
    expect((await call('not json', true)).status).toBe(400)
    expect((await call({ input: 5 })).status).toBe(400)
    expect((await call({ input: 'x', adapter: 'nope' })).status).toBe(400)
    expect((await call({ input: 'x', options: 3 })).status).toBe(400)
  })

  it('413s on oversize input', async () => {
    const res = await call({ input: 'a'.repeat(262145) })
    expect(res.status).toBe(413)
    const huge = await call({ input: 'a'.repeat(600000) })
    expect(huge.status).toBe(413)
  })

  it('422s on unrecognized input without echoing it', async () => {
    const res = await call({ input: 'zzz-unique-marker-123' })
    expect(res.status).toBe(422)
    const text = await res.text()
    expect(text).not.toContain('zzz-unique-marker-123')
    expect(JSON.parse(text).ok).toBe(false)
  })

  it('rejects credentials without echoing them or logging', async () => {
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m))
    const secret = ['sk', 'abcdefghijklmnop1234567890'].join('-')
    const res = await call({ input: `${fx('acme-openapi.yaml')}\napi_key: ${secret}\n` })
    expect(res.status).toBe(422)
    const text = await res.text()
    expect(text).not.toContain(secret)
    expect(text).toContain('credential-rejected')
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  })

  it('does not import fs, db or log', () => {
    expect(src).not.toMatch(/node:fs|from 'fs'|\$lib\/server|drizzle|console\./)
  })
})
