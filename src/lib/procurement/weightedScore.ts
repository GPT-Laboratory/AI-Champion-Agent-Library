// Corrected weighted bid score (own code). Replaces the unweighted sum / hidden x10 scale of the
// reference skill: total = sum(score_i * w_i) / sum(w), on the 0-10 scale, rounded to 2 decimals
// at output only. Pure functions, no I/O.

export interface Criterion {
  name: string
  weight: number
}

export type ScoreErrorCode =
  | 'empty-criteria'
  | 'empty-name'
  | 'duplicate-criterion'
  | 'bad-weight'
  | 'zero-weights'
  | 'bad-score'
  | 'missing-score'
  | 'unknown-criterion'

export class WeightedScoreError extends Error {
  readonly code: ScoreErrorCode
  constructor(code: ScoreErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'WeightedScoreError'
    this.code = code
  }
}

export const MIN_SCORE = 0
export const MAX_SCORE = 10

export function validateCriteria(criteria: Criterion[]): void {
  if (!Array.isArray(criteria) || criteria.length === 0) throw new WeightedScoreError('empty-criteria', 'at least one criterion is required')
  const seen = new Set<string>()
  let sum = 0
  for (const c of criteria) {
    if (typeof c.name !== 'string' || c.name.trim() === '') throw new WeightedScoreError('empty-name', 'criterion name is empty')
    if (seen.has(c.name)) throw new WeightedScoreError('duplicate-criterion', `criterion "${c.name}" appears twice`)
    seen.add(c.name)
    if (typeof c.weight !== 'number' || !Number.isFinite(c.weight) || c.weight < 0) {
      throw new WeightedScoreError('bad-weight', `weight of "${c.name}" must be a finite number >= 0`)
    }
    sum += c.weight
  }
  if (!(sum > 0)) throw new WeightedScoreError('zero-weights', 'at least one weight must be positive')
}

function validateScores(criteria: Criterion[], scores: Record<string, number>): void {
  const names = new Set(criteria.map((c) => c.name))
  for (const key of Object.keys(scores)) {
    if (!names.has(key)) throw new WeightedScoreError('unknown-criterion', `score for unknown criterion "${key}"`)
  }
  for (const c of criteria) {
    const s = scores[c.name]
    if (s === undefined) throw new WeightedScoreError('missing-score', `no score for "${c.name}"`)
    if (typeof s !== 'number' || !Number.isFinite(s) || s < MIN_SCORE || s > MAX_SCORE) {
      throw new WeightedScoreError('bad-score', `score for "${c.name}" must be a number from ${MIN_SCORE} to ${MAX_SCORE}`)
    }
  }
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** sum(score*weight)/sum(weights), 0-10 scale, rounded to 2 decimals. Weight scale (0.4 or 40) does not matter. */
export function weightedScore(input: { criteria: Criterion[]; scores: Record<string, number> }): number {
  validateCriteria(input.criteria)
  validateScores(input.criteria, input.scores)
  let num = 0
  let den = 0
  for (const c of input.criteria) {
    num += input.scores[c.name] * c.weight
    den += c.weight
  }
  return round2(num / den)
}

export interface RankedBid {
  id: string
  total: number
  rank: number
}

/** Totals per bid, sorted by descending total. Equal (rounded) totals share a rank (1, 1, 3); input order is kept in a tie. */
export function rankBids(criteria: Criterion[], bids: { id: string; scores: Record<string, number> }[]): RankedBid[] {
  const scored = bids.map((b, i) => ({ id: b.id, i, total: weightedScore({ criteria, scores: b.scores }) }))
  scored.sort((x, y) => y.total - x.total || x.i - y.i)
  let rank = 0
  let prev: number | null = null
  return scored.map((s, pos) => {
    if (prev === null || s.total !== prev) rank = pos + 1
    prev = s.total
    return { id: s.id, total: s.total, rank }
  })
}
