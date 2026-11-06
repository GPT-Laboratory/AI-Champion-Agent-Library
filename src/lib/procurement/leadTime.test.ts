import { describe, expect, it } from 'vitest'
import {
  LeadTimeError,
  addDays,
  diffDays,
  evaluateItem,
  enrichItems,
  parseIsoDate,
  verdictFor,
  type RawItem,
} from './leadTime'

const item = (o: Partial<RawItem> = {}): RawItem => ({
  item_id: 'X-1',
  description: 'Test',
  priority: 'normal',
  status: 'quoted',
  required_date: '2026-06-01',
  lead_time_days: '120',
  vendor: '',
  po_number: '',
  ...o,
})

describe('date arithmetic (UTC, calendar days)', () => {
  it('subtracts across month and year boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-01-10', -20)).toBe('2025-12-21')
    expect(addDays('2026-09-15', -154)).toBe('2026-04-14')
  })
  it('handles the leap day', () => {
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(diffDays('2028-03-01', '2028-02-28')).toBe(2)
  })
  it('rejects impossible and badly formed dates', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '1.3.2026', '2026-3-1', 'soon']) {
      expect(() => parseIsoDate(bad)).toThrowError(LeadTimeError)
    }
  })
})

describe('must_order_by', () => {
  it('equals required_date minus lead_time_days', () => {
    expect(evaluateItem(item(), '2026-03-02').must_order_by).toBe('2026-02-01')
    expect(evaluateItem(item({ lead_time_days: '0' }), '2026-03-02').must_order_by).toBe('2026-06-01')
  })
})

describe('late and soon flags (as_of explicit, no clock)', () => {
  const at = (mob: string, asOf: string, o: Partial<RawItem> = {}) =>
    evaluateItem(item({ required_date: addDays(mob, 10), lead_time_days: '10', ...o }), asOf)
  it('late when pre-po and as_of is after must_order_by', () => {
    const r = at('2026-03-01', '2026-03-02')
    expect(r).toMatchObject({ days_to_order: '-1', late_flag: 'Y', soon_flag: 'N' })
  })
  it('day 0 is soon, not late (strict late test)', () => {
    expect(at('2026-03-02', '2026-03-02')).toMatchObject({ days_to_order: '0', late_flag: 'N', soon_flag: 'Y' })
  })
  it('day 14 is soon, day 15 is neither', () => {
    expect(at('2026-03-16', '2026-03-02')).toMatchObject({ days_to_order: '14', late_flag: 'N', soon_flag: 'Y' })
    expect(at('2026-03-17', '2026-03-02')).toMatchObject({ days_to_order: '15', late_flag: 'N', soon_flag: 'N' })
  })
  it('late and soon are never both Y (skill window overlapped)', () => {
    for (let d = -30; d <= 30; d++) {
      const r = at(addDays('2026-03-02', d), '2026-03-02')
      expect(r.late_flag === 'Y' && r.soon_flag === 'Y').toBe(false)
    }
  })
  it('a required date already in the past is late for a pre-po item', () => {
    expect(evaluateItem(item({ required_date: '2026-01-10', lead_time_days: '30' }), '2026-03-02')).toMatchObject({ late_flag: 'Y' })
  })
  it('ordered and delivered items are never late or soon, whatever the dates', () => {
    for (const status of ['po_issued', 'in_production', 'shipped', 'delivered']) {
      expect(evaluateItem(item({ status }), '2026-03-02')).toMatchObject({ late_flag: 'N', soon_flag: 'N' })
    }
  })
  it('the same item gives the same answer for the same as_of and different answers for another as_of', () => {
    const a = evaluateItem(item(), '2026-03-02')
    expect(evaluateItem(item(), '2026-03-02')).toEqual(a)
    expect(evaluateItem(item(), '2026-01-01')).not.toEqual(a)
  })
})

describe('status class', () => {
  it.each([
    ['requisitioned', 'pre-po'],
    ['rfq_sent', 'pre-po'],
    ['quoted', 'pre-po'],
    ['po_issued', 'ordered'],
    ['in_production', 'ordered'],
    ['shipped', 'ordered'],
    ['delivered', 'delivered'],
  ])('%s -> %s', (s, c) => expect(evaluateItem(item({ status: s }), '2026-03-02').status_class).toBe(c))
})

describe('incomplete and invalid input', () => {
  it('blank lead time or required date gives the typed incomplete marker for a pre-po item', () => {
    for (const o of [{ lead_time_days: '' }, { required_date: '' }]) {
      const r = evaluateItem(item(o), '2026-03-02')
      expect(r).toMatchObject({ must_order_by: '-', days_to_order: '-', late_flag: '-', soon_flag: '-' })
      expect(Object.values(r).join(' ')).not.toMatch(/NaN|undefined/)
    }
  })
  it('blank lead time on an ordered item keeps the flags N and must_order_by -', () => {
    expect(evaluateItem(item({ status: 'po_issued', lead_time_days: '' }), '2026-03-02')).toMatchObject({
      must_order_by: '-',
      late_flag: 'N',
      soon_flag: 'N',
    })
  })
  it.each([
    [{ lead_time_days: '-5' }, 'bad-lead-time'],
    [{ lead_time_days: '12.5' }, 'bad-lead-time'],
    [{ lead_time_days: 'abc' }, 'bad-lead-time'],
    [{ required_date: '2026-02-30' }, 'bad-date'],
    [{ status: 'ordered' }, 'bad-status'],
    [{ priority: 'urgent' }, 'bad-priority'],
    [{ item_id: '' }, 'missing-field'],
  ] as [Partial<RawItem>, string][])('throws a typed error for %j', (o, code) => {
    expect(() => evaluateItem(item(o), '2026-03-02')).toThrowError(LeadTimeError)
    try {
      evaluateItem(item(o), '2026-03-02')
    } catch (e) {
      expect((e as LeadTimeError).code).toBe(code)
    }
  })
  it('a bad as_of throws', () => {
    expect(() => evaluateItem(item(), '02.03.2026')).toThrowError(LeadTimeError)
  })
})

describe('verdict lookup', () => {
  const v = (o: Partial<RawItem>) => verdictFor(item(o), '2026-03-02')
  it('pre-po branches', () => {
    expect(v({})).toBe('order-now')
    expect(v({ required_date: '2026-05-15', lead_time_days: '70' })).toBe('order-soon')
    expect(v({ required_date: '2026-12-01', lead_time_days: '180' })).toBe('ordered-ok')
    expect(v({ lead_time_days: '' })).toBe('order-data-incomplete')
  })
  it('ordered and delivered need po_number and vendor', () => {
    expect(v({ status: 'po_issued', vendor: 'V', po_number: 'PO-1' })).toBe('ordered-ok')
    expect(v({ status: 'in_production', vendor: 'V' })).toBe('order-data-incomplete')
    expect(v({ status: 'shipped', po_number: 'PO-1' })).toBe('order-data-incomplete')
    expect(v({ status: 'delivered', vendor: 'V', po_number: 'PO-1' })).toBe('ordered-ok')
    expect(v({ status: 'delivered', vendor: 'V' })).toBe('order-data-incomplete')
  })
  it('a pre-po item ignores missing po fields', () => {
    expect(v({ required_date: '2026-12-01', lead_time_days: '180', vendor: '', po_number: '' })).toBe('ordered-ok')
  })
})

describe('sample from the spec answer key (as_of 2026-03-02)', () => {
  // Hand-computed in docs/ddc-alignment/procurement-lead-time-check.md section 8.
  const raw: RawItem[] = [
    item({ item_id: 'P-01', status: 'po_issued', required_date: '2026-09-15', lead_time_days: '154', vendor: 'V', po_number: 'PO' }),
    item({ item_id: 'P-02', status: 'quoted', required_date: '2026-06-01', lead_time_days: '120' }),
    item({ item_id: 'P-03', status: 'rfq_sent', required_date: '2026-05-15', lead_time_days: '70' }),
    item({ item_id: 'P-04', status: 'requisitioned', required_date: '2026-12-01', lead_time_days: '180' }),
    item({ item_id: 'P-05', status: 'quoted', required_date: '2026-10-01', lead_time_days: '' }),
    item({ item_id: 'P-06', status: 'delivered', required_date: '2026-02-20', lead_time_days: '60', vendor: 'V', po_number: 'PO' }),
    item({ item_id: 'P-07', status: 'in_production', required_date: '2026-08-03', lead_time_days: '90', vendor: 'V' }),
  ]
  it('matches the key', () => {
    const rows = enrichItems(raw, '2026-03-02')
    expect(rows.map((r) => [r.item_id, r.must_order_by, r.days_to_order, r.late_flag, r.soon_flag, r.verdict])).toEqual([
      ['P-01', '2026-04-14', '43', 'N', 'N', 'ordered-ok'],
      ['P-02', '2026-02-01', '-29', 'Y', 'N', 'order-now'],
      ['P-03', '2026-03-06', '4', 'N', 'Y', 'order-soon'],
      ['P-04', '2026-06-04', '94', 'N', 'N', 'ordered-ok'],
      ['P-05', '-', '-', '-', '-', 'order-data-incomplete'],
      ['P-06', '2025-12-22', '-70', 'N', 'N', 'ordered-ok'],
      ['P-07', '2026-05-05', '64', 'N', 'N', 'order-data-incomplete'],
    ])
  })
})
