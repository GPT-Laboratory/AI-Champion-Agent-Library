import { describe, it, expect } from 'vitest'
import {
  DEFAULT_KIND_INFO,
  defaultKindInfo,
  clampExtras,
  parseKindInfoRow,
  EXTRAS_MAX_BYTES,
  MEMBERS_MAX,
} from './kinds.js'

describe('kinds', () => {
  it('defaults', () => {
    expect(DEFAULT_KIND_INFO.kind).toBe('agent')
    expect(DEFAULT_KIND_INFO.members).toEqual([])
    expect(DEFAULT_KIND_INFO.extras).toEqual({})
    expect(Object.isFrozen(DEFAULT_KIND_INFO)).toBe(true)
    const a = defaultKindInfo()
    a.members.push({ ref: 'r', name: 'n', role: 'peer', description: null, slug: null })
    expect(defaultKindInfo().members).toEqual([])
  })

  it('clampExtras passes small and truncates large', () => {
    const small = { a: 1 }
    expect(clampExtras(small)).toBe(small)
    const big = { s: 'x'.repeat(EXTRAS_MAX_BYTES + 10) }
    const r = clampExtras(big)
    expect(r._truncated).toBe(true)
    expect(typeof r._originalBytes).toBe('number')
  })

  it('clampExtras tolerates cycles', () => {
    const c: Record<string, unknown> = {}
    c.self = c
    expect(clampExtras(c)._truncated).toBe(true)
  })

  it('parseKindInfoRow parses valid row', () => {
    const k = parseKindInfoRow({
      kind: 'system',
      framework: 'crewai',
      topology: 'hierarchical',
      members: JSON.stringify([
        { ref: 'a', name: 'A', role: 'manager', description: 'd', slug: 's' },
        { ref: 'bad' },
      ]),
      sourceFormat: 'crewai',
      extras: '{"x":1}',
    })
    expect(k.kind).toBe('system')
    expect(k.members).toHaveLength(1)
    expect(k.members[0].slug).toBe('s')
    expect(k.extras).toEqual({ x: 1 })
  })

  it('parseKindInfoRow tolerates garbage', () => {
    const k = parseKindInfoRow({ kind: 'nope', members: '{bad', extras: '[1]' })
    expect(k).toEqual(defaultKindInfo())
  })

  it('caps members', () => {
    const members = Array.from({ length: MEMBERS_MAX + 5 }, (_, i) => ({
      ref: `r${i}`,
      name: `n${i}`,
      role: 'worker',
    }))
    expect(parseKindInfoRow({ members: JSON.stringify(members) }).members).toHaveLength(MEMBERS_MAX)
  })
})
