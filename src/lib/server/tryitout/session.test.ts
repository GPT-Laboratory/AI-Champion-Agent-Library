import { describe, expect, it, vi } from 'vitest'
import { TRYOUT_SESSION_COOKIE, sessionKey } from './session'

function jar(initial: Record<string, string> = {}) {
  const store = { ...initial }
  const set = vi.fn((name: string, value: string, _opts: object) => {
    store[name] = value
  })
  return { get: (n: string) => store[n], set, store }
}
const url = new URL('http://localhost/agents/x')

describe('sessionKey', () => {
  it('uses the user email and sets no cookie', () => {
    const cookies = jar()
    expect(sessionKey({ locals: { user: { email: 'a@b.fi' } }, cookies, url })).toBe('user:a@b.fi')
    expect(cookies.set).not.toHaveBeenCalled()
  })

  it('mints an httpOnly cookie once for anonymous visitors', () => {
    const cookies = jar()
    const key = sessionKey({ locals: { user: null }, cookies, url })
    expect(cookies.set).toHaveBeenCalledTimes(1)
    const [name, value, opts] = cookies.set.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(name).toBe(TRYOUT_SESSION_COOKIE)
    expect(value).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 86400 })
    expect(key).toBe(`anon:${value}`)
    expect(sessionKey({ locals: { user: null }, cookies, url })).toBe(key)
    expect(cookies.set).toHaveBeenCalledTimes(1)
  })

  it('reuses a valid cookie', () => {
    const cookies = jar({ [TRYOUT_SESSION_COOKIE]: 'abcdefghijklmnopqrstuv' })
    expect(sessionKey({ cookies, url })).toBe('anon:abcdefghijklmnopqrstuv')
    expect(cookies.set).not.toHaveBeenCalled()
  })

  it('replaces malformed cookie values', () => {
    for (const bad of ['../x', 'a'.repeat(300)]) {
      const cookies = jar({ [TRYOUT_SESSION_COOKIE]: bad })
      const key = sessionKey({ cookies, url })
      expect(cookies.set).toHaveBeenCalledTimes(1)
      expect(key).not.toContain(bad)
    }
  })

  it('does not throw without a cookies object', () => {
    expect(sessionKey({})).toMatch(/^anon:ephemeral-/)
  })
})
