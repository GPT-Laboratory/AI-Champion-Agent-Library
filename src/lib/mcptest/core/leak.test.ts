import { describe, it, expect } from 'vitest'
import { LEAK_CORE, RUNTIME_LEAK_EXTRA, leakReason, looksLikeLeak } from './leak'

describe('leak core substrings', () => {
  it.each(LEAK_CORE)('fires on %s', (s) => {
    expect(leakReason(`prefix ${s} suffix`)).toBe(`substring:${s}`)
  })
  it('is case-sensitive', () => {
    expect(leakReason('traceback (most recent call last)')).toBeNull()
  })
})

describe('envelope rule', () => {
  it.each([
    ['timestamp status error path', 'envelope:4of4'],
    ['the timestamp, status and error', 'envelope:3of4'],
    ['status error path', 'envelope:3of4'],
    ['status and error only', null],
    ['Ordinary prose: status is fine, no error here', null]
  ])('%s -> %s', (text, want) => {
    expect(leakReason(text)).toBe(want)
  })
  it('does not fire on our own error shape', () => {
    const ok = '{"ok":false,"kind":"not_found","message":"Item not found","hint":"Check the id"}'
    expect(leakReason(ok)).toBeNull()
    expect(looksLikeLeak(ok)).toBe(false)
  })
})

describe('runtime extras', () => {
  it.each(RUNTIME_LEAK_EXTRA)('fires on %s when included', (s) => {
    expect(looksLikeLeak(`x ${s} y`)).toBe(true)
    expect(leakReason(`x ${s} y`, [s])).toBe(`substring:${s}`)
  })
  it('core rule alone ignores extras', () => {
    expect(leakReason('connect ECONNREFUSED')).toBeNull()
  })
})
