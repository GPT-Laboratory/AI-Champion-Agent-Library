import { describe, expect, it } from 'vitest'
import {
  QtoError,
  groupLabel,
  groupTotals,
  normaliseRows,
  normaliseUnit,
  parseQuantity,
  type InputRow,
} from './groupTotals'

const rows: InputRow[] = [
  { row_id: 'Q-01', group: 'Putkisto', description: 'Copper pipe DN22', quantity: '48.5', unit: 'm', level: 'Level 1' },
  { row_id: 'Q-02', group: 'ilmanvaihto', description: 'Circular duct DN160', quantity: '36,4', unit: 'm', level: 'Level 1' },
  { row_id: 'Q-03', group: 'Putkisto', description: 'Copper pipe DN15', quantity: '2400', unit: 'mm', level: 'Level 2' },
  { row_id: 'Q-04', group: 'Sähkö', description: 'Cable drum', quantity: '3', unit: 'roll', level: 'Level 1' },
  { row_id: 'Q-05', group: 'PUTKISTO', description: 'Copper pipe DN22', quantity: '48.5', unit: 'm', level: 'Level 1' },
  { row_id: 'Q-06', group: 'Ilmanvaihto', description: 'Supply air diffuser', quantity: '', unit: 'pcs', level: 'Level 2' },
]

describe('normaliseUnit', () => {
  it.each([
    ['m', 'm', 1],
    ['M', 'm', 1],
    ['m²', 'm2', 1],
    ['sqm', 'm2', 1],
    ['m^2', 'm2', 1],
    ['cum', 'm3', 1],
    ['ea', 'pcs', 1],
    ['mm', 'm', 0.001],
    ['cm', 'm', 0.01],
    ['L', 'm3', 0.001],
    ['t', 'kg', 1000],
    ['g', 'kg', 0.001],
  ])('%s -> %s x %s', (u, unit, factor) => {
    expect(normaliseUnit(u)).toMatchObject({ unit, factor })
  })
  it('classifies kind', () => {
    expect(normaliseUnit('m').kind).toBe('canonical')
    expect(normaliseUnit('sqm').kind).toBe('spelling')
    expect(normaliseUnit('mm').kind).toBe('convert')
  })
  it('imperial, unknown and empty units are unresolved, not guessed', () => {
    for (const u of ['roll', 'sf', 'cy', 'lf', '', '  ']) {
      expect(() => normaliseUnit(u)).toThrowError(QtoError)
      try {
        normaliseUnit(u)
      } catch (e) {
        expect((e as QtoError).code).toBe('unresolved-unit')
      }
    }
  })
})

describe('parseQuantity', () => {
  it('decimal comma and point give the same number', () => {
    expect(parseQuantity('36,4')).toBe(36.4)
    expect(parseQuantity('36.4')).toBe(36.4)
  })
  it('removes spaces and thousands separators', () => {
    expect(parseQuantity('1 250')).toBe(1250)
    expect(parseQuantity('1 250,5')).toBe(1250.5)
    expect(parseQuantity('1,250.5')).toBe(1250.5)
    expect(parseQuantity('1.250,5')).toBe(1250.5)
  })
  it('negative and zero parse', () => {
    expect(parseQuantity('-12.5')).toBe(-12.5)
    expect(parseQuantity('0')).toBe(0)
  })
  it('empty, garbage and ambiguous throw typed errors, never NaN', () => {
    const code = (s: string): string => {
      try {
        parseQuantity(s)
      } catch (e) {
        return (e as QtoError).code
      }
      return 'no-error'
    }
    expect(code('')).toBe('missing-quantity')
    expect(code('  ')).toBe('missing-quantity')
    expect(code('abc')).toBe('bad-number')
    expect(code('12..5')).toBe('bad-number')
    expect(code('1,250')).toBe('ambiguous-number')
  })
})

describe('groupLabel', () => {
  it('uses the lookup and the capitalise rule', () => {
    expect(groupLabel('ilmanvaihto')).toBe('Ilmanvaihto')
    expect(groupLabel('PUTKISTO')).toBe('Putkisto')
    expect(groupLabel('sähkö')).toBe('Sähkö')
    expect(groupLabel('sahko')).toBe('Sähkö')
    expect(groupLabel('  doors ')).toBe('Doors')
  })
})

describe('normaliseRows', () => {
  const n = normaliseRows(rows)
  it('matches the answer key cell by cell', () => {
    expect(n.map((r) => [r.row_id, r.group, r.level, r.qty, r.unit, r.factor, r.dup_of, r.issue])).toEqual([
      ['Q-01', 'Putkisto', 'Level 1', '48.5', 'm', '1', '-', 'OK'],
      ['Q-02', 'Ilmanvaihto', 'Level 1', '36.4', 'm', '1', '-', 'NUMFMT'],
      ['Q-03', 'Putkisto', 'Level 2', '2400', 'm', '0.001', '-', 'UNIT-CONV'],
      ['Q-04', 'Sähkö', 'Level 1', '3', 'UNRESOLVED', '-', '-', 'UNRESOLVED-UNIT'],
      ['Q-05', 'Putkisto', 'Level 1', '48.5', 'm', '1', 'Q-01', 'DUPLICATE'],
      ['Q-06', 'Ilmanvaihto', 'Level 2', '-', 'pcs', '1', '-', 'MISSING-QTY'],
    ])
  })
  it('canonical quantities and exclusion reasons', () => {
    expect(n.map((r) => r.canonical)).toEqual([48.5, 36.4, 2.4, null, null, null])
    expect(n.map((r) => r.excluded)).toEqual([null, null, null, 'unresolved-unit', 'duplicate of Q-01', 'missing-quantity'])
  })
  it('duplicate rule: a different quantity, unit or level is not a duplicate; first row is kept', () => {
    const r = normaliseRows([
      { row_id: 'A', group: 'Doors', description: 'D1', quantity: '2', unit: 'pcs', level: 'L1' },
      { row_id: 'B', group: 'doors', description: 'D1', quantity: '2', unit: 'pcs', level: 'L2' },
      { row_id: 'C', group: 'doors', description: 'D1', quantity: '3', unit: 'pcs', level: 'L1' },
      { row_id: 'D', group: 'doors', description: 'D1', quantity: '2', unit: 'pcs', level: 'L1' },
    ])
    expect(r.map((x) => x.dup_of)).toEqual(['-', '-', '-', 'A'])
  })
  it('a missing group or level is a typed error, not a dropped row', () => {
    expect(() => normaliseRows([{ row_id: 'X', group: '', description: 'd', quantity: '1', unit: 'm', level: 'L1' }])).toThrowError(QtoError)
    expect(() => normaliseRows([{ row_id: 'X', group: 'g', description: 'd', quantity: '1', unit: 'm', level: '' }])).toThrowError(QtoError)
  })
  it('a bad number (not empty) is reported as BAD-NUMBER and excluded', () => {
    const r = normaliseRows([{ row_id: 'X', group: 'g', description: 'd', quantity: 'abc', unit: 'm', level: 'L1' }])
    expect(r[0].issue).toBe('BAD-NUMBER')
    expect(r[0].excluded).toBe('bad-number')
  })
})

describe('groupTotals', () => {
  const t = groupTotals(normaliseRows(rows))
  it('totals by group and by level equal the spec answer key', () => {
    expect(t.byGroup).toEqual([
      { key: 'Ilmanvaihto', unit: 'm', total: 36.4, rows: 1 },
      { key: 'Putkisto', unit: 'm', total: 50.9, rows: 2 },
    ])
    expect(t.byLevel).toEqual([
      { key: 'Level 1', unit: 'm', total: 84.9, rows: 2 },
      { key: 'Level 2', unit: 'm', total: 2.4, rows: 1 },
    ])
  })
  it('unconvertible, duplicate and missing rows are excluded and reported, not summed', () => {
    expect(t.excluded).toEqual([
      { row_id: 'Q-04', reason: 'unresolved-unit' },
      { row_id: 'Q-05', reason: 'duplicate of Q-01' },
      { row_id: 'Q-06', reason: 'missing-quantity' },
    ])
  })
  it('different units in one group are never added', () => {
    const r = groupTotals(
      normaliseRows([
        { row_id: 'A', group: 'Walls', description: 'a', quantity: '10', unit: 'm2', level: 'L1' },
        { row_id: 'B', group: 'Walls', description: 'b', quantity: '5', unit: 'm', level: 'L1' },
        { row_id: 'C', group: 'Walls', description: 'c', quantity: '1', unit: 'm3', level: 'L1' },
      ]),
    )
    expect(r.byGroup.map((x) => [x.unit, x.total])).toEqual([['m', 5], ['m2', 10], ['m3', 1]])
  })
  it('float noise is removed (0.1 + 0.2 style sums, mm conversion)', () => {
    const r = groupTotals(
      normaliseRows([
        { row_id: 'A', group: 'P', description: 'a', quantity: '100', unit: 'mm', level: 'L1' },
        { row_id: 'B', group: 'P', description: 'b', quantity: '200', unit: 'mm', level: 'L1' },
      ]),
    )
    expect(r.byGroup[0].total).toBe(0.3)
  })
  it('negative and zero quantities are summed as given', () => {
    const r = groupTotals(
      normaliseRows([
        { row_id: 'A', group: 'D', description: 'a', quantity: '0', unit: 'm', level: 'L1' },
        { row_id: 'B', group: 'D', description: 'b', quantity: '-12.5', unit: 'm', level: 'L1' },
      ]),
    )
    expect(r.byGroup[0].total).toBe(-12.5)
  })
})
