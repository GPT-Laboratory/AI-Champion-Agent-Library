import { beforeEach, describe, expect, it, vi } from 'vitest'

const authEnabled = vi.fn()
vi.mock('$lib/server/auth-config', () => ({ isAuthenticationEnabled: () => authEnabled() }))
vi.mock('$lib/server/auth', () => ({
  AUTH_COOKIE_NAME: 'aic_session',
  authCookieOptions: () => ({}),
  getAuthService: () => ({ getSession: () => null }),
}))

// Plain function (not a spy) so a deliberate throw is not reported as a test error by the mock tracker.
const svc = vi.hoisted(() => ({ calls: 0, fail: false }))
vi.mock('$lib/server/tryitout/service', () => ({
  startTryItOutService: () => {
    svc.calls++
    if (svc.fail) throw new Error('boom')
  },
}))

import { handle, init } from './hooks.server'

function makeEvent(path: string, method = 'POST') {
  return {
    url: new URL(`http://localhost${path}`),
    request: new Request(`http://localhost${path}`, { method }),
    cookies: { get: vi.fn(), set: vi.fn() },
    locals: {} as Record<string, unknown>,
    route: { id: path },
  }
}

async function run(path: string, method = 'POST') {
  const event = makeEvent(path, method)
  const resolve = vi.fn(async () => new Response('ok'))
  try {
    const res = await handle({ event, resolve } as unknown as Parameters<typeof handle>[0])
    return { res, resolve, event, thrown: null as null | { status: number; location: string } }
  } catch (e) {
    const err = e as { status: number; location: string }
    return { res: null, resolve, event, thrown: err }
  }
}

describe('hooks.server auth handling', () => {
  beforeEach(() => authEnabled.mockReset())

  it('lets /api/llm/ through without a session', async () => {
    authEnabled.mockReturnValue(true)
    const { res, resolve } = await run('/api/llm/v1/chat/completions')
    expect(resolve).toHaveBeenCalled()
    expect(res?.status).toBe(200)
  })

  it('still 401s other api paths', async () => {
    authEnabled.mockReturnValue(true)
    const { res, resolve } = await run('/api/tryitout/jobs')
    expect(res?.status).toBe(401)
    expect(await res?.json()).toEqual({ message: 'Authentication required' })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('local MCP prefix: public only when LOCAL_MCP_AGENTS is on', async () => {
    authEnabled.mockReturnValue(true)
    const prev = process.env.LOCAL_MCP_AGENTS
    try {
      delete process.env.LOCAL_MCP_AGENTS
      const off = await run('/api/local-mcp/v1/tools/x')
      expect(off.res?.status).toBe(401)
      expect(await off.res?.json()).toEqual({ message: 'Authentication required' })
      expect(off.resolve).not.toHaveBeenCalled()
      process.env.LOCAL_MCP_AGENTS = 'on'
      const on = await run('/api/local-mcp/v1/tools/x')
      expect(on.resolve).toHaveBeenCalled()
      expect(on.res?.status).toBe(200)
      // the LLM prefix is unchanged in both states
      expect((await run('/api/llm/v1/chat/completions')).res?.status).toBe(200)
    } finally {
      if (prev === undefined) delete process.env.LOCAL_MCP_AGENTS
      else process.env.LOCAL_MCP_AGENTS = prev
    }
  })

  it('401s /api/llmx/foo', async () => {
    authEnabled.mockReturnValue(true)
    const { res } = await run('/api/llmx/foo')
    expect(res?.status).toBe(401)
  })

  it('redirects pages to login', async () => {
    authEnabled.mockReturnValue(true)
    const { thrown } = await run('/catalog', 'GET')
    expect(thrown?.status).toBe(303)
    expect(thrown?.location).toBe('/login?next=%2Fcatalog')
  })

  it('auth disabled resolves with user null', async () => {
    authEnabled.mockReturnValue(false)
    const { res, event, resolve } = await run('/api/tryitout/jobs')
    expect(resolve).toHaveBeenCalled()
    expect(res?.status).toBe(200)
    expect(event.locals.user).toBeNull()
  })
})

describe('hooks.server init', () => {
  beforeEach(() => {
    svc.calls = 0
    svc.fail = false
  })

  it('does not start the service merely by importing', () => {
    expect(svc.calls).toBe(0)
  })

  it('init starts the service once', async () => {
    await init()
    expect(svc.calls).toBe(1)
  })

  it('init resolves even if the service throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    svc.fail = true
    await expect(init()).resolves.toBeUndefined()
    expect(svc.calls).toBe(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
