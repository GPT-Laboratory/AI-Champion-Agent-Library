// Streamable HTTP transport (MCP 2025-03-26+). Loopback only: the runner never touches real hosts.
import type { Channel } from '../jsonrpc'
import { DEFAULT_MAX_LINE_BYTES } from '../jsonrpc'

/** Transports the platform knows about but does not implement; listed in the report as a designed-only gap. */
export const UNSUPPORTED_TRANSPORTS = ['http+sse-legacy']

export class HttpChannelError extends Error {
  constructor(
    public code: 'non-loopback' | 'bad-url',
    message: string
  ) {
    super(message)
    this.name = 'HttpChannelError'
  }
}

export interface HttpOptions {
  url: string
  healthPath?: string
  fetchFn?: typeof fetch
  maxLineBytes?: number
}

export type HttpChannel = Channel & { healthCheck(): Promise<{ ok: boolean; status?: number }> }

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

function parseLoopback(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new HttpChannelError('bad-url', 'invalid URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpChannelError('bad-url', 'unsupported scheme')
  if (!LOOPBACK.has(u.hostname)) {
    throw new HttpChannelError('non-loopback', `host ${u.hostname.slice(0, 60)} is not loopback`)
  }
  return u
}

export function httpChannel(opts: HttpOptions): HttpChannel {
  const url = parseLoopback(opts.url)
  const doFetch = opts.fetchFn ?? globalThis.fetch
  const maxBytes = opts.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
  /** Cap on everything one response may stream (SSE), so many small events cannot run on without bound. */
  const maxTotalBytes = maxBytes * 8
  const msgCbs: ((m: unknown) => void)[] = []
  const noiseCbs: ((l: string) => void)[] = []
  const closeCbs: ((i: { code?: number | null; signal?: string | null }) => void)[] = []
  const overCbs: ((b: number) => void)[] = []
  const errCbs: ((i: { id?: number | string; kind: string; message: string }) => void)[] = []
  let sessionId: string | undefined
  let protocolVersion: string | undefined
  let closed = false
  const inflight = new Set<AbortController>()

  const fail = (id: number | string | undefined, kind: string, message: string) => {
    for (const cb of errCbs) cb({ id, kind, message: message.slice(0, 200) })
  }

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json'
    }
    if (sessionId) h['MCP-Session-Id'] = sessionId
    if (protocolVersion) h['MCP-Protocol-Version'] = protocolVersion
    return h
  }

  const deliver = (m: unknown, seen: Set<unknown>) => {
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      const o = m as Record<string, unknown>
      if (typeof o.method !== 'string' && o.id !== undefined) seen.add(o.id)
      const res = o.result as Record<string, unknown> | undefined
      if (res && typeof res.protocolVersion === 'string' && !protocolVersion) protocolVersion = res.protocolVersion
    }
    for (const cb of msgCbs) cb(m)
  }

  const deliverJsonText = (text: string, seen: Set<unknown>): boolean => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      for (const cb of noiseCbs) cb(text.slice(0, 200))
      return false
    }
    for (const m of Array.isArray(parsed) ? parsed : [parsed]) deliver(m, seen)
    return true
  }

  /** Reads a JSON body through the stream and gives up (cancelling the request) once it passes maxBytes. */
  async function readTextCapped(res: Response): Promise<{ text: string } | { over: number }> {
    const reader = res.body?.getReader()
    if (!reader) return { text: '' }
    const dec = new TextDecoder()
    let text = ''
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {})
        return { over: bytes }
      }
      text += dec.decode(value, { stream: true })
    }
    return { text: text + dec.decode() }
  }

  async function readSse(res: Response, seen: Set<unknown>): Promise<boolean> {
    const reader = res.body?.getReader()
    if (!reader) return false
    const dec = new TextDecoder()
    let buf = ''
    let discarding = false
    let data: string[] = []
    // WR-06: bytes of data lines gathered for the current event, and bytes read for the whole response.
    let dataBytes = 0
    let total = 0
    let ok = true
    const flushEvent = () => {
      if (data.length) {
        if (!deliverJsonText(data.join('\n'), seen)) ok = false
      }
      data = []
      dataBytes = 0
    }
    const cut = async (n: number): Promise<false> => {
      for (const cb of overCbs) cb(n)
      await reader.cancel().catch(() => {})
      return false
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxTotalBytes) return cut(total)
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        let line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (discarding) {
          discarding = false
          continue
        }
        if (line === '') flushEvent()
        else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''))
          dataBytes += line.length
          if (dataBytes > maxBytes) return cut(dataBytes)
        }
        // other fields (event:, id:, retry:, comments) are ignored
      }
      if (buf.length > maxBytes) {
        for (const cb of overCbs) cb(buf.length)
        buf = ''
        data = []
        discarding = true
        ok = false
      }
    }
    flushEvent()
    return ok
  }

  async function post(msg: unknown) {
    const id =
      msg && typeof msg === 'object' && 'id' in msg && 'method' in msg
        ? ((msg as { id?: number | string }).id as number | string | undefined)
        : undefined
    const ac = new AbortController()
    inflight.add(ac)
    try {
      const res = await doFetch(url.href, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(msg),
        signal: ac.signal,
        // WR-01: a redirect would leave the loopback host that parseLoopback checked.
        redirect: 'error'
      })
      const sid = res.headers.get('mcp-session-id')
      if (sid && !sessionId) sessionId = sid
      if (res.status === 202) {
        await res.body?.cancel().catch(() => {})
        return
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        fail(id, sessionId && res.status === 404 ? 'session_error' : 'bad_response', `POST returned HTTP ${res.status}`)
        return
      }
      const ct = (res.headers.get('content-type') ?? '').toLowerCase()
      const seen = new Set<unknown>()
      if (ct.includes('application/json')) {
        const body = await readTextCapped(res)
        if ('over' in body) {
          for (const cb of overCbs) cb(body.over)
          fail(id, 'bad_response', 'response body over size cap')
          return
        }
        const text = body.text
        if (!deliverJsonText(text, seen)) fail(id, 'bad_response', 'response body is not JSON')
      } else if (ct.includes('text/event-stream')) {
        await readSse(res, seen)
      } else {
        await res.body?.cancel().catch(() => {})
        fail(id, 'bad_response', `unexpected content-type ${ct.slice(0, 60) || '(none)'}`)
        return
      }
      if (id !== undefined && !seen.has(id)) fail(id, 'bad_response', 'response carried no reply for the request')
    } catch (e) {
      if (ac.signal.aborted) return
      fail(id, 'bad_response', `request failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      inflight.delete(ac)
    }
  }

  return {
    send(msg) {
      if (closed) return
      void post(msg)
    },
    onMessage: (cb) => void msgCbs.push(cb),
    onNoise: (cb) => void noiseCbs.push(cb),
    onClose: (cb) => void closeCbs.push(cb),
    onOversize: (cb) => void overCbs.push(cb),
    onTransportError: (cb) => void errCbs.push(cb),
    async healthCheck() {
      const hp = opts.healthPath ?? '/health'
      try {
        const res = await doFetch(url.origin + hp, { method: 'GET', redirect: 'error' })
        await res.body?.cancel().catch(() => {})
        return { ok: res.status >= 200 && res.status < 300, status: res.status }
      } catch {
        return { ok: false }
      }
    },
    async close() {
      if (closed) return
      closed = true
      for (const ac of inflight) ac.abort()
      if (sessionId) {
        try {
          const res = await doFetch(url.href, {
            method: 'DELETE',
            redirect: 'error',
            headers: { 'MCP-Session-Id': sessionId, ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}) }
          })
          await res.body?.cancel().catch(() => {}) // 405 and others are tolerated
        } catch {
          /* ignore */
        }
      }
      for (const cb of closeCbs) cb({})
    }
  }
}
