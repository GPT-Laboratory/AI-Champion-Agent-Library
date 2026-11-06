import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/server/search/index.js', () => ({ search: vi.fn() }))

import { search } from '$lib/server/search/index.js'
import { GET } from './+server.js'

const mockSearch = search as unknown as ReturnType<typeof vi.fn>

function call(qs: string) {
  return GET({ url: new URL(`http://localhost/api/search${qs}`) } as Parameters<typeof GET>[0])
}

describe('GET /api/search', () => {
  beforeEach(() => mockSearch.mockReset())

  it('returns ranked results and mode', async () => {
    mockSearch.mockResolvedValue({ results: [{ slug: 'a', score: 2, extra: 1 }], mode: 'bm25' })
    const res = await call('?q=sql')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [{ slug: 'a', score: 2 }], mode: 'bm25' })
  })

  it('trims and caps q at 200 chars', async () => {
    mockSearch.mockResolvedValue({ results: [], mode: 'bm25' })
    await call(`?q=${encodeURIComponent('  ' + 'x'.repeat(300))}`)
    expect(mockSearch).toHaveBeenCalledWith('x'.repeat(200))
  })

  it('returns mode none for blank or missing q without searching', async () => {
    for (const qs of ['', '?q=', '?q=%20%20']) {
      const res = await call(qs)
      expect(await res.json()).toEqual({ results: [], mode: 'none' })
    }
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('returns 500 when search throws', async () => {
    // Throw from inside the handler's try block (a throwing mock itself trips vitest here).
    mockSearch.mockResolvedValue({
      get results(): never {
        throw new Error('boom')
      },
      mode: 'bm25',
    })
    const res = await call('?q=sql')
    expect(res.status).toBe(500)
    expect(JSON.parse(await res.text())).toEqual({ message: 'Search failed.' })
  })
})
