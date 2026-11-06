import { describe, expect, it } from 'vitest'
import {
  DeliveryError,
  evaluateLine,
  enrichLines,
  formatQuantity,
  parseIsoDate,
  parseQuantity,
  verdictFromParts,
  type RawLine,
} from './deliveryCheck'

const AS_OF = '2026-03-02'
const line = (o: Partial<RawLine> = {}): RawLine => ({
  line_id: 'X-1',
  po_number: 'PO-1',
  description: 'Test',
  priority: 'normal',
  status: 'in_transit',
  unit: 'm',
  qty_ordered: '100',
  qty_received: '0',
  scheduled_date: '2026-02-27',
  actual_date: '',
  delay_reason: '',
  ...o,
})

describe('quantities', () => {
  it('parses point and comma decimals the same', () => {
    expect(parseQuantity('12.5', 'qty_ordered')).toBe(12.5)
    expect(parseQuantity('12,5', 'qty_ordered')).toBe(12.5)
    expect(parseQuantity(' 7 ', 'qty_received')).toBe(7)
  })
  it('rejects negative, non-numeric and malformed quantities', () => {
    for (const bad of ['-1', 'abc', '1.2.3', '1e3', '12 m']) {
      expect(() => parseQuantity(bad, 'qty_received')).toThrowError(DeliveryError)
    }
  })
  it('formats without float noise', () => {
    expect(formatQuantity(0.1 + 0.2)).toBe('0.3')
    expect(formatQuantity(120)).toBe('120')
    expect(formatQuantity(-2)).toBe('-2')
  })
})

describe('balance, balance_flag and is_complete rule (received >= ordered)', () => {
  it('balance = ordered minus received with the unit; flags complete, short, over', () => {
    const c = evaluateLine(line({ qty_ordered: '120', qty_received: '120', status: 'delivered', actual_date: '2026-02-24' }), AS_OF)
    expect([c.balance, c.balance_flag]).toEqual(['0 m', 'complete'])
    const s = evaluateLine(line({ qty_ordered: '300', qty_received: '180' }), AS_OF)
    expect([s.balance, s.balance_flag]).toEqual(['120 m', 'short'])
    const o = evaluateLine(line({ unit: 'kpl', qty_ordered: '10', qty_received: '12', status: 'delivered', actual_date: '2026-02-27' }), AS_OF)
    expect([o.balance, o.balance_flag]).toEqual(['-2 kpl', 'over'])
  })
  it('decimal comma and point give the same balance', () => {
    const a = evaluateLine(line({ qty_ordered: '12,5', qty_received: '2,25' }), AS_OF)
    const b = evaluateLine(line({ qty_ordered: '12.5', qty_received: '2.25' }), AS_OF)
    expect(a.balance).toBe('10.25 m')
    expect(a).toEqual(b)
  })
  it('a blank received quantity is "-", never 0 and never full (skill assumed full receipt)', () => {
    const e = evaluateLine(line({ qty_received: '' }), AS_OF)
    expect([e.balance, e.balance_flag, e.days_late, e.late_flag]).toEqual(['-', '-', '-', '-'])
  })
})

describe('days_late and late_flag from an explicit as_of', () => {
  it('short line: as_of minus scheduled; the first receipt date of a partial is not used', () => {
    const e = evaluateLine(line({ status: 'partial', qty_ordered: '300', qty_received: '180', scheduled_date: '2026-02-20', actual_date: '2026-02-18' }), AS_OF)
    expect([e.days_late, e.late_flag]).toEqual(['10', 'Y'])
  })
  it('complete line: actual minus scheduled', () => {
    const e = evaluateLine(line({ status: 'delivered', qty_received: '100', scheduled_date: '2026-02-20', actual_date: '2026-02-25' }), AS_OF)
    expect([e.days_late, e.late_flag]).toEqual(['5', 'Y'])
  })
  it('never negative: early and not-yet-due give 0 and N', () => {
    expect(evaluateLine(line({ status: 'delivered', qty_received: '100', scheduled_date: '2026-02-28', actual_date: '2026-02-20' }), AS_OF)).toMatchObject({ days_late: '0', late_flag: 'N' })
    expect(evaluateLine(line({ scheduled_date: '2026-03-16' }), AS_OF)).toMatchObject({ days_late: '0', late_flag: 'N' })
  })
  it('due today is not late (0 days)', () => {
    expect(evaluateLine(line({ scheduled_date: AS_OF }), AS_OF)).toMatchObject({ days_late: '0', late_flag: 'N' })
  })
  it('crosses month, year and leap day', () => {
    expect(evaluateLine(line({ scheduled_date: '2025-12-30' }), '2026-01-02').days_late).toBe('3')
    expect(evaluateLine(line({ scheduled_date: '2028-02-28' }), '2028-03-01').days_late).toBe('2')
    expect(evaluateLine(line({ scheduled_date: '2026-02-28' }), '2026-03-01').days_late).toBe('1')
  })
  it('a blank scheduled date gives "-" for days_late and late_flag', () => {
    expect(evaluateLine(line({ scheduled_date: '' }), AS_OF)).toMatchObject({ balance_flag: 'short', days_late: '-', late_flag: '-' })
  })
  it('cancelled lines are not judged: late columns "-"', () => {
    expect(evaluateLine(line({ status: 'cancelled' }), AS_OF)).toMatchObject({ days_late: '-', late_flag: '-' })
  })
  it('partial late is reported (the skill ignored partial deliveries)', () => {
    expect(evaluateLine(line({ status: 'partial', qty_received: '40', scheduled_date: '2026-02-01', actual_date: '2026-02-01' }), AS_OF).late_flag).toBe('Y')
  })
})

describe('conflicts K1-K6', () => {
  const c = (o: Partial<RawLine>) => evaluateLine(line(o), AS_OF).conflict
  it('K1 delivered but short', () => expect(c({ status: 'delivered', qty_received: '80', actual_date: '2026-02-27' })).toBe('Y'))
  it('delivered and complete is consistent', () => expect(c({ status: 'delivered', qty_received: '100', actual_date: '2026-02-27' })).toBe('N'))
  it('K2 partial with nothing received, or complete', () => {
    expect(c({ status: 'partial', qty_received: '0', actual_date: '2026-02-27' })).toBe('Y')
    expect(c({ status: 'partial', qty_received: '100', actual_date: '2026-02-27' })).toBe('Y')
    expect(c({ status: 'partial', qty_received: '40', actual_date: '2026-02-27' })).toBe('N')
  })
  it('K3 delivered or partial without actual date', () => {
    expect(c({ status: 'delivered', qty_received: '100', actual_date: '' })).toBe('Y')
    expect(c({ status: 'partial', qty_received: '40', actual_date: '' })).toBe('Y')
  })
  it('K4 scheduled, in_transit or delayed with goods or an arrival date', () => {
    expect(c({ status: 'scheduled', qty_received: '10' })).toBe('Y')
    expect(c({ status: 'delayed', actual_date: '2026-02-27' })).toBe('Y')
    expect(c({ status: 'in_transit' })).toBe('N')
  })
  it('K5 cancelled with received goods', () => {
    expect(c({ status: 'cancelled', qty_received: '5' })).toBe('Y')
    expect(c({ status: 'cancelled', qty_received: '0' })).toBe('N')
  })
  it('K6 actual date after as_of', () => expect(c({ status: 'delivered', qty_received: '100', actual_date: '2026-03-03' })).toBe('Y'))
  it('over-delivery with delivered status is consistent', () => expect(c({ status: 'delivered', qty_received: '110', actual_date: '2026-02-27' })).toBe('N'))
  it('with a blank received quantity only the date rules apply', () => {
    expect(c({ status: 'delivered', qty_received: '', actual_date: '' })).toBe('Y')
    expect(c({ status: 'in_transit', qty_received: '' })).toBe('N')
  })
})

describe('typed validation errors', () => {
  const code = (o: Partial<RawLine>, asOf = AS_OF) => {
    try {
      evaluateLine(line(o), asOf)
    } catch (e) {
      return e instanceof DeliveryError ? e.code : 'other'
    }
    return 'none'
  }
  it('bad dates, as_of, quantities, status, priority, missing fields', () => {
    expect(code({ scheduled_date: '2026-02-30' })).toBe('bad-date')
    expect(code({ actual_date: '1.3.2026' })).toBe('bad-date')
    expect(code({}, 'tomorrow')).toBe('bad-as-of')
    expect(code({ qty_ordered: '-5' })).toBe('bad-quantity')
    expect(code({ qty_ordered: '0' })).toBe('bad-quantity')
    expect(code({ qty_ordered: '' })).toBe('missing-field')
    expect(code({ qty_received: 'many' })).toBe('bad-quantity')
    expect(code({ status: 'arrived' })).toBe('bad-status')
    expect(code({ priority: 'urgent' })).toBe('bad-priority')
    expect(code({ line_id: '' })).toBe('missing-field')
    expect(code({ unit: '' })).toBe('missing-field')
  })
  it('parseIsoDate is strict', () => {
    expect(() => parseIsoDate('2026-2-3')).toThrowError(DeliveryError)
    expect(parseIsoDate('2026-03-02') - parseIsoDate('2026-02-28')).toBe(2)
  })
})

describe('verdict lookup (spec section 7), every row once', () => {
  const v = (o: Parameters<typeof verdictFromParts>[0], reason: 'Y' | 'N' = 'N') => verdictFromParts(o, reason)
  const base = { status: 'in_transit', balance_flag: 'short', late_flag: 'N', conflict: 'N' } as const
  it('row 1: a "-" in balance_flag or late_flag', () => {
    expect(v({ ...base, late_flag: '-' })).toBe('data-incomplete')
    expect(v({ ...base, balance_flag: '-' })).toBe('data-incomplete')
  })
  it('row 2: conflict', () => expect(v({ ...base, status: 'delivered', late_flag: 'Y', conflict: 'Y' })).toBe('data-incomplete'))
  it('row 3: complete or over', () => {
    expect(v({ ...base, status: 'delivered', balance_flag: 'complete' })).toBe('received-complete')
    expect(v({ ...base, status: 'delivered', balance_flag: 'over', late_flag: 'Y' })).toBe('received-complete')
  })
  it('rows 4-5: short and late, by reason', () => {
    expect(v({ ...base, late_flag: 'Y' }, 'Y')).toBe('late')
    expect(v({ ...base, late_flag: 'Y' }, 'N')).toBe('late-no-reason')
    expect(v({ ...base, status: 'partial', late_flag: 'Y' }, 'Y')).toBe('late')
  })
  it('rows 6-7: short and not late', () => {
    expect(v({ ...base, status: 'partial' })).toBe('partial')
    expect(v({ ...base, status: 'scheduled' })).toBe('not-yet-due')
    expect(v({ ...base, status: 'delayed' }, 'Y')).toBe('not-yet-due')
  })
  it('cancelled is data-incomplete through the "-" columns', () => {
    const e = evaluateLine(line({ status: 'cancelled' }), AS_OF)
    expect(verdictFromParts({ ...e, status: 'cancelled' }, 'N')).toBe('data-incomplete')
  })
})

describe('sample (answer key of the spec, as_of 2026-03-02)', () => {
  const raw: RawLine[] = [
    line({ line_id: 'D-01', description: 'Spiraalikanava DN400', status: 'delivered', qty_ordered: '120', qty_received: '120', scheduled_date: '2026-02-24', actual_date: '2026-02-24' }),
    line({ line_id: 'D-02', status: 'partial', qty_ordered: '300', qty_received: '180', scheduled_date: '2026-03-05', actual_date: '2026-02-27' }),
    line({ line_id: 'D-03', status: 'delayed', unit: 'kpl', qty_ordered: '2', qty_received: '0', scheduled_date: '2026-02-20', delay_reason: 'Tehdasviive' }),
    line({ line_id: 'D-04', status: 'in_transit', qty_ordered: '200', qty_received: '0', scheduled_date: '2026-02-27' }),
    line({ line_id: 'D-05', status: 'scheduled', unit: 'kpl', qty_ordered: '1', qty_received: '0', scheduled_date: '2026-03-16' }),
    line({ line_id: 'D-06', status: 'delivered', unit: 'kpl', qty_ordered: '10', qty_received: '8', scheduled_date: '2026-02-26', actual_date: '2026-02-26' }),
    line({ line_id: 'D-07', status: 'in_transit', qty_ordered: '80', qty_received: '0', scheduled_date: '' }),
  ]
  it('equals the hand-computed key', () => {
    const rows = enrichLines(raw, AS_OF)
    expect(rows.map((r) => [r.balance, r.balance_flag, r.days_late, r.late_flag, r.conflict, r.reason_present, r.verdict])).toEqual([
      ['0 m', 'complete', '0', 'N', 'N', 'N', 'received-complete'],
      ['120 m', 'short', '0', 'N', 'N', 'N', 'partial'],
      ['2 kpl', 'short', '10', 'Y', 'N', 'Y', 'late'],
      ['200 m', 'short', '3', 'Y', 'N', 'N', 'late-no-reason'],
      ['1 kpl', 'short', '0', 'N', 'N', 'N', 'not-yet-due'],
      ['2 kpl', 'short', '4', 'Y', 'Y', 'N', 'data-incomplete'],
      ['80 m', 'short', '-', '-', 'N', 'N', 'data-incomplete'],
    ])
  })
})
