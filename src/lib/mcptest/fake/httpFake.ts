// Streamable HTTP flavour of the fake MCP server: POST /mcp (JSON responses) and GET /health.
// Loopback only, ephemeral port. Scorer fixture; shares the dispatcher with serveStdio.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createFake, type FakeOptions } from './fakeServer'

const MAX_BODY_BYTES = 1024 * 1024

export async function startHttpFake(
  opts: Pick<FakeOptions, 'variant' | 'env' | 'sleep' | 'stderr'>
): Promise<{ url: string; close(): Promise<void> }> {
  const fake = createFake(opts) // throws FakeError for an unknown variant
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    const send = (status: number, body?: unknown) => {
      if (res.destroyed) return
      if (body === undefined) {
        res.writeHead(status).end()
        return
      }
      const text = JSON.stringify(body)
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
      res.end(text)
    }
    if (req.method === 'GET' && path === '/health') return send(200, { ok: true })
    if (path !== '/mcp') return send(404, { message: 'Not found' })
    if (req.method !== 'POST') return send(405, { message: 'Method not allowed' })
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      void (async () => {
        let parsed: unknown
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
        }
        const msgs = Array.isArray(parsed) ? parsed : [parsed]
        const out = []
        const fault = fake.def.behaviour.processFault
        if (fault === 'hang') return // never answers
        for (const m of msgs) {
          if (fault === 'crash-on-init' && (m as { method?: unknown })?.method === 'initialize') {
            req.socket.destroy()
            return
          }
          const r = await fake.handle(m)
          if (r) out.push(r)
        }
        if (out.length === 0) return send(202)
        send(200, Array.isArray(parsed) ? out : out[0])
      })()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  let closed: Promise<void> | null = null
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => {
      closed ??= new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
      return closed
    }
  }
}
