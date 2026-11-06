import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ get: undefined as undefined | ((...a: unknown[]) => unknown) }))

vi.mock('$lib/server/db', () => {
  const mockWhere = vi.fn(() => ({ get: () => state.get?.() }))
  const mockFrom = vi.fn(() => ({ where: mockWhere }))
  return { db: { select: vi.fn(() => ({ from: mockFrom })) }, agents: { slug: 'slug' } }
})
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@sveltejs/kit', () => ({
  error: vi.fn((status: number, message: string) => {
    const err = new Error(message) as Error & { status: number }
    err.status = status
    throw err
  }),
}))
vi.mock('$lib/server/auth', () => ({
  AUTH_COOKIE_NAME: 'aic_session',
  authCookieOptions: () => ({ path: '/', httpOnly: true, sameSite: 'lax' }),
}))
vi.mock('$lib/server/tryitout/service', () => ({
  warmForSession: vi.fn(() => new Promise(() => {})),
}))

import { warmForSession } from '$lib/server/tryitout/service'
import { load } from './[slug]/+page.server.js'

type LoadArgs = Parameters<typeof load>[0]
const warm = warmForSession as unknown as ReturnType<typeof vi.fn>

function row(mode?: string) {
  return {
    slug: 'demo-rfi-triage',
    title: 'Demo',
    tryItOutMode: mode,
    toolNames: '[]',
    tags: '[]',
    inputSchema: '[]',
    fixedFields: '[]',
    customizableFields: null,
  }
}

function makeCookies(initial: Record<string, string> = {}) {
  const jar = { ...initial }
  return {
    get: vi.fn((n: string) => jar[n]),
    set: vi.fn((n: string, v: string) => {
      jar[n] = v
    }),
  }
}

function run(cookies = makeCookies(), user: { email: string } | null = null) {
  return load({
    params: { slug: 'demo-rfi-triage' },
    url: new URL('http://localhost/agents/demo-rfi-triage'),
    locals: { user },
    cookies,
    getClientAddress: () => '203.0.113.7',
  } as unknown as LoadArgs)
}

describe('warm on visit', () => {
  beforeEach(() => {
    warm.mockReset()
    warm.mockImplementation(() => new Promise(() => {}))
  })

  it('warms a runnable agent without blocking and mints the cookie', async () => {
    state.get = () => row('runnable')
    const cookies = makeCookies()
    await run(cookies)
    expect(warm).toHaveBeenCalledTimes(1)
    const [key, slug] = warm.mock.calls[0]
    expect(key).toMatch(/^anon:.+/)
    expect(slug).toBe('demo-rfi-triage')
    expect(warm.mock.calls[0][2]).toBe('203.0.113.7') // WR-07: the client address rides along for the per-client cap
    expect(cookies.set).toHaveBeenCalledWith('aic_tryout_sid', expect.any(String), expect.anything())
    expect(key).toBe(`anon:${cookies.set.mock.calls[0][1]}`)
  })

  it('uses the signed-in user key and sets no cookie', async () => {
    state.get = () => row('runnable')
    const cookies = makeCookies()
    await run(cookies, { email: 'u@x.fi' })
    expect(warm).toHaveBeenCalledWith('user:u@x.fi', 'demo-rfi-triage', '203.0.113.7')
    expect(cookies.set).not.toHaveBeenCalled()
  })

  it.each(['none', 'external'])('does not warm for %s', async (mode) => {
    state.get = () => row(mode)
    const cookies = makeCookies()
    await run(cookies)
    expect(warm).not.toHaveBeenCalled()
    expect(cookies.set).not.toHaveBeenCalled()
  })

  it('reload in the same session warms again with the same key', async () => {
    state.get = () => row('runnable')
    const cookies = makeCookies()
    await run(cookies)
    await run(cookies)
    expect(warm).toHaveBeenCalledTimes(2)
    expect(warm.mock.calls[1][0]).toBe(warm.mock.calls[0][0])
    expect(cookies.set).toHaveBeenCalledTimes(1)
  })

  it('a rejecting warm never breaks the load', async () => {
    state.get = () => row('runnable')
    warm.mockImplementation(() => Promise.reject(new Error('engine down')))
    const result = (await run()) as { agent: { slug: string } }
    expect(result.agent.slug).toBe('demo-rfi-triage')
  })
})
