import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createServer, type Server, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { McpClient } from '../client'
import { httpChannel, HttpChannelError, UNSUPPORTED_TRANSPORTS } from './streamableHttp'

type Mode = 'json' | 'sse' | 'badstatus' | 'badtype'
let server: Server
let base = ''
let mode: Mode = 'json'
let reqs: { method: string; headers: IncomingMessage['headers']; body: any }[] = []
let deleteStatus = 200

const result = (m: any) => {
  if (m.method === 'initialize')
    return { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'http-stub', version: '1' } }
  if (m.method === 'tools/list') return { tools: [{ name: 'ping_tool' }] }
  return { content: [{ type: 'text', text: 'pong' }] }
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined
      reqs.push({ method: req.method ?? '', headers: req.headers, body })
      if (req.method === 'GET' && req.url === '/health') return void res.writeHead(200).end('ok')
      if (req.method === 'GET') return void res.writeHead(500).end()
      if (req.method === 'DELETE') return void res.writeHead(deleteStatus).end()
      if (mode === 'badstatus') return void res.writeHead(500).end('boom')
      if (mode === 'badtype') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<html/>')
      if (body.id === undefined) return void res.writeHead(202).end()
      const payload = { jsonrpc: '2.0', id: body.id, result: result(body) }
      const h: Record<string, string> = {}
      if (body.method === 'initialize') h['mcp-session-id'] = 'sess-1'
      if (mode === 'sse') {
        res.writeHead(200, { ...h, 'content-type': 'text/event-stream' })
        res.write(': comment\n\n')
        res.write('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message' }) + '\n\n')
        res.write('data: ' + JSON.stringify(payload) + '\n\n')
        res.end()
      } else {
        res.writeHead(200, { ...h, 'content-type': 'application/json' }).end(JSON.stringify(payload))
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))
afterEach(() => {
  mode = 'json'
  reqs = []
  deleteStatus = 200
})

describe('httpChannel', () => {
  for (const m of ['json', 'sse'] as const) {
    it(`runs the full client lifecycle over ${m} responses`, async () => {
      mode = m
      const client = McpClient.connect(httpChannel({ url: base + '/mcp' }), { timeoutMs: 2000 })
      expect(await client.initialize()).toMatchObject({ ok: true, serverInfo: { name: 'http-stub' } })
      expect((await client.listTools()).map((t) => t.name)).toEqual(['ping_tool'])
      expect(await client.callTool('ping_tool', {})).toMatchObject({ kind: 'result', text: 'pong' })
      await client.close()

      const posts = reqs.filter((r) => r.method === 'POST')
      expect(posts[0].headers.accept).toBe('application/json, text/event-stream')
      expect(posts[0].headers['content-type']).toContain('application/json')
      expect(posts[0].headers['mcp-session-id']).toBeUndefined()
      // notification got 202 and later requests carry the session id and protocol version
      expect(posts[1].body.method).toBe('notifications/initialized')
      expect(posts[1].headers['mcp-session-id']).toBe('sess-1')
      expect(posts[2].headers['mcp-protocol-version']).toBe('2025-06-18')
      const del = reqs.find((r) => r.method === 'DELETE')
      expect(del?.headers['mcp-session-id']).toBe('sess-1')
      expect(client.findings).toEqual([])
    })
  }

  it('tolerates 405 on DELETE', async () => {
    deleteStatus = 405
    const client = McpClient.connect(httpChannel({ url: base + '/mcp' }), { timeoutMs: 2000 })
    await client.initialize()
    await expect(client.close()).resolves.toBeUndefined()
  })

  it('healthCheck reports ok, non-2xx and network errors without throwing', async () => {
    const ch = httpChannel({ url: base + '/mcp', healthPath: '/health' })
    expect(await ch.healthCheck()).toEqual({ ok: true, status: 200 })
    expect(await httpChannel({ url: base + '/mcp', healthPath: '/nope' }).healthCheck()).toEqual({
      ok: false,
      status: 500
    })
    const dead = httpChannel({ url: 'http://127.0.0.1:1/mcp' })
    expect((await dead.healthCheck()).ok).toBe(false)
  })

  it('non-2xx POST becomes a transport_error plus a finding', async () => {
    mode = 'badstatus'
    const client = McpClient.connect(httpChannel({ url: base + '/mcp' }), { timeoutMs: 2000 })
    expect(await client.initialize()).toMatchObject({ ok: false, kind: 'error' })
    expect(client.findings.map((f) => f.kind)).toContain('bad_response')
    expect(await client.callTool('x', {})).toMatchObject({ kind: 'transport_error' })
  })

  it('wrong content-type becomes a bad_response finding', async () => {
    mode = 'badtype'
    const client = McpClient.connect(httpChannel({ url: base + '/mcp' }), { timeoutMs: 2000 })
    expect(await client.callTool('x', {})).toMatchObject({ kind: 'transport_error' })
    expect(client.findings.map((f) => f.kind)).toContain('bad_response')
  })

  it('a refused connection yields transport_error, never a throw', async () => {
    const client = McpClient.connect(httpChannel({ url: 'http://127.0.0.1:1/mcp' }), { timeoutMs: 2000 })
    expect(await client.callTool('x', {})).toMatchObject({ kind: 'transport_error' })
  })

  it('refuses non-loopback hosts', () => {
    for (const u of ['http://example.com/mcp', 'http://10.0.0.5/mcp', 'http://127.0.0.1.example.org/mcp']) {
      let err: unknown
      try {
        httpChannel({ url: u })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(HttpChannelError)
      expect((err as HttpChannelError).code).toBe('non-loopback')
    }
    expect(() => httpChannel({ url: 'http://localhost:9/mcp' })).not.toThrow()
    expect(() => httpChannel({ url: 'http://[::1]:9/mcp' })).not.toThrow()
  })

  it('lists the legacy transport as unsupported', () => {
    expect(UNSUPPORTED_TRANSPORTS).toEqual(['http+sse-legacy'])
  })
})
