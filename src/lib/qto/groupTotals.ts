// QTO normalisation and grouped totals (own code, deterministic, no I/O). Method from the DDC skill bim-qto
// (group by group/level, one item per row), with the defects of its grouping code corrected: no silent
// zero for a missing quantity, no summing across units, no dropped rows with a missing key, no hidden
// imperial units, rounding at output only. See docs/ddc-alignment/qto-normalization.md.

export type QtoErrorCode =
  | 'unresolved-unit'
  | 'missing-quantity'
  | 'bad-number'
  | 'ambiguous-number'
  | 'missing-field'

export class QtoError extends Error {
  readonly code: QtoErrorCode
  constructor(code: QtoErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'QtoError'
    this.code = code
  }
}

export interface InputRow {
  row_id: string
  group: string
  description: string
  quantity: string
  unit: string
  level: string
}

export type UnitKind = 'canonical' | 'spelling' | 'convert'
export interface UnitResult {
  unit: string
  factor: number
  kind: UnitKind
}

// Lookup table of the spec (section 4). Case-sensitive on the copied unit text.
const UNIT_TABLE: Record<string, UnitResult> = {
  m: { unit: 'm', factor: 1, kind: 'canonical' },
  M: { unit: 'm', factor: 1, kind: 'spelling' },
  m2: { unit: 'm2', factor: 1, kind: 'canonical' },
  M2: { unit: 'm2', factor: 1, kind: 'spelling' },
  'm²': { unit: 'm2', factor: 1, kind: 'spelling' },
  sqm: { unit: 'm2', factor: 1, kind: 'spelling' },
  'm^2': { unit: 'm2', factor: 1, kind: 'spelling' },
  m3: { unit: 'm3', factor: 1, kind: 'canonical' },
  M3: { unit: 'm3', factor: 1, kind: 'spelling' },
  'm³': { unit: 'm3', factor: 1, kind: 'spelling' },
  cum: { unit: 'm3', factor: 1, kind: 'spelling' },
  kg: { unit: 'kg', factor: 1, kind: 'canonical' },
  pcs: { unit: 'pcs', factor: 1, kind: 'canonical' },
  pc: { unit: 'pcs', factor: 1, kind: 'spelling' },
  ea: { unit: 'pcs', factor: 1, kind: 'spelling' },
  kpl: { unit: 'pcs', factor: 1, kind: 'spelling' },
  mm: { unit: 'm', factor: 0.001, kind: 'convert' },
  cm: { unit: 'm', factor: 0.01, kind: 'convert' },
  l: { unit: 'm3', factor: 0.001, kind: 'convert' },
  L: { unit: 'm3', factor: 0.001, kind: 'convert' },
  t: { unit: 'kg', factor: 1000, kind: 'convert' },
  g: { unit: 'kg', factor: 0.001, kind: 'convert' },
}

export function normaliseUnit(text: string): UnitResult {
  const key = text.trim()
  const hit = Object.prototype.hasOwnProperty.call(UNIT_TABLE, key) ? UNIT_TABLE[key] : undefined
  if (!hit) throw new QtoError('unresolved-unit', `unit "${key}" is not in the lookup table`)
  return { ...hit }
}

/** Returns the number text with a decimal point and without spaces; throws a typed error. */
export function cleanNumberText(text: string): string {
  const t = text.replace(/[\s ]/g, '')
  if (t === '') throw new QtoError('missing-quantity', 'quantity is empty')
  if (!/^[+-]?[\d.,]+$/.test(t) || !/\d/.test(t)) throw new QtoError('bad-number', `"${text.trim()}" is not a number`)
  const commas = (t.match(/,/g) ?? []).length
  const points = (t.match(/\./g) ?? []).length
  let out: string
  if (commas && points) {
    const dec = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.'
    const thou = dec === ',' ? '.' : ','
    if ((t.match(dec === ',' ? /,/g : /\./g) ?? []).length > 1) throw new QtoError('bad-number', `"${text.trim()}" has several decimal separators`)
    out = t.split(thou).join('').replace(dec, '.')
  } else if (commas === 1) {
    if (/^[+-]?\d{1,3},\d{3}$/.test(t)) throw new QtoError('ambiguous-number', `"${t}" could be 1.250 or 1250: engineer must confirm`)
    out = t.replace(',', '.')
  } else if (commas > 1) {
    out = t.split(',').join('')
  } else if (points > 1) {
    throw new QtoError('bad-number', `"${text.trim()}" has several decimal points`)
  } else out = t
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(out)) throw new QtoError('bad-number', `"${text.trim()}" is not a number`)
  return out
}

export function parseQuantity(text: string): number {
  return Number(cleanNumberText(text))
}

const GROUP_LABELS: Record<string, string> = { ilmanvaihto: 'Ilmanvaihto', putkisto: 'Putkisto', sähkö: 'Sähkö', sahko: 'Sähkö' }

export function groupLabel(text: string): string {
  const t = text.trim().toLowerCase()
  if (GROUP_LABELS[t]) return GROUP_LABELS[t]
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export type IssueCode =
  | 'OK'
  | 'NUMFMT'
  | 'UNIT-SPELL'
  | 'UNIT-CONV'
  | 'DUPLICATE'
  | 'UNRESOLVED-UNIT'
  | 'MISSING-QTY'
  | 'BAD-NUMBER'
  | 'AMBIGUOUS-NUMBER'

export interface NormalisedRow {
  row_id: string
  group: string
  level: string
  qty: string
  unit: string
  factor: string
  dup_of: string
  issue: IssueCode
  /** canonical quantity (qty x factor), null when excluded */
  canonical: number | null
  excluded: string | null
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6
const round3 = (x: number): number => Math.round(x * 1e3) / 1e3

export function normaliseRows(rows: InputRow[]): NormalisedRow[] {
  const seen = new Map<string, string>()
  return rows.map((r) => {
    if (r.group.trim() === '') throw new QtoError('missing-field', `row ${r.row_id} has no group`)
    if (r.level.trim() === '') throw new QtoError('missing-field', `row ${r.row_id} has no level`)
    const group = groupLabel(r.group)
    const level = r.level.trim()

    let qty = '-'
    let numCode: QtoErrorCode | null = null
    let numChanged = false
    try {
      qty = cleanNumberText(r.quantity)
      numChanged = qty !== r.quantity.trim()
    } catch (e) {
      if (!(e instanceof QtoError)) throw e
      numCode = e.code
      qty = e.code === 'missing-quantity' ? '-' : r.quantity.trim()
    }

    let unit = 'UNRESOLVED'
    let factorNum: number | null = null
    let kind: UnitKind | null = null
    try {
      const u = normaliseUnit(r.unit)
      unit = u.unit
      factorNum = u.factor
      kind = u.kind
    } catch (e) {
      if (!(e instanceof QtoError)) throw e
    }

    const dupKey = [group.toLowerCase(), r.description.trim().toLowerCase(), qty, r.unit.trim(), level].join('\u0001')
    const first = seen.get(dupKey)
    if (!first) seen.set(dupKey, r.row_id)

    let issue: IssueCode
    let excluded: string | null = null
    if (numCode === 'missing-quantity') (issue = 'MISSING-QTY'), (excluded = 'missing-quantity')
    else if (kind === null) (issue = 'UNRESOLVED-UNIT'), (excluded = 'unresolved-unit')
    else if (numCode === 'bad-number') (issue = 'BAD-NUMBER'), (excluded = 'bad-number')
    else if (numCode === 'ambiguous-number') (issue = 'AMBIGUOUS-NUMBER'), (excluded = 'ambiguous-number')
    else if (first) (issue = 'DUPLICATE'), (excluded = `duplicate of ${first}`)
    else if (kind === 'convert') issue = 'UNIT-CONV'
    else if (numChanged) issue = 'NUMFMT'
    else if (kind === 'spelling') issue = 'UNIT-SPELL'
    else issue = 'OK'

    const canonical = excluded === null && factorNum !== null ? round6(Number(qty) * factorNum) : null
    return {
      row_id: r.row_id,
      group,
      level,
      qty,
      unit,
      factor: factorNum === null ? '-' : String(factorNum),
      dup_of: first ?? '-',
      issue,
      canonical,
      excluded,
    }
  })
}

export interface TotalLine {
  key: string
  unit: string
  total: number
  rows: number
}

export interface Totals {
  byGroup: TotalLine[]
  byLevel: TotalLine[]
  excluded: { row_id: string; reason: string }[]
}

function sumBy(rows: NormalisedRow[], keyOf: (r: NormalisedRow) => string): TotalLine[] {
  const m = new Map<string, TotalLine & { raw: number }>()
  for (const r of rows) {
    if (r.canonical === null) continue
    const k = `${keyOf(r)}\u0001${r.unit}`
    const cur = m.get(k) ?? { key: keyOf(r), unit: r.unit, total: 0, rows: 0, raw: 0 }
    cur.raw += r.canonical
    cur.rows += 1
    m.set(k, cur)
  }
  return [...m.values()]
    .map(({ key, unit, raw, rows: n }) => ({ key, unit, total: round3(round6(raw)), rows: n }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0))
}

export function groupTotals(rows: NormalisedRow[]): Totals {
  return {
    byGroup: sumBy(rows, (r) => r.group),
    byLevel: sumBy(rows, (r) => r.level),
    excluded: rows.filter((r) => r.excluded !== null).map((r) => ({ row_id: r.row_id, reason: r.excluded as string })),
  }
}
