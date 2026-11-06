import { describe, it, expect, vi, beforeEach } from 'vitest'

const flag = vi.hoisted(() => ({ on: false }))
const kindMocks = vi.hoisted(() => ({
  listSlugsByKind: vi.fn(),
  listKinds: vi.fn(),
  loadKindInfo: vi.fn(),
}))

const row = (slug: string, llmName = 'gpt-4o') => ({
  slug,
  title: slug,
  summary: 's',
  llmName,
  toolNames: '[]',
  inputSchema: '[]',
  tags: '[]',
  category: null,
  maturityStatus: 'beta',
})

vi.mock('$lib/server/db.js', () => ({
  db: { select: vi.fn(), selectDistinct: vi.fn() },
  agents: { slug: 'slug', title: 'title', llmName: 'llm_name', category: 'category', maturityStatus: 'm' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  asc: vi.fn((col) => ({ type: 'asc', col })),
  inArray: vi.fn((col, vals) => ({ type: 'inArray', col, vals })),
}))
vi.mock('$lib/server/search/index.js', () => ({ search: vi.fn() }))
vi.mock('$lib/flags.js', () => ({ agentKindsEnabled: () => flag.on }))
vi.mock('$lib/server/kinds.js', () => kindMocks)

type CatalogData = Record<string, any>

async function runLoad(search: string, rows = [row('a'), row('b')]) {
  const { db } = await import('$lib/server/db.js')
  const { inArray } = await import('drizzle-orm')
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockReturnValue(rows),
  }
  ;(db.select as any).mockImplementation(() => chain)
  ;(db.selectDistinct as any).mockReturnValue({
    from: vi.fn().mockReturnThis(),
    all: vi.fn().mockReturnValue([{ category: null, llmName: 'gpt-4o', maturityStatus: 'beta' }, { llmName: 'n/a' }]),
  })
  const { load } = await import('./+page.server.js')
  const result = (await load({ url: new URL(`http://localhost/catalog${search}`) } as any)) as CatalogData
  return { result, inArray: inArray as any, select: db.select as any }
}

beforeEach(() => {
  vi.clearAllMocks()
  flag.on = false
  kindMocks.listSlugsByKind.mockReturnValue(new Set(['b']))
  kindMocks.listKinds.mockReturnValue(['agent', 'system'])
  kindMocks.loadKindInfo.mockReturnValue(new Map([['b', { kind: 'system', framework: 'crewai' }]]))
})

describe('catalog load, flag off', () => {
  it('has no kind keys and never touches the kinds module', async () => {
    const { result } = await runLoad('?kind=system')
    expect(Object.keys(result).sort()).toEqual(
      ['agents', 'categories', 'filters', 'llms', 'maturityStatuses', 'page', 'pageSize', 'searchDegraded', 'total', 'totalPages'].sort()
    )
    expect(Object.keys(result.filters).sort()).toEqual(['category', 'llm', 'maturity', 'q'])
    expect(result.agents[0]).not.toHaveProperty('kind')
    expect(kindMocks.listSlugsByKind).not.toHaveBeenCalled()
    expect(kindMocks.listKinds).not.toHaveBeenCalled()
    expect(result.llms).toContain('n/a')
  })
})

describe('catalog load, flag on', () => {
  beforeEach(() => {
    flag.on = true
  })

  it('adds kinds, filters.kind and per-card kind/framework; drops n/a model', async () => {
    const { result } = await runLoad('')
    expect(result.kinds).toEqual(['agent', 'system'])
    expect(result.filters.kind).toBeNull()
    expect(result.agents.find((a: any) => a.slug === 'b')).toMatchObject({ kind: 'system', framework: 'crewai' })
    expect(result.agents.find((a: any) => a.slug === 'a')).toMatchObject({ kind: 'agent', framework: null })
    expect(result.llms).toEqual(['gpt-4o'])
  })

  it('?kind=system restricts via inArray on the kind slugs', async () => {
    const { result, inArray } = await runLoad('?kind=system', [row('b')])
    expect(kindMocks.listSlugsByKind).toHaveBeenCalledWith(expect.anything(), 'system')
    expect(inArray).toHaveBeenCalledWith('slug', ['b'])
    expect(result.filters.kind).toBe('system')
    expect(result.total).toBe(1)
  })

  it('empty kind set yields an empty page without querying agents', async () => {
    kindMocks.listSlugsByKind.mockReturnValue(new Set())
    const { result } = await runLoad('?kind=skill')
    expect(result.agents).toEqual([])
    expect(result.total).toBe(0)
  })

  it('more than 500 kind slugs are filtered in memory with correct totals', async () => {
    const big = new Set(Array.from({ length: 600 }, (_, i) => `s${i}`))
    kindMocks.listSlugsByKind.mockReturnValue(big)
    const { result, inArray } = await runLoad('?kind=system', [row('s1'), row('other'), row('s2')])
    expect(inArray).not.toHaveBeenCalled()
    expect(result.total).toBe(2)
    expect(result.agents.map((a: any) => a.slug)).toEqual(['s1', 's2'])
  })

  it('ignores unknown and malicious kind values', async () => {
    for (const bad of ["x' OR 1=1", 'System', 'foo']) {
      const { result } = await runLoad(`?kind=${encodeURIComponent(bad)}`)
      expect(result.filters.kind).toBeNull()
    }
    expect(kindMocks.listSlugsByKind).not.toHaveBeenCalled()
  })
})
