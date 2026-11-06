import { describe, it, expect } from 'vitest'
import { McpClient } from '../core/client'
import { httpChannel } from '../core/transports/streamableHttp'
import { TOOL_NAMES, ENV_VARS } from '../mock/contract'
import { catalogItems, codesDataset, KNOWN_ITEM_ID, MISSING_ITEM_ID } from '../mock/datasets'
import { withMock } from '../mock/testing'
const noSleep = async () => {}
import { CANARY, envelopeLeak, FAKE_SPEC as SPEC, withFake } from './testing'
import { startHttpFake } from './httpFake'

type Out = Awaited<ReturnType<McpClient['callTool']>>
const res = (o: Out) => {
  if (o.kind !== 'result') throw new Error(`not a result: ${o.kind}`)
  return o
}
const sc = (o: Out) => res(o).structured as Record<string, unknown>

describe('good variant over real stdio framing', () => {
  it('initializes, lists every tool with a schema, answers ping and rejects unknown tools', async () => {
    await withFake('good', async (c) => {
      const names = c.tools.map((t) => t.name)
      for (const n of Object.values(TOOL_NAMES)) expect(names).toContain(n)
      expect(c.tools.every((t) => typeof t.inputSchema === 'object')).toBe(true)
      expect(names).not.toContain('delete_item')
      const o = await c.callTool('no_such_tool', {})
      expect(o).toMatchObject({ kind: 'rpc_error', code: -32602 })
      expect(c.findings).toEqual([])
    })
  })

  it('each hint regex binds exactly one good-variant tool', async () => {
    const { HINTS } = await import('../mock/contract')
    await withFake('good', async (c) => {
      for (const [kind, re] of Object.entries(HINTS)) {
        const rx = new RegExp(re, 'i')
        const n = c.tools.filter((t) => rx.test(t.name) || rx.test(t.description ?? '')).length
        if (['partition_filter', 'derived_filter', 'composite', 'i18n_codes', 'large_response', 'grounding', 'profile'].includes(kind)) {
          expect(n, kind).toBe(1)
        } else expect(n, kind).toBeGreaterThanOrEqual(1)
      }
    })
  })

  it('invalid arguments give an invalid_input tool result', async () => {
    await withFake('good', async (c) => {
      const o = await c.callTool(TOOL_NAMES.lookupItem, {})
      expect(res(o).isError).toBe(true)
      expect(sc(o)).toMatchObject({ ok: false, kind: 'invalid_input' })
    })
  })

  it('lookup returns the item with at most 12 fields; unknown id is a clean not_found', async () => {
    await withFake('good', async (c) => {
      const o = await c.callTool(TOOL_NAMES.lookupItem, { id: KNOWN_ITEM_ID })
      const item = sc(o).item as Record<string, unknown>
      expect(item.id).toBe(KNOWN_ITEM_ID)
      expect(Object.keys(item).length).toBeLessThanOrEqual(12)
      const miss = await c.callTool(TOOL_NAMES.lookupItem, { id: MISSING_ITEM_ID })
      expect(res(miss).isError).toBe(true)
      expect(sc(miss)).toMatchObject({ ok: false, kind: 'not_found' })
      expect(String(sc(miss).message)).toContain('not found')
      expect(envelopeLeak(res(miss).text)).toBe(false)
    })
  })

  it('alternate code lookup works', async () => {
    await withFake('good', async (c) => {
      const code = catalogItems(1).find((i) => i.id === KNOWN_ITEM_ID)!.code
      const o = await c.callTool(TOOL_NAMES.lookupItem, { code })
      expect((sc(o).item as Record<string, unknown>).id).toBe(KNOWN_ITEM_ID)
    })
  })

  it('empty search is ok with a message; oversize per_page is clamped and echoed', async () => {
    await withFake('good', async (c) => {
      const e = await c.callTool(TOOL_NAMES.searchItems, { q: 'zzzzqqqq' })
      expect(res(e).isError).toBe(false)
      expect(sc(e)).toMatchObject({ ok: true, items: [], message: 'No matching items found' })
      const big = await c.callTool(TOOL_NAMES.searchItems, { per_page: 250 })
      expect(sc(big).per_page).toBe(50)
      expect((sc(big).items as unknown[]).length).toBe(50)
    })
  })

  it('a wrong key gives an auth failure naming the API key', async () => {
    await withFake(
      'good',
      async (c) => {
        const o = await c.callTool(TOOL_NAMES.searchItems, { q: 'bearing' })
        expect(res(o).isError).toBe(true)
        expect(sc(o).kind).toBe('auth')
        expect(String(sc(o).message)).toContain('API key')
        expect(String(sc(o).message)).toContain('unauthorized')
        expect(envelopeLeak(res(o).text)).toBe(false)
      },
      { key: 'wrong-key-0000' }
    )
  })

  it('derived filter pages the mock and never sends an attribute parameter', async () => {
    await withFake('good', async (c, mock) => {
      const o = await c.callTool(TOOL_NAMES.findByAttribute, { attribute: 'Colour', value: 'Red' })
      const ids = (sc(o).items as { id: string }[]).map((i) => i.id).sort()
      const expected = catalogItems(1)
        .filter((i) => i.attributes.some((a) => a.key === 'Colour' && a.value === 'Red'))
        .map((i) => i.id)
        .sort()
      expect(expected.length).toBeGreaterThan(0)
      expect(ids).toEqual(expected)
      expect(mock.log().some((e) => 'attribute' in e.query || 'value' in e.query)).toBe(false)
      expect(mock.hits('/items')).toBeGreaterThan(1)
    })
  })

  it('retries 429 honouring Retry-After and succeeds on the third attempt', async () => {
    await withFake('good', async (c, mock) => {
      mock.inject({ route: '/items', fault: 'status', status: 429, times: 2, headers: { 'Retry-After': '0' } })
      const o = await c.callTool(TOOL_NAMES.searchItems, { q: 'bearing' })
      expect(res(o).isError).toBe(false)
      expect(mock.hits('/items')).toBe(3)
    })
  })

  it('persistent 500 gives three attempts then an honest upstream failure', async () => {
    await withFake('good', async (c, mock) => {
      mock.inject({ route: '/items', fault: 'status', status: 500, times: 99 })
      const o = await c.callTool(TOOL_NAMES.searchItems, { q: 'bearing' })
      expect(res(o).isError).toBe(true)
      expect(sc(o).kind).toBe('upstream')
      expect(mock.hits('/items')).toBe(3)
      expect(envelopeLeak(res(o).text)).toBe(false)
    })
  })

  it('a malformed upstream body is an upstream failure, never ok:true', async () => {
    await withFake('good', async (c, mock) => {
      mock.inject({ route: '/items', fault: 'malformed', mode: 'truncated_json', times: 1 })
      const o = await c.callTool(TOOL_NAMES.searchItems, { q: 'bearing' })
      expect(res(o).isError).toBe(true)
      expect(sc(o)).toMatchObject({ ok: false, kind: 'upstream' })
    })
  })

  it('a large category is bounded, flagged truncated and under 64 KiB', async () => {
    await withFake('good', async (c) => {
      const o = await c.callTool(TOOL_NAMES.listCategoryItems, { category: 'Bearings' })
      const s = sc(o)
      expect((s.items as unknown[]).length).toBeLessThanOrEqual(100)
      expect(s).toMatchObject({ truncated: true, total: 5000 })
      expect(s.shown).toBe((s.items as unknown[]).length)
      expect(res(o).text.length).toBeLessThan(64 * 1024)
    })
  })

  it('invalid GTIN is rejected before the upstream; a valid one resolves', async () => {
    await withFake('good', async (c, mock) => {
      const { valid, invalid } = codesDataset(1)
      const bad = await c.callTool(TOOL_NAMES.lookupByGtin, { gtin: invalid[0] })
      expect(sc(bad)).toMatchObject({ ok: false, kind: 'invalid_input' })
      expect(mock.hits('/products')).toBe(0)
      const good = await c.callTool(TOOL_NAMES.lookupByGtin, { gtin: valid[0].gtin })
      expect((sc(good).item as { name: string }).name).toBe(valid[0].name)
      expect(mock.hits('/products')).toBe(1)
    })
  })

  it('widgets and composite tools work and only documented routes are used', async () => {
    await withFake('good', async (c, mock) => {
      expect((sc(await c.callTool(TOOL_NAMES.listWidgets, {})).items as unknown[]).length).toBeGreaterThan(0)
      expect(res(await c.callTool(TOOL_NAMES.getWidget, { id: 'WGT-001' })).isError).toBe(false)
      const comp = sc(await c.callTool(TOOL_NAMES.assemble, { id: 'CMP-0001' })).item as Record<string, unknown>
      expect(comp.component).toBeTruthy()
      expect(comp.assembly).toBeTruthy()
      expect(mock.log().filter((e) => e.route === '(unmatched)')).toEqual([])
      expect(mock.log().every((e) => e.method === 'GET')).toBe(true)
    })
  })

  it('no good-variant output trips the 3-of-4 envelope rule and the canary never appears', async () => {
    await withFake('good', async (c, mock, stderr) => {
      const calls: [string, Record<string, unknown>][] = [
        [TOOL_NAMES.lookupItem, { id: KNOWN_ITEM_ID }],
        [TOOL_NAMES.lookupItem, { id: MISSING_ITEM_ID }],
        [TOOL_NAMES.searchItems, { q: 'bearing' }],
        [TOOL_NAMES.searchItems, { q: 'zzzzqqqq' }],
        [TOOL_NAMES.searchItems, { page: 9, per_page: 50 }],
        [TOOL_NAMES.listBySupplier, { supplier: 'SUP-001' }],
        [TOOL_NAMES.findByAttribute, { attribute: 'Colour', value: 'Red' }],
        [TOOL_NAMES.listCategoryItems, { category: 'Bearings' }],
        [TOOL_NAMES.listWidgets, {}],
        [TOOL_NAMES.lookupByGtin, { gtin: '123' }]
      ]
      for (const [n, a] of calls) {
        const t = res(await c.callTool(n, a)).text
        expect(envelopeLeak(t), `${n} ${JSON.stringify(a)}`).toBe(false)
        expect(t).not.toContain(CANARY)
      }
      expect(stderr.join('')).not.toContain(CANARY)
      void mock
    })
  })
})

describe('HTTP flavour', () => {
  it('serves /health and /mcp over Streamable HTTP', async () => {
    await withMock(SPEC, async (mock) => {
      const fake = await startHttpFake({
        variant: 'good',
        env: { [ENV_VARS.baseUrl]: mock.url, [ENV_VARS.baseUrlB]: mock.url, [ENV_VARS.apiKey]: CANARY },
        sleep: noSleep
      })
      const ch = httpChannel({ url: fake.url })
      const client = McpClient.connect(ch, { timeoutMs: 8000 })
      try {
        expect(await ch.healthCheck()).toMatchObject({ ok: true })
        expect((await client.initialize()).ok).toBe(true)
        expect((await client.listTools()).length).toBeGreaterThanOrEqual(9)
        const o = await client.callTool(TOOL_NAMES.lookupItem, { id: KNOWN_ITEM_ID })
        expect((sc(o).item as { id: string }).id).toBe(KNOWN_ITEM_ID)
      } finally {
        await client.close()
        await fake.close()
      }
    }, { apiKey: CANARY })
  })
})
