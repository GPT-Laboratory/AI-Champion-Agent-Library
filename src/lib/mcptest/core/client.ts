// Black-box MCP client (hand-written, no SDK). Records protocol misbehaviour as findings; never throws from callTool.
import type { Channel } from './jsonrpc'
import type { ToolCaller, ToolInfo, ToolOutcome } from './types'

export type { Channel } from './jsonrpc'

export type FindingKind =
  | 'stdout_noise'
  | 'oversize_message'
  | 'unknown_protocol_version'
  | 'timeout'
  | 'bad_response'
  | 'invalid_json_rpc'
  | 'early_exit'
  | 'session_error'
export interface Finding {
  kind: FindingKind
  detail: string
}
export type InitResult =
  | {
      ok: true
      protocolVersion: string
      serverInfo: { name?: string; version?: string }
      capabilities: unknown
    }
  | { ok: false; kind: 'timeout' | 'closed' | 'error' | 'bad_response'; reason: string }

export const KNOWN_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

type Reply =
  | { t: 'ok'; result: unknown }
  | { t: 'rpc_error'; code: number; message: string }
  | { t: 'timeout' }
  | { t: 'closed' }
  | { t: 'transport'; message: string }

const MAX_FINDINGS = 200
const clip = (s: string) => (s.length > 200 ? s.slice(0, 200) : s)
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export class McpClient implements ToolCaller {
  tools: ToolInfo[] = []
  findings: Finding[] = []
  /** Negotiated protocol version, set by a successful initialize. */
  protocolVersion?: string

  private nextId = 1
  private pending = new Map<number | string, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>()
  private timedOut = new Set<number | string>()
  private closing = false
  private closedInfo = false
  private initialized = false

  private constructor(
    private ch: Channel,
    private timeoutMs: number,
    private clientVersion: string,
    private maxToolPages: number
  ) {
    ch.onMessage((m) => this.onMessage(m))
    ch.onNoise((l) => this.note('stdout_noise', l))
    ch.onOversize?.((n) => this.note('oversize_message', `line over size cap (${n} bytes seen)`))
    ch.onTransportError?.((e) => {
      this.note(e.kind === 'session_error' ? 'session_error' : 'bad_response', e.message)
      if (e.id !== undefined) this.settle(e.id, { t: 'transport', message: clip(e.message) })
    })
    ch.onClose(() => this.onClosed())
  }

  /** maxLineBytes is enforced by the Channel (pass it to lineChannel / httpChannel); accepted here for API symmetry. */
  static connect(
    ch: Channel,
    opts: { timeoutMs?: number; maxLineBytes?: number; clientVersion?: string; maxToolPages?: number } = {}
  ): McpClient {
    return new McpClient(ch, opts.timeoutMs ?? 10000, opts.clientVersion ?? '0.1.0', opts.maxToolPages ?? 20)
  }

  private note(kind: FindingKind, detail: string) {
    if (this.findings.length < MAX_FINDINGS) this.findings.push({ kind, detail: clip(detail) })
  }

  private settle(id: number | string, r: Reply) {
    const p = this.pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(id)
    p.resolve(r)
  }

  private onClosed() {
    if (this.closedInfo) return
    this.closedInfo = true
    if (!this.closing && (this.pending.size > 0 || !this.initialized)) {
      this.note('early_exit', 'server closed the channel unexpectedly')
    }
    for (const id of [...this.pending.keys()]) this.settle(id, { t: 'closed' })
  }

  private onMessage(m: unknown) {
    if (!isObj(m) || m.jsonrpc !== '2.0') {
      this.note('invalid_json_rpc', 'message is not a JSON-RPC 2.0 object')
      return
    }
    const hasId = typeof m.id === 'number' || typeof m.id === 'string'
    if (typeof m.method === 'string') {
      if (!hasId) return // notification: ignored
      if (m.method === 'ping') this.ch.send({ jsonrpc: '2.0', id: m.id, result: {} })
      else this.ch.send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } })
      return
    }
    if (!hasId) {
      this.note('invalid_json_rpc', 'response without id')
      return
    }
    const id = m.id as number | string
    if (!this.pending.has(id)) {
      if (this.timedOut.has(id)) return
      this.note('invalid_json_rpc', `response with unknown id ${String(id).slice(0, 40)}`)
      return
    }
    if (isObj(m.error)) {
      const code = typeof m.error.code === 'number' ? m.error.code : -32603
      const message = typeof m.error.message === 'string' ? m.error.message : 'error'
      this.settle(id, { t: 'rpc_error', code, message: clip(message) })
    } else if ('result' in m) {
      this.settle(id, { t: 'ok', result: m.result })
    } else {
      this.note('invalid_json_rpc', 'response has neither result nor error')
      this.settle(id, { t: 'transport', message: 'response has neither result nor error' })
    }
  }

  private request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<Reply> {
    if (this.closedInfo) return Promise.resolve({ t: 'closed' })
    const id = this.nextId++
    return new Promise<Reply>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.timedOut.add(id)
        this.note('timeout', `${method} timed out after ${timeoutMs} ms`)
        resolve({ t: 'timeout' })
      }, timeoutMs)
      this.pending.set(id, { resolve, timer })
      this.ch.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  async initialize(): Promise<InitResult> {
    const r = await this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'aic-mcp-tester', version: this.clientVersion }
    })
    if (r.t === 'timeout') return { ok: false, kind: 'timeout', reason: 'initialize timed out' }
    if (r.t === 'closed') return { ok: false, kind: 'closed', reason: 'channel closed before initialize reply' }
    if (r.t === 'transport') return { ok: false, kind: 'error', reason: r.message }
    if (r.t === 'rpc_error') return { ok: false, kind: 'error', reason: `${r.code}: ${r.message}` }
    const res = r.result
    if (!isObj(res) || typeof res.protocolVersion !== 'string') {
      this.note('bad_response', 'initialize result missing protocolVersion')
      return { ok: false, kind: 'bad_response', reason: 'initialize result missing protocolVersion' }
    }
    if (!KNOWN_PROTOCOL_VERSIONS.includes(res.protocolVersion)) {
      this.note('unknown_protocol_version', `server chose ${res.protocolVersion.slice(0, 40)}`)
    }
    this.protocolVersion = res.protocolVersion
    this.initialized = true
    this.ch.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const si = isObj(res.serverInfo) ? res.serverInfo : {}
    return {
      ok: true,
      protocolVersion: res.protocolVersion,
      serverInfo: {
        name: typeof si.name === 'string' ? si.name : undefined,
        version: typeof si.version === 'string' ? si.version : undefined
      },
      capabilities: res.capabilities
    }
  }

  async listTools(): Promise<ToolInfo[]> {
    const out: ToolInfo[] = []
    let cursor: string | undefined
    for (let page = 0; ; page++) {
      if (page >= this.maxToolPages) {
        this.note('bad_response', `tools/list exceeded ${this.maxToolPages} pages`)
        break
      }
      const r = await this.request('tools/list', cursor ? { cursor } : {})
      if (r.t !== 'ok') {
        if (r.t === 'rpc_error') this.note('bad_response', `tools/list error ${r.code}`)
        break
      }
      const res = r.result
      if (!isObj(res) || !Array.isArray(res.tools)) {
        this.note('bad_response', 'tools/list result has no tools array')
        break
      }
      for (const t of res.tools) {
        if (!isObj(t) || typeof t.name !== 'string') {
          this.note('bad_response', 'tool entry without a name')
          continue
        }
        out.push({
          name: t.name,
          description: typeof t.description === 'string' ? t.description : undefined,
          inputSchema: t.inputSchema,
          annotations: isObj(t.annotations) ? t.annotations : undefined
        })
      }
      if (typeof res.nextCursor === 'string' && res.nextCursor) cursor = res.nextCursor
      else break
    }
    this.tools = out
    return out
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts: { timeoutMs?: number } = {}
  ): Promise<ToolOutcome> {
    try {
      const r = await this.request('tools/call', { name, arguments: args }, opts.timeoutMs)
      if (r.t === 'timeout') return { kind: 'transport_error', message: 'tools/call timed out', timedOut: true }
      if (r.t === 'closed') return { kind: 'transport_error', message: 'channel closed' }
      if (r.t === 'transport') return { kind: 'transport_error', message: r.message }
      if (r.t === 'rpc_error') return { kind: 'rpc_error', code: r.code, message: r.message }
      const res = r.result
      if (!isObj(res)) {
        this.note('bad_response', 'tools/call result is not an object')
        return { kind: 'transport_error', message: 'tools/call result is not an object' }
      }
      const content = Array.isArray(res.content) ? res.content : []
      const text = content
        .filter((c): c is Record<string, unknown> => isObj(c) && c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('\n')
      return { kind: 'result', isError: res.isError === true, text, structured: res.structuredContent, content }
    } catch (e) {
      return { kind: 'transport_error', message: clip(e instanceof Error ? e.message : String(e)) }
    }
  }

  call(name: string, args: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<ToolOutcome> {
    return this.callTool(name, args, opts)
  }

  async close(): Promise<void> {
    this.closing = true
    try {
      await this.ch.close()
    } catch {
      /* ignore */
    }
    this.onClosed()
  }

  stderrText(): string {
    return this.ch.stderrText?.() ?? ''
  }
}
