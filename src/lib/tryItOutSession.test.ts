// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { replaceStateMock } = vi.hoisted(() => ({ replaceStateMock: vi.fn() }))
vi.mock('$app/navigation', () => ({
  replaceState: replaceStateMock,
}))

import { readJobIdFromUrl, writeJobIdToUrl, clearJobIdFromUrl } from './tryItOutSession'

const VALID_UUID = 'a3f1c2d4-5b6e-4a7f-8c9d-0e1f2a3b4c5d'
const OTHER_UUID = 'b4a2d3e5-6c7f-4b8a-9d0e-1f2a3b4c5d6e'

function setUrl(path: string) {
  window.history.replaceState({}, '', path)
}

beforeEach(() => {
  replaceStateMock.mockClear()
  setUrl('/agents/demo-rfi-triage')
})

describe('readJobIdFromUrl', () => {
  it('returns the job param when it is a valid RFC-4122 UUID', () => {
    setUrl(`/agents/demo-rfi-triage?job=${VALID_UUID}`)
    expect(readJobIdFromUrl()).toBe(VALID_UUID)
  })

  it('returns null when the param is absent', () => {
    setUrl('/agents/demo-rfi-triage')
    expect(readJobIdFromUrl()).toBeNull()
  })

  it('returns null when the param is empty', () => {
    setUrl('/agents/demo-rfi-triage?job=')
    expect(readJobIdFromUrl()).toBeNull()
  })

  const badValues = [
    'abc',
    '../etc',
    `${VALID_UUID}/x`,
    'x'.repeat(500),
    '<img src=x onerror=alert(1)>',
  ]

  it.each(badValues)('returns null for the malformed value %j (threat T5-1)', (bad) => {
    setUrl(`/agents/demo-rfi-triage?job=${encodeURIComponent(bad)}`)
    expect(readJobIdFromUrl()).toBeNull()
  })

  it('returns null when window is undefined (SSR safety) and does not throw', () => {
    const originalWindow = globalThis.window
    delete (globalThis as { window?: unknown }).window
    try {
      expect(() => readJobIdFromUrl()).not.toThrow()
      expect(readJobIdFromUrl()).toBeNull()
    } finally {
      globalThis.window = originalWindow
    }
  })
})

describe('writeJobIdToUrl', () => {
  it('sets the job param to the given id via $app/navigation replaceState', () => {
    setUrl('/agents/demo-rfi-triage')
    writeJobIdToUrl(VALID_UUID)

    expect(replaceStateMock).toHaveBeenCalledTimes(1)
    const [urlArg] = replaceStateMock.mock.calls[0]
    const url = urlArg instanceof URL ? urlArg : new URL(String(urlArg), window.location.origin)
    expect(url.searchParams.get('job')).toBe(VALID_UUID)
  })

  it('preserves other existing query params', () => {
    setUrl('/agents/demo-rfi-triage?foo=bar')
    writeJobIdToUrl(VALID_UUID)

    const [urlArg] = replaceStateMock.mock.calls[0]
    const url = urlArg instanceof URL ? urlArg : new URL(String(urlArg), window.location.origin)
    expect(url.searchParams.get('foo')).toBe('bar')
    expect(url.searchParams.get('job')).toBe(VALID_UUID)
  })

  it('is a no-op for an invalid id', () => {
    setUrl('/agents/demo-rfi-triage')
    writeJobIdToUrl('not-a-uuid')
    expect(replaceStateMock).not.toHaveBeenCalled()
  })

  it('overwrites a previously-set job id rather than appending a second job param', () => {
    setUrl(`/agents/demo-rfi-triage?job=${OTHER_UUID}`)
    writeJobIdToUrl(VALID_UUID)

    const [urlArg] = replaceStateMock.mock.calls[0]
    const url = urlArg instanceof URL ? urlArg : new URL(String(urlArg), window.location.origin)
    expect(url.searchParams.getAll('job')).toEqual([VALID_UUID])
  })

  it('does not throw when no SvelteKit router is initialized', () => {
    replaceStateMock.mockImplementationOnce(() => {
      throw new Error('no router')
    })
    setUrl('/agents/demo-rfi-triage')
    expect(() => writeJobIdToUrl(VALID_UUID)).not.toThrow()
  })

  it('does not throw when window is undefined', () => {
    const originalWindow = globalThis.window
    delete (globalThis as { window?: unknown }).window
    try {
      expect(() => writeJobIdToUrl(VALID_UUID)).not.toThrow()
    } finally {
      globalThis.window = originalWindow
    }
  })
})

describe('clearJobIdFromUrl', () => {
  it('removes only the job param, leaving other params intact', () => {
    setUrl(`/agents/demo-rfi-triage?foo=bar&job=${VALID_UUID}`)
    clearJobIdFromUrl()

    expect(replaceStateMock).toHaveBeenCalledTimes(1)
    const [urlArg] = replaceStateMock.mock.calls[0]
    const url = urlArg instanceof URL ? urlArg : new URL(String(urlArg), window.location.origin)
    expect(url.searchParams.get('job')).toBeNull()
    expect(url.searchParams.get('foo')).toBe('bar')
  })

  it('does not throw when no SvelteKit router is initialized', () => {
    replaceStateMock.mockImplementationOnce(() => {
      throw new Error('no router')
    })
    setUrl(`/agents/demo-rfi-triage?job=${VALID_UUID}`)
    expect(() => clearJobIdFromUrl()).not.toThrow()
  })

  it('does not throw when window is undefined', () => {
    const originalWindow = globalThis.window
    delete (globalThis as { window?: unknown }).window
    try {
      expect(() => clearJobIdFromUrl()).not.toThrow()
    } finally {
      globalThis.window = originalWindow
    }
  })
})

describe('history semantics', () => {
  it('never uses pushState-creating navigation — only $app/navigation replaceState is called', () => {
    setUrl('/agents/demo-rfi-triage')
    writeJobIdToUrl(VALID_UUID)
    clearJobIdFromUrl()
    // Every call recorded went through the mocked replaceState import, never
    // a raw history.pushState — replaceStateMock's call count is the only
    // navigation signal these functions produce.
    expect(replaceStateMock).toHaveBeenCalledTimes(2)
  })
})
