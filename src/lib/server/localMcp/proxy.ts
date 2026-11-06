// App-side MCP proxy handler (D-635). The Pi container reaches only the app; the key and the server stay on the host.
// Handler order: flag (404) -> bearer (401) -> body (413/400) -> allow-list/args (403/400) -> job (429) -> budget (429)
// -> upstream configured (503) -> call (504/502) -> sanitized envelope.
import { authenticateBearer, getActiveJobId } from '../tryitout/llmProxy'
import { redactSecrets } from '../tryitout/redact'
import { localMcpAgentsEnabled } from '../../localMcpFlag'
import { validateToolCall } from './allowlist'
import { shapeResult } from './sanitize'
import { LOCAL_MCP_ALLOWED_TOOLS, MAX_ARGS_BYTES, type LocalMcpDeps } from './types'

const FINISHED_LIMIT = 200
interface LocalMcpState {
  counts: Map<string, number>
}
const g = globalThis as typeof globalThis & { __aicLocalMcpState?: LocalMcpState }
g.__aicLocalMcpState ??= { counts: new Map() }
const state = g.__aicLocalMcpState

export function __resetLocalMcp(): void {
  state.counts.clear()
}

function reply(status: number, tool: string, error: string): Response {
  console.log(`local-mcp ${tool} error ${status}`)
  return Response.json({ ok: false, error }, { status })
}

/** Increments before any await so concurrent calls cannot exceed the budget. Returns the new count or null. */
function spend(jobId: string, budget: number): number | null {
  const used = state.counts.get(jobId) ?? 0
  if (used >= budget) return null
  state.counts.delete(jobId)
  state.counts.set(jobId, used + 1)
  while (state.counts.size > FINISHED_LIMIT) {
    const oldest = state.counts.keys().next().value
    if (oldest === undefined) break
    state.counts.delete(oldest)
  }
  return used + 1
}

export async function handleLocalMcpCall(request: Request, toolName: string, deps: LocalMcpDeps): Promise<Response> {
  if (!localMcpAgentsEnabled()) return Response.json({ message: 'Not found' }, { status: 404 })
  const tool = (LOCAL_MCP_ALLOWED_TOOLS as readonly string[]).includes(toolName) ? toolName : 'unknown'

  const auth = authenticateBearer(request.headers.get('authorization'))
  if (!auth) return reply(401, tool, 'unauthorized')

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_ARGS_BYTES) return reply(413, tool, 'request too large')
  const raw = await request.text().catch(() => '')
  if (Buffer.byteLength(raw, 'utf8') > MAX_ARGS_BYTES) return reply(413, tool, 'request too large')
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return reply(400, tool, 'invalid body')
  }
  if (
    body === null || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).some((k) => k !== 'arguments') || !('arguments' in body)
  ) {
    return reply(400, tool, 'invalid body')
  }

  const v = validateToolCall(toolName, (body as { arguments: unknown }).arguments)
  if (!v.ok) return reply(v.status, tool, v.error)

  const jobId = getActiveJobId(auth.leaseId)
  if (!jobId) return reply(429, tool, 'no active job')
  const used = spend(jobId, deps.callBudget)
  if (used === null) return reply(429, tool, 'tool call budget exceeded')
  if (!deps.upstream) return reply(503, tool, 'upstream not configured')

  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), deps.timeoutMs)
  const signal = AbortSignal.any([timeout.signal, request.signal])
  try {
    const result = await deps.upstream.callTool(toolName, v.args, signal)
    const shaped = shapeResult(result)
    console.log(`local-mcp ${tool} ${shaped.isError ? 'error' : 'ok'} 200`)
    return Response.json({
      ok: !shaped.isError,
      tool: toolName,
      ...(shaped.isError ? { error: 'tool returned an error' } : {}),
      data: shaped.data,
      truncated: shaped.truncated,
      calls_used: used,
      calls_left: Math.max(0, deps.callBudget - used),
    })
  } catch (err) {
    if (timeout.signal.aborted) return reply(504, tool, 'upstream timeout')
    // Only the error class is logged: upstream text may carry data or secrets.
    console.warn(`local-mcp ${tool} upstream failure ${redactSecrets(err instanceof Error ? err.name : 'unknown')}`)
    return reply(502, tool, 'upstream failure')
  } finally {
    clearTimeout(timer)
  }
}
