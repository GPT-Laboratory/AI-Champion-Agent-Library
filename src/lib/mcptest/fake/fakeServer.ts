// In-process fake MCP server (scorer fixture). One dispatcher (createFake().handle) is shared by the
// stdio flavour (serveStdio, real line framing) and the HTTP flavour (httpFake.ts).
// Imports nothing from $lib, svelte or @sveltejs. Reads ACME_* only from the explicit env option.
import type { Readable, Writable } from 'node:stream'
import { callTool, listTools, type ToolDeps } from './tools'
import { getVariant, type VariantDef } from './variants'

export class FakeError extends Error {
  constructor(
    public code: 'unknown-variant',
    message: string
  ) {
    super(message)
    this.name = 'FakeError'
  }
}

export interface FakeOptions {
  variant: string
  env: Record<string, string>
  sleep?: (ms: number) => Promise<void>
  /** Where secret-echo writes its stderr line. Default process.stderr. */
  stderr?: { write(s: string): unknown }
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

const SERVER_PROTOCOL = '2025-11-25'
const OLD_PROTOCOL = '2024-11-05' // a version the client knows
const UNKNOWN_PROTOCOL = '1999-01-01' // a version nobody knows
const STDOUT_BANNER = 'Acme fake server starting (this line is not JSON-RPC)'
const KNOWN = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

export interface Fake {
  def: VariantDef
  /** Returns the JSON-RPC response, or undefined for notifications and fault-suppressed replies. */
  handle(msg: unknown): Promise<Json | undefined>
}

export function createFake(opts: FakeOptions): Fake {
  const found = getVariant(opts.variant)
  if (!found) throw new FakeError('unknown-variant', `unknown variant: ${String(opts.variant).slice(0, 60)}`)
  const def: VariantDef = found
  const b = def.behaviour
  const deps: ToolDeps = {
    env: opts.env,
    sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    stderr: opts.stderr ?? process.stderr
  }
  const reply = (id: unknown, result: unknown): Json => ({ jsonrpc: '2.0', id, result })
  const rpcError = (id: unknown, code: number, message: string): Json => ({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message }
  })

  async function handle(msg: unknown): Promise<Json | undefined> {
    if (!isObj(msg) || typeof msg.method !== 'string') return rpcError(isObj(msg) ? msg.id : null, -32600, 'Invalid request')
    const id = msg.id
    const isNotification = id === undefined
    const params = isObj(msg.params) ? msg.params : {}
    switch (msg.method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : SERVER_PROTOCOL
        const negotiated =
          b.processFault === 'old-protocol'
            ? OLD_PROTOCOL
            : b.processFault === 'unknown-protocol'
              ? UNKNOWN_PROTOCOL
              : KNOWN.includes(asked)
                ? asked
                : SERVER_PROTOCOL
        return reply(id, {
          protocolVersion: negotiated,
          capabilities: { tools: {} },
          serverInfo: { name: `scorer-fixture-${def.id}`, version: '0.0.0' }
        })
      }
      case 'ping':
        return isNotification ? undefined : reply(id, {})
      case 'tools/list':
        return reply(id, { tools: listTools(b) })
      case 'tools/call': {
        const name = params.name
        if (typeof name !== 'string') return rpcError(id, -32602, 'Invalid params: name is required')
        const args = params.arguments === undefined ? {} : params.arguments
        if (!isObj(args)) return rpcError(id, -32602, 'Invalid params: arguments must be an object')
        const r = await callTool(b, deps, name, args)
        if (!r) return rpcError(id, -32602, `Unknown tool: ${name.slice(0, 60)}`)
        const result: Json = { content: [{ type: 'text', text: r.text }], isError: r.isError }
        if (r.structured) result.structuredContent = r.structured
        return reply(id, result)
      }
      default:
        if (isNotification || msg.method.startsWith('notifications/')) return undefined
        return rpcError(id, -32601, 'Method not found')
    }
  }
  return { def, handle }
}

/**
 * Speak MCP over line-delimited JSON on a pair of streams. Resolves when input ends and all in-flight
 * calls are answered. Rejects with FakeError for an unknown variant (never crashes the process).
 */
export async function serveStdio(
  input: Readable,
  output: Writable,
  opts: FakeOptions & { endOutputOnEof?: boolean }
): Promise<void> {
  const fake = createFake(opts)
  const fault = fake.def.behaviour.processFault
  const inflight = new Set<Promise<void>>()
  const send = (m: unknown) => {
    if (!output.destroyed && !output.writableEnded) output.write(JSON.stringify(m) + '\n')
  }
  let crashed = false
  let stop: () => void = () => {}
  if (fault === 'stdout-noise') output.write(STDOUT_BANNER + '\n')
  const onLine = (line: string) => {
    if (crashed || fault === 'hang' || !line.trim()) return
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    if (fault === 'crash-on-init' && isObj(msg) && msg.method === 'initialize') {
      crashed = true // the process ends before replying to initialize
      stop()
      return
    }
    const p = fake
      .handle(msg)
      .then((r) => {
        if (r) send(r)
      })
      .catch(() => send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }))
      .finally(() => inflight.delete(p))
    inflight.add(p)
  }

  await new Promise<void>((resolve) => {
    let buf = ''
    input.setEncoding?.('utf8')
    input.on('data', (chunk: string | Buffer) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        onLine(line)
      }
    })
    let done = false
    const finish = () => {
      if (done) return
      done = true
      if (buf.trim()) onLine(buf)
      resolve()
    }
    stop = finish
    input.on('end', finish)
    input.on('close', finish)
    input.on('error', finish)
  })
  await Promise.allSettled([...inflight])
  if (opts.endOutputOnEof !== false) {
    try {
      output.end()
    } catch {
      /* ignore */
    }
  }
}
