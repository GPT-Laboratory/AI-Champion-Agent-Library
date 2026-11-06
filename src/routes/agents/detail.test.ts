import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'

// Mock the db module before importing the load function
vi.mock('$lib/server/db', () => {
  const mockGet = vi.fn()
  const mockWhere = vi.fn(() => ({ get: mockGet }))
  const mockFrom = vi.fn(() => ({ where: mockWhere }))
  const mockSelect = vi.fn(() => ({ from: mockFrom }))
  return {
    db: { select: mockSelect },
    agents: { slug: 'slug' },
  }
})

const relatedMock = vi.fn()
vi.mock('$lib/server/search/index.js', () => ({ related: (...a: unknown[]) => relatedMock(...a) }))

vi.mock('$lib/server/tryitout/service', () => ({ warmForSession: vi.fn() }))

// Mock drizzle-orm eq
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  inArray: vi.fn(),
}))

// Mock @sveltejs/kit error helper
vi.mock('@sveltejs/kit', () => ({
  error: vi.fn((status: number, message: string) => {
    const err = new Error(message) as Error & { status: number }
    err.status = status
    throw err
  }),
}))

describe('Agent detail load function', () => {
  let load: (args: { params: { slug: string } }) => Promise<unknown>
  let mockDb: { select: ReturnType<typeof vi.fn> }
  let mockGet: ReturnType<typeof vi.fn>
  let mockAll: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const dbModule = await import('$lib/server/db')
    mockDb = dbModule.db as unknown as typeof mockDb
    // Rebuild the mock chain fresh each test
    mockGet = vi.fn()
    mockAll = vi.fn(() => [])
    const mockWhere = vi.fn(() => ({ get: mockGet, all: mockAll }))
    const mockFrom = vi.fn(() => ({ where: mockWhere }))
    mockDb.select = vi.fn(() => ({ from: mockFrom }))
    relatedMock.mockReset()
    relatedMock.mockResolvedValue([])

    // Re-import load after mocks are set
    const mod = await import('./[slug]/+page.server.js')
    load = mod.load as typeof load
  })

  it('returns agent data for valid slug', async () => {
    const fakeRow = {
      slug: 'test-agent',
      title: 'Test Agent',
      summary: 'Does things',
      systemPrompt: 'You are helpful',
      llmName: 'gpt-4o',
      llmTemperature: 0.7,
      llmMaxTokens: null,
      llmTopP: null,
      toolNames: '["search","calculator"]',
      requiresHumanApproval: false,
      category: 'Automation',
      githubUrl: 'https://github.com/example/test-agent',
      maturityStatus: 'beta',
      tags: '["automation","ai"]',
      specId: null,
      lastIngestedAt: '2026-01-01T00:00:00.000Z',
    }
    mockGet.mockReturnValue(fakeRow)

    const result = await load({ params: { slug: 'test-agent' } }) as { agent: Record<string, unknown> }
    expect(result.agent.slug).toBe('test-agent')
    expect(result.agent.title).toBe('Test Agent')
  })

  it('deserializes toolNames JSON string to array', async () => {
    const fakeRow = {
      slug: 'test-agent',
      title: 'Test Agent',
      summary: '',
      systemPrompt: 'prompt',
      llmName: 'gpt-4o',
      llmTemperature: null,
      llmMaxTokens: null,
      llmTopP: null,
      toolNames: '["search","calculator"]',
      requiresHumanApproval: false,
      category: null,
      githubUrl: null,
      maturityStatus: 'experimental',
      tags: '[]',
      specId: null,
      lastIngestedAt: '2026-01-01T00:00:00.000Z',
    }
    mockGet.mockReturnValue(fakeRow)

    const result = await load({ params: { slug: 'test-agent' } }) as { agent: { toolNames: unknown } }
    expect(Array.isArray(result.agent.toolNames)).toBe(true)
    expect(result.agent.toolNames).toEqual(['search', 'calculator'])
  })

  it('deserializes tags JSON string to array', async () => {
    const fakeRow = {
      slug: 'test-agent',
      title: 'Test Agent',
      summary: '',
      systemPrompt: 'prompt',
      llmName: 'gpt-4o',
      llmTemperature: null,
      llmMaxTokens: null,
      llmTopP: null,
      toolNames: '[]',
      requiresHumanApproval: false,
      category: null,
      githubUrl: null,
      maturityStatus: 'experimental',
      tags: '["nlp","automation"]',
      specId: null,
      lastIngestedAt: '2026-01-01T00:00:00.000Z',
    }
    mockGet.mockReturnValue(fakeRow)

    const result = await load({ params: { slug: 'test-agent' } }) as { agent: { tags: unknown } }
    expect(Array.isArray(result.agent.tags)).toBe(true)
    expect(result.agent.tags).toEqual(['nlp', 'automation'])
  })

  it('throws 404 for unknown slug', async () => {
    mockGet.mockReturnValue(undefined)

    await expect(load({ params: { slug: 'nonexistent' } })).rejects.toThrow()
    try {
      await load({ params: { slug: 'nonexistent' } })
    } catch (err) {
      expect((err as { status: number }).status).toBe(404)
    }
  })

  describe('related agents', () => {
    const row = {
      slug: 'test-agent',
      title: 'Test Agent',
      summary: '',
      systemPrompt: 'p',
      llmName: 'gpt-4o',
      toolNames: '[]',
      category: null,
      maturityStatus: 'beta',
      tags: '[]',
      tryItOutMode: 'none',
    }
    const rel = (slug: string) => ({ slug, title: slug.toUpperCase(), summary: 's', category: null })
    type R = { related: { slug: string }[] }

    it('returns related agents in ranked order, up to 4', async () => {
      mockGet.mockReturnValue(row)
      relatedMock.mockResolvedValue(['c', 'a', 'b'].map((slug) => ({ slug, score: 1, via: 'fallback' })))
      mockAll.mockReturnValue([rel('a'), rel('b'), rel('c')])
      const result = (await load({ params: { slug: 'test-agent' } })) as R
      expect(relatedMock).toHaveBeenCalledWith('test-agent', 4)
      expect(result.related.map((r) => r.slug)).toEqual(['c', 'a', 'b'])
    })

    it('excludes the agent itself', async () => {
      mockGet.mockReturnValue(row)
      relatedMock.mockResolvedValue(['test-agent', 'a'].map((slug) => ({ slug, score: 1, via: 'fallback' })))
      mockAll.mockReturnValue([rel('test-agent'), rel('a')])
      const result = (await load({ params: { slug: 'test-agent' } })) as R
      expect(result.related.map((r) => r.slug)).toEqual(['a'])
    })

    it('yields [] when related() rejects', async () => {
      mockGet.mockReturnValue(row)
      relatedMock.mockRejectedValue(new Error('boom'))
      const result = (await load({ params: { slug: 'test-agent' } })) as R & { agent: { slug: string } }
      expect(result.agent.slug).toBe('test-agent')
      expect(result.related).toEqual([])
    })

    it('yields [] when there are no hits or the lookup throws', async () => {
      mockGet.mockReturnValue(row)
      expect(((await load({ params: { slug: 'test-agent' } })) as R).related).toEqual([])
      relatedMock.mockResolvedValue([{ slug: 'a', score: 1, via: 'fallback' }])
      mockAll.mockImplementation(() => {
        throw new Error('db')
      })
      expect(((await load({ params: { slug: 'test-agent' } })) as R).related).toEqual([])
    })
  })
})
