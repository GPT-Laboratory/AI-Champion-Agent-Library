// MCP clients for the local proxy (D-635/D-637): streamable-HTTP JSON-RPC and stdio, no SDK, no shell.
// Error messages are fixed strings: upstream bodies, stderr and headers are never echoed or logged.
import { spawn, type ChildProcess } from 'node:child_process'
import type { McpToolResult, McpUpstream } from './types'

const PROTOCOL = '2025-06-18'
const INIT = { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'aic-local-mcp-proxy', version: '1' } }
const MAX_RESTARTS = 3

class UpstreamError extends Error {}
const fail = (m: string) => new UpstreamError(m)

type Json = Record<string, any>

function abortError(): Error {
  return fail('upstream call aborted')
}

// ---- streamable HTTP ----
export function createHttpUpstream(url: string, fetchImpl: typeof fetch = fetch): McpUpstream {
  let sessionId: string | null = null
  let ready: Promise<void> | null = null
  let nextId = 1

  async function post(body: Json, signal: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    if (sessionId) headers['mcp-session-id'] = sessionId
    try {
      return await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    } catch {
      throw signal.aborted ? abortError() : fail('upstream unreachable')
    }
  }

  async function readResult(res: Response, id: number): Promise<Json> {
    const type = res.headers.get('content-type') ?? ''
    const text = await res.text().catch(() => '')
    let msg: Json | undefined
    if (type.includes('text/event-stream')) {
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')
        if (!data) continue
        try {
          const j = JSON.parse(data) as Json
          if (j.id === id) {
            msg = j
            break
          }
        } catch {
          /* skip */
        }
      }
    } else {
      try {
        msg = JSON.parse(text) as Json
      } catch {
        /* fall through */
      }
    }
    if (!msg) throw fail('upstream bad response')
    if (msg.error) throw fail('upstream rpc error')
    return (msg.result ?? {}) as Json
  }

  async function init(signal: AbortSignal): Promise<void> {
    sessionId = null
    const id = nextId++
    const res = await post({ jsonrpc: '2.0', id, method: 'initialize', params: INIT }, signal)
    if (!res.ok) throw fail('upstream http error')
    sessionId = res.headers.get('mcp-session-id')
    await readResult(res, id)
    const n = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal)
    await n.text().catch(() => '')
    if (!n.ok) throw fail('upstream http error')
  }

  const ensure = (signal: AbortSignal) => (ready ??= init(signal).catch((e) => {
    ready = null
    throw e
  }))

  async function call(name: string, args: Json, signal: AbortSignal, retry: boolean): Promise<McpToolResult> {
    await ensure(signal)
    const id = nextId++
    const res = await post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, signal)
    if (!res.ok && retry && (res.status === 404 || res.status === 400)) {
      await res.text().catch(() => '')
      ready = null
      return call(name, args, signal, false)
    }
    if (!res.ok) {
      await res.text().catch(() => '')
      throw fail('upstream http error')
    }
    return (await readResult(res, id)) as McpToolResult
  }

  return {
    callTool: (name, args, signal) => call(name, args, signal, true),
    async close() {
      ready = null
      sessionId = null
    },
  }
}

// ---- stdio ----
export function createStdioUpstream(argv: string[], envSource: Record<string, string | undefined> = process.env): McpUpstream {
  let proc: ChildProcess | null = null
  let ready: Promise<void> | null = null
  let crashes = 0
  let nextId = 1
  let buf = ''
  const pending = new Map<number, { resolve: (r: Json) => void; reject: (e: Error) => void }>()

  const minimalEnv = (): Record<string, string> => {
    const env: Record<string, string> = {}
    for (const k of ['PATH', 'HOME', 'LVI_API_BASE', 'LVI_API_KEY']) {
      const v = envSource[k]
      if (typeof v === 'string') env[k] = v
    }
    return env
  }

  function failAll(msg: string): void {
    for (const p of pending.values()) p.reject(fail(msg))
    pending.clear()
  }

  function start(): ChildProcess {
    if (crashes >= MAX_RESTARTS) throw fail('upstream restart limit reached')
    buf = ''
    const p = spawn(argv[0], argv.slice(1), { shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: minimalEnv() })
    let intentional = false
    ;(p as ChildProcess & { __kill?: () => void }).__kill = () => {
      intentional = true
      if (proc === p) {
        proc = null
        ready = null
      }
      p.kill('SIGKILL')
      failAll('upstream process exited')
    }
    p.stderr?.on('data', () => undefined) // drained and discarded: may contain secrets
    p.stdin?.on('error', () => undefined)
    p.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          const m = JSON.parse(line) as Json
          const w = typeof m.id === 'number' ? pending.get(m.id) : undefined
          if (w) {
            pending.delete(m.id)
            if (m.error) w.reject(fail('upstream rpc error'))
            else w.resolve((m.result ?? {}) as Json)
          }
        } catch {
          /* ignore non-JSON line */
        }
      }
    })
    p.on('error', () => {
      if (proc === p) {
        proc = null
        ready = null
        if (!intentional) crashes++
        failAll('upstream process failed')
      }
    })
    p.on('exit', () => {
      if (proc === p) {
        proc = null
        ready = null
        if (!intentional) crashes++
        failAll('upstream process exited')
      }
    })
    return p
  }

  function rpc(p: ChildProcess, method: string, params: Json, signal: AbortSignal): Promise<Json> {
    return new Promise<Json>((resolve, reject) => {
      if (signal.aborted) return reject(abortError())
      const id = nextId++
      const onAbort = () => {
        pending.delete(id)
        ;(p as ChildProcess & { __kill?: () => void }).__kill?.()
        reject(abortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      pending.set(id, {
        resolve: (r) => {
          signal.removeEventListener('abort', onAbort)
          resolve(r)
        },
        reject: (e) => {
          signal.removeEventListener('abort', onAbort)
          reject(e)
        },
      })
      p.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  async function ensure(signal: AbortSignal): Promise<ChildProcess> {
    if (!proc) {
      proc = start()
      const p = proc
      ready = (async () => {
        await rpc(p, 'initialize', INIT, signal)
        p.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      })()
      ready.catch(() => undefined)
    }
    const p = proc
    await ready
    return p
  }

  return {
    async callTool(name, args, signal) {
      const p = await ensure(signal)
      const r = await rpc(p, 'tools/call', { name, arguments: args }, signal)
      crashes = 0
      return r as McpToolResult
    },
    async close() {
      const p = proc
      proc = null
      ready = null
      if (p) (p as ChildProcess & { __kill?: () => void }).__kill?.()
      failAll('upstream closed')
    },
  }
}

// ---- configuration ----
const URL_OK = /^http:\/\/(127\.0\.0\.1|localhost|host\.containers\.internal):\d{1,5}(\/|$)/

/** LOCAL_MCP_LVI_URL (loopback / host gateway only) wins over LOCAL_MCP_LVI_STDIO (JSON array, no shell). */
export function upstreamFromEnv(env: Record<string, string | undefined>): McpUpstream | null {
  const url = env.LOCAL_MCP_LVI_URL
  if (url) {
    if (!URL_OK.test(url)) {
      console.warn('local-mcp: LOCAL_MCP_LVI_URL rejected (only loopback or host gateway over http)')
      return null
    }
    return createHttpUpstream(url)
  }
  const stdio = env.LOCAL_MCP_LVI_STDIO
  if (stdio) {
    try {
      const a: unknown = JSON.parse(stdio)
      if (Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'string' && x.length > 0)) {
        return createStdioUpstream(a as string[], env)
      }
    } catch {
      /* fall through */
    }
    console.warn('local-mcp: LOCAL_MCP_LVI_STDIO rejected (needs a non-empty JSON array of strings)')
  }
  return null
}
