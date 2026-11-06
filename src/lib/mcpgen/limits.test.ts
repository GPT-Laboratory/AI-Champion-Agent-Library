// D-465: per-client rate limit and concurrency cap for /api/mcp-generate, with a fake clock.
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createGeneratorGate, generatorLimitConfig, __setGeneratorGateForTests } from './limits'
import { POST } from '../../routes/api/mcp-generate/+server'

describe('generatorLimitConfig', () => {
  it('has conservative defaults: 20 per 10 minutes per client, 2 concurrent', () => {
    expect(generatorLimitConfig({})).toEqual({ rateMax: 20, windowMs: 600_000, maxConcurrent: 2 })
  })
  it('reads the three environment variables and ignores junk', () => {
    expect(generatorLimitConfig({ MCP_GENERATOR_RATE_MAX: '5', MCP_GENERATOR_RATE_WINDOW_SEC: '30', MCP_GENERATOR_MAX_CONCURRENT: '1' })).toEqual({
      rateMax: 5,
      windowMs: 30_000,
      maxConcurrent: 1,
    })
    expect(generatorLimitConfig({ MCP_GENERATOR_RATE_MAX: 'abc', MCP_GENERATOR_RATE_WINDOW_SEC: '-4', MCP_GENERATOR_MAX_CONCURRENT: '1.5' })).toEqual({
      rateMax: 20,
      windowMs: 600_000,
      maxConcurrent: 2,
    })
  })
})

describe('createGeneratorGate', () => {
  it('limits per client in a sliding window and frees slots as the clock advances', () => {
    let t = 0
    const g = createGeneratorGate({ rateMax: 2, windowMs: 1000, maxConcurrent: 0 }, () => t)
    for (const [c, ok] of [['a', true], ['a', true], ['a', false], ['b', true]] as const) {
      const r = g.admit(c)
      expect(r.ok).toBe(ok)
      if (r.ok) r.release()
      else expect(r).toEqual({ ok: false, reason: 'rate' })
    }
    t = 999
    expect(g.admit('a').ok).toBe(false)
    t = 1000
    expect(g.admit('a').ok).toBe(true)
  })

  it('caps concurrency, releases once, and a refused request records nothing', () => {
    const g = createGeneratorGate({ rateMax: 3, windowMs: 1000, maxConcurrent: 2 }, () => 0)
    const a = g.admit('a')
    const b = g.admit('b')
    expect([a.ok, b.ok]).toEqual([true, true])
    expect(g.admit('c')).toEqual({ ok: false, reason: 'busy' })
    expect(g.inFlight()).toBe(2)
    if (a.ok) {
      a.release()
      a.release() // idempotent
    }
    expect(g.inFlight()).toBe(1)
    // 'c' was refused as busy, so its rate budget is untouched: three admissions still fit.
    const c1 = g.admit('c')
    expect(c1.ok).toBe(true)
    if (c1.ok) c1.release()
    if (b.ok) b.release()
    expect(g.inFlight()).toBe(0)
  })

  it('0 means unlimited', () => {
    const g = createGeneratorGate({ rateMax: 0, windowMs: 1000, maxConcurrent: 0 }, () => 0)
    for (let i = 0; i < 100; i++) expect(g.admit('a').ok).toBe(true)
  })
})

describe('POST /api/mcp-generate gate', () => {
  const input = readFileSync(new URL('./testing/fixtures/acme-openapi.yaml', import.meta.url), 'utf8')
  const call = (addr: string | undefined) =>
    POST({
      request: new Request('http://x/api/mcp-generate', { method: 'POST', body: JSON.stringify({ input }) }),
      getClientAddress: addr === undefined ? undefined : () => addr,
    } as never) as Promise<Response>

  afterEach(() => {
    __setGeneratorGateForTests(null)
    delete process.env.MCP_GENERATOR
  })

  it('flag off is still a 404 first, even when the gate is exhausted', async () => {
    __setGeneratorGateForTests(createGeneratorGate({ rateMax: 1, windowMs: 1000, maxConcurrent: 1 }, () => 0))
    await expect(call('1.1.1.1')).rejects.toMatchObject({ status: 404 })
    process.env.MCP_GENERATOR = '1'
    expect((await call('1.1.1.1')).status).toBe(200)
  })

  it('429 { message } over the rate; another client is unaffected; the window reopens', async () => {
    process.env.MCP_GENERATOR = '1'
    let t = 0
    __setGeneratorGateForTests(createGeneratorGate({ rateMax: 2, windowMs: 1000, maxConcurrent: 2 }, () => t))
    expect((await call('1.1.1.1')).status).toBe(200)
    expect((await call('1.1.1.1')).status).toBe(200)
    const limited = await call('1.1.1.1')
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ message: 'Too many generation requests from this client, try again later.' })
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect((await call('2.2.2.2')).status).toBe(200)
    t = 1000
    expect((await call('1.1.1.1')).status).toBe(200)
  })

  it('429 { message } when the concurrency cap is held, and releases after a request finishes', async () => {
    process.env.MCP_GENERATOR = '1'
    const gate = createGeneratorGate({ rateMax: 0, windowMs: 1000, maxConcurrent: 1 }, () => 0)
    __setGeneratorGateForTests(gate)
    const held = gate.admit('x')
    expect(held.ok).toBe(true)
    const busy = await call('3.3.3.3')
    expect(busy.status).toBe(429)
    expect(await busy.json()).toEqual({ message: 'The generator is busy. Try again in a moment.' })
    if (held.ok) held.release()
    expect((await call('3.3.3.3')).status).toBe(200)
    expect(gate.inFlight()).toBe(0)
  })

  it('releases the slot when the request is rejected or fails', async () => {
    process.env.MCP_GENERATOR = '1'
    const gate = createGeneratorGate({ rateMax: 0, windowMs: 1000, maxConcurrent: 1 }, () => 0)
    __setGeneratorGateForTests(gate)
    const bad = (await POST({ request: new Request('http://x/api/mcp-generate', { method: 'POST', body: 'nope' }) } as never)) as Response
    expect(bad.status).toBe(400)
    expect(gate.inFlight()).toBe(0)
  })

  it('a missing client address does not crash (shared "unknown" bucket)', async () => {
    process.env.MCP_GENERATOR = '1'
    __setGeneratorGateForTests(createGeneratorGate({ rateMax: 1, windowMs: 1000, maxConcurrent: 2 }, () => 0))
    expect((await call(undefined)).status).toBe(200)
    expect((await call(undefined)).status).toBe(429)
  })
})
