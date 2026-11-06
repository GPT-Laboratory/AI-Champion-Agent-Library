// Rerun aggregation helpers. Pure and total (never throw). No $lib imports.
import type { CheckResult } from './types'

/** Worst first. Earlier entries win ties in majority(). Unlisted states rank after the listed ones. */
export const DEFAULT_PESSIMISM: readonly string[] = [
  'ERROR',
  'INSTALL_FAILED',
  'GEN_FAILED',
  'UNAVAILABLE',
  'FAIL',
  'PENDING_HUMAN',
  'SKIPPED_FIXTURE',
  'NA_TRANSPORT',
  'NA_MODALITY',
  'PASS'
]

/** Most frequent state; ties resolve to the most pessimistic one (FAIL beats PASS). Empty input yields 'ERROR'. */
export function majority<T extends string>(states: T[], pessimism: readonly string[] = DEFAULT_PESSIMISM): T {
  if (states.length === 0) return 'ERROR' as T
  const counts = new Map<T, number>()
  for (const s of states) counts.set(s, (counts.get(s) ?? 0) + 1)
  const rank = (s: string) => {
    const i = pessimism.indexOf(s)
    return i === -1 ? pessimism.length : i
  }
  let best: T = states[0]
  let bestN = -1
  for (const [s, n] of counts) {
    if (n > bestN || (n === bestN && rank(s) < rank(best))) {
      best = s
      bestN = n
    }
  }
  return best
}

export function spread(nums: number[]): { min: number; median: number; max: number } {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (xs.length === 0) return { min: 0, median: 0, max: 0 }
  const mid = Math.floor(xs.length / 2)
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
  return { min: xs[0], median, max: xs[xs.length - 1] }
}

const statusMap = (run: CheckResult[]) =>
  JSON.stringify(run.map((c) => [c.id, c.status]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))

/** True when every run has the identical id -> status map. */
export function equivalentRuns(runs: CheckResult[][]): boolean {
  if (runs.length < 2) return true
  const first = statusMap(runs[0])
  return runs.every((r) => statusMap(r) === first)
}
