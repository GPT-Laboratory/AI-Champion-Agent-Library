import { describe, it, expect } from 'vitest'
import { majority, spread, equivalentRuns } from './aggregate'
import type { CheckResult } from './types'

const c = (id: string, status: CheckResult['status']): CheckResult => ({
  id,
  kind: 'call',
  dimension: 'D2',
  status,
  boundBy: 'none',
  reason: ''
})

describe('majority', () => {
  it('is pessimistic on ties', () => {
    expect(majority(['PASS', 'FAIL'])).toBe('FAIL')
    expect(majority(['FAIL', 'PASS'])).toBe('FAIL')
  })
  it('takes the most frequent state', () => {
    expect(majority(['PASS', 'PASS', 'FAIL'])).toBe('PASS')
    expect(majority(['FAIL', 'FAIL', 'PASS'])).toBe('FAIL')
  })
  it('honours a custom pessimism order', () => {
    expect(majority(['PASS', 'FAIL'], ['PASS', 'FAIL'])).toBe('PASS')
  })
  it('does not throw on empty input', () => {
    expect(majority([])).toBe('ERROR')
  })
})

describe('spread', () => {
  it('reports min, median, max', () => {
    expect(spread([90, 100, 100])).toEqual({ min: 90, median: 100, max: 100 })
    expect(spread([1, 3])).toEqual({ min: 1, median: 2, max: 3 })
    expect(spread([])).toEqual({ min: 0, median: 0, max: 0 })
  })
})

describe('equivalentRuns', () => {
  it('is true only for identical id -> status maps', () => {
    const a = [c('x', 'PASS'), c('y', 'FAIL')]
    expect(equivalentRuns([a, [c('y', 'FAIL'), c('x', 'PASS')]])).toBe(true)
    expect(equivalentRuns([a, [c('x', 'PASS'), c('y', 'PASS')]])).toBe(false)
    expect(equivalentRuns([a, [c('x', 'PASS')]])).toBe(false)
    expect(equivalentRuns([a])).toBe(true)
  })
})
