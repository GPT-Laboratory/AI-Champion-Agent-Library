import { describe, expect, it } from 'vitest'
import { BmsError, bindPoints, evaluateReading, type AssetRow, type HintRow, type PointRow } from './pointStatus'

const hint = (o: Partial<HintRow> = {}): HintRow => ({ keyword: 'co2', tag: 'SYN-CO2', expected_unit: 'ppm', low: '400', high: '1000', ...o })

describe('evaluateReading', () => {
  it('inside the band is normal, below low and above high are flagged', () => {
    expect(evaluateReading('700', 'ppm', hint())).toBe('normal')
    expect(evaluateReading('399.9', 'ppm', hint())).toBe('below_minimum')
    expect(evaluateReading('1350', 'ppm', hint())).toBe('above_maximum')
  })
  it('boundary values low and high are inside the band (inclusive)', () => {
    expect(evaluateReading('400', 'ppm', hint())).toBe('normal')
    expect(evaluateReading('1000', 'ppm', hint())).toBe('normal')
  })
  it('missing, non-numeric, NaN or infinite reading is no-data, never normal (skill defect: NaN judged normal)', () => {
    for (const r of ['', '  ', 'n/a', 'NaN', 'Infinity', '12abc', '1e3', undefined]) expect(evaluateReading(r, 'ppm', hint())).toBe('no-data')
  })
  it('a unit mismatch is flagged and never compared, even for a reading that would be out of band', () => {
    expect(evaluateReading('1200', 'rpm', hint({ expected_unit: '%', low: '0', high: '100' }))).toBe('unit-mismatch')
    expect(evaluateReading('50', '', hint({ expected_unit: '%', low: '0', high: '100' }))).toBe('unit-mismatch')
  })
  it('an open side is unbounded; both sides empty is no-limits', () => {
    expect(evaluateReading('-50', 'C', hint({ expected_unit: 'C', low: '', high: '30' }))).toBe('normal')
    expect(evaluateReading('31', 'C', hint({ expected_unit: 'C', low: '', high: '30' }))).toBe('above_maximum')
    expect(evaluateReading('5', 'C', hint({ expected_unit: 'C', low: '10', high: '' }))).toBe('below_minimum')
    expect(evaluateReading('5', 'C', hint({ expected_unit: 'C', low: '', high: '' }))).toBe('no-limits')
  })
  it('handles negative and decimal numbers; avoids float noise', () => {
    expect(evaluateReading('-3.5', 'C', hint({ expected_unit: 'C', low: '-5', high: '5' }))).toBe('normal')
    expect(evaluateReading('0.30000000000000004', 'C', hint({ expected_unit: 'C', low: '0.1', high: '0.3' }))).toBe('no-data') // 17 digits is not a plain short decimal
  })
  it('regression: low greater than high is a typed error (skill flags every reading)', () => {
    expect(() => evaluateReading('5', 'ppm', hint({ low: '1000', high: '400' }))).toThrow(BmsError)
    expect(() => evaluateReading('5', 'ppm', hint({ low: 'abc' }))).toThrow(/bad-limit/)
  })
})

const assets: AssetRow[] = [
  { asset_id: 'AHU-01', name: 'AHU 1', kind: 'equipment' },
  { asset_id: 'PMP-05', name: 'Pump 5', kind: 'equipment' },
  { asset_id: 'PMP-05', name: 'Pump 5 dup', kind: 'equipment' },
]
const hints: HintRow[] = [
  { keyword: 'supply air temperature', tag: 'SYN-SAT', expected_unit: 'C', low: '12', high: '24' },
  { keyword: 'air', tag: 'SYN-AIR', expected_unit: 'C', low: '', high: '' },
]
const p = (id: string, name: string, description: string, unit: string, reading: string): PointRow => ({ point_id: id, point_name: name, description, unit, reading })

describe('bindPoints', () => {
  it('binds by exact id prefix, first hint in table order, helper status', () => {
    const [a] = bindPoints([p('P1', 'AHU-01.SAT', 'supply air temperature', 'C', '18.5')], assets, hints)
    expect(a).toMatchObject({ asset_id: 'AHU-01', tag: 'SYN-SAT', binding: 'bound', status: 'normal', review: 'NO', low: '12', high: '24' })
  })
  it('regression: unknown prefix is unbound (skill silently ignores), AHU-09 is not AHU-01', () => {
    const [a] = bindPoints([p('P3', 'AHU-09.SAT', 'supply air temperature', 'C', '17')], assets, hints)
    expect(a).toMatchObject({ asset_id: 'UNMAPPED', binding: 'unbound', status: 'not-bound', review: 'YES' })
  })
  it('regression: duplicate asset id is ambiguous, never overwritten', () => {
    const [a] = bindPoints([p('P6', 'PMP-05.DP', 'supply air temperature', 'C', '17')], assets, hints)
    expect(a).toMatchObject({ asset_id: 'AMBIGUOUS', binding: 'ambiguous', status: 'not-bound' })
  })
  it('no keyword contained is untagged (abbreviations not guessed)', () => {
    const [a] = bindPoints([p('P4', 'AHU-01.RAT', 'return temp', 'C', '21')], assets, hints)
    expect(a).toMatchObject({ tag: 'UNTAGGED', binding: 'untagged', status: 'untagged', low: '-', high: '-' })
  })
  it('a prefix is the text before the first dot, or the whole name', () => {
    const [a, b] = bindPoints([p('P7', 'AHU-01', 'air', 'C', '1'), p('P8', 'AHU-01.A.B', 'air', 'C', '')], assets, hints)
    expect(a.asset_id).toBe('AHU-01')
    expect(b).toMatchObject({ asset_id: 'AHU-01', status: 'no-data', tag: 'SYN-AIR' })
  })
  it('binding order: unbound before untagged before unit-mismatch', () => {
    const [a, b] = bindPoints([p('P9', 'ZZ.X', 'nothing', 'C', '1'), p('P10', 'AHU-01.X', 'supply air temperature', 'F', '70')], assets, hints)
    expect(a.binding).toBe('unbound')
    expect(b).toMatchObject({ binding: 'unit-mismatch', status: 'unit-mismatch', review: 'YES' })
  })
})
