import { describe, it, expect } from 'vitest'
import { runTier3Check, type SpecialCtx } from './tier3Checks'
import { withMock } from '../mock/testing'
import type { ToolCaller, ToolInfo, ToolOutcome } from './types'

const ok = (body: unknown): ToolOutcome => ({
  kind: 'result',
  isError: false,
  text: typeof body === 'string' ? body : JSON.stringify(body),
  content: []
})
const err = (text: string): ToolOutcome => ({ kind: 'result', isError: true, text, content: [] })

const caller = (tools: ToolInfo[], fn: (name: string, args: Record<string, unknown>) => Promise<ToolOutcome> | ToolOutcome): ToolCaller => ({
  tools,
  call: async (name, args) => fn(name, args)
})

const fetchJson = async (url: string): Promise<ToolOutcome> => {
  const r = await fetch(url)
  const text = await r.text()
  return r.ok ? ok(text) : err(text)
}

const noMock = {
  url: '',
  log: () => [],
  hits: () => 0,
  inject: () => {},
  clearFaults: () => {},
  reset: () => {}
}

const baseCtx = (c: ToolCaller, over: Partial<SpecialCtx> = {}): SpecialCtx => ({
  caller: c,
  mock: noMock,
  bind: (kind) => ({ tool: c.tools[0]?.name, args: {}, boundBy: 'explicit' }),
  config: {},
  ...over
})

describe('grounding', () => {
  const tools: ToolInfo[] = [{ name: 'list_widgets' }, { name: 'get_widget' }]
  const table = { list_widgets: 'GET /widgets', get_widget: 'GET /widgets/{id}' }
  const spec = { datasets: ['docs' as const], documentedRoutes: ['/widgets', '/widgets/:id'] }

  it('passes when every tool is traced and only documented routes are hit', async () => {
    await withMock(spec, async (m) => {
      const c = caller(tools, (n, a) => fetchJson(n === 'list_widgets' ? `${m.url}/widgets` : `${m.url}/widgets/${a.id}`))
      const r = await runTier3Check('grounding', baseCtx(c, { mock: m, config: { traceTable: table, toolArgs: { get_widget: { id: 'WID-0001' } } } }))
      expect(r).toHaveLength(1)
      expect(r[0]).toMatchObject({ id: 'grounding', dimension: 'D3', status: 'PASS' })
    })
  })

  it('fails a tool without a documented operation', async () => {
    const r = await runTier3Check('grounding', baseCtx(caller(tools, () => ok({})), { config: { traceTable: { list_widgets: 'GET /widgets' } } }))
    expect(r[0].status).toBe('FAIL')
    expect(r[0].reason).toMatch(/untraceable tool: get_widget/)
  })

  it('fails when a tool calls an undocumented route and names it', async () => {
    await withMock(spec, async (m) => {
      const c = caller(tools, (n) => fetchJson(n === 'list_widgets' ? `${m.url}/widgets` : `${m.url}/widgets/w1/history`))
      const r = await runTier3Check('grounding', baseCtx(c, { mock: m, config: { traceTable: table } }))
      expect(r[0].status).toBe('FAIL')
      expect(r[0].reason).toMatch(/undocumented route called: GET \/widgets\/w1\/history/)
    })
  })
})

describe('profile', () => {
  const tools: ToolInfo[] = [
    { name: 'list_widgets', description: 'Lists widgets' },
    { name: 'getWidget', description: '' }
  ]
  const run = (profile: unknown) => runTier3Check('profile', baseCtx(caller(tools, () => ok({})), { config: { profile } }))

  it('returns one D3 result per item', async () => {
    const r = await run({ requiredTools: ['list_widgets', 'get_widget'], namePattern: '^[a-z_]+$', requireDescriptions: true })
    expect(r.map((x) => x.id)).toEqual(['profile.required_tools', 'profile.naming', 'profile.descriptions'])
    expect(r.every((x) => x.dimension === 'D3' && x.status === 'FAIL')).toBe(true)
    expect(r[0].reason).toMatch(/get_widget/)
    expect(r[1].reason).toMatch(/getWidget/)
    expect(r[2].reason).toMatch(/getWidget/)
  })

  it('passes a conforming profile and reports NA for unconfigured items', async () => {
    const good: ToolInfo[] = [{ name: 'list_widgets', description: 'd' }]
    const r = await runTier3Check('profile', baseCtx(caller(good, () => ok({})), { config: { profile: { requiredTools: ['list_widgets'] } } }))
    expect(r.map((x) => x.status)).toEqual(['PASS', 'NA', 'NA'])
  })

  it('reports an invalid pattern as ERROR without throwing', async () => {
    const r = await run({ namePattern: '(' })
    expect(r[1].status).toBe('ERROR')
  })
})

describe('composite', () => {
  const tools: ToolInfo[] = [{ name: 'assemble_composite' }]
  const cfg = { expectedKeys: ['mass_g', 'parts'] }

  const withBoth = async (fn: (a: import('../mock/spec').MockHandle, b: import('../mock/spec').MockHandle) => Promise<void>) =>
    withMock({ datasets: ['components'] }, (a) => withMock({ datasets: ['products'] }, (b) => fn(a, b), { label: 'B' }), { label: 'A' })

  const assemble =
    (a: { url: string }, b: { url: string }, onBFail: (detail: string) => ToolOutcome): ToolCaller['call'] =>
    async () => {
      const ra = await fetch(`${a.url}/components/CMP-0001`)
      let rb: Response
      try {
        rb = await fetch(`${b.url}/assemblies/CMP-0001`)
      } catch {
        return onBFail('connection reset')
      }
      if (!rb.ok) return onBFail('status')
      return ok({ ...(await ra.json()), ...(await rb.json()) })
    }

  it('passes for a joined result and an honest partial notice when B is down', async () => {
    await withBoth(async (a, b) => {
      const c = caller(tools, assemble(a, b, () => ok('Partial result: assembly backend unavailable')))
      const r = await runTier3Check('composite', baseCtx(c, { mock: a, mockB: b, config: cfg }))
      expect(r[0]).toMatchObject({ id: 'composite', dimension: 'D2', status: 'PASS' })
    })
  })

  it('accepts a clean error when B is down', async () => {
    await withBoth(async (a, b) => {
      const c = caller(tools, assemble(a, b, () => err('Assembly service could not be reached.')))
      const r = await runTier3Check('composite', baseCtx(c, { mock: a, mockB: b, config: cfg }))
      expect(r[0].status).toBe('PASS')
    })
  })

  it('fails a confident answer with no partial notice', async () => {
    await withBoth(async (a, b) => {
      const c = caller(tools, assemble(a, b, () => ok({ mass_g: 1, parts: 1 })))
      const r = await runTier3Check('composite', baseCtx(c, { mock: a, mockB: b, config: cfg }))
      expect(r[0].status).toBe('FAIL')
      expect(r[0].reason).toMatch(/confident answer/)
    })
  })

  it('fails and flags a leak when B is down', async () => {
    await withBoth(async (a, b) => {
      const c = caller(tools, assemble(a, b, () => err('Traceback (most recent call last): boom')))
      const r = await runTier3Check('composite', baseCtx(c, { mock: a, mockB: b, config: cfg }))
      expect(r[0].status).toBe('FAIL')
      expect(r[0].flags?.[0].id).toBe('LEAK')
    })
  })

  it('fails when the joined result lacks backend fields', async () => {
    await withBoth(async (a, b) => {
      const c = caller(tools, async () => ok({ mass_g: 5 }))
      const r = await runTier3Check('composite', baseCtx(c, { mock: a, mockB: b, config: cfg }))
      expect(r[0].status).toBe('FAIL')
      expect(r[0].reason).toMatch(/both backends/)
    })
  })

  it('returns ERROR when unbound ambiguous, FAIL when no tool, ERROR without mockB', async () => {
    const c = caller(tools, () => ok({}))
    const amb = await runTier3Check('composite', baseCtx(c, { bind: () => ({ args: {}, boundBy: 'none', error: 'ambiguous binding' }) }))
    expect(amb[0].status).toBe('ERROR')
    const none = await runTier3Check('composite', baseCtx(c, { bind: () => ({ args: {}, boundBy: 'none' }) }))
    expect(none[0]).toMatchObject({ status: 'FAIL', reason: 'no tool' })
    const nob = await runTier3Check('composite', baseCtx(c, { config: cfg }))
    expect(nob[0].status).toBe('ERROR')
  })
})

describe('large_response', () => {
  const tools: ToolInfo[] = [{ name: 'list_category_items' }]
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ACM-${i}`, name: `Acme item ${i}` }))
  const run = (out: ToolOutcome, config: Record<string, unknown> = {}) =>
    runTier3Check('large_response', baseCtx(caller(tools, () => out), { config }))

  it('passes a capped result with a truncation signal (structured or text)', async () => {
    const a = await run({ kind: 'result', isError: false, text: 'ok', structured: { items: items(50), truncated: true }, content: [] })
    expect(a[0]).toMatchObject({ dimension: 'D4', status: 'PASS' })
    expect(a[0].reason).toMatch(/bytes\/4/)
    const b = await run(ok(JSON.stringify({ items: items(50) }) + ' Showing 50 of 5000, more results available'))
    expect(b[0].status).toBe('PASS')
  })

  it('fails a silent cap', async () => {
    const r = await run(ok({ items: items(50) }))
    expect(r[0].status).toBe('FAIL')
    expect(r[0].reason).toMatch(/silent cap/)
  })

  it('passes when everything is shown (total within shown)', async () => {
    const r = await run(ok({ items: items(10), total: 10 }))
    expect(r[0].status).toBe('PASS')
  })

  it('fails on too many items or too many bytes', async () => {
    const many = await run(ok({ items: items(500), total: 500, note: 'truncated' }))
    expect(many[0].reason).toMatch(/500 items > 100/)
    const big = await run(ok({ items: items(5), total: 5, pad: 'x'.repeat(70000) }))
    expect(big[0].reason).toMatch(/bytes > 65536/)
    const cfg = await run(ok({ items: items(5), total: 5 }), { maxBytes: 50 })
    expect(cfg[0].status).toBe('FAIL')
  })

  it('fails on error outcomes and non-results without throwing', async () => {
    expect((await run(err('boom')))[0].status).toBe('FAIL')
    expect((await run({ kind: 'transport_error', message: 'x' }))[0].status).toBe('FAIL')
  })

  it('never throws when the caller throws', async () => {
    const c: ToolCaller = { tools, call: async () => { throw new Error('kaput') } }
    const r = await runTier3Check('large_response', baseCtx(c))
    expect(r[0].status).toBe('FAIL')
  })

  it('redacts and caps reasons', async () => {
    const r = await runTier3Check(
      'large_response',
      baseCtx(caller(tools, () => ok({ items: items(500), total: 500 })), { redact: (s) => s.replace(/items/g, '[r]') + 'y'.repeat(400) })
    )
    expect(r[0].reason.length).toBeLessThanOrEqual(200)
    expect(r[0].reason).not.toMatch(/items/)
  })
})
