import { describe, expect, it, vi } from 'vitest'
import { uiDarkModeEnabled } from './flags'
import { layoutThemeData, parseTheme, resolveWithTheme, themeCookieString } from './theme'
import { load } from '../routes/+layout.server'

describe('uiDarkModeEnabled', () => {
  it('is off by default and for falsy values', () => {
    expect(uiDarkModeEnabled({})).toBe(false)
    for (const v of ['0', 'false', 'off', 'no', '']) expect(uiDarkModeEnabled({ UI_DARK_MODE: v })).toBe(false)
  })
  it.each(['1', 'true', 'TRUE', ' on ', 'yes'])('is on for %j', (v) => {
    expect(uiDarkModeEnabled({ UI_DARK_MODE: v })).toBe(true)
  })
  it('is independent of the other flags', () => {
    expect(uiDarkModeEnabled({ AGENT_COMPARE: '1', AGENT_KINDS: '1' })).toBe(false)
  })
})

describe('theme helpers', () => {
  it('whitelists the cookie value', () => {
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('"><script>')).toBe('system')
    expect(parseTheme(undefined)).toBe('system')
  })
  it('flag off adds no loader keys', () => {
    expect(layoutThemeData('dark', {})).toEqual({})
    expect(layoutThemeData('dark', { UI_DARK_MODE: '1' })).toEqual({ themeEnabled: true, theme: 'dark' })
  })
  it('layout load keys are exactly the pre-existing ones with the flag off', async () => {
    const prev = process.env.UI_DARK_MODE
    delete process.env.UI_DARK_MODE
    try {
      const data = await (load as unknown as (e: unknown) => Promise<Record<string, unknown>>)({
        locals: { user: null },
        cookies: { get: () => 'dark' },
      })
      expect(Object.keys(data).filter((k) => k !== 'compareEnabled')).toEqual(['user'])
    } finally {
      if (prev !== undefined) process.env.UI_DARK_MODE = prev
    }
  })
  it('cookie is a plain preference cookie, not HttpOnly, one year, Lax', () => {
    const c = themeCookieString('dark', true)
    expect(c).toBe('aic_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure')
    expect(c).not.toMatch(/HttpOnly/i)
  })
})

describe('resolveWithTheme', () => {
  const event = { cookies: { get: (n: string) => (n === 'aic_theme' ? 'dark' : undefined) } }
  it('flag off: resolve(event) with exactly one argument, cookie never read', () => {
    const get = vi.fn()
    const resolve = vi.fn((_e: unknown, ..._rest: unknown[]) => 'ok')
    expect(resolveWithTheme({ cookies: { get } }, resolve, {})).toBe('ok')
    expect(resolve.mock.calls[0]).toHaveLength(1)
    expect(get).not.toHaveBeenCalled()
  })
  it('flag on: stamps data-theme on <html> during SSR (no flash, no inline script)', () => {
    const resolve = vi.fn((_e: unknown, o?: { transformPageChunk?: (i: { html: string; done: boolean }) => string }) => o)
    const opts = resolveWithTheme(event, resolve, { UI_DARK_MODE: '1' })!
    const out = opts.transformPageChunk!({ html: '<html lang="en"><head></head>', done: true })
    expect(out).toBe('<html lang="en" data-theme="dark"><head></head>')
    expect(out).not.toContain('<script')
  })
})
