import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createHttpUpstream, createStdioUpstream, upstreamFromEnv } from './upstream'
import type { McpUpstream } from './types'

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-mcp-stdio.mjs', import.meta.url))
const sig = () => new AbortController().signal

describe('http upstream', () => {
  let srv: Server | null = null
  let up: McpUpstream | null = null
  afterEach(async () => {
    await up?.close()
    await new Promise((r) => (srv ? srv.close(() => r(null)) : r(null)))
    srv = null
    up = null
  })

  function start(handler: (body: any, req: IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<string> {
    return new Promise((resolve) => {
      srv = createServer((req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => handler(raw ? JSON.parse(raw) : {}, req, res))
      }).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(srv!.address() as AddressInfo).port}/mcp`))
    })
  }

  it('initializes once, forwards session id, handles JSON then SSE', async () => {
    const seen: Array<{ method: string; sid: string | undefined; accept: string | undefined }> = []
    let toolCalls = 0
    const url = await start((b, req, res) => {
      seen.push({ method: b.method, sid: req.headers['mcp-session-id'] as string | undefined, accept: req.headers.accept })
      if (b.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' })
        return void res.end(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: { protocolVersion: '2025-06-18' } }))
      }
      if (b.method === 'notifications/initialized') return void res.writeHead(202).end()
      toolCalls++
      const result = { content: [{ type: 'text', text: '{"_synthetic":true}' }], structuredContent: { _synthetic: true, n: toolCalls } }
      if (toolCalls === 1) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return void res.end(JSON.stringify({ jsonrpc: '2.0', id: b.id, result }))
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('event: ping\ndata: {"jsonrpc":"2.0","id":999,"result":{}}\n\n')
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: b.id, result })}\n\n`)
    })
    up = createHttpUpstream(url)
    const r1 = await up.callTool('search_products', { page_size: 1 }, sig())
    const r2 = await up.callTool('search_products', {}, sig())
    expect(r1.structuredContent).toEqual({ _synthetic: true, n: 1 })
    expect(r2.structuredContent).toEqual({ _synthetic: true, n: 2 })
    expect(seen.filter((s) => s.method === 'initialize')).toHaveLength(1)
    expect(seen.map((s) => s.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'tools/call'])
    expect(seen[2].sid).toBe('sess-1')
    for (const s of seen) expect(s.accept).toBe('application/json, text/event-stream')
  })

  it('maps non-2xx and JSON-RPC errors to fixed-message errors without echoing the body', async () => {
    const url = await start((b, _req, res) => {
      if (b.method === 'initialize') return void res.writeHead(500).end('SECRET-BODY')
    })
    up = createHttpUpstream(url)
    const err = await up.callTool('x', {}, sig()).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('SECRET-BODY')
  })

  it('JSON-RPC error becomes a thrown error', async () => {
    const url = await start((b, _req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      if (b.method === 'initialize') return void res.end(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: {} }))
      if (b.method === 'notifications/initialized') return void res.end('{}')
      res.end(JSON.stringify({ jsonrpc: '2.0', id: b.id, error: { code: -1, message: 'SECRET-RPC' } }))
    })
    up = createHttpUpstream(url)
    const err = (await up.callTool('x', {}, sig()).catch((e: Error) => e)) as Error
    expect(err.message).not.toContain('SECRET-RPC')
  })

  it('re-initializes once after a 404', async () => {
    let inits = 0
    let first = true
    const url = await start((b, _req, res) => {
      if (b.method === 'initialize') {
        inits++
        res.writeHead(200, { 'content-type': 'application/json' })
        return void res.end(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: {} }))
      }
      if (b.method === 'notifications/initialized') return void res.writeHead(202).end()
      if (first) {
        first = false
        return void res.writeHead(404).end()
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: { content: [], structuredContent: { ok: 1 } } }))
    })
    up = createHttpUpstream(url)
    const r = await up.callTool('x', {}, sig())
    expect(r.structuredContent).toEqual({ ok: 1 })
    expect(inits).toBe(2)
  })

  it('aborts on the signal', async () => {
    const url = await start(() => {
      /* never answers */
    })
    up = createHttpUpstream(url)
    const ac = new AbortController()
    const p = up.callTool('x', {}, ac.signal)
    setTimeout(() => ac.abort(), 50)
    await expect(p).rejects.toThrow()
  })
})

describe('stdio upstream', () => {
  let up: McpUpstream | null = null
  afterEach(async () => {
    await up?.close()
    up = null
  })

  it('calls a tool, returns structured content, reuses the process', async () => {
    up = createStdioUpstream(['node', FIXTURE], { PATH: process.env.PATH })
    const r = await up.callTool('lookup_by_lvi_number', { lvi_number: '1' }, sig())
    expect(r.structuredContent).toMatchObject({ _synthetic: true, tool: 'lookup_by_lvi_number' })
    const r2 = await up.callTool('get_product_by_gtin', { gtin: '2' }, sig())
    expect(r2.structuredContent).toMatchObject({ tool: 'get_product_by_gtin' })
  })

  it('passes isError results through', async () => {
    up = createStdioUpstream(['node', FIXTURE], { PATH: process.env.PATH })
    const r = await up.callTool('search_products', { _mode: 'error' }, sig())
    expect(r.isError).toBe(true)
  })

  it('starts the child with a minimal environment', async () => {
    up = createStdioUpstream(['node', FIXTURE], {
      PATH: process.env.PATH, HOME: '/h', LVI_API_BASE: 'http://x', LVI_API_KEY: 'k', OPENAI_API_KEY: 'sk-must-not-pass', OTHER: '1',
    })
    const r = await up.callTool('search_products', { _mode: 'env' }, sig())
    const env = (r.structuredContent as { env: string[] }).env
    expect(env).toEqual(expect.arrayContaining(['PATH', 'HOME', 'LVI_API_BASE', 'LVI_API_KEY']))
    expect(env).not.toContain('OPENAI_API_KEY')
    expect(env).not.toContain('OTHER')
  })

  it('omits minimal-env variables that are not present', async () => {
    up = createStdioUpstream(['node', FIXTURE], { PATH: process.env.PATH })
    const r = await up.callTool('search_products', { _mode: 'env' }, sig())
    const env = (r.structuredContent as { env: string[] }).env
    expect(env).not.toContain('LVI_API_KEY')
  })

  it('fails a pending call when the process crashes and restarts on the next call', async () => {
    up = createStdioUpstream(['node', FIXTURE], { PATH: process.env.PATH })
    await expect(up.callTool('search_products', { _mode: 'exit' }, sig())).rejects.toThrow()
    const r = await up.callTool('search_products', {}, sig())
    expect(r.structuredContent).toMatchObject({ _synthetic: true })
  })

  it('stops restarting after 3 consecutive crashes', async () => {
    up = createStdioUpstream(['node', FIXTURE], { PATH: process.env.PATH })
    for (let i = 0; i < 4; i++) await up.callTool('x', { _mode: 'exit' }, sig()).catch(() => undefined)
    await expect(up.callTool('x', {}, sig())).rejects.toThrow(/restart/)
  })

  it('kills the process on abort of a pending call', async () => {
    up = createStdioUpstream(['node', FIXTURE], { PATH: process.env.PATH })
    const ac = new AbortController()
    const p = up.callTool('x', { _mode: 'hang' }, ac.signal)
    setTimeout(() => ac.abort(), 100)
    await expect(p).rejects.toThrow()
    const r = await up.callTool('x', {}, sig())
    expect(r.structuredContent).toMatchObject({ _synthetic: true })
  })
})

describe('upstreamFromEnv', () => {
  it('returns null when nothing is set', () => {
    expect(upstreamFromEnv({})).toBeNull()
  })
  it.each(['http://127.0.0.1:8000/mcp', 'http://localhost:9/mcp', 'http://host.containers.internal:8000/mcp'])('accepts %s', (u) => {
    expect(upstreamFromEnv({ LOCAL_MCP_LVI_URL: u })).not.toBeNull()
  })
  it.each(['https://example.com/mcp', 'http://10.0.0.5:8000/mcp', 'http://127.0.0.1.evil.com:80/x', 'ftp://127.0.0.1:1', 'nonsense'])('rejects %s', (u) => {
    expect(upstreamFromEnv({ LOCAL_MCP_LVI_URL: u })).toBeNull()
  })
  it('URL wins over stdio; stdio parses a JSON string array', () => {
    expect(upstreamFromEnv({ LOCAL_MCP_LVI_STDIO: '["node","x.mjs"]' })).not.toBeNull()
    expect(upstreamFromEnv({ LOCAL_MCP_LVI_STDIO: 'not json' })).toBeNull()
    expect(upstreamFromEnv({ LOCAL_MCP_LVI_STDIO: '[]' })).toBeNull()
    expect(upstreamFromEnv({ LOCAL_MCP_LVI_STDIO: '[1]' })).toBeNull()
    // invalid URL does not fall back to stdio silently: URL set means URL decides
    expect(upstreamFromEnv({ LOCAL_MCP_LVI_URL: 'https://e.com', LOCAL_MCP_LVI_STDIO: '["node"]' })).toBeNull()
  })
})
