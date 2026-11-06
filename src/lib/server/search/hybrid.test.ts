import { describe, it, expect } from 'vitest'
import { cosine, rrf, hybridSearch, SIM_FLOOR } from './hybrid.js'
import { buildBm25Index } from './bm25.js'

const v = (...n: number[]) => Float32Array.from(n)
const doc = (slug: string, title: string, text: string) => ({ slug, title, tags: [], text })

describe('cosine', () => {
  it('identical = 1, orthogonal = 0, mismatch = 0', () => {
    expect(cosine(v(1, 0, 0), v(1, 0, 0))).toBe(1)
    expect(cosine(v(1, 0, 0), v(0, 1, 0))).toBe(0)
    expect(cosine(v(1, 0), v(1, 0, 0))).toBe(0)
  })
})

describe('rrf', () => {
  it('ties score 1/61+1/62 and break by slug', () => {
    const r = rrf([
      { weight: 1, slugs: ['a', 'b'] },
      { weight: 1, slugs: ['b', 'a'] },
    ])
    expect(r.map(x => x.slug)).toEqual(['a', 'b'])
    expect(r[0].score).toBeCloseTo(1 / 61 + 1 / 62, 10)
    expect(r[1].score).toBeCloseTo(1 / 61 + 1 / 62, 10)
  })

  it('honours weights and only includes ranked docs', () => {
    const r = rrf([
      { weight: 1, slugs: ['a'] },
      { weight: 2, slugs: ['b'] },
    ])
    expect(r.map(x => x.slug)).toEqual(['b', 'a'])
    expect(rrf([{ weight: 1, slugs: [] }])).toEqual([])
  })
})

describe('hybridSearch', () => {
  const bm25 = buildBm25Index([
    doc('x', 'Exact', 'alpha keyword here'),
    doc('a', 'Other', 'nothing relevant'),
    doc('m', 'Mid', 'unrelated words'),
  ])

  it('null query vector -> BM25 ranking, mode bm25', () => {
    const r = hybridSearch({ query: 'alpha', bm25, vectors: new Map(), queryVector: null })
    expect(r.mode).toBe('bm25')
    expect(r.results).toEqual(bm25.search('alpha'))
  })

  it('semantic-only paraphrase appears; below-floor docs are dropped', () => {
    const q = v(1, 0, 0)
    const vectors = new Map([
      ['a', v(0.9, Math.sqrt(1 - 0.81), 0)],
      ['m', v(0.1, Math.sqrt(1 - 0.01), 0)],
    ])
    const r = hybridSearch({ query: 'zzzz', bm25, vectors, queryVector: q })
    expect(r.mode).toBe('hybrid')
    expect(r.results.map(s => s.slug)).toEqual(['a'])
  })

  it('everything below floor and BM25 empty -> []', () => {
    const vectors = new Map([['a', v(0, 1, 0)]])
    const r = hybridSearch({ query: 'zzzz', bm25, vectors, queryVector: v(1, 0, 0) })
    expect(r.results).toEqual([])
    expect(SIM_FLOOR).toBeGreaterThan(0)
  })

  it('short queries weight semantic 0.5, long queries 1.0 (order flips)', () => {
    const b = buildBm25Index([doc('x', 'X', 'alpha'), doc('a', 'A', 'filler')])
    const vectors = new Map([['a', v(1, 0, 0)]])
    const q = v(1, 0, 0)
    const short = hybridSearch({ query: 'alpha', bm25: b, vectors, queryVector: q })
    expect(short.results.map(s => s.slug)).toEqual(['x', 'a'])
    const long = hybridSearch({ query: 'alpha beta gamma', bm25: b, vectors, queryVector: q })
    expect(long.results.map(s => s.slug)).toEqual(['a', 'x'])
  })

  it('exact keyword hit stays in the top 3 despite low cosine', () => {
    const b = buildBm25Index([
      doc('kw', 'Keyword', 'sprinkler'),
      doc('s1', 'S1', 'none'),
      doc('s2', 'S2', 'none'),
      doc('s3', 'S3', 'none'),
    ])
    const vectors = new Map([
      ['kw', v(0, 1, 0)],
      ['s1', v(1, 0, 0)],
      ['s2', v(0.95, 0.31, 0)],
      ['s3', v(0.9, 0.43, 0)],
    ])
    const r = hybridSearch({ query: 'sprinkler', bm25: b, vectors, queryVector: v(1, 0, 0) })
    expect(r.results.slice(0, 3).map(s => s.slug)).toContain('kw')
  })

  it('limit truncates', () => {
    const vectors = new Map([
      ['a', v(1, 0, 0)],
      ['m', v(1, 0, 0)],
      ['x', v(1, 0, 0)],
    ])
    const r = hybridSearch({ query: 'zzzz', bm25, vectors, queryVector: v(1, 0, 0), limit: 2 })
    expect(r.results.length).toBe(2)
  })
})
