import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetProxy,
  beginJob,
  getJobUsage,
  registerLeaseToken,
} from '$lib/server/tryitout/llmProxy.js'
import { POST } from './+server'

// A developer's real .env (OPENAI_API_KEY) must never leak into these tests: the route reads
// `env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY`, so keep SvelteKit's dynamic env empty and
// let each test control process.env alone.
vi.mock('$env/dynamic/private', () => ({ env: {} }))

const SSE =
  'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
  'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}\n\n' +
  'data: [DONE]\n\n'

function sseResponse(): Response {
  const bytes = new TextEncoder().encode(SSE)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 20))
      controller.enqueue(bytes.slice(20))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('POST /api/llm/v1/chat/completions', () => {
  const fetchMock = vi.fn()
  const prevKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    __resetProxy()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => sseResponse())
    vi.stubGlobal('fetch', fetchMock)
    process.env.OPENAI_API_KEY = 'sk-real'
    delete process.env.PI_LLM_UPSTREAM_URL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = prevKey
  })

  it('injects the real key, forces model and streams bytes unchanged', async () => {
    const token = registerLeaseToken('lease-1')
    beginJob('lease-1', 'job-1', { maxTotalTokens: 1000, maxRequests: 5 })
    const request = new Request('http://localhost/api/llm/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'whatever',
        stream: true,
        messages: [{ role: 'user', content: 'x' }],
        tools: [{ type: 'function', function: { name: 'read' } }],
      }),
    })
    const res = await POST({ request } as Parameters<typeof POST>[0])

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const text = await res.text()
    expect(text).toBe(SSE)
    expect(text).not.toContain('sk-real')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-real')
    const sent = JSON.parse(init.body)
    expect(sent.model).toBe('gpt-4.1-mini')
    expect(sent.store).toBe(false)
    expect(sent.stream_options.include_usage).toBe(true)
    expect(sent.tools).toHaveLength(1)

    await vi.waitFor(() => expect(getJobUsage('job-1')?.totalTokens).toBe(18))
    expect(getJobUsage('job-1')?.requests).toBe(1)
  })

  it('importing the route with no key set does not throw', async () => {
    delete process.env.OPENAI_API_KEY
    vi.resetModules()
    await expect(import('./+server')).resolves.toBeDefined()
  })
})
