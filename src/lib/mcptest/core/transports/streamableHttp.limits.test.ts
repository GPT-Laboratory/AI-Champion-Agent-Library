// Review fixes WR-01 (no redirects) and WR-06 (bounded buffering) for the Streamable HTTP transport.
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { httpChannel } from './streamableHttp'

const servers: Server[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections?.()
    await new Promise<void>((r) => s.close(() => r()))
  }
})

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const s = createServer(handler)
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}

const until = async (cond: () => boolean, ms = 3000) => {
  for (let t = 0; t < ms && !cond(); t += 10) await new Promise((r) => setTimeout(r, 10))
}

function collect(ch: ReturnType<typeof httpChannel>) {
  const errors: { kind: string; message: string }[] = []
  const over: number[] = []
  const msgs: unknown[] = []
  ch.onTransportError?.((e) => errors.push(e))
  ch.onOversize?.((n) => over.push(n))
  ch.onMessage((m) => msgs.push(m))
  return { errors, over, msgs }
}

describe('redirects are refused (WR-01)', () => {
  it('does not follow a 302 from POST, GET health or DELETE', async () => {
    let victimHits = 0
    const victim = await listen((_req, res) => {
      victimHits += 1
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
    const sources: string[] = []
    const front = await listen((req, res) => {
      sources.push(`${req.method} ${req.url}`)
      res.writeHead(302, { location: `${victim}/secret` }).end()
    })
    const ch = httpChannel({ url: `${front}/mcp`, healthPath: '/health' })
    const seen = collect(ch)
    ch.send({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    await until(() => seen.errors.length > 0)
    expect(seen.errors[0].kind).toBe('bad_response')
    expect(await ch.healthCheck()).toEqual({ ok: false })
    await ch.close()
    expect(sources).toContain('POST /mcp')
    expect(sources).toContain('GET /health')
    expect(victimHits).toBe(0)
  })

  it('passes redirect: error on every fetch it makes', async () => {
    const calls: (RequestInit | undefined)[] = []
    const fetchFn = (async (_u: unknown, init?: RequestInit) => {
      calls.push(init)
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', serverInfo: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' }
      })
    }) as typeof fetch
    const ch = httpChannel({ url: 'http://127.0.0.1:9/mcp', fetchFn })
    const seen = collect(ch)
    ch.send({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    await until(() => seen.msgs.length > 0)
    await ch.healthCheck()
    await ch.close()
    expect(calls.map((c) => c?.method)).toEqual(['POST', 'GET', 'DELETE'])
    for (const c of calls) expect(c?.redirect).toBe('error')
  })
})

describe('response buffering is bounded (WR-06)', () => {
  const stream = (res: ServerResponse, type: string, chunk: () => string, onClosed: () => void) => {
    res.writeHead(200, { 'content-type': type })
    const timer = setInterval(() => {
      if (!res.writableEnded) res.write(chunk())
    }, 1)
    res.on('close', () => {
      clearInterval(timer)
      onClosed()
    })
  }

  it('cuts an SSE event whose data lines never end, and the server sees the connection drop', async () => {
    let closed = false
    const base = await listen((req, res) => {
      req.resume()
      req.on('end', () => stream(res, 'text/event-stream', () => 'data: ' + 'a'.repeat(100) + '\n', () => (closed = true)))
    })
    const ch = httpChannel({ url: `${base}/mcp`, maxLineBytes: 2000 })
    const seen = collect(ch)
    ch.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    await until(() => closed)
    expect(seen.over.length).toBeGreaterThan(0)
    expect(closed).toBe(true)
    await ch.close()
  })

  it('cuts an SSE stream of many small valid events once the response total passes the cap', async () => {
    let closed = false
    let n = 0
    const base = await listen((req, res) => {
      req.resume()
      req.on('end', () =>
        stream(res, 'text/event-stream', () => `data: {"jsonrpc":"2.0","method":"notifications/message","params":{"n":${n++}}}\n\n`, () => (closed = true))
      )
    })
    const ch = httpChannel({ url: `${base}/mcp`, maxLineBytes: 1000 })
    const seen = collect(ch)
    ch.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    await until(() => closed)
    expect(closed).toBe(true)
    expect(seen.over.length).toBeGreaterThan(0)
    // stopped near the 8 x cap, nowhere near unbounded
    expect(seen.msgs.length).toBeLessThan(500)
    await ch.close()
  })

  it('cancels a JSON body that streams past the cap instead of buffering it', async () => {
    let closed = false
    const base = await listen((req, res) => {
      req.resume()
      req.on('end', () => stream(res, 'application/json', () => 'x'.repeat(500), () => (closed = true)))
    })
    const ch = httpChannel({ url: `${base}/mcp`, maxLineBytes: 2000 })
    const seen = collect(ch)
    ch.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    await until(() => seen.errors.length > 0)
    expect(seen.errors[0]).toMatchObject({ kind: 'bad_response', message: 'response body over size cap' })
    expect(seen.over.length).toBe(1)
    await until(() => closed)
    expect(closed).toBe(true)
    await ch.close()
  })
})
