// Procurement lead time check (own code, deterministic, no I/O, no clock). Method from the DDC skill
// material-procurement-tracker (must order by = required date minus lead time, late-to-order rule, 14-day
// items-to-order window, status enumeration), with the skill's defects corrected: no date.today() (explicit
// as_of), disjoint late and soon flags, typed validation errors, a typed incomplete marker for blank values,
// PO status needs vendor and PO number. Lead time is in CALENDAR days. See
// docs/ddc-alignment/procurement-lead-time-check.md.

export type LeadTimeErrorCode =
  | 'bad-date'
  | 'bad-as-of'
  | 'bad-lead-time'
  | 'bad-status'
  | 'bad-priority'
  | 'missing-field'

export class LeadTimeError extends Error {
  readonly code: LeadTimeErrorCode
  constructor(code: LeadTimeErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'LeadTimeError'
    this.code = code
  }
}

export const SOON_WINDOW_DAYS = 14

export const STATUSES = ['requisitioned', 'rfq_sent', 'quoted', 'po_issued', 'in_production', 'shipped', 'delivered'] as const
export const PRIORITIES = ['critical', 'high', 'normal', 'low'] as const
export type StatusClass = 'pre-po' | 'ordered' | 'delivered'
export type Verdict = 'ordered-ok' | 'order-now' | 'order-soon' | 'order-data-incomplete'

const CLASS_OF: Record<string, StatusClass> = {
  requisitioned: 'pre-po',
  rfq_sent: 'pre-po',
  quoted: 'pre-po',
  po_issued: 'ordered',
  in_production: 'ordered',
  shipped: 'ordered',
  delivered: 'delivered',
}

export interface RawItem {
  item_id: string
  description: string
  priority: string
  status: string
  required_date: string
  lead_time_days: string
  vendor: string
  po_number: string
}

export interface Evaluation {
  status_class: StatusClass
  must_order_by: string
  days_to_order: string
  late_flag: 'Y' | 'N' | '-'
  soon_flag: 'Y' | 'N' | '-'
}

export interface EnrichedItem extends RawItem, Evaluation {
  po_present: 'Y' | 'N'
  vendor_present: 'Y' | 'N'
  verdict: Verdict
}

const DAY_MS = 86_400_000

/** Parses strict ISO YYYY-MM-DD to a UTC day number (days since 1970-01-01); throws bad-date. */
export function parseIsoDate(text: string, code: 'bad-date' | 'bad-as-of' = 'bad-date'): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
  if (!m) throw new LeadTimeError(code, `"${text}" is not an ISO date (YYYY-MM-DD)`)
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new LeadTimeError(code, `"${text}" is not a real calendar date`)
  }
  return ms / DAY_MS
}

function formatDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  return formatDay(parseIsoDate(iso) + days)
}

/** a minus b in calendar days. */
export function diffDays(a: string, b: string): number {
  return parseIsoDate(a) - parseIsoDate(b)
}

function need(item: RawItem, key: keyof RawItem): string {
  const v = item[key]
  if (typeof v !== 'string' || v.trim() === '') throw new LeadTimeError('missing-field', `${key} is empty (item "${item.item_id ?? ''}")`)
  return v.trim()
}

export function evaluateItem(item: RawItem, asOf: string): Evaluation {
  const asOfDay = parseIsoDate(asOf, 'bad-as-of')
  const id = need(item, 'item_id')
  const status = need(item, 'status')
  const klass = CLASS_OF[status]
  if (!Object.prototype.hasOwnProperty.call(CLASS_OF, status)) throw new LeadTimeError('bad-status', `item ${id}: status "${status}" is not one of ${STATUSES.join(', ')}`)
  const priority = need(item, 'priority')
  if (!(PRIORITIES as readonly string[]).includes(priority)) throw new LeadTimeError('bad-priority', `item ${id}: priority "${priority}" is not one of ${PRIORITIES.join(', ')}`)

  const reqText = (item.required_date ?? '').trim()
  const leadText = (item.lead_time_days ?? '').trim()
  const reqDay = reqText === '' ? null : parseIsoDate(reqText)
  let lead: number | null = null
  if (leadText !== '') {
    if (!/^\d+$/.test(leadText)) throw new LeadTimeError('bad-lead-time', `item ${id}: lead_time_days "${leadText}" is not a whole number of days >= 0`)
    lead = Number(leadText)
  }

  if (reqDay === null || lead === null) {
    // Incomplete marker, never NaN or zero. Only a not-yet-ordered item needs the date to be judged.
    const flag = klass === 'pre-po' ? '-' : 'N'
    return { status_class: klass, must_order_by: '-', days_to_order: '-', late_flag: flag, soon_flag: flag }
  }
  const mobDay = reqDay - lead
  const days = mobDay - asOfDay
  const pre = klass === 'pre-po'
  return {
    status_class: klass,
    must_order_by: formatDay(mobDay),
    days_to_order: String(days),
    late_flag: pre && days < 0 ? 'Y' : 'N',
    soon_flag: pre && days >= 0 && days <= SOON_WINDOW_DAYS ? 'Y' : 'N',
  }
}

export const present = (v: string | undefined): 'Y' | 'N' => ((v ?? '').trim() === '' ? 'N' : 'Y')

/** Verdict by the lookup table of the spec (section 7), first line that fits wins. */
export function verdictFromParts(e: Evaluation, poPresent: 'Y' | 'N', vendorPresent: 'Y' | 'N'): Verdict {
  if (e.status_class === 'pre-po') {
    if (e.late_flag === '-') return 'order-data-incomplete'
    if (e.late_flag === 'Y') return 'order-now'
    if (e.soon_flag === 'Y') return 'order-soon'
    return 'ordered-ok'
  }
  return poPresent === 'Y' && vendorPresent === 'Y' ? 'ordered-ok' : 'order-data-incomplete'
}

export function verdictFor(item: RawItem, asOf: string): Verdict {
  return verdictFromParts(evaluateItem(item, asOf), present(item.po_number), present(item.vendor))
}

export function enrichItems(items: RawItem[], asOf: string): EnrichedItem[] {
  return items.map((item) => {
    const e = evaluateItem(item, asOf)
    const po = present(item.po_number)
    const vendor = present(item.vendor)
    return { ...item, ...e, po_present: po, vendor_present: vendor, verdict: verdictFromParts(e, po, vendor) }
  })
}
