// CR-50: a concurrency slot is taken only for the pipeline, not while the request body is still being read.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { __setGeneratorGateForTests, createGeneratorGate, generatorLimitConfig } from '$lib/mcpgen/limits'
import { POST } from './+server'

const fx = (n: string) => readFileSync(new URL(`../../../lib/mcpgen/testing/fixtures/${n}`, import.meta.url), 'utf8')
let prev: string | undefined
beforeEach(() => {
  prev = process.env.MCP_GENERATOR
  process.env.MCP_GENERATOR = '1'
})
afterEach(() => {
  __setGeneratorGateForTests(null)
  if (prev === undefined) delete process.env.MCP_GENERATOR
  else process.env.MCP_GENERATOR = prev
})

describe('retry-after (CR-59)', () => {
  it('says how long the rate window really is', async () => {
    const gate = createGeneratorGate({ maxConcurrent: 5, rateMax: 1, windowMs: 600_000 })
    __setGeneratorGateForTests(gate)
    const post = () =>
      POST({ request: new Request('http://x/api/mcp-generate', { method: 'POST', body: JSON.stringify({ input: fx('acme-openapi.yaml') }) }), getClientAddress: () => '10.0.0.5' } as never) as Promise<Response>
    expect((await post()).status).toBe(200)
    const limited = await post()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe(String(Math.ceil(generatorLimitConfig().windowMs / 1000)))
  })
})

describe('POST /api/mcp-generate slot handling (CR-50)', () => {
  it('a client that never finishes its body does not occupy the only slot', async () => {
    __setGeneratorGateForTests(createGeneratorGate({ maxConcurrent: 1, rateMax: 100, windowMs: 60_000 }))
    const stalled = new ReadableStream<Uint8Array>({ start() {} })
    const slow = POST({ request: new Request('http://x/api/mcp-generate', { method: 'POST', body: stalled, duplex: 'half' } as RequestInit), getClientAddress: () => '10.0.0.1' } as never)
    void Promise.resolve(slow).catch(() => {})
    const res = (await POST({
      request: new Request('http://x/api/mcp-generate', { method: 'POST', body: JSON.stringify({ input: fx('acme-openapi.yaml') }) }),
      getClientAddress: () => '10.0.0.2',
    } as never)) as Response
    expect(res.status).toBe(200)
  })
  it('still answers 429 busy when the slot is taken by a running pipeline', async () => {
    const gate = createGeneratorGate({ maxConcurrent: 1, rateMax: 100, windowMs: 60_000 })
    __setGeneratorGateForTests(gate)
    const held = gate.admit('10.0.0.9')
    expect(held.ok).toBe(true)
    const res = (await POST({
      request: new Request('http://x/api/mcp-generate', { method: 'POST', body: JSON.stringify({ input: fx('acme-openapi.yaml') }) }),
      getClientAddress: () => '10.0.0.2',
    } as never)) as Response
    expect(res.status).toBe(429)
    if (held.ok) held.release()
  })
})
