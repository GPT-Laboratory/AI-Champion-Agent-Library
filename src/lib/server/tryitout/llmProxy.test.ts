import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_COMPLETION_TOKENS,
  MAX_PROXY_BODY_BYTES,
  __resetProxy,
  beginJob,
  buildUpstreamBody,
  endJob,
  getJobUsage,
  handleChatCompletions,
  registerLeaseToken,
  revokeLeaseToken,
} from './llmProxy.js'

const okJson = (total: number) =>
  new Response(JSON.stringify({ choices: [], usage: { total_tokens: total } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const fetchImpl = vi.fn()

function call(token: string | null, body: unknown = { messages: [] }, apiKey: string | null = 'sk-real') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token !== null) headers.Authorization = token
  const request = new Request('http://localhost/x', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return handleChatCompletions(request, {
    apiKey: apiKey ?? undefined,
    upstreamBaseUrl: 'https://up.test/v1',
    model: 'gpt-4.1-mini',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
}

beforeEach(() => {
  __resetProxy()
  fetchImpl.mockReset()
  fetchImpl.mockImplementation(async () => okJson(10))
})

describe('auth', () => {
  it('401 missing header', async () => {
    expect((await call(null)).status).toBe(401)
  })
  it('401 wrong token', async () => {
    expect((await call('Bearer wrong')).status).toBe(401)
  })
  it('401 revoked token', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'j', { maxTotalTokens: 100, maxRequests: 5 })
    expect((await call(`Bearer ${t}`)).status).toBe(200)
    revokeLeaseToken('lease-1')
    expect((await call(`Bearer ${t}`)).status).toBe(401)
  })
  it('re-registering invalidates the first token', async () => {
    const t1 = registerLeaseToken('lease-1')
    const t2 = registerLeaseToken('lease-1')
    beginJob('lease-1', 'j', { maxTotalTokens: 100, maxRequests: 5 })
    expect((await call(`Bearer ${t1}`)).status).toBe(401)
    expect((await call(`Bearer ${t2}`)).status).toBe(200)
  })
})

describe('jobs and budget', () => {
  it('429 no active job, before and after endJob', async () => {
    const t = registerLeaseToken('lease-1')
    const r = await call(`Bearer ${t}`)
    expect(r.status).toBe(429)
    expect((await r.json()).error.message).toBe('no active job for this token')
    beginJob('lease-1', 'j', { maxTotalTokens: 100, maxRequests: 5 })
    expect((await call(`Bearer ${t}`)).status).toBe(200)
    endJob('lease-1')
    expect((await call(`Bearer ${t}`)).status).toBe(429)
  })

  it('429 budget requests', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'job-r', { maxTotalTokens: 1000, maxRequests: 2 })
    expect((await call(`Bearer ${t}`)).status).toBe(200)
    expect((await call(`Bearer ${t}`)).status).toBe(200)
    const third = await call(`Bearer ${t}`)
    expect(third.status).toBe(429)
    expect((await third.json()).error.message).toBe('job token budget exceeded')
    expect(getJobUsage('job-r')?.budgetExceeded).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('429 budget tokens', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'job-t', { maxTotalTokens: 100, maxRequests: 10 })
    fetchImpl.mockImplementationOnce(async () => okJson(150))
    expect((await call(`Bearer ${t}`)).status).toBe(200)
    expect((await call(`Bearer ${t}`)).status).toBe(429)
    expect(getJobUsage('job-t')?.budgetExceeded).toBe(true)
  })

  it('endJob returns final usage and it stays queryable', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'job-e', { maxTotalTokens: 100, maxRequests: 5 })
    await call(`Bearer ${t}`)
    const usage = endJob('lease-1')
    expect(usage).toMatchObject({ jobId: 'job-e', requests: 1, totalTokens: 10 })
    expect(getJobUsage('job-e')).toMatchObject({ requests: 1 })
  })
})

describe('budget hardening (WR-05)', () => {
  it('sends the default completion cap when none (or a non-number) is given', () => {
    expect(buildUpstreamBody({ messages: [] }, 'm').max_tokens).toBe(MAX_COMPLETION_TOKENS)
    const odd = buildUpstreamBody({ messages: [], max_tokens: 'lots', max_completion_tokens: {} }, 'm')
    expect(odd.max_tokens).toBe(MAX_COMPLETION_TOKENS)
    expect(odd.max_completion_tokens).toBeUndefined()
    const small = buildUpstreamBody({ messages: [], max_completion_tokens: 50 }, 'm')
    expect(small.max_completion_tokens).toBe(50)
    expect(small.max_tokens).toBeUndefined()
  })

  it('only forwards include_usage from stream_options', () => {
    const out = buildUpstreamBody(
      { messages: [], stream: true, stream_options: { include_usage: false, x: 1 } },
      'm',
    )
    expect(out.stream_options).toEqual({ include_usage: true })
  })

  it('concurrent requests cannot all pass the token budget check', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'job-c', { maxTotalTokens: 100, maxRequests: 10 })
    fetchImpl.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10))
      return okJson(150)
    })
    const results = await Promise.all([call(`Bearer ${t}`), call(`Bearer ${t}`), call(`Bearer ${t}`)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(getJobUsage('job-c')?.totalTokens).toBe(150)
    expect(getJobUsage('job-c')?.budgetExceeded).toBe(true)
  })

  it('releases the reservation after a failed upstream call', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'job-f', { maxTotalTokens: 100, maxRequests: 10 })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchImpl.mockImplementationOnce(async () => new Response('{}', { status: 500 }))
    expect((await call(`Bearer ${t}`)).status).toBe(500)
    expect((await call(`Bearer ${t}`)).status).toBe(200)
  })

  it('charges the reservation when a stream ends without usage', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'job-s', { maxTotalTokens: 100000, maxRequests: 10 })
    fetchImpl.mockImplementationOnce(
      async () =>
        new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )
    const r = await call(`Bearer ${t}`, { messages: [], stream: true, max_tokens: 300 })
    await r.text()
    await new Promise((res) => setTimeout(res, 20))
    expect(getJobUsage('job-s')?.totalTokens).toBe(300)
  })

  it('charges the reservation when a stream errors midway', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'job-a', { maxTotalTokens: 100000, maxRequests: 10 })
    fetchImpl.mockImplementationOnce(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'))
          c.error(new Error('aborted'))
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    const r = await call(`Bearer ${t}`, { messages: [], stream: true, max_tokens: 200 })
    await r.text().catch(() => undefined)
    await new Promise((res) => setTimeout(res, 20))
    expect(getJobUsage('job-a')?.totalTokens).toBe(200)
  })
})

describe('request handling', () => {
  it('413 oversized body, fetch not called', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'j', { maxTotalTokens: 100, maxRequests: 5 })
    const big = JSON.stringify({ messages: 'x'.repeat(MAX_PROXY_BODY_BYTES + 10) })
    expect((await call(`Bearer ${t}`, big)).status).toBe(413)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('400 invalid json', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'j', { maxTotalTokens: 100, maxRequests: 5 })
    expect((await call(`Bearer ${t}`, '{nope')).status).toBe(400)
  })

  it('whitelist drops unknown keys, forces model/store, clamps tokens', () => {
    const out = buildUpstreamBody(
      {
        model: 'gpt-5',
        user: 'u',
        metadata: {},
        n: 5,
        messages: [],
        tools: [1],
        tool_choice: 'auto',
        max_tokens: 100000,
      },
      'gpt-4.1-mini',
    )
    expect(out).toEqual({
      model: 'gpt-4.1-mini',
      store: false,
      messages: [],
      tools: [1],
      tool_choice: 'auto',
      max_tokens: MAX_COMPLETION_TOKENS,
    })
  })

  it('upstream error is replaced by a generic message, usage request still counted (WR-06)', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'job-u', { maxTotalTokens: 100, maxRequests: 5 })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchImpl.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({ error: { message: 'Incorrect API key provided: sk-proj-****abcd' } }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
    )
    const r = await call(`Bearer ${t}`)
    expect(r.status).toBe(401)
    const text = await r.text()
    expect(JSON.parse(text).error.message).toBe('model request failed (401)')
    expect(text).not.toContain('sk-')
    expect(text).not.toContain('Incorrect API key')
    expect(getJobUsage('job-u')?.requests).toBe(1)
    // Server-side log keeps the detail but never a key-like string.
    const logged = errSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('sk-proj')
    errSpy.mockRestore()
  })

  it('500 when apiKey missing, message leaks nothing', async () => {
    const t = registerLeaseToken('lease-1')
    beginJob('lease-1', 'j', { maxTotalTokens: 100, maxRequests: 5 })
    const r = await call(`Bearer ${t}`, { messages: [] }, null)
    expect(r.status).toBe(500)
    const text = await r.text()
    expect(text).toContain('LLM proxy is not configured')
    expect(text).not.toContain('OPENAI')
  })
})
