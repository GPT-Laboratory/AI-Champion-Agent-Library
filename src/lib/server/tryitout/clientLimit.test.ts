import { describe, expect, it } from 'vitest'
import { createClientLimiter } from './clientLimit'

describe('createClientLimiter', () => {
  it('admits up to max per window per client, then refuses', () => {
    let t = 0
    const l = createClientLimiter({ max: 2, windowMs: 1000, now: () => t })
    expect(l.tryAdmit('a')).toBe(true)
    expect(l.tryAdmit('a')).toBe(true)
    expect(l.tryAdmit('a')).toBe(false)
    expect(l.tryAdmit('b')).toBe(true) // other clients are independent
  })
  it('admits again once the window has passed', () => {
    let t = 0
    const l = createClientLimiter({ max: 1, windowMs: 1000, now: () => t })
    expect(l.tryAdmit('a')).toBe(true)
    expect(l.tryAdmit('a')).toBe(false)
    t = 1001
    expect(l.tryAdmit('a')).toBe(true)
  })
  it('max 0 means unlimited', () => {
    const l = createClientLimiter({ max: 0, windowMs: 1000 })
    for (let i = 0; i < 50; i++) expect(l.tryAdmit('a')).toBe(true)
  })
})
