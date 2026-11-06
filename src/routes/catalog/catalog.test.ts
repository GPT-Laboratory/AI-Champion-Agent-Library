import { describe, it, expect, vi, beforeEach } from 'vitest'

// SvelteKit's load() is typed as void | data; the catalog load always returns data.
type CatalogData = Exclude<Awaited<ReturnType<typeof import('./+page.server.js').load>>, void>

// Mock the db module before importing the load function
vi.mock('$lib/server/db.js', () => {
  const makeMockRows = (overrides: Record<string, unknown>[] = []) =>
    overrides.map(o => ({
      slug: 'test-agent',
      title: 'Test Agent',
      summary: 'A test agent summary',
      systemPrompt: 'You are a test agent.',
      llmName: 'gpt-4o',
      llmTemperature: 0.7,
      llmMaxTokens: null,
      llmTopP: null,
      toolNames: '[]',
      requiresHumanApproval: false,
      category: 'productivity',
      githubUrl: null,
      maturityStatus: 'experimental',
      tags: '["tag1","tag2"]',
      specId: null,
      lastIngestedAt: '2026-01-01T00:00:00Z',
      ...o,
    }))

  const mockAll = vi.fn()
  const mockSelect = vi.fn()
  const mockSelectDistinct = vi.fn()

  const chainBuilder = (rows: Record<string, unknown>[]) => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue(rows),
      get: vi.fn().mockReturnValue(rows[0] ?? null),
    }
    return chain
  }

  return {
    db: {
      select: mockSelect,
      selectDistinct: mockSelectDistinct,
    },
    agents: {
      slug: 'slug',
      title: 'title',
      summary: 'summary',
      systemPrompt: 'system_prompt',
      llmName: 'llm_name',
      llmTemperature: 'llm_temperature',
      llmMaxTokens: 'llm_max_tokens',
      llmTopP: 'llm_top_p',
      toolNames: 'tool_names',
      requiresHumanApproval: 'requires_human_approval',
      category: 'category',
      githubUrl: 'github_url',
      maturityStatus: 'maturity_status',
      tags: 'tags',
      specId: 'spec_id',
      lastIngestedAt: 'last_ingested_at',
    },
  }
})

// Also mock drizzle-orm operators since load function imports them
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  asc: vi.fn((col) => ({ type: 'asc', col })),
  inArray: vi.fn((col, vals) => ({ type: 'inArray', col, vals })),
}))

vi.mock('$lib/server/search/index.js', () => ({ search: vi.fn() }))

describe('Catalog load function', () => {
  it('returns agents from the database', async () => {
    const { db } = await import('$lib/server/db.js')
    const mockAgentRow = {
      slug: 'my-agent',
      title: 'My Agent',
      summary: 'Does things',
      systemPrompt: 'You are my agent.',
      llmName: 'gpt-4o',
      llmTemperature: 0.7,
      llmMaxTokens: null,
      llmTopP: null,
      toolNames: '["search"]',
      requiresHumanApproval: false,
      category: 'productivity',
      githubUrl: null,
      maturityStatus: 'beta',
      tags: '["tag1"]',
      specId: null,
      lastIngestedAt: '2026-01-01T00:00:00Z',
    }

    const allChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([mockAgentRow]),
    }
    const countChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([{ slug: 'my-agent' }]),
    }
    const distinctChain = {
      from: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([{ category: 'productivity' }, { llmName: 'gpt-4o' }, { maturityStatus: 'beta' }]),
    }

    let callCount = 0
    ;(db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++
      return callCount === 1 ? allChain : countChain
    })
    ;(db.selectDistinct as ReturnType<typeof vi.fn>).mockReturnValue(distinctChain)

    const url = new URL('http://localhost/catalog')
    const { load } = await import('./+page.server.js')
    const result = (await load({ url } as Parameters<typeof load>[0])) as CatalogData

    expect(result.agents).toHaveLength(1)
    expect(result.agents[0].slug).toBe('my-agent')
    expect(result.agents[0].toolNames).toEqual(['search'])
    expect(result.agents[0].tags).toEqual(['tag1'])
  })

  it('paginates at PAGE_SIZE=24', async () => {
    const { db } = await import('$lib/server/db.js')

    const mockRows = Array.from({ length: 24 }, (_, i) => ({
      slug: `agent-${i}`,
      title: `Agent ${i}`,
      summary: 'Summary',
      systemPrompt: 'Prompt',
      llmName: 'gpt-4o',
      llmTemperature: null,
      llmMaxTokens: null,
      llmTopP: null,
      toolNames: '[]',
      requiresHumanApproval: false,
      category: null,
      githubUrl: null,
      maturityStatus: 'experimental',
      tags: '[]',
      specId: null,
      lastIngestedAt: '2026-01-01T00:00:00Z',
    }))

    const limitSpy = vi.fn().mockReturnThis()
    const offsetSpy = vi.fn().mockReturnThis()
    const allChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: limitSpy,
      offset: offsetSpy,
      all: vi.fn().mockReturnValue(mockRows),
    }
    const countChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue(Array.from({ length: 50 }, (_, i) => ({ slug: `agent-${i}` }))),
    }
    const distinctChain = {
      from: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }

    let callCount = 0
    ;(db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++
      return callCount === 1 ? allChain : countChain
    })
    ;(db.selectDistinct as ReturnType<typeof vi.fn>).mockReturnValue(distinctChain)

    const url = new URL('http://localhost/catalog?page=2')
    const { load } = await import('./+page.server.js')
    const result = (await load({ url } as Parameters<typeof load>[0])) as CatalogData

    expect(result.page).toBe(2)
    expect(result.pageSize).toBe(24)
    expect(limitSpy).toHaveBeenCalledWith(24)
    expect(offsetSpy).toHaveBeenCalledWith(24) // (page 2 - 1) * 24
    expect(result.totalPages).toBe(3) // Math.ceil(50/24) = 3
  })

  it('filters by category when URL param present', async () => {
    const { db } = await import('$lib/server/db.js')
    const { eq } = await import('drizzle-orm')

    const allChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }
    const countChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }
    const distinctChain = {
      from: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }

    let callCount = 0
    ;(db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++
      return callCount === 1 ? allChain : countChain
    })
    ;(db.selectDistinct as ReturnType<typeof vi.fn>).mockReturnValue(distinctChain)

    const url = new URL('http://localhost/catalog?category=productivity')
    const { load } = await import('./+page.server.js')
    const result = (await load({ url } as Parameters<typeof load>[0])) as CatalogData

    expect(result.filters.category).toBe('productivity')
    expect(eq).toHaveBeenCalledWith(expect.anything(), 'productivity')
  })

  it('filters by LLM when URL param present', async () => {
    const { db } = await import('$lib/server/db.js')
    const { eq } = await import('drizzle-orm')

    const allChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }
    const countChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }
    const distinctChain = {
      from: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }

    let callCount = 0
    ;(db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++
      return callCount === 1 ? allChain : countChain
    })
    ;(db.selectDistinct as ReturnType<typeof vi.fn>).mockReturnValue(distinctChain)

    const url = new URL('http://localhost/catalog?llm=gpt-4o')
    const { load } = await import('./+page.server.js')
    const result = (await load({ url } as Parameters<typeof load>[0])) as CatalogData

    expect(result.filters.llm).toBe('gpt-4o')
    expect(eq).toHaveBeenCalledWith(expect.anything(), 'gpt-4o')
  })

  it('filters by maturityStatus when URL param present', async () => {
    const { db } = await import('$lib/server/db.js')
    const { eq } = await import('drizzle-orm')

    const allChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }
    const countChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }
    const distinctChain = {
      from: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }

    let callCount = 0
    ;(db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++
      return callCount === 1 ? allChain : countChain
    })
    ;(db.selectDistinct as ReturnType<typeof vi.fn>).mockReturnValue(distinctChain)

    const url = new URL('http://localhost/catalog?maturity=production')
    const { load } = await import('./+page.server.js')
    const result = (await load({ url } as Parameters<typeof load>[0])) as CatalogData

    expect(result.filters.maturity).toBe('production')
    expect(eq).toHaveBeenCalledWith(expect.anything(), 'production')
  })

  it('returns distinct categories for filter dropdown', async () => {
    const { db } = await import('$lib/server/db.js')

    const allChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }
    const countChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }

    let selectCallCount = 0
    ;(db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCallCount++
      return selectCallCount === 1 ? allChain : countChain
    })

    let distinctCallCount = 0
    ;(db.selectDistinct as ReturnType<typeof vi.fn>).mockImplementation(() => {
      distinctCallCount++
      if (distinctCallCount === 1) {
        return { from: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([{ category: 'productivity' }, { category: 'devops' }]) }
      }
      if (distinctCallCount === 2) {
        return { from: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([{ llmName: 'gpt-4o' }]) }
      }
      return { from: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([{ maturityStatus: 'experimental' }]) }
    })

    const url = new URL('http://localhost/catalog')
    const { load } = await import('./+page.server.js')
    const result = (await load({ url } as Parameters<typeof load>[0])) as CatalogData

    expect(result.categories).toContain('productivity')
    expect(result.categories).toContain('devops')
  })

  it('returns distinct LLM names for filter dropdown', async () => {
    const { db } = await import('$lib/server/db.js')

    const allChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }
    const countChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }

    let selectCallCount = 0
    ;(db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCallCount++
      return selectCallCount === 1 ? allChain : countChain
    })

    let distinctCallCount = 0
    ;(db.selectDistinct as ReturnType<typeof vi.fn>).mockImplementation(() => {
      distinctCallCount++
      if (distinctCallCount === 1) {
        return { from: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([{ category: 'productivity' }]) }
      }
      if (distinctCallCount === 2) {
        return { from: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([{ llmName: 'gpt-4o' }, { llmName: 'claude-3-5-sonnet' }]) }
      }
      return { from: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([{ maturityStatus: 'beta' }]) }
    })

    const url = new URL('http://localhost/catalog')
    const { load } = await import('./+page.server.js')
    const result = (await load({ url } as Parameters<typeof load>[0])) as CatalogData

    expect(result.llms).toContain('gpt-4o')
    expect(result.llms).toContain('claude-3-5-sonnet')
  })

  it('returns distinct maturity statuses for filter dropdown', async () => {
    const { db } = await import('$lib/server/db.js')

    const allChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }
    const countChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
    }

    let selectCallCount = 0
    ;(db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCallCount++
      return selectCallCount === 1 ? allChain : countChain
    })

    let distinctCallCount = 0
    ;(db.selectDistinct as ReturnType<typeof vi.fn>).mockImplementation(() => {
      distinctCallCount++
      if (distinctCallCount === 1) {
        return { from: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([]) }
      }
      if (distinctCallCount === 2) {
        return { from: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([]) }
      }
      return { from: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([{ maturityStatus: 'experimental' }, { maturityStatus: 'beta' }, { maturityStatus: 'production' }]) }
    })

    const url = new URL('http://localhost/catalog')
    const { load } = await import('./+page.server.js')
    const result = (await load({ url } as Parameters<typeof load>[0])) as CatalogData

    expect(result.maturityStatuses).toContain('experimental')
    expect(result.maturityStatuses).toContain('beta')
    expect(result.maturityStatuses).toContain('production')
  })

  it('clamps invalid page to 1 and never passes NaN/negative to offset (WR-03)', async () => {
    const { db } = await import('$lib/server/db.js')
    for (const page of ['abc', '0', '-2', '']) {
      const offsetSpy = vi.fn().mockReturnThis()
      const allChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: offsetSpy,
        all: vi.fn().mockReturnValue([]),
      }
      ;(db.select as ReturnType<typeof vi.fn>).mockReset()
      ;(db.select as ReturnType<typeof vi.fn>).mockReturnValue(allChain)
      ;(db.selectDistinct as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        all: vi.fn().mockReturnValue([]),
      })
      const { load } = await import('./+page.server.js')
      const r = (await load({ url: new URL(`http://localhost/catalog?page=${page}`) } as Parameters<typeof load>[0])) as CatalogData
      expect(r.page, page).toBe(1)
      expect(offsetSpy, page).toHaveBeenCalledWith(0)
    }
  })

  describe('with q', () => {
    const mk = (slug: string, title: string, category = 'productivity') => ({
      slug, title, summary: 's', systemPrompt: 'p', llmName: 'gpt-4o', llmTemperature: null,
      llmMaxTokens: null, llmTopP: null, toolNames: '[]', requiresHumanApproval: false,
      category, githubUrl: null, maturityStatus: 'beta', tags: '[]', specId: null,
      lastIngestedAt: '2026-01-01T00:00:00Z',
    })

    async function setup(matched: ReturnType<typeof mk>[], ranked: string[]) {
      const { db } = await import('$lib/server/db.js')
      const { search } = await import('$lib/server/search/index.js')
      ;(search as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        results: ranked.map((slug, i) => ({ slug, score: 10 - i })),
        mode: 'bm25',
      })
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        all: vi.fn().mockReturnValue(matched),
      }
      ;(db.select as ReturnType<typeof vi.fn>).mockReset()
      ;(db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain)
      ;(db.selectDistinct as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        all: vi.fn().mockReturnValue([]),
      })
      return { chain, search }
    }

    it('orders by search rank and returns filters.q', async () => {
      await setup([mk('a', 'A'), mk('b', 'B'), mk('c', 'C')], ['c', 'a', 'b'])
      const { load } = await import('./+page.server.js')
      const url = new URL('http://localhost/catalog?q=sql')
      const r = (await load({ url } as Parameters<typeof load>[0])) as CatalogData
      expect(r.agents.map((a: { slug: string }) => a.slug)).toEqual(['c', 'a', 'b'])
      expect(r.total).toBe(3)
      expect(r.filters.q).toBe('sql')
    })

    it('combines with category filter', async () => {
      await setup([mk('a', 'A')], ['a'])
      const { eq, inArray } = await import('drizzle-orm')
      const { load } = await import('./+page.server.js')
      const url = new URL('http://localhost/catalog?q=sql&category=productivity')
      await load({ url } as Parameters<typeof load>[0])
      expect(eq).toHaveBeenCalledWith(expect.anything(), 'productivity')
      expect(inArray).toHaveBeenCalledWith(expect.anything(), ['a'])
    })

    it('paginates the ranked list', async () => {
      const slugs = Array.from({ length: 30 }, (_, i) => `a${i}`)
      await setup(slugs.map((s) => mk(s, s)), slugs)
      const { load } = await import('./+page.server.js')
      const url = new URL('http://localhost/catalog?q=x&page=2')
      const r = (await load({ url } as Parameters<typeof load>[0])) as CatalogData
      expect(r.total).toBe(30)
      expect(r.totalPages).toBe(2)
      expect(r.agents.map((a: { slug: string }) => a.slug)).toEqual(slugs.slice(24))
    })

    it('ranks without a top-N cut so filters and total see every match (CR-01)', async () => {
      const { search } = await setup([mk('a', 'A')], ['a'])
      const { load } = await import('./+page.server.js')
      await load({ url: new URL('http://localhost/catalog?q=sql&category=productivity') } as Parameters<typeof load>[0])
      expect(search).toHaveBeenLastCalledWith('sql', { limit: Infinity })
    })

    it('chunks the slug IN-list and totals matches beyond 50 (CR-01)', async () => {
      const slugs = Array.from({ length: 1200 }, (_, i) => `a${String(i).padStart(4, '0')}`)
      const { chain } = await setup([], slugs)
      const { inArray } = await import('drizzle-orm')
      ;(inArray as unknown as ReturnType<typeof vi.fn>).mockClear()
      chain.all.mockImplementation(() => {
        const call = (inArray as unknown as ReturnType<typeof vi.fn>).mock.calls.length - 1
        return slugs.slice(call * 500, call * 500 + 500).map((s) => mk(s, s))
      })
      const { load } = await import('./+page.server.js')
      const r = (await load({ url: new URL('http://localhost/catalog?q=x&page=3') } as Parameters<typeof load>[0])) as CatalogData
      expect(r.total).toBe(1200)
      expect(r.totalPages).toBe(50)
      const lists = (inArray as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as string[]).length)
      expect(lists).toEqual([500, 500, 200])
      expect(r.agents.map((a: { slug: string }) => a.slug)).toEqual(slugs.slice(48, 72))
    })

    it('clamps invalid page to 1 in the search branch (WR-03)', async () => {
      const slugs = Array.from({ length: 30 }, (_, i) => `a${i}`)
      await setup(slugs.map((s) => mk(s, s)), slugs)
      const { load } = await import('./+page.server.js')
      for (const page of ['abc', '0', '-3', 'NaN']) {
        const r = (await load({ url: new URL(`http://localhost/catalog?q=x&page=${page}`) } as Parameters<typeof load>[0])) as CatalogData
        expect(r.page, page).toBe(1)
        expect(r.agents.map((a: { slug: string }) => a.slug), page).toEqual(slugs.slice(0, 24))
      }
    })

    it('falls back to a basic text match when search throws instead of 500 (WR-07)', async () => {
      const rows = [mk('sql-helper', 'SQL Helper'), mk('hvac', 'HVAC Sizer'), mk('sql-tuner', 'Query Tuner')]
      const { search } = await setup(rows, [])
      ;(search as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('index build failed'))
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { load } = await import('./+page.server.js')
      const r = (await load({ url: new URL('http://localhost/catalog?q=sql') } as Parameters<typeof load>[0])) as CatalogData
      expect(err).toHaveBeenCalled()
      err.mockRestore()
      expect(r.searchDegraded).toBe(true)
      expect(r.agents.map((a: { slug: string }) => a.slug)).toEqual(['sql-helper'])
      expect(r.total).toBe(1)
      expect(r.filters.q).toBe('sql')
    })

    it('searchDegraded is false when search works', async () => {
      await setup([mk('a', 'A')], ['a'])
      const { load } = await import('./+page.server.js')
      const r = (await load({ url: new URL('http://localhost/catalog?q=a') } as Parameters<typeof load>[0])) as CatalogData
      expect(r.searchDegraded).toBe(false)
    })

    it('returns empty when nothing matches', async () => {
      const { chain } = await setup([], [])
      const { load } = await import('./+page.server.js')
      const url = new URL('http://localhost/catalog?q=zzz')
      const r = (await load({ url } as Parameters<typeof load>[0])) as CatalogData
      expect(r.agents).toEqual([])
      expect(r.total).toBe(0)
      expect(chain.all).not.toHaveBeenCalled()
    })

    it('filters.q is null without q', async () => {
      const { db } = await import('$lib/server/db.js')
      const empty = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), offset: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([]) }
      ;(db.select as ReturnType<typeof vi.fn>).mockReset()
      ;(db.select as ReturnType<typeof vi.fn>).mockReturnValue(empty)
      ;(db.selectDistinct as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnThis(), all: vi.fn().mockReturnValue([]) })
      const { load } = await import('./+page.server.js')
      const r = (await load({ url: new URL('http://localhost/catalog') } as Parameters<typeof load>[0])) as CatalogData
      expect(r.filters.q).toBeNull()
    })
  })
})
