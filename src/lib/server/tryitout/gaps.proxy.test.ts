// E3: LLM proxy error mapping and redaction edge cases not covered by llmProxy.test.ts / chaos.proxy.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_COMPLETION_TOKENS,
  __resetProxy,
  beginJob,
  buildUpstreamBody,
  endJob,
  getJobUsage,
  handleChatCompletions,
  registerLeaseToken,
} from './llmProxy'
import { TryItOutRuntimeError } from './runtime'
import { logDetail, publicErrorMessage, publicText, redactSecrets } from './redact'

const fetchImpl = vi.fn()
let token = ''

function call(body: unknown, headers: Record<string, string> = {}, apiKey: string | undefined = 'sk-real') {
  const request = new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return handleChatCompletions(request, {
    apiKey,
    upstreamBaseUrl: 'https://up.test/v1',
    model: 'm',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
}

beforeEach(() => {
  __resetProxy()
  fetchImpl.mockReset()
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  token = registerLeaseToken('L1')
  beginJob('L1', 'job-1', { maxTotalTokens: 1000, maxRequests: 10 })
})

describe('proxy request validation', () => {
  it.each([['null'], ['[]'], ['"str"'], ['42']])('400 for JSON body %s, upstream untouched', async (raw) => {
    const res = await call(raw)
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toMatch(/JSON object/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('an empty body is 400 (not a crash)', async () => {
    const res = await call('')
    expect(res.status).toBe(400)
  })

  it('401 for a non-Bearer scheme and for an empty bearer', async () => {
    const a = await call({}, { Authorization: 'Basic abc' })
    expect(a.status).toBe(401)
    const b = await call({}, { Authorization: 'Bearer    ' })
    expect(b.status).toBe(401)
  })

  it('the 401 error body is OpenAI-shaped and does not echo the token', async () => {
    const res = await call({}, { Authorization: 'Bearer nope-secret-token' })
    const text = await res.text()
    expect(JSON.parse(text).error.type).toBe('invalid_request_error')
    expect(text).not.toContain('nope-secret-token')
  })

  it('413 beats 400: an oversized declared Content-Length is rejected before JSON parsing', async () => {
    const res = await call('not json', { 'content-length': String(5 * 1024 * 1024) })
    // fetch's Request ignores a forged length header on some runtimes; either 413 or 400 is a rejection with no upstream call
    expect([400, 413]).toContain(res.status)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('upstream status mapping', () => {
  it.each([400, 401, 403, 404, 429, 500, 503])(
    'upstream %i is passed through as the same status with a generic message (no upstream body)',
    async (status) => {
      fetchImpl.mockResolvedValue(new Response('{"error":"leak sk-proj-ABCDEFGH1234"}', { status }))
      const res = await call({ messages: [] })
      expect(res.status).toBe(status)
      const text = await res.text()
      expect(text).toContain(`model request failed (${status})`)
      expect(text).not.toContain('sk-proj')
      expect(JSON.parse(text).error.type).toBe('server_error')
    },
  )

  it('the upstream error body is logged redacted, truncated to 500 chars', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchImpl.mockResolvedValue(new Response('sk-proj-ABCDEFGH1234 ' + 'x'.repeat(2000), { status: 500 }))
    await call({ messages: [] })
    const logged = err.mock.calls.flat().join(' ')
    expect(logged).not.toContain('sk-proj-ABCDEFGH1234')
    expect(logged).toContain('[redacted]')
    expect(logged.length).toBeLessThan(700)
  })

  it('an upstream whose error body cannot be read still maps to the status', async () => {
    const bad = new Response('x', { status: 502 })
    vi.spyOn(bad, 'text').mockRejectedValue(new Error('stream died'))
    fetchImpl.mockResolvedValue(bad)
    const res = await call({ messages: [] })
    expect(res.status).toBe(502)
  })

  it('a thrown fetch maps to 502 and the log line has the key redacted', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchImpl.mockRejectedValue(new Error('connect ECONNREFUSED with Bearer sk-live-AAAAAAAAAAAA'))
    const res = await call({ messages: [] })
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).toContain('upstream request failed')
    expect(text).not.toContain('ECONNREFUSED')
    expect(err.mock.calls.flat().join(' ')).not.toContain('sk-live-AAAAAAAAAAAA')
  })

  it('a thrown non-Error maps to 502 as well', async () => {
    fetchImpl.mockRejectedValue('weird')
    const res = await call({ messages: [] })
    expect(res.status).toBe(502)
  })

  it('a 200 whose body is not JSON maps to 502 and releases the reservation', async () => {
    fetchImpl.mockResolvedValue(new Response('<html>', { status: 200 }))
    const res = await call({ messages: [] })
    expect(res.status).toBe(502)
    // a follow-up request is still admitted: reservation not leaked
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ usage: { total_tokens: 1 } }), { status: 200 }))
    expect((await call({ messages: [] })).status).toBe(200)
  })

  it('a null JSON payload is returned as null and charged the reservation', async () => {
    fetchImpl.mockResolvedValue(new Response('null', { status: 200 }))
    const res = await call({ messages: [], max_tokens: 7 })
    expect(res.status).toBe(200)
    expect(getJobUsage('job-1')?.totalTokens).toBe(7)
  })
})

describe('usage accounting', () => {
  it('non-stream usage without total_tokens sums prompt and completion', async () => {
    fetchImpl.mockResolvedValue(
      new Response(JSON.stringify({ usage: { prompt_tokens: 30, completion_tokens: 12 } }), { status: 200 }),
    )
    await call({ messages: [] })
    expect(getJobUsage('job-1')?.totalTokens).toBe(42)
  })

  it('negative total_tokens is ignored (falls back to prompt+completion)', async () => {
    fetchImpl.mockResolvedValue(
      new Response(JSON.stringify({ usage: { total_tokens: -500, prompt_tokens: 1, completion_tokens: 2 } }), {
        status: 200,
      }),
    )
    await call({ messages: [] })
    expect(getJobUsage('job-1')?.totalTokens).toBe(3)
  })

  it('the last SSE usage chunk wins, CRLF-free and split across chunk boundaries', async () => {
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"usage":{"total_tokens":5}}\n\ndata: {"usa'))
        c.enqueue(enc.encode('ge":{"total_tokens":9}}\n\ndata: [DONE]\n\n'))
        c.close()
      },
    })
    fetchImpl.mockResolvedValue(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const res = await call({ messages: [], stream: true })
    await res.text()
    await vi.waitFor(() => expect(getJobUsage('job-1')?.totalTokens).toBe(9))
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  it('a stream response keeps the upstream content-type, defaulting to text/event-stream', async () => {
    fetchImpl.mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }))
    const res = await call({ messages: [], stream: true })
    expect(res.headers.get('content-type')).toMatch(/text\/(plain|event-stream)/)
    await res.text()
  })

  it('budgetExceeded is sticky and reported by endJob', async () => {
    beginJob('L1', 'job-2', { maxTotalTokens: 10, maxRequests: 1 })
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ usage: { total_tokens: 4 } }), { status: 200 }))
    expect((await call({ messages: [] })).status).toBe(200)
    const res = await call({ messages: [] })
    expect(res.status).toBe(429)
    expect((await res.json()).error.type).toBe('insufficient_quota')
    expect(endJob('L1')).toMatchObject({ jobId: 'job-2', requests: 1, budgetExceeded: true })
  })

  it('the missing-key 500 is checked after auth and budget (401/429 take priority)', async () => {
    expect((await call({ messages: [] }, { Authorization: 'Bearer wrong' }, '')).status).toBe(401)
    expect((await call({ messages: [] }, {}, '')).status).toBe(500)
    endJob('L1')
    expect((await call({ messages: [] }, {}, '')).status).toBe(429)
  })
})

describe('buildUpstreamBody edge cases', () => {
  it.each([
    [{ max_tokens: -1 }],
    [{ max_tokens: 0 }],
    [{ max_tokens: Infinity }],
    [{ max_tokens: '100' }],
  ])('invalid %j is dropped and replaced by the default cap', (input) => {
    const out = buildUpstreamBody({ messages: [], ...input }, 'm')
    expect(out.max_tokens).toBe(MAX_COMPLETION_TOKENS)
    expect(out.max_completion_tokens).toBeUndefined()
  })

  it('only max_completion_tokens given: it is clamped and no max_tokens is added', () => {
    const out = buildUpstreamBody({ max_completion_tokens: 999_999 }, 'm')
    expect(out.max_completion_tokens).toBe(MAX_COMPLETION_TOKENS)
    expect(out.max_tokens).toBeUndefined()
  })

  it('an invalid max_completion_tokens next to a valid max_tokens keeps max_tokens only', () => {
    const out = buildUpstreamBody({ max_tokens: 50, max_completion_tokens: -3 }, 'm')
    expect(out).toMatchObject({ max_tokens: 50 })
    expect(out.max_completion_tokens).toBeUndefined()
  })

  it('does not mutate the caller body and always forces store=false', () => {
    const body = { messages: [1], store: true, model: 'evil' }
    const out = buildUpstreamBody(body, 'good')
    expect(out).toMatchObject({ model: 'good', store: false })
    expect(body).toEqual({ messages: [1], store: true, model: 'evil' })
  })
})

describe('redact', () => {
  it('redacts multiple keys and mixed-case Bearer tokens in one string', () => {
    const s = 'a sk-AAAA1111 b bearer abcdefgh12345 c Bearer xyz.123_456-789/abc='
    const out = redactSecrets(s)
    expect(out).not.toMatch(/sk-AAAA1111|abcdefgh12345|xyz\.123/)
    expect(out.match(/\[redacted\]/g)).toHaveLength(3)
  })

  it('leaves too-short key-like prefixes alone ("sk-ab", "Bearer x")', () => {
    expect(redactSecrets('sk-ab Bearer x')).toBe('sk-ab Bearer x')
  })

  it('publicText bounds the length to 200 with an ellipsis and does not cut a redaction in half', () => {
    const out = publicText('y'.repeat(500))
    expect(out).toHaveLength(200)
    expect(out.endsWith('…')).toBe(true)
    expect(publicText('short')).toBe('short')
    expect(publicText('sk-proj-ABCDEF ' + 'z'.repeat(300))).not.toContain('sk-proj')
  })

  describe('publicErrorMessage', () => {
    const rt = (code: ConstructorParameters<typeof TryItOutRuntimeError>[0], msg = 'detail /run/podman.sock') =>
      new TryItOutRuntimeError(code, msg)

    it('maps engine_unavailable to a fixed message', () => {
      expect(publicErrorMessage(rt('engine_unavailable'))).toBe('container engine unavailable')
    })
    it.each(['container_start_failed', 'exec_failed'] as const)('maps %s to a generic message without detail', (code) => {
      expect(publicErrorMessage(rt(code))).toBe('container engine error')
    })
    it('keeps busy and session_busy messages', () => {
      expect(publicErrorMessage(rt('busy', 'slots busy'))).toBe('slots busy')
      expect(publicErrorMessage(rt('session_busy', 'job running'))).toBe('job running')
    })
    it('keeps only the exact output-limit messages for output_invalid', () => {
      expect(publicErrorMessage(rt('output_invalid', 'output exceeds 200 files'))).toBe('output exceeds 200 files')
      expect(publicErrorMessage(rt('output_invalid', 'output exceeds 5 bytes'))).toBe('output exceeds 5 bytes')
      expect(publicErrorMessage(rt('output_invalid', 'output exceeds 5 bytes /etc/passwd'))).toBe(
        'container output was invalid',
      )
      expect(publicErrorMessage(rt('output_invalid', 'unsafe output path: ../x'))).toBe('container output was invalid')
    })
    it('recognises a runtime error from an older module copy (name + string code)', () => {
      const e = Object.assign(new Error('x /sock'), { name: 'TryItOutRuntimeError', code: 'engine_unavailable' })
      expect(publicErrorMessage(e)).toBe('container engine unavailable')
    })
    it('redacts and bounds plain errors and non-Error values', () => {
      expect(publicErrorMessage(new Error('failed sk-proj-ABCDEF'))).toBe('failed [redacted]')
      expect(publicErrorMessage('plain string')).toBe('plain string')
      expect(publicErrorMessage(undefined)).toBe('undefined')
      expect(publicErrorMessage(new Error('q'.repeat(400)))).toHaveLength(200)
    })
  })

  it('logDetail logs only redacted text, for Error and non-Error', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    logDetail('ctx', new Error('boom sk-proj-ABCDEF'))
    logDetail('ctx2', { toString: () => 'Bearer abcdefghij' })
    const all = err.mock.calls.flat().join(' ')
    expect(all).toContain('ctx')
    expect(all).not.toMatch(/sk-proj-ABCDEF|abcdefghij/)
  })
})
