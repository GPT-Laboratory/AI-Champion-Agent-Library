// @vitest-environment jsdom
// D-462: handleError logs redacted details under a short ref and returns { message: 'Internal Error', ref };
// +error.svelte shows "Reference: <ref>" for 5xx only.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'

const pageStore = vi.hoisted(() => ({ value: { url: new URL('http://localhost/x'), status: 500, error: null as { message: string; ref?: string } | null } }))
vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn(), replaceState: vi.fn() }))
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store')
  return {
    get page() {
      return readable(pageStore.value)
    },
  }
})
vi.mock('$lib/server/auth-config', () => ({ isAuthenticationEnabled: () => false }))
vi.mock('$lib/server/auth', () => ({ AUTH_COOKIE_NAME: 'x', authCookieOptions: () => ({}), getAuthService: () => ({ getSession: () => null }) }))
vi.mock('$lib/server/tryitout/service', () => ({ startTryItOutService: () => {} }))

import Layout from './+layout.svelte'
import ErrorPage from './+error.svelte'
import { handleError } from '../hooks.server'
import { expectNoAxeViolations } from '$lib/testing/axe'

afterEach(() => vi.restoreAllMocks())

const call = (error: unknown, status = 500, message = 'Internal Error') =>
  (handleError as unknown as (i: unknown) => { message: string; ref?: string })({
    error,
    status,
    message,
    event: { request: new Request('http://x/agents/a', { method: 'GET' }), url: new URL('http://x/agents/a') },
  })

describe('handleError (D-462)', () => {
  it('returns a generic message and an 8-hex ref; logs the ref and the error, redacting secrets', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = call(new Error('db exploded with key sk-abcdefghijklmnopqrstuvwx'))
    expect(out.message).toBe('Internal Error')
    expect(out.ref).toMatch(/^[0-9a-f]{8}$/)
    expect(Object.keys(out).sort()).toEqual(['message', 'ref'])
    const logged = spy.mock.calls.flat().join(' ')
    expect(logged).toContain(out.ref!)
    expect(logged).toContain('db exploded')
    expect(logged).not.toContain('sk-abcdefghijklmnopqrstuvwx')
    expect(logged).toContain('[redacted]')
  })

  it('handles non-Error throwables and gives distinct refs', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const a = call('plain string Bearer abcdefghijklmnopqrstuvwxyz0123')
    const b = call({ weird: true })
    expect(a.ref).not.toBe(b.ref)
  })

  it('leaves 4xx untouched and logs nothing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(call(new Error('x'), 404, 'Not Found')).toEqual({ message: 'Not Found' })
    expect(spy).not.toHaveBeenCalled()
  })
})

function mountError(status: number, error: { message: string; ref?: string } | null) {
  pageStore.value = { url: new URL('http://localhost/x'), status, error }
  document.body.innerHTML = ''
  const empty = createRawSnippet(() => ({ render: () => '<span></span>' }))
  const { container } = render(Layout, { props: { data: { user: null }, children: empty } as never })
  const main = container.querySelector('main') as HTMLElement
  render(ErrorPage, { target: main })
  return { container, main }
}

describe('+error.svelte reference (D-462)', () => {
  it('5xx with a ref: fixed copy plus "Reference: <ref>", passes axe', async () => {
    const { container, main } = mountError(500, { message: 'Internal Error', ref: 'a1b2c3d4' })
    expect(main.textContent).toContain('Reference: a1b2c3d4')
    expect(main.textContent).toContain('An unexpected error occurred')
    await expectNoAxeViolations(container, { landmarks: true })
  })

  it('ignores a malformed ref and never shows a ref for 4xx', () => {
    expect(mountError(500, { message: 'Internal Error', ref: '<script>alert(1)</script>' }).main.textContent).not.toContain('Reference')
    expect(mountError(404, { message: 'Not found', ref: 'a1b2c3d4' }).main.textContent).not.toContain('Reference')
  })
})
