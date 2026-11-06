// Phase 13 (flag AGENT_KINDS): detail load with and without the flag. Synthetic data only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('$lib/server/db', () => ({ db: { select: vi.fn() }, agents: { slug: 'slug' } }))
vi.mock('$lib/server/search/index.js', () => ({ related: vi.fn(async () => []) }))
const warmMock = vi.fn(() => Promise.resolve())
vi.mock('$lib/server/tryitout/service', () => ({ warmForSession: (...a: unknown[]) => warmMock(...(a as [])) }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), inArray: vi.fn() }))
const kindsMock = vi.fn()
vi.mock('$lib/server/kinds.js', () => ({ loadKindInfo: (...a: unknown[]) => kindsMock(...a) }))
vi.mock('@sveltejs/kit', () => ({
  error: vi.fn((status: number, message: string) => {
    throw Object.assign(new Error(message), { status })
  }),
}))

type Load = (args: Record<string, unknown>) => Promise<Record<string, unknown>>

const row = (over: Record<string, unknown> = {}) => ({
  slug: 'synthetic-team',
  title: 'Synthetic Team',
  summary: 'A synthetic system.',
  systemPrompt: 'n/a',
  llmName: 'n/a',
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
  lastIngestedAt: '2026-01-01T00:00:00.000Z',
  tryItOutMode: 'runnable',
  ...over,
})

const members = [1, 2, 3].map((i) => ({
  ref: `m${i}`,
  name: `Member ${i}`,
  role: 'worker',
  description: `Does part ${i}`,
  slug: null,
}))

describe('detail load with AGENT_KINDS', () => {
  let load: Load
  let mockGet: ReturnType<typeof vi.fn>
  let selectMock: ReturnType<typeof vi.fn>
  const saved = process.env.AGENT_KINDS

  beforeEach(async () => {
    vi.clearAllMocks()
    const { db } = await import('$lib/server/db')
    mockGet = vi.fn()
    const where = vi.fn(() => ({ get: mockGet, all: vi.fn(() => []) }))
    selectMock = vi.fn(() => ({ from: vi.fn(() => ({ where })) }))
    ;(db as unknown as { select: unknown }).select = selectMock
    load = (await import('./[slug]/+page.server.js')).load as unknown as Load
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.AGENT_KINDS
    else process.env.AGENT_KINDS = saved
  })

  it('flag off: no kindInfo key, no kinds query, runnable agent is warmed', async () => {
    delete process.env.AGENT_KINDS
    mockGet.mockReturnValue(row())
    const result = await load({ params: { slug: 'synthetic-team' } })
    expect(Object.keys(result)).toEqual(['agent', 'related', 'openTryOut'])
    expect('kindInfo' in result).toBe(false)
    expect(kindsMock).not.toHaveBeenCalled()
    expect(selectMock).toHaveBeenCalledTimes(1)
    expect((result.agent as { tryItOutMode: string }).tryItOutMode).toBe('runnable')
    expect(warmMock).toHaveBeenCalledTimes(1)
  })

  it('flag on, system with 3 members: kindInfo returned without extras, Try It Out coerced to none', async () => {
    process.env.AGENT_KINDS = '1'
    mockGet.mockReturnValue(row())
    kindsMock.mockReturnValue(
      new Map([
        [
          'synthetic-team',
          { kind: 'system', framework: 'crewai', topology: 'swarm', members, sourceFormat: 'crewai', extras: { secret: 'x' } },
        ],
      ])
    )
    const result = (await load({ params: { slug: 'synthetic-team' } })) as {
      agent: { tryItOutMode: string }
      kindInfo: Record<string, unknown> & { members: unknown[] }
    }
    expect(result.kindInfo.members).toHaveLength(3)
    expect(result.kindInfo.kind).toBe('system')
    expect('extras' in result.kindInfo).toBe(false)
    expect(result.agent.tryItOutMode).toBe('none')
    expect(warmMock).not.toHaveBeenCalled()
  })

  it('flag on, system with external mode keeps external', async () => {
    process.env.AGENT_KINDS = '1'
    mockGet.mockReturnValue(row({ tryItOutMode: 'external' }))
    kindsMock.mockReturnValue(
      new Map([['synthetic-team', { kind: 'system', framework: null, topology: null, members: [], sourceFormat: null, extras: {} }]])
    )
    const result = (await load({ params: { slug: 'synthetic-team' } })) as { agent: { tryItOutMode: string } }
    expect(result.agent.tryItOutMode).toBe('external')
  })

  it('flag on, no sidecar row: default kind agent, runnable unchanged and warmed', async () => {
    process.env.AGENT_KINDS = '1'
    mockGet.mockReturnValue(row())
    kindsMock.mockReturnValue(new Map())
    const result = (await load({ params: { slug: 'synthetic-team' } })) as {
      agent: { tryItOutMode: string }
      kindInfo: { kind: string }
    }
    expect(result.kindInfo.kind).toBe('agent')
    expect(result.agent.tryItOutMode).toBe('runnable')
    expect(warmMock).toHaveBeenCalledTimes(1)
  })
})
