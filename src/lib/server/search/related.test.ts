import { describe, expect, it } from 'vitest'
import { fallbackScore, relatedAgents, type RelatedInput } from './related.js'

const mk = (
  slug: string,
  tags: string[],
  category: string | null = null,
  toolNames: string[] = [],
  llm?: string,
): RelatedInput => ({ slug, tags, category, toolNames, llm })
const unit = (...v: number[]) => {
  const n = Math.hypot(...v)
  return new Float32Array(v.map((x) => x / n))
}

const agents = [
  mk('a', ['x', 'y'], 'c1'),
  mk('b', ['x', 'y'], 'c1'),
  mk('c', ['x'], 'c2'),
  mk('d', ['z'], 'c3'),
  mk('e', ['x', 'y'], 'c1'),
]

describe('fallbackScore', () => {
  it('combines jaccard, category, tools and llm', () => {
    const a = mk('a', ['x', 'y'], 'c', ['t'], 'm')
    const b = mk('b', ['x'], 'C', ['t'], 'm')
    expect(fallbackScore(a, b)).toBeCloseTo(0.5 + 0.5 + 0.1 + 0.05)
  })
  it('is 0 for empty vs empty', () => {
    expect(fallbackScore(mk('a', []), mk('b', []))).toBe(0)
  })
})

describe('relatedAgents fallback', () => {
  it('excludes self, ties by slug, omits zero scores', () => {
    const r = relatedAgents('a', agents)
    expect(r.map((x) => x.slug)).toEqual(['b', 'e', 'c'])
    expect(r.every((x) => x.via === 'fallback')).toBe(true)
  })
  it('respects k', () => {
    expect(relatedAgents('a', agents, undefined, 1)).toHaveLength(1)
  })
  it('returns [] for unknown slug or single agent', () => {
    expect(relatedAgents('nope', agents)).toEqual([])
    expect(relatedAgents('a', [agents[0]])).toEqual([])
  })
  it('is order independent', () => {
    expect(relatedAgents('a', [...agents].reverse())).toEqual(relatedAgents('a', agents))
  })
})

describe('relatedAgents vectors', () => {
  const vectors = new Map([
    ['a', unit(1, 0)],
    ['b', unit(0.6, 0.8)],
    ['c', unit(1, 0.1)],
    ['d', unit(0, 1)],
  ])
  it('ranks by cosine and drops below the floor', () => {
    const r = relatedAgents('a', agents, vectors)
    expect(r.filter((x) => x.via === 'embedding').map((x) => x.slug)).toEqual(['c', 'b'])
    expect(r.map((x) => x.slug)).not.toContain('d')
  })
  it('scores vectorless candidates by scaled fallback', () => {
    const r = relatedAgents('a', agents, vectors)
    const e = r.find((x) => x.slug === 'e')!
    expect(e.via).toBe('fallback')
    expect(e.score).toBeLessThanOrEqual(1)
  })
  it('uses fallback for all when the target has no vector', () => {
    const r = relatedAgents('e', agents, vectors)
    expect(r.every((x) => x.via === 'fallback')).toBe(true)
  })
})
