import { describe, it, expect, vi, afterEach } from 'vitest'

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))
vi.mock('$lib/server/db.js', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ all: () => state.rows }) }) }) },
  agents: { slug: 'slug' },
}))
vi.mock('drizzle-orm', () => ({ inArray: vi.fn() }))

import * as pageServer from './+page.server'
const load = pageServer.load as unknown as (e: unknown) => Promise<any>
const call = (qs: string) => load({ url: new URL(`http://localhost/compare${qs}`) })

const row = (slug: string, o: Record<string, unknown> = {}) => ({
  slug, title: slug.toUpperCase(), summary: 's', category: null, tags: '[]', llmName: 'gpt-4o', llmTemperature: null,
  toolNames: '[]', inputSchema: '[]', requiresHumanApproval: false, maturityStatus: 'beta', tryItOutMode: 'none',
  githubUrl: null, linkLabel: null, customizableFields: null, ...o,
})

afterEach(() => {
  vi.unstubAllEnvs()
  state.rows = []
})

const VALID = new Set(['load', 'prerender', 'csr', 'ssr', 'trailingSlash', 'config', 'actions', 'entries'])

describe('/compare +page.server.ts', () => {
  it('exports only names SvelteKit accepts (routeExports guard)', () => {
    for (const k of Object.keys(pageServer)) expect(VALID.has(k) || k.startsWith('_'), `invalid export ${k}`).toBe(true)
  })

  it('answers 404 when AGENT_COMPARE is off', async () => {
    vi.stubEnv('AGENT_COMPARE', '')
    await expect(call('?agents=a,b')).rejects.toMatchObject({ status: 404 })
  })

  it('returns ordered agents and rows when on', async () => {
    vi.stubEnv('AGENT_COMPARE', '1')
    vi.stubEnv('AGENT_KINDS', '')
    state.rows = [row('b', { llmName: 'claude' }), row('a')]
    const d = await call('?agents=a,b')
    expect(d.agents.map((a: any) => a.slug)).toEqual(['a', 'b'])
    expect(d.unknown).toEqual([])
    expect(d.kindsOn).toBe(false)
    expect(d.rows.find((r: any) => r.key === 'kind')).toBeUndefined()
    expect(d.rows.find((r: any) => r.key === 'llm').differs).toBe(true)
  })

  it('unknown and invalid slugs are reported, never thrown', async () => {
    vi.stubEnv('AGENT_COMPARE', '1')
    state.rows = [row('a')]
    const d = await call('?agents=a,ghost,../x&agents=d,e')
    expect(d.unknown).toContain('ghost')
    expect(d.invalidCount).toBe(1)
    expect(d.truncated).toBe(true)
    expect(d.agents.map((a: any) => a.slug)).toEqual(['a'])
  })

  it('no agents requested is an empty comparison, not an error', async () => {
    vi.stubEnv('AGENT_COMPARE', '1')
    const d = await call('')
    expect(d.agents).toEqual([])
  })
})
