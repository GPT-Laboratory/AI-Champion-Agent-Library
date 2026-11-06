// Warranty register check (own code, deterministic, no I/O, no clock). Data model and status rule from the DDC
// skill warranty-tracker (warranty type words, building system words, expired / expiring within 90 days / active,
// days_remaining = end date minus today), with the skill's defects corrected: no date.today() (explicit as_of),
// calendar-year addition instead of years * 365 days, end date checked against start plus duration, the 90-day
// window really returns the expiring warranties, missing documents and contacts are visible, typed validation
// errors. Days are CALENDAR days. See docs/ddc-alignment/warranty-register-check.md.

export type WarrantyErrorCode = 'bad-date' | 'bad-as-of' | 'bad-duration' | 'bad-system' | 'bad-type' | 'missing-field'

export class WarrantyError extends Error {
  readonly code: WarrantyErrorCode
  constructor(code: WarrantyErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'WarrantyError'
    this.code = code
  }
}

export const SYSTEMS = ['structural', 'roofing', 'hvac', 'electrical', 'plumbing', 'elevators', 'fire_protection', 'glazing', 'flooring', 'painting', 'appliances', 'exterior', 'other'] as const
export const TYPES = ['manufacturer', 'contractor', 'installer', 'extended', 'performance'] as const
export const EXPIRING_WINDOW_DAYS = 90
export type Flag = 'Y' | 'N' | '-'
export type StatusClass = 'expired' | 'expiring-soon' | 'active' | '-'
export type Verdict = 'register-ok' | 'expiring-soon' | 'expired' | 'documents-missing' | 'contact-missing' | 'dates-inconsistent' | 'data-incomplete'

export interface RawWarranty {
  warranty_id: string
  item: string
  system: string
  warranty_type: string
  start_date: string
  end_date: string
  duration_years: string
  documents: string
  contact: string
  coverage: string
}

export interface Evaluation {
  end_date_expected: string
  dates_consistent: Flag
  days_remaining: string
  status_class: StatusClass
  document_present: 'Y' | 'N'
  contact_present: 'Y' | 'N'
  coverage_present: 'Y' | 'N'
}

export interface EnrichedWarranty extends RawWarranty, Evaluation {
  verdict: Verdict
}

const DAY_MS = 86_400_000

/** Strict ISO YYYY-MM-DD to a UTC day number; throws bad-date (or bad-as-of). */
export function parseIsoDate(text: string, code: 'bad-date' | 'bad-as-of' = 'bad-date'): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
  if (!m) throw new WarrantyError(code, `"${text}" is not an ISO date (YYYY-MM-DD)`)
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new WarrantyError(code, `"${text}" is not a real calendar date`)
  }
  return ms / DAY_MS
}

const dayToIso = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10)

/** Same month and day `years` calendar years later; 29 February moves to 28 February in a non-leap target year. */
export function addYears(iso: string, years: number): string {
  parseIsoDate(iso)
  const y = Number(iso.slice(0, 4)) + years
  const mo = Number(iso.slice(5, 7))
  let d = Number(iso.slice(8, 10))
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (d > lastDay) d = lastDay
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function need(w: RawWarranty, key: keyof RawWarranty): string {
  const v = w[key]
  if (typeof v !== 'string' || v.trim() === '') throw new WarrantyError('missing-field', `${key} is empty (warranty "${w.warranty_id ?? ''}")`)
  return v.trim()
}

const present = (v: string | undefined): 'Y' | 'N' => ((v ?? '').trim() === '' ? 'N' : 'Y')

export function evaluateWarranty(w: RawWarranty, asOf: string): Evaluation {
  const asOfDay = parseIsoDate(asOf, 'bad-as-of')
  const id = need(w, 'warranty_id')
  need(w, 'item')
  const system = need(w, 'system')
  if (!(SYSTEMS as readonly string[]).includes(system)) throw new WarrantyError('bad-system', `warranty ${id}: system "${system}" is not one of ${SYSTEMS.join(', ')}`)
  const type = need(w, 'warranty_type')
  if (!(TYPES as readonly string[]).includes(type)) throw new WarrantyError('bad-type', `warranty ${id}: warranty_type "${type}" is not one of ${TYPES.join(', ')}`)
  const startText = (w.start_date ?? '').trim()
  const endText = (w.end_date ?? '').trim()
  const durText = (w.duration_years ?? '').trim()
  if (startText !== '') parseIsoDate(startText)
  const endDay = endText === '' ? null : parseIsoDate(endText)
  let years: number | null = null
  if (durText !== '') {
    if (!/^\d+$/.test(durText) || Number(durText) < 1) throw new WarrantyError('bad-duration', `warranty ${id}: duration_years "${durText}" is not a whole number >= 1`)
    years = Number(durText)
  }

  const expected = startText !== '' && years !== null ? addYears(startText, years) : '-'
  let consistent: Flag = '-'
  if (expected !== '-' && endDay !== null) {
    const expDay = parseIsoDate(expected)
    consistent = endDay === expDay || endDay === expDay - 1 ? 'Y' : 'N'
  }

  let days = '-'
  let status: StatusClass = '-'
  if (endDay !== null) {
    const remaining = endDay - asOfDay
    days = String(remaining)
    status = remaining < 0 ? 'expired' : remaining <= EXPIRING_WINDOW_DAYS ? 'expiring-soon' : 'active'
  }

  return {
    end_date_expected: expected,
    dates_consistent: consistent,
    days_remaining: days,
    status_class: status,
    document_present: present(w.documents),
    contact_present: present(w.contact),
    coverage_present: present(w.coverage),
  }
}

/** Verdict by the lookup table of the spec (section 7), first line that fits wins. */
export function verdictFromParts(e: Pick<Evaluation, 'dates_consistent' | 'status_class' | 'document_present' | 'contact_present' | 'coverage_present'>): Verdict {
  if (e.status_class === '-' || e.dates_consistent === '-' || e.coverage_present === 'N') return 'data-incomplete'
  if (e.dates_consistent === 'N') return 'dates-inconsistent'
  if (e.status_class === 'expired') return 'expired'
  if (e.document_present === 'N') return 'documents-missing'
  if (e.contact_present === 'N') return 'contact-missing'
  if (e.status_class === 'expiring-soon') return 'expiring-soon'
  return 'register-ok'
}

export function verdictFor(w: RawWarranty, asOf: string): Verdict {
  return verdictFromParts(evaluateWarranty(w, asOf))
}

export function enrichWarranties(rows: RawWarranty[], asOf: string): EnrichedWarranty[] {
  return rows.map((w) => {
    const e = evaluateWarranty(w, asOf)
    return { ...w, ...e, verdict: verdictFromParts(e) }
  })
}
