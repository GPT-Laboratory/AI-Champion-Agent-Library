import { describe, it, expect } from 'vitest'
import { request } from 'node:http'
import { connect } from 'node:net'
import { createMockUpstream } from './upstream'
import { withMock } from './testing'
import type { MockHandle } from './spec'
import type { MockView } from '../core/types'

const KEY = 'test-key-not-real'
const CAT: { datasets: ['catalog'] } = { datasets: ['catalog'] }

describe('basics', () => {
  it('binds loopback on an ephemeral port and serves routes', async () => {
    await withMock({ datasets: ['catalog', 'bulk', 'codes', 'docs', 'components', 'products'] }, async (m) => {
      expect(m.url).toBe(`http://127.0.0.1:${m.port}`)
      expect(m.port).toBeGreaterThan(0)
      const item = await (await fetch(`${m.url}/items/ACM-000042`)).json()
      expect(item.id).toBe('ACM-000042')
      expect(Object.keys(item).length).toBeGreaterThanOrEqual(20)
      expect((await fetch(`${m.url}/items/by-code/${item.code}`)).status).toBe(200)
      const miss = await fetch(`${m.url}/items/ACM-999999`)
      expect(miss.status).toBe(404)
      expect(await miss.json()).toEqual({ message: 'Item not found' })
      const empty = await (await fetch(`${m.url}/items?q=zzzzqqqq`)).json()
      expect(empty.items).toEqual([])
      expect(empty.total).toBe(0)
      const bulk = await (await fetch(`${m.url}/categories/any/items?limit=1000`)).json()
      expect(bulk.items).toHaveLength(1000)
      expect(bulk.next).toBe('1000')
      expect((await fetch(`${m.url}/vocabularies/colour`)).status).toBe(200)
      expect((await fetch(`${m.url}/widgets`)).status).toBe(200)
      expect((await fetch(`${m.url}/components/CMP-0001`)).status).toBe(200)
      expect((await fetch(`${m.url}/assemblies/CMP-0001`)).status).toBe(200)
      expect((await fetch(`${m.url}/health`)).status).toBe(200)
      expect((await fetch(`${m.url}/nope`)).status).toBe(404)
    })
  })

  it('products route validates the code checksum', async () => {
    await withMock({ datasets: ['codes'] }, async (m) => {
      const { codesDataset } = await import('./datasets')
      const c = codesDataset(1)
      expect((await fetch(`${m.url}/products/by-gtin/${c.valid[0].gtin}`)).status).toBe(200)
      expect((await fetch(`${m.url}/products/by-gtin/${c.invalid[0]}`)).status).toBe(400)
      expect(m.hits('/products')).toBe(2)
    })
  })

  it('rejects a non-loopback Host with 421', async () => {
    await withMock(CAT, async (m) => {
      const status = await new Promise<number>((resolve, reject) => {
        const r = request({ host: '127.0.0.1', port: m.port, path: '/health', headers: { Host: 'other.example' } }, (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        })
        r.on('error', reject)
        r.end()
      })
      expect(status).toBe(421)
    })
  })

  it('MockHandle is assignable to the core MockView', async () => {
    await withMock(CAT, async (m: MockHandle) => {
      const v: MockView = m
      expect(v.url).toBe(m.url)
    })
  })
})

describe('strictness', () => {
  it('rejects unknown query parameters including the nested-attribute name', async () => {
    await withMock(CAT, async (m) => {
      const r = await fetch(`${m.url}/items?attribute=Colour:Red`)
      expect(r.status).toBe(400)
      expect(await r.json()).toEqual({ message: 'Unknown parameter attribute' })
      expect((await fetch(`${m.url}/items/ACM-000042?foo=1`)).status).toBe(400)
    })
    await withMock({ ...CAT, rejectUnknownParams: false }, async (m) => {
      expect((await fetch(`${m.url}/items?attribute=Colour:Red`)).status).toBe(200)
    })
  })

  it('ceiling boundary and oversize per_page', async () => {
    await withMock({ ...CAT, maxPageSize: 50, ceiling: 200 }, async (m) => {
      expect((await fetch(`${m.url}/items?page=4&per_page=50`)).status).toBe(200)
      const over = await fetch(`${m.url}/items?page=5&per_page=50`)
      expect(over.status).toBe(500)
      expect(await over.text()).toContain('all shards failed')
      const big = await (await fetch(`${m.url}/items?per_page=120`)).json()
      expect(big.items).toHaveLength(120)
      expect((await fetch(`${m.url}/items?per_page=251`)).status).toBe(400)
    })
    await withMock({ ...CAT, ceiling: null }, async (m) => {
      expect((await fetch(`${m.url}/items?page=8&per_page=50`)).status).toBe(200)
    })
  })

  it('auth: wrong or missing key yields the legacy envelope, health exempt', async () => {
    for (const mode of ['401', '403'] as const) {
      await withMock(
        { ...CAT, auth: { header: 'X-Api-Key', mode } },
        async (m) => {
          const bad = await fetch(`${m.url}/items`, { headers: { 'X-Api-Key': 'wrong' } })
          expect(bad.status).toBe(Number(mode))
          const body = await bad.json()
          expect(Object.keys(body).sort()).toEqual(['error', 'path', 'status', 'timestamp'])
          expect((await fetch(`${m.url}/items`)).status).toBe(Number(mode))
          expect((await fetch(`${m.url}/items`, { headers: { 'X-Api-Key': KEY } })).status).toBe(200)
          expect((await fetch(`${m.url}/health`)).status).toBe(200)
        },
        { apiKey: KEY },
      )
    }
  })

  it('docs mode flags undocumented routes', async () => {
    await withMock({ datasets: ['docs', 'catalog'], documentedRoutes: ['/widgets', '/widgets/:id'] }, async (m) => {
      expect((await fetch(`${m.url}/widgets`)).status).toBe(200)
      expect((await fetch(`${m.url}/invented/thing`)).status).toBe(404)
      expect((await fetch(`${m.url}/items`)).status).toBe(404)
      const log = m.log()
      expect(log[0].undocumented).toBeUndefined()
      expect(log[1].undocumented).toBe(true)
      expect(log[2].undocumented).toBe(true)
    })
  })
})

describe('faults', () => {
  it('status 429 with Retry-After and envelope, then 503, then 500 text', async () => {
    await withMock(CAT, async (m) => {
      m.inject({ fault: 'status', status: 429, headers: { 'Retry-After': '1' }, envelope: true })
      const r = await fetch(`${m.url}/items`)
      expect(r.status).toBe(429)
      expect(r.headers.get('retry-after')).toBe('1')
      expect(Object.keys(await r.json()).sort()).toEqual(['error', 'path', 'status', 'timestamp'])
      m.inject({ fault: 'status', status: 503 })
      expect((await fetch(`${m.url}/items`)).status).toBe(503)
      m.inject({ fault: 'status', status: 500, envelope: true })
      expect((await fetch(`${m.url}/items`)).status).toBe(500)
      expect(m.log()[0].fault).toBe('status:429')
    })
  })

  it('latency delays the response', async () => {
    await withMock(CAT, async (m) => {
      m.inject({ fault: 'latency', ms: 80 })
      const t = Date.now()
      const r = await fetch(`${m.url}/items`)
      expect(Date.now() - t).toBeGreaterThanOrEqual(70)
      expect(r.status).toBe(200)
    })
  })

  it('timeout holds until the client aborts, and close() still resolves', async () => {
    await withMock(CAT, async (m) => {
      m.inject({ fault: 'timeout' })
      const ac = new AbortController()
      setTimeout(() => ac.abort(), 60)
      await expect(fetch(`${m.url}/items`, { signal: ac.signal })).rejects.toThrow()
    })
    // a held socket at close time must not block close()
    const m = await createMockUpstream(CAT)
    m.inject({ fault: 'timeout' })
    const p = fetch(`${m.url}/items`).catch(() => 'closed')
    await new Promise((r) => setTimeout(r, 30))
    await m.close()
    expect(await p).toBe('closed')
  })

  it('malformed modes', async () => {
    await withMock(CAT, async (m) => {
      m.inject({ fault: 'malformed', mode: 'truncated_json' })
      await expect((await fetch(`${m.url}/items`)).json()).rejects.toThrow()
      m.inject({ fault: 'malformed', mode: 'html' })
      const h = await fetch(`${m.url}/items`)
      expect(h.headers.get('content-type')).toContain('text/html')
      m.inject({ fault: 'malformed', mode: 'empty' })
      expect(await (await fetch(`${m.url}/items`)).text()).toBe('')
      m.inject({ fault: 'malformed', mode: 'wrong_content_type' })
      const w = await fetch(`${m.url}/items`)
      expect(w.headers.get('content-type')).toContain('text/plain')
      expect(JSON.parse(await w.text()).total).toBe(0)
      m.inject({ fault: 'malformed', mode: 'slow_drip', ms: 5 })
      const t = Date.now()
      const d = await fetch(`${m.url}/items`)
      expect(JSON.parse(await d.text()).total).toBe(0)
      expect(Date.now() - t).toBeGreaterThanOrEqual(60)
    })
  })

  it('reset surfaces a fetch error', async () => {
    await withMock(CAT, async (m) => {
      m.inject({ fault: 'reset' })
      await expect(fetch(`${m.url}/items`)).rejects.toThrow()
    })
  })

  it('huge returns at least the requested bytes', async () => {
    await withMock(CAT, async (m) => {
      m.inject({ fault: 'huge', bytes: 200_000 })
      const text = await (await fetch(`${m.url}/items`)).text()
      expect(text.length).toBeGreaterThanOrEqual(200_000)
      expect(() => JSON.parse(text)).not.toThrow()
    })
  })

  it('flapping: times 2 then success; log offsets increase; hits counts', async () => {
    let clock = 1000
    await withMock(
      CAT,
      async (m) => {
        m.inject({ fault: 'status', status: 503, times: 2, route: '/items' })
        const statuses: number[] = []
        for (let i = 0; i < 3; i++) {
          statuses.push((await fetch(`${m.url}/items`)).status)
          clock += 100
        }
        expect(statuses).toEqual([503, 503, 200])
        const log = m.log()
        expect(log.map((e) => e.tMs)).toEqual([0, 100, 200])
        expect(m.hits('/items')).toBe(3)
        expect(m.hits('/other')).toBe(0)
        expect(m.hits()).toBe(3)
      },
      { now: () => clock },
    )
  })

  it('clearFaults drops pending faults', async () => {
    await withMock(CAT, async (m) => {
      m.inject({ fault: 'status', status: 503, times: 5 })
      m.clearFaults()
      expect((await fetch(`${m.url}/items`)).status).toBe(200)
    })
  })
})

describe('log, determinism, lifecycle', () => {
  it('records header names, never values; raw path preserved; backend label', async () => {
    await withMock(
      CAT,
      async (m) => {
        const sentinel = 'SENTINEL-VALUE-12345'
        await fetch(`${m.url}/items/ACM%2D000042?x=1&x=2`, { headers: { 'X-Custom-Thing': sentinel } })
        const [e] = m.log()
        expect(e.headerNames).toContain('x-custom-thing')
        expect(e.rawPath).toBe('/items/ACM%2D000042')
        expect(e.query).toEqual({ x: ['1', '2'] })
        expect(e.route).toBe('/items/:id')
        expect(e.backend).toBe('A')
        expect(JSON.stringify(m.log())).not.toContain(sentinel)
      },
      { label: 'A' },
    )
  })

  it('same seed gives byte-identical responses; setSeed changes them; reset clears state', async () => {
    const get = (m: MockHandle) => fetch(`${m.url}/items?per_page=30`).then((r) => r.text())
    const a = await withMock({ ...CAT, seed: 3 }, get)
    const b = await withMock({ ...CAT, seed: 3 }, get)
    expect(a).toBe(b)
    await withMock({ ...CAT, seed: 3 }, async (m) => {
      m.setSeed(4)
      expect(await get(m)).not.toBe(a)
      m.inject({ fault: 'status', status: 503, times: 3 })
      m.reset()
      expect(m.log()).toEqual([])
      expect((await fetch(`${m.url}/items`)).status).toBe(200)
      expect(m.log()[0].tMs).toBe(0)
    })
  })

  it('close() releases the port', async () => {
    const m = await createMockUpstream(CAT)
    const { port } = m
    await m.close()
    await m.close()
    await expect(
      new Promise((resolve, reject) => {
        const s = connect(port, '127.0.0.1', () => {
          s.destroy()
          resolve('connected')
        })
        s.on('error', reject)
      }),
    ).rejects.toThrow()
  })
})
