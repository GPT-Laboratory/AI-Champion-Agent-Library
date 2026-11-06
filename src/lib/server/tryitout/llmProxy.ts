// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
// LLM proxy for Pi containers (D-17): per-lease bearer tokens, per-job budget, real key injected server-side.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { redactSecrets } from './redact'

export interface JobBudget {
  maxTotalTokens: number
  maxRequests: number
}

export interface JobUsage {
  jobId: string
  totalTokens: number
  requests: number
  budgetExceeded: boolean
}

export const MAX_PROXY_BODY_BYTES = 1_048_576
export const MAX_COMPLETION_TOKENS = 16384

const FINISHED_LIMIT = 200

interface TokenEntry {
  leaseId: string
  digest: Buffer
}

interface ActiveJob {
  jobId: string
  budget: JobBudget
  usage: JobUsage
  /** Completion tokens reserved by in-flight requests (WR-05): spent + reserved gates new requests. */
  reserved: number
}

// Held on globalThis, like the lease service (service.ts), so a Vite dev reload of this module
// cannot drop tokens while the surviving lease manager still hands them to running containers.
interface ProxyState {
  tokensByHex: Map<string, TokenEntry>
  hexByLease: Map<string, string>
  activeJobs: Map<string, ActiveJob>
  finishedUsage: Map<string, JobUsage>
}
const proxyGlobal = globalThis as typeof globalThis & { __aicLlmProxyState?: ProxyState }
proxyGlobal.__aicLlmProxyState ??= {
  tokensByHex: new Map(),
  hexByLease: new Map(),
  activeJobs: new Map(),
  finishedUsage: new Map(),
}
const { tokensByHex, hexByLease, activeJobs, finishedUsage } = proxyGlobal.__aicLlmProxyState

function digestOf(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function rememberFinished(usage: JobUsage): void {
  finishedUsage.delete(usage.jobId)
  finishedUsage.set(usage.jobId, usage)
  while (finishedUsage.size > FINISHED_LIMIT) {
    const oldest = finishedUsage.keys().next().value
    if (oldest === undefined) break
    finishedUsage.delete(oldest)
  }
}

export function registerLeaseToken(leaseId: string): string {
  revokeLeaseToken(leaseId)
  const token = randomBytes(32).toString('base64url')
  const digest = digestOf(token)
  const hex = digest.toString('hex')
  tokensByHex.set(hex, { leaseId, digest })
  hexByLease.set(leaseId, hex)
  return token
}

export function revokeLeaseToken(leaseId: string): void {
  const hex = hexByLease.get(leaseId)
  if (hex) {
    tokensByHex.delete(hex)
    hexByLease.delete(leaseId)
  }
  endJob(leaseId)
}

export function beginJob(leaseId: string, jobId: string, budget: JobBudget): void {
  const usage: JobUsage = { jobId, totalTokens: 0, requests: 0, budgetExceeded: false }
  activeJobs.set(leaseId, { jobId, budget, usage, reserved: 0 })
  rememberFinished(usage)
}

export function endJob(leaseId: string): JobUsage | null {
  const job = activeJobs.get(leaseId)
  if (!job) return null
  activeJobs.delete(leaseId)
  rememberFinished(job.usage)
  return job.usage
}

/** Job id of the lease's running job, or null (used by the local MCP proxy, Phase 36). */
export function getActiveJobId(leaseId: string): string | null {
  return activeJobs.get(leaseId)?.jobId ?? null
}

export function getJobUsage(jobId: string): JobUsage | null {
  for (const job of activeJobs.values()) {
    if (job.jobId === jobId) return job.usage
  }
  return finishedUsage.get(jobId) ?? null
}

export function authenticateBearer(header: string | null): { leaseId: string } | null {
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token) return null
  const digest = digestOf(token)
  const entry = tokensByHex.get(digest.toString('hex'))
  if (!entry) return null
  if (entry.digest.length !== digest.length || !timingSafeEqual(entry.digest, digest)) return null
  return { leaseId: entry.leaseId }
}

const ALLOWED_KEYS = [
  'messages',
  'tools',
  'tool_choice',
  'stream',
  'stream_options',
  'temperature',
  'top_p',
  'parallel_tool_calls',
  'response_format',
  'max_tokens',
  'max_completion_tokens',
] as const

export function buildUpstreamBody(
  body: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of ALLOWED_KEYS) {
    if (body[key] !== undefined) out[key] = body[key]
  }
  out.model = model
  out.store = false
  // WR-05: always bound the completion; a missing or non-numeric limit gets the cap.
  for (const key of ['max_tokens', 'max_completion_tokens'] as const) {
    const v = out[key]
    if (v === undefined) continue
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[key] = Math.min(v, MAX_COMPLETION_TOKENS)
    else delete out[key]
  }
  if (out.max_tokens === undefined && out.max_completion_tokens === undefined) {
    out.max_tokens = MAX_COMPLETION_TOKENS
  }
  if (out.stream === true) {
    // Only include_usage is ours to set; other client stream_options keys are not forwarded.
    out.stream_options = { include_usage: true }
  } else {
    delete out.stream_options
  }
  return out
}

function errorResponse(
  status: number,
  message: string,
  type = 'invalid_request_error',
): Response {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A usable token count: finite and non-negative. Anything else counts as "not reported". */
function tokenCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

function usageTotal(usage: unknown): number {
  if (!usage || typeof usage !== 'object') return 0
  const u = usage as Record<string, unknown>
  const total = tokenCount(u.total_tokens)
  if (total !== null) return total
  return (tokenCount(u.prompt_tokens) ?? 0) + (tokenCount(u.completion_tokens) ?? 0)
}

async function readCappedText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_PROXY_BODY_BYTES) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_PROXY_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function completionCap(body: Record<string, unknown>): number {
  const caps = [body.max_tokens, body.max_completion_tokens].filter(
    (v): v is number => typeof v === 'number',
  )
  return caps.length ? Math.min(...caps) : MAX_COMPLETION_TOKENS
}

async function meterStream(
  stream: ReadableStream<Uint8Array>,
  job: ActiveJob,
  reserved: number,
): Promise<void> {
  let charged = false
  try {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let lastUsage: unknown = null
    const scan = (line: string) => {
      if (!line.startsWith('data:')) return
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') return
      try {
        const parsed = JSON.parse(payload) as { usage?: unknown }
        if (parsed.usage) lastUsage = parsed.usage
      } catch {
        // ignore malformed chunk
      }
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(scan)
    }
    if (buffer) scan(buffer)
    const used = usageTotal(lastUsage)
    // No usage chunk (provider omitted it): charge the reservation.
    job.usage.totalTokens += used > 0 ? used : reserved
    charged = true
  } catch {
    // aborted or failed stream: usage unknown, charge the reservation (WR-05)
  } finally {
    if (!charged) job.usage.totalTokens += reserved
    job.reserved = Math.max(0, job.reserved - reserved)
  }
}

export async function handleChatCompletions(
  request: Request,
  deps: {
    apiKey: string | undefined
    upstreamBaseUrl: string
    model: string
    fetchImpl: typeof fetch
  },
): Promise<Response> {
  const auth = authenticateBearer(request.headers.get('authorization'))
  if (!auth) return errorResponse(401, 'invalid or missing token')

  const text = await readCappedText(request)
  if (text === null) return errorResponse(413, 'request body too large')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return errorResponse(400, 'request body must be valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return errorResponse(400, 'request body must be a JSON object')
  }

  const job = activeJobs.get(auth.leaseId)
  if (!job) return errorResponse(429, 'no active job for this token', 'rate_limit_error')

  if (
    job.usage.requests >= job.budget.maxRequests ||
    job.usage.totalTokens + job.reserved >= job.budget.maxTotalTokens
  ) {
    job.usage.budgetExceeded = true
    return errorResponse(429, 'job token budget exceeded', 'insufficient_quota')
  }

  if (!deps.apiKey) return errorResponse(500, 'LLM proxy is not configured', 'server_error')

  const upstreamBody = buildUpstreamBody(parsed as Record<string, unknown>, deps.model)
  job.usage.requests++
  // Reserve before the first await so concurrent requests see it (check and reserve are synchronous).
  const reserve = completionCap(upstreamBody)
  job.reserved += reserve
  let reservationHandedToMeter = false

  try {
    const upstream = await deps.fetchImpl(`${deps.upstreamBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
      signal: request.signal,
    })

    if (!upstream.ok) {
      // WR-06: the upstream body can echo the masked key; log it redacted, tell Pi only the status.
      const errText = await upstream.text().catch(() => '')
      console.error('llm proxy upstream error', upstream.status, redactSecrets(errText).slice(0, 500))
      return errorResponse(
        upstream.status,
        `model request failed (${upstream.status})`,
        'server_error',
      )
    }

    if (upstreamBody.stream === true && upstream.body) {
      const [toClient, toMeter] = upstream.body.tee()
      reservationHandedToMeter = true
      void meterStream(toMeter, job, reserve)
      return new Response(toClient, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      })
    }

    const payload = (await upstream.json()) as { usage?: unknown } | null
    // Missing/invalid usage is charged the reservation, like a stream without a usage chunk.
    const used = usageTotal(payload?.usage)
    job.usage.totalTokens += used > 0 ? used : reserve
    return new Response(JSON.stringify(payload), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(
      'llm proxy failed',
      redactSecrets(err instanceof Error ? err.message : 'unknown error'),
    )
    return errorResponse(502, 'upstream request failed', 'server_error')
  } finally {
    if (!reservationHandedToMeter) job.reserved = Math.max(0, job.reserved - reserve)
  }
}

export function __resetProxy(): void {
  tokensByHex.clear()
  hexByLease.clear()
  activeJobs.clear()
  finishedUsage.clear()
}
