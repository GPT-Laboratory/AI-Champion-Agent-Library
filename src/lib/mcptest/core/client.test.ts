import { describe, it, expect } from 'vitest'
import { PassThrough } from 'node:stream'
import { lineChannel } from './jsonrpc'
import { McpClient } from './client'

type Peer = { reply(o: unknown): void; raw(s: string): void; end(): void; seen: any[] }

/** In-memory scripted peer: handler(msg, peer) is called for each client message. */
function make(handler: (m: any, p: Peer) => void, opts: { timeoutMs?: number; maxToolPages?: number } = {}) {
  const fromServer = new PassThrough()
  const toServer = new PassThrough()
  const ch = lineChannel(fromServer, toServer, { maxLineBytes: 10_000 })
  const seen: any[] = []
  const peer: Peer = {
    seen,
    reply: (o) => void fromServer.write(JSON.stringify(o) + '\n'),
    raw: (s) => void fromServer.write(s),
    end: () => void fromServer.end()
  }
  let buf = ''
  toServer.on('data', (c) => {
    buf += String(c)
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      const m = JSON.parse(line)
      seen.push(m)
      handler(m, peer)
    }
  })
  const client = McpClient.connect(ch, { timeoutMs: 100, ...opts })
  return { client, peer }
}

const okInit = (m: any, p: Peer, version = '2025-06-18') =>
  p.reply({
    jsonrpc: '2.0',
    id: m.id,
    result: { protocolVersion: version, capabilities: {}, serverInfo: { name: 'stub', version: '1' } }
  })

describe('McpClient', () => {
  it('initializes, sends notifications/initialized before tools/list', async () => {
    const { client, peer } = make((m, p) => {
      if (m.method === 'initialize') okInit(m, p)
      else if (m.method === 'tools/list') p.reply({ jsonrpc: '2.0', id: m.id, result: { tools: [] } })
    })
    const r = await client.initialize()
    expect(r).toMatchObject({ ok: true, protocolVersion: '2025-06-18', serverInfo: { name: 'stub' } })
    await client.listTools()
    const methods = peer.seen.map((m) => m.method)
    expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    expect(peer.seen[0].params.clientInfo.name).toBe('aic-mcp-tester')
    expect(client.findings).toEqual([])
  })

  it('accepts an unknown protocol version and records a finding', async () => {
    const { client } = make((m, p) => okInit(m, p, '2099-01-01'))
    const r = await client.initialize()
    expect(r.ok).toBe(true)
    expect(client.findings.map((f) => f.kind)).toContain('unknown_protocol_version')
  })

  it('initialize without result fields -> bad_response', async () => {
    const { client } = make((m, p) => p.reply({ jsonrpc: '2.0', id: m.id, result: {} }))
    expect(await client.initialize()).toMatchObject({ ok: false, kind: 'bad_response' })
  })

  it('initialize without a reply -> timeout; late reply is ignored silently', async () => {
    let late: (() => void) | undefined
    const { client } = make((m, p) => {
      late = () => okInit(m, p)
    })
    expect(await client.initialize()).toMatchObject({ ok: false, kind: 'timeout' })
    late?.()
    await new Promise((r) => setTimeout(r, 20))
    expect(client.findings.map((f) => f.kind)).toEqual(['timeout'])
  })

  it('channel closing first -> closed plus early_exit', async () => {
    const { client } = make((_m, p) => p.end())
    expect(await client.initialize()).toMatchObject({ ok: false, kind: 'closed' })
    expect(client.findings.map((f) => f.kind)).toContain('early_exit')
  })

  it('follows nextCursor and keeps tool fields', async () => {
    const { client, peer } = make((m, p) => {
      if (m.method !== 'tools/list') return
      if (!m.params.cursor)
        p.reply({
          jsonrpc: '2.0',
          id: m.id,
          result: {
            tools: [{ name: 'a', description: 'da', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
            nextCursor: 'c2'
          }
        })
      else p.reply({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'b' }] } })
    })
    const tools = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['a', 'b'])
    expect(tools[0]).toMatchObject({ description: 'da', annotations: { readOnlyHint: true } })
    expect(peer.seen[1].params).toEqual({ cursor: 'c2' })
  })

  it('stops at the page cap with a bad_response finding', async () => {
    const { client } = make(
      (m, p) => p.reply({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 't' + m.id }], nextCursor: 'more' } }),
      { maxToolPages: 3 }
    )
    const tools = await client.listTools()
    expect(tools).toHaveLength(3)
    expect(client.findings.map((f) => f.kind)).toContain('bad_response')
  })

  it('callTool maps results, isError, structuredContent', async () => {
    const { client } = make((m, p) =>
      p.reply({
        jsonrpc: '2.0',
        id: m.id,
        result: {
          content: [{ type: 'text', text: 'one' }, { type: 'image', data: 'x' }, { type: 'text', text: 'two' }],
          structuredContent: { n: 1 },
          isError: true
        }
      })
    )
    const o = await client.callTool('x', {})
    expect(o).toMatchObject({ kind: 'result', isError: true, text: 'one\ntwo', structured: { n: 1 } })
    expect(await client.call('x', {})).toMatchObject({ kind: 'result' })
  })

  it('JSON-RPC error is rpc_error, distinct from isError', async () => {
    const { client } = make((m, p) =>
      p.reply({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'Unknown tool' } })
    )
    expect(await client.callTool('nope', {})).toEqual({ kind: 'rpc_error', code: -32602, message: 'Unknown tool' })
  })

  it('callTool timeout and closed never throw', async () => {
    const a = make(() => {})
    expect(await a.client.callTool('x', {})).toMatchObject({ kind: 'transport_error', timedOut: true })
    const b = make((_m, p) => p.end())
    expect(await b.client.callTool('x', {})).toMatchObject({ kind: 'transport_error' })
    expect(await b.client.callTool('x', {})).toMatchObject({ kind: 'transport_error' })
  })

  it('correlates concurrent requests by id', async () => {
    const held: any[] = []
    const { client, peer } = make((m, p) => {
      held.push(m)
      if (held.length === 2) {
        // answer in reverse order
        for (const h of [...held].reverse())
          p.reply({ jsonrpc: '2.0', id: h.id, result: { content: [{ type: 'text', text: h.params.name }] } })
      }
    })
    const [x, y] = await Promise.all([client.callTool('first', {}), client.callTool('second', {})])
    expect(x).toMatchObject({ text: 'first' })
    expect(y).toMatchObject({ text: 'second' })
    expect(peer.seen).toHaveLength(2)
  })

  it('records noise, unknown ids, malformed messages and oversize lines', async () => {
    const { client, peer } = make((m, p) => {
      p.raw('starting server...\n')
      p.reply({ jsonrpc: '2.0', id: 999, result: {} })
      p.reply({ foo: 'bar' })
      p.raw('q'.repeat(20_000) + '\n')
      p.reply({ jsonrpc: '2.0', id: m.id, result: { content: [] } })
    })
    const o = await client.callTool('x', {})
    expect(o.kind).toBe('result')
    const kinds = client.findings.map((f) => f.kind)
    expect(kinds).toEqual(expect.arrayContaining(['stdout_noise', 'invalid_json_rpc', 'oversize_message']))
    expect(peer.seen).toHaveLength(1)
  })

  it('answers server requests: ping -> {}, others -> -32601; ignores notifications', async () => {
    const { client, peer } = make((m, p) => {
      if (m.method === 'tools/call') {
        p.reply({ jsonrpc: '2.0', id: 'p1', method: 'ping' })
        p.reply({ jsonrpc: '2.0', id: 'p2', method: 'sampling/createMessage', params: {} })
        p.reply({ jsonrpc: '2.0', method: 'notifications/message', params: {} })
        p.reply({ jsonrpc: '2.0', id: m.id, result: { content: [] } })
      }
    })
    await client.callTool('x', {})
    await new Promise((r) => setTimeout(r, 20))
    const ping = peer.seen.find((m) => m.id === 'p1')
    const other = peer.seen.find((m) => m.id === 'p2')
    expect(ping).toEqual({ jsonrpc: '2.0', id: 'p1', result: {} })
    expect(other.error.code).toBe(-32601)
    expect(client.findings).toEqual([])
  })
})
