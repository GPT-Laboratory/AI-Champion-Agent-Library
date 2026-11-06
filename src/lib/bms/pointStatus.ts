// BMS point binding and threshold status (own code, deterministic, no I/O). Method from the DDC skill digital-twin-sync
// (element-to-sensor binding, min/max threshold with below_minimum / above_maximum), with the defects of the skill
// corrected: unknown element is reported (not ignored), duplicate asset ids are ambiguous (not overwritten), units are
// checked before any comparison, empty / NaN / non-numeric readings are `no-data` (never normal), boundary values are
// inside the band, low greater than high is an error. See docs/ddc-alignment/bms-digital-twin.md.

export type BmsErrorCode = 'bad-limit' | 'bad-input'

export class BmsError extends Error {
  readonly code: BmsErrorCode
  constructor(code: BmsErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'BmsError'
    this.code = code
  }
}

export interface PointRow { point_id: string; point_name: string; description: string; unit: string; reading: string }
export interface AssetRow { asset_id: string; name: string; kind: string }
export interface HintRow { keyword: string; tag: string; expected_unit: string; low: string; high: string }

export type Binding = 'unbound' | 'ambiguous' | 'untagged' | 'unit-mismatch' | 'bound'
export type Status = 'not-bound' | 'untagged' | 'unit-mismatch' | 'no-data' | 'no-limits' | 'below_minimum' | 'above_maximum' | 'normal'

export interface BoundPoint {
  point_id: string
  point_name: string
  asset_id: string // asset id, UNMAPPED or AMBIGUOUS
  tag: string // tag or UNTAGGED
  unit: string
  reading: string
  low: string // copied or '-'
  high: string
  binding: Binding
  status: Status
  review: 'YES' | 'NO'
}

const NUM = /^-?\d{1,12}(\.\d{1,12})?$/

function num(s: string | undefined): number | null {
  const t = (s ?? '').trim()
  return NUM.test(t) ? Number(t) : null
}

/** Limits of a hint row: empty = open side; a non-empty non-number or low > high is a typed error. */
export function limits(h: HintRow): { low: number | null; high: number | null } {
  const side = (s: string, n: string) => {
    const t = (s ?? '').trim()
    if (t === '') return null
    const v = num(t)
    if (v === null) throw new BmsError('bad-limit', `${n} "${t}" of tag ${h.tag} is not a number`)
    return v
  }
  const low = side(h.low, 'low')
  const high = side(h.high, 'high')
  if (low !== null && high !== null && low > high) throw new BmsError('bad-limit', `low ${low} is greater than high ${high} for tag ${h.tag}`)
  return { low, high }
}

/** Threshold status of one reading against one hint row. Unit first, then reading, then the band. */
export function evaluateReading(reading: string | undefined, pointUnit: string, hint: HintRow): Status {
  const { low, high } = limits(hint)
  if ((pointUnit ?? '').trim() !== (hint.expected_unit ?? '').trim()) return 'unit-mismatch'
  const v = num(reading)
  if (v === null) return 'no-data'
  if (low === null && high === null) return 'no-limits'
  if (low !== null && v < low) return 'below_minimum'
  if (high !== null && v > high) return 'above_maximum'
  return 'normal'
}

export function prefixOf(pointName: string): string {
  const i = pointName.indexOf('.')
  return i < 0 ? pointName : pointName.slice(0, i)
}

/** Binding and status for every point, in input order. */
export function bindPoints(points: PointRow[], assets: AssetRow[], hints: HintRow[]): BoundPoint[] {
  return points.map((p) => {
    const prefix = prefixOf(p.point_name)
    const n = assets.filter((a) => a.asset_id === prefix).length
    const hint = hints.find((h) => h.keyword !== '' && p.description.includes(h.keyword))
    const asset_id = n === 0 ? 'UNMAPPED' : n === 1 ? prefix : 'AMBIGUOUS'
    const unitOk = hint ? p.unit.trim() === hint.expected_unit.trim() : null
    const binding: Binding = n === 0 ? 'unbound' : n > 1 ? 'ambiguous' : !hint ? 'untagged' : unitOk === false ? 'unit-mismatch' : 'bound'
    let status: Status
    if (binding === 'unbound' || binding === 'ambiguous') status = 'not-bound'
    else if (!hint) status = 'untagged'
    else status = evaluateReading(p.reading, p.unit, hint)
    if (hint) limits(hint) // validate the band even when the status is decided earlier
    return {
      point_id: p.point_id,
      point_name: p.point_name,
      asset_id,
      tag: hint ? hint.tag : 'UNTAGGED',
      unit: p.unit,
      reading: p.reading,
      low: hint && hint.low.trim() !== '' ? hint.low.trim() : '-',
      high: hint && hint.high.trim() !== '' ? hint.high.trim() : '-',
      binding,
      status,
      review: binding === 'bound' ? 'NO' : 'YES',
    }
  })
}
