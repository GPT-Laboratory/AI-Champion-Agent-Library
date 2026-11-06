import { describe, it, expect, vi, afterEach } from 'vitest'

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))
vi.mock('$lib/server/db.js', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ all: () => state.rows }) }) }) },
  agents: { slug: 'slug' },
}))
vi.mock('drizzle-orm', () => ({ inArray: vi.fn() }))
vi.mock('$lib/server/kinds.js', () => ({
  loadKindInfo: () =>
    new Map([
      ['an-agent', { kind: 'agent', framework: null }],
      ['a-skill', { kind: 'skill', framework: 'claude-code' }],
    ]),
}))

import { load as rawLoad } from './+page.server'
const load = rawLoad as unknown as (e: unknown) => Promise<any>
const call = (qs: string) => load({ url: new URL(`http://localhost/compare${qs}`) })

const row = (slug: string) => ({
  slug, title: slug, summary: 's', category: null, tags: '[]', llmName: 'gpt-4o', llmTemperature: null,
  toolNames: '[]', inputSchema: '[]', requiresHumanApproval: false, maturityStatus: 'beta', tryItOutMode: 'runnable',
  githubUrl: null, linkLabel: null, customizableFields: null,
})

afterEach(() => {
  vi.unstubAllEnvs()
  state.rows = []
})

describe('/compare loader with AGENT_KINDS on (G1)', () => {
  it('carries kind rows and masks the try-it-out mode of non-agent kinds', async () => {
    vi.stubEnv('AGENT_COMPARE', '1')
    vi.stubEnv('AGENT_KINDS', '1')
    state.rows = [row('an-agent'), row('a-skill')]
    const d = await call('?agents=an-agent,a-skill')
    expect(d.kindsOn).toBe(true)
    expect(d.agents.map((a: any) => [a.slug, a.kind])).toEqual([['an-agent', 'agent'], ['a-skill', 'skill']])
    expect(d.rows.find((r: any) => r.key === 'kind')).toBeDefined()
    expect(d.rows.find((r: any) => r.key === 'tryitout').differs).toBe(true)
  })

  it('flag off keeps the raw mode (no kind lookup)', async () => {
    vi.stubEnv('AGENT_COMPARE', '1')
    vi.stubEnv('AGENT_KINDS', '')
    state.rows = [row('an-agent'), row('a-skill')]
    const d = await call('?agents=an-agent,a-skill')
    expect(d.rows.find((r: any) => r.key === 'tryitout').differs).toBe(false)
  })
})
