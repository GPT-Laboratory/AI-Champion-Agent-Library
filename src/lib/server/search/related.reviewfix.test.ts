// Phase 13 review fix IN-01: the fallback scale accounts for the kind bonus without a clamp,
// and flag-off inputs keep the exact pre-Phase-13 scaling.
import { describe, expect, it } from 'vitest'
import { relatedAgents, type RelatedInput } from './related.js'

const input = (slug: string, over: Partial<RelatedInput> = {}): RelatedInput => ({
  slug,
  category: 'ops',
  tags: ['a', 'b'],
  toolNames: ['t'],
  llm: 'm',
  ...over,
})
const vec = new Float32Array([1, 0])

describe('relatedAgents fallback scaling', () => {
  it('flag off (no kind): a perfect overlap scores exactly 1 (f / 1.65)', () => {
    const out = relatedAgents('x', [input('x'), input('y')], new Map([['x', vec]]))
    expect(out).toEqual([{ slug: 'y', score: 1.65 / 1.65, via: 'fallback' }])
  })

  it('flag on: a perfect overlap with the same kind is at most 1 and still ranks above a different kind', () => {
    const agents = [
      input('x', { kind: 'system' }),
      input('same', { kind: 'system' }),
      input('other', { kind: 'skill' }),
    ]
    const out = relatedAgents('x', agents, new Map([['x', vec]]))
    expect(out.map((r) => r.slug)).toEqual(['same', 'other'])
    expect(out[0]!.score).toBeLessThanOrEqual(1)
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score)
  })

  it('without a target vector the raw fallback score is used (unchanged)', () => {
    const out = relatedAgents('x', [input('x', { kind: 'system' }), input('y', { kind: 'system' })])
    expect(out[0]!.score).toBeCloseTo(1.75, 10)
  })
})
