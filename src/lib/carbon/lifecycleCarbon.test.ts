import { describe, expect, it } from 'vitest'
import {
  CarbonError,
  calcProduct,
  compareOptions,
  fmt,
  isExpired,
  mapProducts,
  parseFactor,
  runCarbon,
  type EpdRow,
  type ProductRow,
} from './lifecycleCarbon'

const ND = 'ND'
const epd = (id: string, key: string, unit: string, g: string[], valid: string): EpdRow => ({
  epd_id: id,
  material_key: key,
  product_name: id,
  declared_unit: unit,
  gwp: { 'A1-A3': g[0], A4: g[1], A5: g[2], B: g[3], C: g[4], D: g[5] },
  valid_until: valid,
})
const EPDS: EpdRow[] = [
  epd('EPD-01', 'CONC-C30', 'm3', ['310', ND, ND, ND, ND, ND], '2029-12-31'),
  epd('EPD-02', 'REBAR', 't', ['720', ND, ND, ND, ND, ND], '2028-06-30'),
  epd('EPD-03', 'CU-PIPE', 'm', ['6.1', ND, ND, ND, ND, ND], '2025-06-30'),
  epd('EPD-04', 'MW-INS', 'm2', ['4.2', '0.3', '0.1', ND, '0.2', ND], '2028-03-31'),
  epd('EPD-05', 'WW-INS', 'm2', ['3.5', ND, ND, ND, ND, ND], '2029-01-31'),
  epd('EPD-06', 'CONC-C30', 'm3', ['335', ND, ND, ND, ND, ND], '2027-01-31'),
]
const p = (id: string, key: string, qty: string, unit: string, option = '-'): ProductRow => ({
  product_id: id,
  description: id,
  material_key: key,
  qty,
  unit,
  option,
})
const PRODUCTS: ProductRow[] = [
  p('X-01', 'CONC-C30', '85', 'm3'),
  p('X-02', 'CONC-C25', '40', 'm3'),
  p('X-03', 'REBAR', '3850', 'kg'),
  p('X-04', 'CU-PIPE', '120', 'm'),
  p('X-05', 'MW-INS', '60', 'm2', 'A'),
  p('X-06', 'WW-INS', '60', 'm2', 'B'),
]
const REF = '2026-10-15'

describe('mapping and status vocabulary', () => {
  it('maps the spec key', () => {
    const m = mapProducts(PRODUCTS, EPDS, REF)
    expect(m.map((x) => [x.product_id, x.cand.join(','), x.status])).toEqual([
      ['X-01', 'EPD-01,EPD-06', 'ambiguous'],
      ['X-02', '', 'no-epd'],
      ['X-03', 'EPD-02', 'unit-mismatch'],
      ['X-04', 'EPD-03', 'expired'],
      ['X-05', 'EPD-04', 'matched'],
      ['X-06', 'EPD-05', 'matched'],
    ])
  })
  it('expiry: equal date is not expired; bad dates are typed errors', () => {
    expect(isExpired('2026-10-15', '2026-10-15')).toBe(false)
    expect(isExpired('2026-10-14', '2026-10-15')).toBe(true)
    expect(() => isExpired('2026-13-01', REF)).toThrow(CarbonError)
    expect(() => isExpired('15.10.2026', REF)).toThrow(/bad-date/)
  })
})

describe('Test 1: quantity x factor, stage totals, grand total', () => {
  const r = runCarbon(PRODUCTS, EPDS, REF)
  it('per product values equal the hand numbers', () => {
    const x5 = r.products.find((x) => x.product_id === 'X-05')!
    expect(x5.stages).toEqual({ 'A1-A3': 252, A4: 18, A5: 6, B: null, C: 12, D: null })
    expect(x5.total_a_c).toBe(288)
    const x6 = r.products.find((x) => x.product_id === 'X-06')!
    expect(x6.stages['A1-A3']).toBe(210)
    expect(x6.total_a_c).toBe(210)
  })
  it('stage totals and A-C total equal the spec key', () => {
    expect(r.stageTotals['A1-A3']).toEqual({ total: 462, declared: 2 })
    expect(r.stageTotals.A4).toEqual({ total: 18, declared: 1 })
    expect(r.stageTotals.A5).toEqual({ total: 6, declared: 1 })
    expect(r.stageTotals.B).toEqual({ total: null, declared: 0 })
    expect(r.stageTotals.C).toEqual({ total: 12, declared: 1 })
    expect(r.stageTotals.D).toEqual({ total: null, declared: 0 })
    expect(r.totalAC).toBe(498)
  })
  it('excluded rows carry the status code', () => {
    expect(r.excluded.map((x) => [x.product_id, x.code])).toEqual([
      ['X-01', 'ambiguous'],
      ['X-02', 'no-epd'],
      ['X-03', 'unit-mismatch'],
      ['X-04', 'expired'],
    ])
  })
})

describe('Test 2: unit mismatch', () => {
  it('throws a typed error without a conversion', () => {
    expect(() => calcProduct(p('X-03', 'REBAR', '3850', 'kg'), EPDS[1], REF)).toThrow(/unit-mismatch/)
    expect(() => calcProduct(p('Y', 'K', '5', 'm2'), epd('E', 'K', 'kg', ['2', ND, ND, ND, ND, ND], '2030-01-01'), REF, { convertUnits: true })).toThrow(/unit-mismatch/)
  })
  it('kg to t converts only on request: 3.85 t x 720 = 2772', () => {
    const v = calcProduct(p('X-03', 'REBAR', '3850', 'kg'), EPDS[1], REF, { convertUnits: true })
    expect(v.stages['A1-A3']).toBe(2772)
    const r = runCarbon(PRODUCTS, EPDS, REF, { convertUnits: true })
    expect(r.stageTotals['A1-A3'].total).toBe(3234)
    expect(r.excluded.map((x) => x.product_id)).toEqual(['X-01', 'X-02', 'X-04'])
  })
})

describe('Test 3: missing factor and expired EPD are excluded, never zero', () => {
  it('missing factor and undeclared A1-A3', () => {
    expect(() => calcProduct(p('X', 'K', '5', 'm'), undefined, REF)).toThrow(/missing-factor/)
    expect(() => calcProduct(p('X', 'K', '5', 'm'), epd('E', 'K', 'm', [ND, '1', ND, ND, ND, ND], '2030-01-01'), REF)).toThrow(/missing-factor/)
  })
  it('expired EPD throws and is excluded from the total', () => {
    expect(() => calcProduct(p('X-04', 'CU-PIPE', '120', 'm'), EPDS[2], REF)).toThrow(/expired-epd/)
    const r = runCarbon([PRODUCTS[3]], EPDS, REF)
    expect(r.totalAC).toBeNull()
    expect(r.products).toHaveLength(0)
  })
  it('bad numbers are typed errors', () => {
    expect(() => calcProduct(p('X', 'K', 'abc', 'm'), EPDS[2], '2020-01-01')).toThrow(/bad-number/)
    expect(() => calcProduct(p('X', 'K', '-3', 'm'), EPDS[2], '2020-01-01')).toThrow(/bad-number/)
    expect(() => parseFactor('1,5')).toThrow(/bad-number/)
  })
})

describe('Test 4: comparison of two options', () => {
  const r = runCarbon(PRODUCTS, EPDS, REF)
  it('A1-A3 basis: B is lower by 42 (-16.67 %)', () => {
    const c = compareOptions(r, 'A', 'B', 'A1-A3')
    expect(c).toMatchObject({ a_total: 252, b_total: 210, lower: 'B', abs_diff: 42, pct_of_baseline: -16.67 })
  })
  it('A-C basis: -27.08 % and a stage-set warning', () => {
    const c = compareOptions(r, 'A', 'B', 'A-C')
    expect(c).toMatchObject({ a_total: 288, b_total: 210, abs_diff: 78, pct_of_baseline: -27.08 })
    expect(c.warnings.join(' ')).toMatch(/declared stages differ/)
  })
  it('equal totals and nothing to compare', () => {
    const same = runCarbon([p('A1', 'WW-INS', '60', 'm2', 'A'), p('B1', 'WW-INS', '60', 'm2', 'B')], EPDS, REF)
    expect(compareOptions(same, 'A', 'B', 'A1-A3')).toMatchObject({ lower: 'equal', abs_diff: 0, pct_of_baseline: 0 })
    expect(() => compareOptions(r, 'A', 'Z', 'A1-A3')).toThrow(/nothing-to-compare/)
  })
  it('warns when options have excluded rows', () => {
    const r2 = runCarbon([...PRODUCTS, p('X-07', 'NOPE', '1', 'm', 'B')], EPDS, REF)
    expect(compareOptions(r2, 'A', 'B', 'A1-A3').warnings.join(' ')).toMatch(/excluded/)
  })
})

describe('Test 5: regressions for the skill bugs (spec section 6)', () => {
  it('bug 1: one identifier resolves every listed record; unknown id is typed', () => {
    for (const e of EPDS) {
      const m = mapProducts([p('P', e.material_key, '1', e.declared_unit)], EPDS, REF)
      expect(m[0].cand).toContain(e.epd_id)
    }
    expect(mapProducts([p('P', 'UNKNOWN', '1', 'm')], EPDS, REF)[0].status).toBe('no-epd')
  })
  it('bug 2: no silent kg/t multiplication', () => {
    const r = runCarbon([p('X-03', 'REBAR', '3850', 'kg')], EPDS, REF)
    expect(r.totalAC).toBeNull()
    expect(r.excluded[0].code).toBe('unit-mismatch')
  })
  it('bug 3: module D credit is not part of the A-C total and is reported separately', () => {
    const e = epd('E-D', 'K', 'kg', ['10', ND, ND, ND, ND, '-4'], '2030-01-01')
    const r = runCarbon([p('P', 'K', '5', 'kg')], [e], REF)
    expect(r.totalAC).toBe(50)
    expect(r.totalD).toBe(-20)
    expect(r.stageTotals.D.total).toBe(-20)
  })
  it('bug 4: stage totals always add up to the A-C total; unusable items are reported', () => {
    const r = runCarbon(PRODUCTS, EPDS, REF, { convertUnits: true })
    const sum = (['A1-A3', 'A4', 'A5', 'B', 'C'] as const).reduce((s, k) => s + (r.stageTotals[k].total ?? 0), 0)
    expect(Math.abs(sum - (r.totalAC ?? 0))).toBeLessThan(1e-9)
    expect(r.products.length + r.excluded.length).toBe(PRODUCTS.length)
  })
  it('bug 5: an undeclared stage is null, not 0, and is not summed', () => {
    const x6 = runCarbon(PRODUCTS, EPDS, REF).products.find((x) => x.product_id === 'X-06')!
    expect(x6.stages.B).toBeNull()
    expect(x6.stages.A4).toBeNull()
    expect(parseFactor('ND')).toBeNull()
    expect(parseFactor('')).toBeNull()
    expect(parseFactor('0')).toBe(0)
  })
  it('bug 6: zero baseline gives undefined percentage, not a crash or 0 %', () => {
    const z = epd('E-Z', 'ZERO', 'm', ['0', ND, ND, ND, ND, ND], '2030-01-01')
    const r = runCarbon([p('A1', 'ZERO', '5', 'm', 'A'), p('B1', 'WW-INS', '60', 'm2', 'B')], [z, ...EPDS], REF)
    const c = compareOptions(r, 'A', 'B', 'A1-A3')
    expect(c.pct_of_baseline).toBe('undefined')
    expect(c.lower).toBe('A')
  })
  it('bug 7: negative baseline uses abs(base): a worse alternative is a positive change', () => {
    const e1 = epd('E-N1', 'N1', 'm3', ['-100', ND, ND, ND, ND, ND], '2030-01-01')
    const e2 = epd('E-N2', 'N2', 'm3', ['-50', ND, ND, ND, ND, ND], '2030-01-01')
    const r = runCarbon([p('A1', 'N1', '1', 'm3', 'A'), p('B1', 'N2', '1', 'm3', 'B')], [e1, e2], REF)
    const c = compareOptions(r, 'A', 'B', 'A1-A3')
    expect(c.pct_of_baseline).toBe(50)
    expect(c.lower).toBe('A')
    expect(r.warnings.join(' ')).toMatch(/negative/)
  })
  it('bug 11: no float drift and 2-decimal display', () => {
    const e = epd('E-F', 'F', 'm', ['0.1', ND, ND, ND, ND, ND], '2030-01-01')
    const r = runCarbon([p('P', 'F', '3', 'm')], [e], REF)
    expect(r.totalAC).toBe(0.3)
    expect(fmt(r.totalAC)).toBe('0.30')
    expect(runCarbon(PRODUCTS, EPDS, REF).products[0].stages['A1-A3']).toBe(252)
    expect(fmt(null)).toBe('not declared')
    expect(fmt(16.666666)).toBe('16.67')
  })
})
