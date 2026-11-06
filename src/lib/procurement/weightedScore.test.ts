import { describe, expect, it } from 'vitest'
import { WeightedScoreError, rankBids, weightedScore } from './weightedScore'

const crit = [
  { name: 'price', weight: 50 },
  { name: 'delivery_time', weight: 20 },
  { name: 'technical_compliance', weight: 20 },
  { name: 'references', weight: 10 },
]
const A = { price: 6, delivery_time: 5, technical_compliance: 9, references: 8 }
const B = { price: 9, delivery_time: 8, technical_compliance: 4, references: 3 }
const C = { price: 5, delivery_time: 9, technical_compliance: 8, references: 4 }

describe('weightedScore', () => {
  it('computes sum(score*weight)/sum(weights) for the spec answer key', () => {
    expect(weightedScore({ criteria: crit, scores: A })).toBe(6.6)
    expect(weightedScore({ criteria: crit, scores: B })).toBe(7.2)
    expect(weightedScore({ criteria: crit, scores: C })).toBe(6.3)
  })

  it('regression: weights decide the winner (the unweighted sum and the old score*weight*10 differ)', () => {
    const c = [{ name: 'price', weight: 0.7 }, { name: 'delivery', weight: 0.3 }]
    const a = { price: 9, delivery: 3 }
    const b = { price: 5, delivery: 9 }
    const wa = weightedScore({ criteria: c, scores: a })
    const wb = weightedScore({ criteria: c, scores: b })
    expect(wa).toBe(7.2)
    expect(wb).toBe(6.2)
    // the unweighted sum (skill total_weighted_score) ranks B first
    expect(a.price + a.delivery).toBeLessThan(b.price + b.delivery)
    // the weighted total ranks A first
    expect(wa).toBeGreaterThan(wb)
    // the old formula used a hidden x10 scale
    const old = (s: typeof a) => s.price * 0.7 * 10 + s.delivery * 0.3 * 10
    expect(old(a)).not.toBe(wa)
    expect(old(a)).toBeCloseTo(72)
  })

  it('answer key: unweighted leader A (28) differs from weighted leader B', () => {
    const sum = (s: Record<string, number>) => Object.values(s).reduce((x, y) => x + y, 0)
    expect([sum(A), sum(B), sum(C)]).toEqual([28, 24, 26])
    const r = rankBids(crit, [{ id: 'A', scores: A }, { id: 'B', scores: B }, { id: 'C', scores: C }])
    expect(r.map((x) => x.id)).toEqual(['B', 'A', 'C'])
  })

  it('changing a weight changes the total', () => {
    const base = weightedScore({ criteria: crit, scores: A })
    const changed = weightedScore({ criteria: [{ name: 'price', weight: 10 }, ...crit.slice(1)], scores: A })
    expect(changed).not.toBe(base)
  })

  it('weights 40/30/30 and 0.4/0.3/0.3 give the same result', () => {
    const s = { a: 7, b: 2, c: 9 }
    const p = weightedScore({ criteria: [{ name: 'a', weight: 40 }, { name: 'b', weight: 30 }, { name: 'c', weight: 30 }], scores: s })
    const f = weightedScore({ criteria: [{ name: 'a', weight: 0.4 }, { name: 'b', weight: 0.3 }, { name: 'c', weight: 0.3 }], scores: s })
    expect(p).toBe(f)
    expect(p).toBe(6.1)
  })

  it('rounds to 2 decimals at the end only', () => {
    const v = weightedScore({ criteria: [{ name: 'a', weight: 1 }, { name: 'b', weight: 1 }, { name: 'c', weight: 1 }], scores: { a: 1, b: 1, c: 2 } })
    expect(v).toBe(1.33)
  })

  const err = (fn: () => unknown, code: string) => {
    try {
      fn()
    } catch (e) {
      expect(e).toBeInstanceOf(WeightedScoreError)
      expect((e as WeightedScoreError).code).toBe(code)
      return
    }
    throw new Error('expected an error')
  }

  it('throws typed errors', () => {
    err(() => weightedScore({ criteria: [], scores: {} }), 'empty-criteria')
    err(() => weightedScore({ criteria: [{ name: 'a', weight: -1 }, { name: 'b', weight: 2 }], scores: { a: 1, b: 1 } }), 'bad-weight')
    err(() => weightedScore({ criteria: [{ name: 'a', weight: Number.NaN }], scores: { a: 1 } }), 'bad-weight')
    err(() => weightedScore({ criteria: [{ name: 'a', weight: 0 }, { name: 'b', weight: 0 }], scores: { a: 1, b: 1 } }), 'zero-weights')
    err(() => weightedScore({ criteria: [{ name: 'a', weight: 1 }], scores: { a: 11 } }), 'bad-score')
    err(() => weightedScore({ criteria: [{ name: 'a', weight: 1 }], scores: { a: -0.5 } }), 'bad-score')
    err(() => weightedScore({ criteria: [{ name: 'a', weight: 1 }], scores: { a: Number.NaN } }), 'bad-score')
    err(() => weightedScore({ criteria: [{ name: 'a', weight: 1 }, { name: 'b', weight: 1 }], scores: { a: 1 } }), 'missing-score')
    err(() => weightedScore({ criteria: [{ name: 'a', weight: 1 }], scores: { a: 1, z: 3 } }), 'unknown-criterion')
    err(() => weightedScore({ criteria: [{ name: 'a', weight: 1 }, { name: 'a', weight: 1 }], scores: { a: 1 } }), 'duplicate-criterion')
    err(() => weightedScore({ criteria: [{ name: ' ', weight: 1 }], scores: {} }), 'empty-name')
  })

  it('a zero weight is allowed when another weight is positive', () => {
    expect(weightedScore({ criteria: [{ name: 'a', weight: 0 }, { name: 'b', weight: 1 }], scores: { a: 10, b: 4 } })).toBe(4)
  })
})

describe('rankBids', () => {
  const c = [{ name: 'a', weight: 1 }]
  it('ties share a rank and keep input order', () => {
    const r = rankBids(c, [
      { id: 'X', scores: { a: 5 } },
      { id: 'Y', scores: { a: 8 } },
      { id: 'Z', scores: { a: 5 } },
    ])
    expect(r).toEqual([
      { id: 'Y', total: 8, rank: 1 },
      { id: 'X', total: 5, rank: 2 },
      { id: 'Z', total: 5, rank: 2 },
    ])
  })
  it('skips a rank after a tie', () => {
    const r = rankBids(c, [{ id: 'a', scores: { a: 9 } }, { id: 'b', scores: { a: 9 } }, { id: 'c', scores: { a: 1 } }])
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3])
  })
  it('propagates validation errors', () => {
    expect(() => rankBids(c, [{ id: 'a', scores: {} }])).toThrow(WeightedScoreError)
  })
})
