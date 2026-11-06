// Phase 13 review fix WR-09: catalog cards never offer "Try out" for non-agent kinds (flag on).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const flag = vi.hoisted(() => ({ on: false }))
const kindMocks = vi.hoisted(() => ({
  listSlugsByKind: vi.fn(),
  listKinds: vi.fn(),
  loadKindInfo: vi.fn(),
}))

const row = (slug: string, tryItOutMode: string) => ({
  slug,
  title: slug,
  summary: 's',
  llmName: 'gpt-4o',
  toolNames: '[]',
  inputSchema: '[]',
  tags: '[]',
  category: null,
  maturityStatus: 'beta',
  tryItOutMode,
  tryItOutUrl: null,
})

vi.mock('$lib/server/db.js', () => ({
  db: { select: vi.fn(), selectDistinct: vi.fn() },
  agents: { slug: 'slug', title: 'title', llmName: 'llm_name', category: 'category', maturityStatus: 'm' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  inArray: vi.fn(),
}))
vi.mock('$lib/server/search/index.js', () => ({ search: vi.fn() }))
vi.mock('$lib/flags.js', () => ({ agentKindsEnabled: () => flag.on }))
vi.mock('$lib/server/kinds.js', () => kindMocks)

async function runLoad(rows: ReturnType<typeof row>[]) {
  const { db } = await import('$lib/server/db.js')
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
    all: vi.fn().mockReturnValue([{ category: null, llmName: 'gpt-4o', maturityStatus: 'beta' }]),
  })
  const { load } = await import('./+page.server.js')
  return (await load({ url: new URL('http://localhost/catalog') } as any)) as Record<string, any>
}

beforeEach(() => {
  vi.clearAllMocks()
  kindMocks.listKinds.mockReturnValue(['agent', 'system'])
  kindMocks.loadKindInfo.mockReturnValue(
    new Map([
      ['sys', { kind: 'system', framework: 'crewai' }],
      ['ext', { kind: 'external-agent', framework: null }],
      ['plain', { kind: 'agent', framework: null }],
    ]),
  )
})

describe('catalog load tryItOutMode (flag on)', () => {
  it('coerces runnable to none for non-agent kinds only', async () => {
    flag.on = true
    const rows = [row('sys', 'runnable'), row('plain', 'runnable'), row('legacy', 'runnable'), row('ext', 'external')]
    const result = await runLoad(rows)
    const mode = Object.fromEntries(result.agents.map((a: any) => [a.slug, a.tryItOutMode]))
    expect(mode).toEqual({ sys: 'none', plain: 'runnable', legacy: 'runnable', ext: 'external' })
  })

  it('flag off: rows are passed through untouched', async () => {
    flag.on = false
    const result = await runLoad([row('sys', 'runnable')])
    expect(result.agents[0].tryItOutMode).toBe('runnable')
    expect(result.agents[0]).not.toHaveProperty('kind')
  })
})
