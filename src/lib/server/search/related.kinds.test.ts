import { describe, it, expect } from 'vitest'
import { fallbackScore, relatedAgents, type RelatedInput } from './related.js'

const base = (slug: string, extra: Partial<RelatedInput> = {}): RelatedInput => ({
  slug,
  category: 'c',
  tags: ['a'],
  toolNames: [],
  ...extra,
})

describe('related same-kind weight', () => {
  it('kind-less inputs score exactly as before', () => {
    expect(fallbackScore(base('x'), base('y'))).toBe(1.5)
  })
  it('adds 0.1 only when both carry an equal kind', () => {
    expect(fallbackScore(base('x', { kind: 'system' }), base('y', { kind: 'system' }))).toBeCloseTo(1.6)
    expect(fallbackScore(base('x', { kind: 'system' }), base('y', { kind: 'agent' }))).toBe(1.5)
    expect(fallbackScore(base('x', { kind: 'system' }), base('y'))).toBe(1.5)
  })
  it('ranks same-kind first on ties and clamps scaled scores to 1', () => {
    const list = [
      base('t', { kind: 'system' }),
      base('a-agent', { kind: 'agent' }),
      base('z-system', { kind: 'system' }),
    ]
    expect(relatedAgents('t', list).map((r) => r.slug)).toEqual(['z-system', 'a-agent'])
    const v = new Map([['t', new Float32Array([1])]])
    for (const r of relatedAgents('t', list, v)) expect(r.score).toBeLessThanOrEqual(1)
  })
})
