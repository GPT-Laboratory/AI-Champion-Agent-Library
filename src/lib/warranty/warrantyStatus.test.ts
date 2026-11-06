import { describe, expect, it } from 'vitest'
import {
  WarrantyError,
  addYears,
  enrichWarranties,
  evaluateWarranty,
  parseIsoDate,
  verdictFromParts,
  type RawWarranty,
} from './warrantyStatus'

const AS_OF = '2026-03-02'
const w = (o: Partial<RawWarranty> = {}): RawWarranty => ({
  warranty_id: 'X-1',
  item: 'Test',
  system: 'hvac',
  warranty_type: 'manufacturer',
  start_date: '2025-06-01',
  end_date: '2030-06-01',
  duration_years: '5',
  documents: 'doc.pdf',
  contact: 'a@example.test',
  coverage: 'Osat',
  ...o,
})

describe('addYears (calendar years, not 365-day blocks)', () => {
  it('adds calendar years, including month and year boundaries', () => {
    expect(addYears('2025-06-01', 5)).toBe('2030-06-01')
    expect(addYears('2025-12-31', 2)).toBe('2027-12-31')
    expect(addYears('2024-03-15', 2)).toBe('2026-03-15')
  })
  it('regression: the skill start + years*365 days drifts by a day over a leap day', () => {
    const skill = new Date(Date.UTC(2025, 5, 1) + 5 * 365 * 86_400_000).toISOString().slice(0, 10)
    expect(skill).toBe('2030-05-31')
    expect(addYears('2025-06-01', 5)).toBe('2030-06-01')
  })
  it('a 29 February start moves to 28 February in a non-leap target year, stays 29 February in a leap year', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28')
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29')
    expect(addYears('2024-02-29', 2)).toBe('2026-02-28')
  })
})

describe('dates_consistent', () => {
  it('Y when end equals the anniversary or the day before it', () => {
    expect(evaluateWarranty(w({ end_date: '2030-06-01' }), AS_OF).dates_consistent).toBe('Y')
    expect(evaluateWarranty(w({ end_date: '2030-05-31' }), AS_OF).dates_consistent).toBe('Y')
  })
  it('N otherwise (regression: the skill never checks end_date against start plus duration)', () => {
    expect(evaluateWarranty(w({ end_date: '2028-06-01' }), AS_OF).dates_consistent).toBe('N')
    expect(evaluateWarranty(w({ end_date: '2030-06-02' }), AS_OF).dates_consistent).toBe('N')
    expect(evaluateWarranty(w({ end_date: '2030-05-30' }), AS_OF).dates_consistent).toBe('N')
  })
  it('a leap-day start is consistent with its 28 February or 27 February end', () => {
    const e = evaluateWarranty(w({ start_date: '2024-02-29', duration_years: '1', end_date: '2025-02-28' }), AS_OF)
    expect([e.end_date_expected, e.dates_consistent]).toEqual(['2025-02-28', 'Y'])
  })
  it('is - when start, duration or end is blank; expected is still shown when start and duration are known', () => {
    const noEnd = evaluateWarranty(w({ end_date: '' }), AS_OF)
    expect([noEnd.end_date_expected, noEnd.dates_consistent]).toEqual(['2030-06-01', '-'])
    const noStart = evaluateWarranty(w({ start_date: '' }), AS_OF)
    expect([noStart.end_date_expected, noStart.dates_consistent]).toEqual(['-', '-'])
    const noDur = evaluateWarranty(w({ duration_years: '' }), AS_OF)
    expect([noDur.end_date_expected, noDur.dates_consistent]).toEqual(['-', '-'])
  })
})

describe('days_remaining and status_class (as_of 2026-03-02, 90-day window inclusive)', () => {
  const at = (end: string) => evaluateWarranty(w({ start_date: '', duration_years: '', end_date: end }), AS_OF)
  it('boundary day 0 is the last covered day: expiring-soon', () => {
    expect([at('2026-03-02').days_remaining, at('2026-03-02').status_class]).toEqual(['0', 'expiring-soon'])
  })
  it('day 90 is expiring-soon, day 91 is active (regression: the skill getter returned nothing for the default window)', () => {
    expect([at('2026-05-31').days_remaining, at('2026-05-31').status_class]).toEqual(['90', 'expiring-soon'])
    expect([at('2026-06-01').days_remaining, at('2026-06-01').status_class]).toEqual(['91', 'active'])
  })
  it('day -1 is expired and the count is negative', () => {
    expect([at('2026-03-01').days_remaining, at('2026-03-01').status_class]).toEqual(['-1', 'expired'])
    expect(at('2026-02-10').days_remaining).toBe('-20')
  })
  it('counts over a leap day and a year end', () => {
    expect(at('2028-03-02').days_remaining).toBe('731')
    expect(at('2030-06-01').days_remaining).toBe('1552')
  })
  it('the same register gives the same answer for the same as_of, a different one for another (no clock)', () => {
    expect(evaluateWarranty(w({ end_date: '2026-03-14' }), '2026-03-02').status_class).toBe('expiring-soon')
    expect(evaluateWarranty(w({ end_date: '2026-03-14' }), '2026-03-20').status_class).toBe('expired')
  })
  it('blank end date gives - and never NaN', () => {
    const e = evaluateWarranty(w({ end_date: '' }), AS_OF)
    expect([e.days_remaining, e.status_class]).toEqual(['-', '-'])
    expect(JSON.stringify(e)).not.toContain('NaN')
  })
})

describe('presence checks', () => {
  it('Y when text, N when blank or spaces', () => {
    const e = evaluateWarranty(w({ documents: '', contact: '  ', coverage: 'x' }), AS_OF)
    expect([e.document_present, e.contact_present, e.coverage_present]).toEqual(['N', 'N', 'Y'])
  })
})

describe('validation (typed errors)', () => {
  const code = (fn: () => unknown) => {
    try {
      fn()
    } catch (e) {
      return (e as WarrantyError).code
    }
    return null
  }
  it('rejects bad dates, bad as_of, bad duration, bad enums and missing ids', () => {
    expect(code(() => evaluateWarranty(w({ end_date: '2026-02-30' }), AS_OF))).toBe('bad-date')
    expect(code(() => evaluateWarranty(w({ start_date: '1.6.2025' }), AS_OF))).toBe('bad-date')
    expect(code(() => evaluateWarranty(w(), '2026-13-01'))).toBe('bad-as-of')
    expect(code(() => evaluateWarranty(w({ duration_years: '0' }), AS_OF))).toBe('bad-duration')
    expect(code(() => evaluateWarranty(w({ duration_years: '-2' }), AS_OF))).toBe('bad-duration')
    expect(code(() => evaluateWarranty(w({ duration_years: '2.5' }), AS_OF))).toBe('bad-duration')
    expect(code(() => evaluateWarranty(w({ system: 'boiler' }), AS_OF))).toBe('bad-system')
    expect(code(() => evaluateWarranty(w({ warranty_type: 'lifetime' }), AS_OF))).toBe('bad-type')
    expect(code(() => evaluateWarranty(w({ warranty_id: '' }), AS_OF))).toBe('missing-field')
    expect(code(() => evaluateWarranty(w({ item: '' }), AS_OF))).toBe('missing-field')
  })
  it('parseIsoDate rejects non-dates', () => {
    expect(() => parseIsoDate('2026-2-3')).toThrowError(WarrantyError)
  })
})

describe('verdict lookup (spec section 7, first line wins)', () => {
  const v = (o: Partial<Parameters<typeof verdictFromParts>[0]> = {}) =>
    verdictFromParts({ dates_consistent: 'Y', status_class: 'active', document_present: 'Y', contact_present: 'Y', coverage_present: 'Y', ...o })
  it('each verdict word', () => {
    expect(v()).toBe('register-ok')
    expect(v({ status_class: 'expiring-soon' })).toBe('expiring-soon')
    expect(v({ status_class: 'expired' })).toBe('expired')
    expect(v({ document_present: 'N' })).toBe('documents-missing')
    expect(v({ contact_present: 'N' })).toBe('contact-missing')
    expect(v({ dates_consistent: 'N' })).toBe('dates-inconsistent')
    expect(v({ status_class: '-' })).toBe('data-incomplete')
    expect(v({ dates_consistent: '-' })).toBe('data-incomplete')
    expect(v({ coverage_present: 'N' })).toBe('data-incomplete')
  })
  it('priority: data-incomplete > dates-inconsistent > expired > documents > contact > expiring-soon', () => {
    expect(v({ dates_consistent: 'N', status_class: 'expired' })).toBe('dates-inconsistent')
    expect(v({ status_class: 'expired', document_present: 'N' })).toBe('expired')
    expect(v({ status_class: 'expiring-soon', document_present: 'N', contact_present: 'N' })).toBe('documents-missing')
    expect(v({ status_class: 'expiring-soon', contact_present: 'N' })).toBe('contact-missing')
    expect(v({ coverage_present: 'N', dates_consistent: 'N' })).toBe('data-incomplete')
  })
})

describe('the sample register equals the spec answer key (section 8)', () => {
  const rows = [
    w({ warranty_id: 'W-01', start_date: '2025-06-01', end_date: '2030-06-01', duration_years: '5' }),
    w({ warranty_id: 'W-02', system: 'plumbing', warranty_type: 'installer', start_date: '2024-03-15', end_date: '2026-03-14', duration_years: '2' }),
    w({ warranty_id: 'W-03', system: 'fire_protection', warranty_type: 'contractor', start_date: '2023-02-10', end_date: '2026-02-10', duration_years: '3' }),
    w({ warranty_id: 'W-04', system: 'plumbing', warranty_type: 'contractor', start_date: '2025-09-01', end_date: '2027-09-01', duration_years: '2', documents: '' }),
    w({ warranty_id: 'W-05', system: 'electrical', start_date: '2025-11-20', end_date: '2030-11-20', duration_years: '5', contact: '' }),
    w({ warranty_id: 'W-06', warranty_type: 'extended', start_date: '2025-04-01', end_date: '2028-04-01', duration_years: '5' }),
    w({ warranty_id: 'W-07', system: 'plumbing', warranty_type: 'installer', start_date: '2025-08-15', end_date: '', duration_years: '2' }),
  ]
  it('matches the hand-computed key', () => {
    const out = enrichWarranties(rows, AS_OF).map((r) => [r.warranty_id, r.end_date_expected, r.dates_consistent, r.days_remaining, r.status_class, r.verdict])
    expect(out).toEqual([
      ['W-01', '2030-06-01', 'Y', '1552', 'active', 'register-ok'],
      ['W-02', '2026-03-15', 'Y', '12', 'expiring-soon', 'expiring-soon'],
      ['W-03', '2026-02-10', 'Y', '-20', 'expired', 'expired'],
      ['W-04', '2027-09-01', 'Y', '548', 'active', 'documents-missing'],
      ['W-05', '2030-11-20', 'Y', '1724', 'active', 'contact-missing'],
      ['W-06', '2030-04-01', 'N', '761', 'active', 'dates-inconsistent'],
      ['W-07', '2027-08-15', '-', '-', '-', 'data-incomplete'],
    ])
  })
})
