import { describe, expect, it } from 'vitest'
import type { GoldenCheck } from './cases'
import { GOLDEN_MIN_LEN, checkGoldenIsolation, goldenFingerprints } from './isolation'

const g = (fv: Record<string, unknown>): GoldenCheck => ({ id: 'c1', type: 'call', expect: { field_value: fv } })

describe('goldenFingerprints', () => {
  it('uses one explicit minimum length', () => {
    expect(GOLDEN_MIN_LEN).toBe(8)
  })
  it('keeps length == minLen and drops minLen-1', () => {
    const atMin = 'a'.repeat(GOLDEN_MIN_LEN)
    const below = 'b'.repeat(GOLDEN_MIN_LEN - 1)
    expect(goldenFingerprints([g({ x: atMin, y: below })])).toEqual([atMin])
  })
  it('lowercases, dedupes and stringifies numbers', () => {
    const fp = goldenFingerprints([g({ a: 'ACM-000042', b: 'acm-000042', c: 123456789 })])
    expect(fp.sort()).toEqual(['123456789', 'acm-000042'])
  })
  it('walks nested values and ignores checks without field_value', () => {
    const fp = goldenFingerprints([g({ n: { deep: ['Example Supplier 3'] } }), { id: 'c2', type: 'tool_exists' }])
    expect(fp).toEqual(['example supplier 3'])
  })
  it('honours an explicit minLen', () => {
    expect(goldenFingerprints([g({ x: 'abc' })], 3)).toEqual(['abc'])
  })
})

describe('checkGoldenIsolation', () => {
  const golden = [g({ id: 'ACM-000042' })]
  it('flags a fixture containing an expected string (case-insensitive)', () => {
    const r = checkGoldenIsolation([{ path: 'spec/a.csv', content: 'row,acm-000042,x' }], golden)
    expect(r.ok).toBe(false)
    expect(r.violations).toEqual([{ path: 'spec/a.csv', fingerprint: 'acm-000042' }])
  })
  it('passes a clean fixture', () => {
    expect(checkGoldenIsolation([{ path: 'spec/a.csv', content: 'id,name' }], golden).ok).toBe(true)
  })
  it('boundary: minLen-1 string is not compared, minLen string is', () => {
    const below = 'z'.repeat(GOLDEN_MIN_LEN - 1)
    const atMin = 'z'.repeat(GOLDEN_MIN_LEN)
    const files = [{ path: 'f', content: `xx ${below} xx` }]
    expect(checkGoldenIsolation(files, [g({ v: below })]).ok).toBe(true)
    const files2 = [{ path: 'f', content: `xx ${atMin} xx` }]
    expect(checkGoldenIsolation(files2, [g({ v: atMin })]).ok).toBe(false)
  })
})
