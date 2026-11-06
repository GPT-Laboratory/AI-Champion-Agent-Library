import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const row = (slug: string) => ({
  slug, title: slug, summary: 's', llmName: 'gpt-4o', toolNames: '[]', inputSchema: '[]', tags: '[]', category: null, maturityStatus: 'beta',
})

vi.mock('$lib/server/db.js', () => ({
  db: { select: vi.fn(), selectDistinct: vi.fn() },
  agents: { slug: 'slug', title: 'title', llmName: 'llm_name', category: 'category', maturityStatus: 'm' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(), and: vi.fn(), asc: vi.fn(), inArray: vi.fn(),
}))
vi.mock('$lib/server/search/index.js', () => ({ search: vi.fn() }))

async function runLoad(search: string) {
  const { db } = await import('$lib/server/db.js')
  const chain = {
    from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(), offset: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([row('a'), row('b')]),
  }
  ;(db.select as any).mockImplementation(() => chain)
  ;(db.selectDistinct as any).mockReturnValue({
    from: vi.fn().mockReturnThis(),
    all: vi.fn().mockReturnValue([{ category: null, llmName: 'gpt-4o', maturityStatus: 'beta' }]),
  })
  const { load } = await import('./+page.server.js')
  return (await load({ url: new URL(`http://localhost/catalog${search}`) } as any)) as Record<string, any>
}

const BASE_KEYS = ['agents', 'categories', 'filters', 'llms', 'maturityStatuses', 'page', 'pageSize', 'searchDegraded', 'total', 'totalPages']

beforeEach(() => {
  vi.stubEnv('AGENT_KINDS', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('catalog load with AGENT_COMPARE', () => {
  it('flag off: loader keys are exactly the pre-existing ones, ?compare is ignored', async () => {
    vi.stubEnv('AGENT_COMPARE', '')
    const r = await runLoad('?compare=a,b')
    expect(Object.keys(r).sort()).toEqual([...BASE_KEYS].sort())
  })
  it('flag on: adds compareEnabled and validated compare slugs only', async () => {
    vi.stubEnv('AGENT_COMPARE', '1')
    const r = await runLoad('?compare=a,b,../x,c,d')
    expect(Object.keys(r).sort()).toEqual([...BASE_KEYS, 'compare', 'compareEnabled'].sort())
    expect(r.compare).toEqual(['a', 'b', 'c'])
    expect(r.compareEnabled).toBe(true)
  })
})
