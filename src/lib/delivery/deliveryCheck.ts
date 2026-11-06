// Material delivery check (own code, deterministic, no I/O, no clock). Data model and completeness rule from the
// DDC skill material-delivery-tracker (status words, priority words, quantity ordered versus received,
// scheduled versus actual date, delay reason, is_complete = received >= ordered), with the skill's defects
// corrected: no date.today() (explicit as_of), status checked against quantities and dates (conflict), late
// partial deliveries reported, blank received is never "full" or zero, over-delivery stays visible, typed
// validation errors. Days are CALENDAR days. See docs/ddc-alignment/material-delivery-check.md.

export type DeliveryErrorCode = 'bad-date' | 'bad-as-of' | 'bad-quantity' | 'bad-status' | 'bad-priority' | 'missing-field'

export class DeliveryError extends Error {
  readonly code: DeliveryErrorCode
  constructor(code: DeliveryErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'DeliveryError'
    this.code = code
  }
}

export const STATUSES = ['scheduled', 'in_transit', 'delivered', 'partial', 'delayed', 'cancelled'] as const
export const PRIORITIES = ['critical', 'high', 'normal', 'low'] as const
export type BalanceFlag = 'complete' | 'short' | 'over' | '-'
export type Flag = 'Y' | 'N' | '-'
export type Verdict = 'received-complete' | 'partial' | 'late' | 'late-no-reason' | 'not-yet-due' | 'data-incomplete'

export interface RawLine {
  line_id: string
  po_number: string
  description: string
  priority: string
  status: string
  unit: string
  qty_ordered: string
  qty_received: string
  scheduled_date: string
  actual_date: string
  delay_reason: string
}

export interface Evaluation {
  balance: string
  balance_flag: BalanceFlag
  days_late: string
  late_flag: Flag
  conflict: 'Y' | 'N'
}

export interface EnrichedLine extends RawLine, Evaluation {
  reason_present: 'Y' | 'N'
  verdict: Verdict
}

const DAY_MS = 86_400_000

/** Strict ISO YYYY-MM-DD to a UTC day number; throws bad-date (or bad-as-of). */
export function parseIsoDate(text: string, code: 'bad-date' | 'bad-as-of' = 'bad-date'): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
  if (!m) throw new DeliveryError(code, `"${text}" is not an ISO date (YYYY-MM-DD)`)
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new DeliveryError(code, `"${text}" is not a real calendar date`)
  }
  return ms / DAY_MS
}

/** Quantity with point or comma decimal; throws bad-quantity for anything else (negative, text, exponent). */
export function parseQuantity(text: string, field: string): number {
  const t = text.trim()
  if (!/^\d+([.,]\d+)?$/.test(t)) throw new DeliveryError('bad-quantity', `${field} "${text}" is not a number >= 0`)
  return Number(t.replace(',', '.'))
}

/** Number to text without float noise (rounded to 6 decimals, no trailing zeros). */
export function formatQuantity(n: number): string {
  return String(Number(n.toFixed(6)))
}

function need(line: RawLine, key: keyof RawLine): string {
  const v = line[key]
  if (typeof v !== 'string' || v.trim() === '') throw new DeliveryError('missing-field', `${key} is empty (line "${line.line_id ?? ''}")`)
  return v.trim()
}

export function evaluateLine(line: RawLine, asOf: string): Evaluation {
  const asOfDay = parseIsoDate(asOf, 'bad-as-of')
  const id = need(line, 'line_id')
  const status = need(line, 'status')
  if (!(STATUSES as readonly string[]).includes(status)) throw new DeliveryError('bad-status', `line ${id}: status "${status}" is not one of ${STATUSES.join(', ')}`)
  const priority = need(line, 'priority')
  if (!(PRIORITIES as readonly string[]).includes(priority)) throw new DeliveryError('bad-priority', `line ${id}: priority "${priority}" is not one of ${PRIORITIES.join(', ')}`)
  const unit = need(line, 'unit')
  const ordered = parseQuantity(need(line, 'qty_ordered'), `line ${id} qty_ordered`)
  if (ordered === 0) throw new DeliveryError('bad-quantity', `line ${id}: qty_ordered must be greater than 0`)
  const recText = (line.qty_received ?? '').trim()
  const received = recText === '' ? null : parseQuantity(recText, `line ${id} qty_received`)
  const schedText = (line.scheduled_date ?? '').trim()
  const actText = (line.actual_date ?? '').trim()
  const schedDay = schedText === '' ? null : parseIsoDate(schedText)
  const actDay = actText === '' ? null : parseIsoDate(actText)

  let balance = '-'
  let flag: BalanceFlag = '-'
  if (received !== null) {
    balance = `${formatQuantity(ordered - received)} ${unit}`
    flag = received === ordered ? 'complete' : received < ordered ? 'short' : 'over'
  }

  let daysLate = '-'
  let lateFlag: Flag = '-'
  if (status !== 'cancelled' && schedDay !== null && flag !== '-') {
    // A short line is measured at as_of (the outstanding part); a complete or over line at its arrival day.
    const ref = flag === 'short' ? asOfDay : (actDay ?? asOfDay)
    const late = Math.max(0, ref - schedDay)
    daysLate = String(late)
    lateFlag = late > 0 ? 'Y' : 'N'
  }

  const hasGoods = received !== null && received > 0
  let conflict = false
  if (status === 'delivered' && flag === 'short') conflict = true // K1
  if (status === 'partial' && received !== null && (flag !== 'short' || received === 0)) conflict = true // K2
  if ((status === 'delivered' || status === 'partial') && actDay === null) conflict = true // K3
  if ((status === 'scheduled' || status === 'in_transit' || status === 'delayed') && (hasGoods || actDay !== null)) conflict = true // K4
  if (status === 'cancelled' && hasGoods) conflict = true // K5
  if (actDay !== null && actDay > asOfDay) conflict = true // K6

  return { balance, balance_flag: flag, days_late: daysLate, late_flag: lateFlag, conflict: conflict ? 'Y' : 'N' }
}

export const reasonPresent = (v: string | undefined): 'Y' | 'N' => ((v ?? '').trim() === '' ? 'N' : 'Y')

/** Verdict by the lookup table of the spec (section 7), first line that fits wins. */
export function verdictFromParts(e: Pick<Evaluation, 'balance_flag' | 'late_flag' | 'conflict'> & { status: string }, reason: 'Y' | 'N'): Verdict {
  if (e.balance_flag === '-' || e.late_flag === '-') return 'data-incomplete'
  if (e.conflict === 'Y') return 'data-incomplete'
  if (e.balance_flag === 'complete' || e.balance_flag === 'over') return 'received-complete'
  if (e.late_flag === 'Y') return reason === 'Y' ? 'late' : 'late-no-reason'
  return e.status === 'partial' ? 'partial' : 'not-yet-due'
}

export function verdictFor(line: RawLine, asOf: string): Verdict {
  return verdictFromParts({ ...evaluateLine(line, asOf), status: line.status.trim() }, reasonPresent(line.delay_reason))
}

export function enrichLines(lines: RawLine[], asOf: string): EnrichedLine[] {
  return lines.map((line) => {
    const e = evaluateLine(line, asOf)
    const reason = reasonPresent(line.delay_reason)
    return { ...line, ...e, reason_present: reason, verdict: verdictFromParts({ ...e, status: line.status.trim() }, reason) }
  })
}
