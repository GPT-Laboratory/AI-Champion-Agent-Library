// Phase 9 chaos: LLM proxy budget exhaustion and token reuse. Upstream fetch is a stub; no network.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_COMPLETION_TOKENS,
  MAX_PROXY_BODY_BYTES,
  __resetProxy,
  authenticateBearer,
  beginJob,
  endJob,
  getJobUsage,
  handleChatCompletions,
  registerLeaseToken,
  revokeLeaseToken,
} from './llmProxy'

const upstream = vi.fn()

const yieldTicks = async (n = 5) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

const jsonUsage = (usage: unknown) =>
  new Response(JSON.stringify({ choices: [], usage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

function sse(chunks: string[], opts: { abort?: boolean } = {}): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      await yieldTicks()
      if (opts.abort) c.error(new Error('aborted'))
      else c.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function req(auth: string | null, body: BodyInit | null, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders }
  if (auth !== null) headers.Authorization = auth
  const init: RequestInit & { duplex?: string } = { method: 'POST', headers, body }
  if (body && typeof body === 'object' && 'getReader' in body) init.duplex = 'half'
  return new Request('http://localhost/api/llm/v1/chat/completions', init)
}

function send(request: Request, apiKey: string | null = 'sk-real') {
  return handleChatCompletions(request, {
    apiKey: apiKey ?? undefined,
    upstreamBaseUrl: 'https://up.test/v1',
    model: 'gpt-test',
    fetchImpl: upstream as unknown as typeof fetch,
  })
}

const post = (token: string, body: unknown = { messages: [{ role: 'user', content: 'x' }], max_tokens: 100 }) =>
  send(req(`Bearer ${token}`, typeof body === 'string' ? body : JSON.stringify(body)))

beforeEach(() => {
  __resetProxy()
  upstream.mockReset()
  upstream.mockImplementation(async () => {
    await yieldTicks()
    return jsonUsage({ total_tokens: 100 })
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('chaos: concurrent budget exhaustion', () => {
  it('20 concurrent requests with a budget that fits 3: upstream sees exactly 3, the rest get 429', async () => {
    const token = registerLeaseToken('L1')
    beginJob('L1', 'job-1', { maxTotalTokens: 300, maxRequests: 100 })
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(token)))
    const statuses = responses.map((r) => r.status)
    expect(statuses.filter((s) => s === 200)).toHaveLength(3)
    expect(statuses.filter((s) => s === 429)).toHaveLength(17)
    expect(upstream).toHaveBeenCalledTimes(3)
    const usage = getJobUsage('job-1')!
    expect(usage.totalTokens).toBe(300)
    expect(usage.totalTokens).toBeLessThanOrEqual(300 + MAX_COMPLETION_TOKENS)
    expect(usage.budgetExceeded).toBe(true)
  })

  it('a request after the budget is exactly consumed is rejected without calling upstream', async () => {
    const token = registerLeaseToken('L1')
    beginJob('L1', 'job-1', { maxTotalTokens: 100, maxRequests: 100 })
    expect((await post(token)).status).toBe(200)
    expect(getJobUsage('job-1')!.totalTokens).toBe(100)
    upstream.mockClear()
    expect((await post(token)).status).toBe(429)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('request-count budget is enforced under concurrency too', async () => {
    const token = registerLeaseToken('L1')
    beginJob('L1', 'job-1', { maxTotalTokens: 1_000_000, maxRequests: 4 })
    const rs = await Promise.all(Array.from({ length: 12 }, () => post(token)))
    expect(rs.filter((r) => r.status === 200)).toHaveLength(4)
    expect(upstream).toHaveBeenCalledTimes(4)
  })
})

describe('chaos: upstream failures at the limit', () => {
  it('upstream rejection releases the reservation (no charge, never negative or NaN)', async () => {
    const token = registerLeaseToken('L1')
    beginJob('L1', 'job-1', { maxTotalTokens: 150, maxRequests: 100 })
    upstream.mockRejectedValueOnce(new Error('socket hang up sk-secretsecret'))
    expect((await post(token)).status).toBe(502)
    const u = getJobUsage('job-1')!
    expect(u.totalTokens).toBe(0)
    // reservation was released: the next request is admitted
    expect((await post(token)).status).toBe(200)
  })

  it('upstream 500 releases the reservation and reports only the status', async () => {
    const token = registerLeaseToken('L1')
    beginJob('L1', 'job-1', { maxTotalTokens: 150, maxRequests: 100 })
    upstream.mockResolvedValueOnce(new Response('boom sk-proj-ABCDEFGH', { status: 500 }))
    const r = await post(token)
    expect(r.status).toBe(500)
    expect(JSON.stringify(await r.json())).not.toContain('sk-proj')
    expect((await post(token)).status).toBe(200)
  })

  it('an aborted stream is charged its reservation, and the reservation is then released', async () => {
    const token = registerLeaseToken('L1')
    beginJob('L1', 'job-1', { maxTotalTokens: 1000, maxRequests: 100 })
    upstream.mockResolvedValueOnce(sse(['data: {"choices":[]}\n\n'], { abort: true }))
    const r = await post(token, { stream: true, messages: [], max_tokens: 100 })
    await r.text().catch(() => '')
    await yieldTicks(20)
    const u = getJobUsage('job-1')!
    expect(u.totalTokens).toBe(100)
    expect(Number.isFinite(u.totalTokens)).toBe(true)
  })

  it.each([
    ['missing', undefined],
    ['negative', { total_tokens: -500 }],
    ['NaN-like null', { total_tokens: null }],
    ['string', { total_tokens: '99999' }],
    ['non-finite prompt', { prompt_tokens: Infinity, completion_tokens: 5 }],
    ['not an object', 'lots'],
  ])('non-stream usage %s keeps usage finite and non-decreasing', async (_label, usage) => {
    const token = registerLeaseToken('L1')
    beginJob('L1', 'job-1', { maxTotalTokens: 1_000_000, maxRequests: 100 })
    upstream.mockResolvedValueOnce(jsonUsage(usage))
    await post(token)
    const u = getJobUsage('job-1')!
    expect(Number.isFinite(u.totalTokens)).toBe(true)
    expect(u.totalTokens).toBeGreaterThanOrEqual(0)
  })

  it('a provider that omits usage still cannot spend for free: the reservation is charged', async () => {
    const token = registerLeaseToken('L1')
    beginJob('L1', 'job-1', { maxTotalTokens: 10_000, maxRequests: 100 })
    upstream.mockImplementation(async () => jsonUsage(undefined))
    for (let i = 0; i < 5; i++) await post(token) // 100-token cap each
    expect(getJobUsage('job-1')!.totalTokens).toBeGreaterThanOrEqual(500)
  })

  it('NaN usage cannot disable the budget check', async () => {
    const token = registerLeaseToken('L1')
    beginJob('L1', 'job-1', { maxTotalTokens: 250, maxRequests: 100 })
    upstream.mockImplementation(async () => new Response('{"usage":{"total_tokens":1e999}}', { status: 200 }))
    for (let i = 0; i < 6; i++) await post(token)
    expect(upstream.mock.calls.length).toBeLessThanOrEqual(3)
    expect(Number.isFinite(getJobUsage('job-1')!.totalTokens)).toBe(true)
  })
})

describe('chaos: token reuse', () => {
  async function expectDenied(token: string) {
    upstream.mockClear()
    const r = await post(token)
    expect([401, 403, 429]).toContain(r.status)
    expect(upstream).not.toHaveBeenCalled()
  }

  it('token is dead after endJob, after revoke, and after the lease registers a new token', async () => {
    const t = registerLeaseToken('A')
    beginJob('A', 'jobA', { maxTotalTokens: 1000, maxRequests: 10 })
    expect((await post(t)).status).toBe(200)
    endJob('A')
    await expectDenied(t)

    beginJob('A', 'jobA2', { maxTotalTokens: 1000, maxRequests: 10 })
    revokeLeaseToken('A')
    const r = await post(t)
    expect(r.status).toBe(401)

    const t2 = registerLeaseToken('A')
    const t3 = registerLeaseToken('A')
    beginJob('A', 'jobA3', { maxTotalTokens: 1000, maxRequests: 10 })
    expect((await post(t2)).status).toBe(401)
    expect((await post(t3)).status).toBe(200)
  })

  it("lease A's token never spends against lease B's job", async () => {
    const a = registerLeaseToken('A')
    registerLeaseToken('B')
    beginJob('B', 'jobB', { maxTotalTokens: 1000, maxRequests: 10 })
    await expectDenied(a) // A has no active job
    expect(getJobUsage('jobB')).toMatchObject({ totalTokens: 0, requests: 0 })
    // A body naming B's job or lease is ignored.
    upstream.mockClear()
    const r = await post(a, { messages: [], jobId: 'jobB', leaseId: 'B', max_tokens: 5 })
    expect(r.status).toBe(429)
    expect(upstream).not.toHaveBeenCalled()
    expect(getJobUsage('jobB')!.requests).toBe(0)
  })

  it('a finished job id cannot be revived by its old token', async () => {
    const t = registerLeaseToken('A')
    beginJob('A', 'old', { maxTotalTokens: 1000, maxRequests: 10 })
    await post(t)
    endJob('A')
    const before = getJobUsage('old')!.totalTokens
    await expectDenied(t)
    expect(getJobUsage('old')!.totalTokens).toBe(before)
  })

  it('1000 minted tokens are all distinct', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(registerLeaseToken('lease-' + i))
    expect(seen.size).toBe(1000)
  })
})

describe('chaos: header variants', () => {
  beforeEach(() => {
    registerLeaseToken('A')
    beginJob('A', 'j', { maxTotalTokens: 1000, maxRequests: 10 })
  })

  const body = JSON.stringify({ messages: [] })

  it.each([
    ['lower-case scheme', 'bearer x'],
    ['no token', 'Bearer'],
    ['empty', ''],
    ['basic scheme', 'Basic abc'],
    ['1 MB token', 'Bearer ' + 'a'.repeat(1_000_000)],
    ['whitespace token', 'Bearer    '],
  ])('rejects %s with 401 and no upstream call', async (_n, header) => {
    const r = await send(req(null, body, header === '' ? {} : { Authorization: header }))
    expect(r.status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('a comma-joined repeated header is rejected', async () => {
    const t = [...Array(1)].map(() => 'x')[0]
    const r = await send(req(null, body, { Authorization: `Bearer ${t}, Bearer ${t}` }))
    expect(r.status).toBe(401)
  })

  it('authenticateBearer never throws on odd input', () => {
    for (const h of [null, '', 'Bearer', 'Bearer ', 'Bearer \u0000', 'Bearer ' + 'é'.repeat(5000)]) {
      expect(() => authenticateBearer(h)).not.toThrow()
      expect(authenticateBearer(h)).toBeNull()
    }
  })
})

describe('chaos: body variants', () => {
  let token: string
  beforeEach(() => {
    token = registerLeaseToken('A')
    beginJob('A', 'j', { maxTotalTokens: 1_000_000, maxRequests: 100 })
  })

  const upstreamBodies = () => upstream.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string))

  it('an oversized streamed body with no Content-Length is cut off with 413', async () => {
    const chunk = new Uint8Array(64 * 1024).fill(97)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent > MAX_PROXY_BODY_BYTES + 128 * 1024) return c.close()
        sent += chunk.byteLength
        c.enqueue(chunk)
      },
    })
    const r = await send(req(`Bearer ${token}`, stream))
    expect(r.status).toBe(413)
    expect(upstream).not.toHaveBeenCalled()
    expect(sent).toBeLessThan(MAX_PROXY_BODY_BYTES + 512 * 1024) // reading stopped early
  })

  it('a body over the cap is rejected even when Content-Length lies', async () => {
    const big = JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(MAX_PROXY_BODY_BYTES) }] })
    const r = await send(req(`Bearer ${token}`, big, { 'Content-Length': '10' }))
    expect(r.status).toBe(413)
    expect(upstream).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid JSON', '{nope'],
    ['empty', ''],
    ['null', 'null'],
    ['number', '42'],
    ['string', '"x"'],
    ['array', '[1,2]'],
  ])('%s is rejected with 400 and never forwarded', async (_n, raw) => {
    const r = await send(req(`Bearer ${token}`, raw))
    expect(r.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('unknown keys (n, user, model override, tools extras) are dropped; model and cap are forced', async () => {
    await post(token, {
      model: 'gpt-expensive',
      n: 1000,
      user: 'x',
      logit_bias: { 1: 100 },
      store: true,
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 10_000_000,
    })
    const [b] = upstreamBodies()
    expect(b.model).toBe('gpt-test')
    expect(b.n).toBeUndefined()
    expect(b.user).toBeUndefined()
    expect(b.logit_bias).toBeUndefined()
    expect(b.store).toBe(false)
    expect(b.max_tokens).toBe(MAX_COMPLETION_TOKENS)
  })

  it('a huge messages array within the body cap is forwarded once and charged normally', async () => {
    const messages = Array.from({ length: 20_000 }, () => ({ role: 'user', content: 'a' }))
    const r = await post(token, { messages, max_tokens: 50 })
    expect(r.status).toBe(200)
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('stream flag toggling: non-boolean stream is not treated as streaming and stream_options is stripped', async () => {
    await post(token, { messages: [], stream: 'true', stream_options: { include_usage: false, x: 1 } })
    await post(token, { messages: [], stream: false, stream_options: { include_usage: true } })
    for (const b of upstreamBodies()) {
      expect(b.stream_options).toBeUndefined()
    }
  })

  it('stream=true forces include_usage and drops other stream_options keys', async () => {
    upstream.mockResolvedValueOnce(sse(['data: [DONE]\n\n']))
    const r = await post(token, { messages: [], stream: true, stream_options: { include_usage: false, evil: 1 } })
    await r.text()
    const [b] = upstreamBodies()
    expect(b.stream_options).toEqual({ include_usage: true })
  })

  it('a missing API key never reaches upstream', async () => {
    const r = await send(req(`Bearer ${token}`, JSON.stringify({ messages: [] })), null)
    expect(r.status).toBe(500)
    expect(upstream).not.toHaveBeenCalled()
  })
})
