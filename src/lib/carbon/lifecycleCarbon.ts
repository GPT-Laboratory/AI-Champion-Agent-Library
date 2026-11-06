// Lifecycle carbon calculation (own code, deterministic, no I/O). Method from the DDC skill
// lifecycle-carbon-calculator (stages A1-A3, A4, A5, B, C, D; quantity x factor per stage; stage sums;
// comparison of alternatives), with the defects of its calculation code corrected: no unit-blind multiplication,
// module D kept out of the A-C total, undeclared stages are null (never 0), no division by zero, abs(baseline)
// in the percentage, float noise removed at output. No factor data from the skill is used.
// See docs/ddc-alignment/carbon-epd-enrichment.md.

export type Stage = 'A1-A3' | 'A4' | 'A5' | 'B' | 'C' | 'D'
export const STAGES: Stage[] = ['A1-A3', 'A4', 'A5', 'B', 'C', 'D']
const AC_STAGES: Stage[] = ['A1-A3', 'A4', 'A5', 'B', 'C']

export type CarbonErrorCode = 'unit-mismatch' | 'missing-factor' | 'expired-epd' | 'bad-number' | 'bad-date' | 'nothing-to-compare'

export class CarbonError extends Error {
  readonly code: CarbonErrorCode
  constructor(code: CarbonErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'CarbonError'
    this.code = code
  }
}

export interface ProductRow {
  product_id: string
  description: string
  material_key: string
  qty: string | number
  unit: string
  option: string // '-' or a letter
}

export interface EpdRow {
  epd_id: string
  material_key: string
  product_name: string
  declared_unit: string
  gwp: Partial<Record<Stage, string | number | null>>
  valid_until: string
}

export type Status = 'matched' | 'no-epd' | 'ambiguous' | 'unit-mismatch' | 'expired'

export interface Mapping {
  product_id: string
  cand: string[]
  status: Status
}

export interface ProductValues {
  product_id: string
  option: string
  epd_id: string
  stages: Record<Stage, number | null>
  total_a_c: number | null
}

export interface Excluded {
  product_id: string
  option: string
  code: string
  message: string
}

export interface CarbonResult {
  products: ProductValues[]
  excluded: Excluded[]
  stageTotals: Record<Stage, { total: number | null; declared: number }>
  totalAC: number | null
  totalD: number | null
  warnings: string[]
}

export interface Options {
  convertUnits?: boolean
}

/** Removes float noise (6 decimals). */
export function clean(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/** Display: 2 decimals, `not declared` for null. */
export function fmt(n: number | null): string {
  if (n === null) return 'not declared'
  return (Math.round(clean(n) * 100) / 100).toFixed(2)
}

/** `ND`, empty and `-` mean not declared (null); otherwise a plain decimal-point number (negative allowed). */
export function parseFactor(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new CarbonError('bad-number', `factor ${v}`)
    return v
  }
  const t = v.trim()
  if (t === '' || t === '-' || t.toUpperCase() === 'ND') return null
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new CarbonError('bad-number', `factor "${t}" is not a number`)
  return Number(t)
}

export function parseQty(v: string | number): number {
  const t = typeof v === 'number' ? String(v) : v.trim()
  if (!/^\d+(\.\d+)?$/.test(t)) throw new CarbonError('bad-number', `quantity "${t}" is not a non-negative number`)
  return Number(t)
}

function isoDate(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) throw new CarbonError('bad-date', `"${s}" is not yyyy-mm-dd`)
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) throw new CarbonError('bad-date', `"${s}" is not a real date`)
  return dt.getTime()
}

/** True when valid_until is before the reference date; the same date is still valid. */
export function isExpired(validUntil: string, referenceDate: string): boolean {
  return isoDate(validUntil) < isoDate(referenceDate)
}

// The only explicit conversion (spec section 5): kg and t, applied on request.
const CONVERT: Record<string, number> = { 'kg>t': 0.001, 't>kg': 1000 }

/** Exact material_key lookup and the fixed status vocabulary (first matching rule). */
export function mapProducts(products: ProductRow[], epds: EpdRow[], referenceDate: string): Mapping[] {
  return products.map((p) => {
    const hits = epds.filter((e) => e.material_key === p.material_key)
    const cand = hits.map((h) => h.epd_id)
    if (hits.length === 0) return { product_id: p.product_id, cand, status: 'no-epd' }
    if (hits.length > 1) return { product_id: p.product_id, cand, status: 'ambiguous' }
    if (p.unit !== hits[0].declared_unit) return { product_id: p.product_id, cand, status: 'unit-mismatch' }
    if (isExpired(hits[0].valid_until, referenceDate)) return { product_id: p.product_id, cand, status: 'expired' }
    return { product_id: p.product_id, cand, status: 'matched' }
  })
}

/** Stage value = quantity x factor in the declared unit; undeclared stages stay null. Throws typed errors. */
export function calcProduct(product: ProductRow, epd: EpdRow | undefined, referenceDate: string, opts: Options = {}): ProductValues {
  if (!epd) throw new CarbonError('missing-factor', `${product.product_id}: no EPD`)
  if (isExpired(epd.valid_until, referenceDate)) throw new CarbonError('expired-epd', `${product.product_id}: ${epd.epd_id} valid until ${epd.valid_until}`)
  let qty = parseQty(product.qty)
  if (product.unit !== epd.declared_unit) {
    const f = opts.convertUnits ? CONVERT[`${product.unit}>${epd.declared_unit}`] : undefined
    if (f === undefined) throw new CarbonError('unit-mismatch', `${product.product_id}: unit ${product.unit} vs declared ${epd.declared_unit}`)
    qty = qty * f
  }
  const stages = {} as Record<Stage, number | null>
  for (const s of STAGES) {
    const f = parseFactor(epd.gwp[s])
    stages[s] = f === null ? null : clean(qty * f)
  }
  if (stages['A1-A3'] === null) throw new CarbonError('missing-factor', `${product.product_id}: ${epd.epd_id} declares no A1-A3 value`)
  const declared = AC_STAGES.map((s) => stages[s]).filter((v): v is number => v !== null)
  return {
    product_id: product.product_id,
    option: product.option,
    epd_id: epd.epd_id,
    stages,
    total_a_c: clean(declared.reduce((a, b) => a + b, 0)),
  }
}

function sumOrNull(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null)
  return v.length ? clean(v.reduce((a, b) => a + b, 0)) : null
}

/** Maps, calculates matched rows (and kg/t unit-mismatched rows with convertUnits), totals the rest. */
export function runCarbon(products: ProductRow[], epds: EpdRow[], referenceDate: string, opts: Options = {}): CarbonResult {
  const maps = mapProducts(products, epds, referenceDate)
  const out: ProductValues[] = []
  const excluded: Excluded[] = []
  const warnings: string[] = []
  products.forEach((p, i) => {
    const m = maps[i]
    const epd = m.cand.length === 1 ? epds.find((e) => e.epd_id === m.cand[0]) : undefined
    try {
      if (m.status !== 'matched' && !(m.status === 'unit-mismatch' && opts.convertUnits)) {
        throw new CarbonError('missing-factor', '')
      }
      const v = calcProduct(p, epd, referenceDate, opts)
      out.push(v)
      for (const s of STAGES) if (v.stages[s] !== null && v.stages[s]! < 0) warnings.push(`${p.product_id}: negative value in ${s}, check biogenic or credit treatment`)
    } catch (e) {
      if (!(e instanceof CarbonError)) throw e
      if (m.status !== 'matched' && !(m.status === 'unit-mismatch' && opts.convertUnits)) {
        excluded.push({ product_id: p.product_id, option: p.option, code: m.status, message: `${m.status}${m.cand.length ? ` (${m.cand.join(',')})` : ''}` })
      } else {
        excluded.push({ product_id: p.product_id, option: p.option, code: e.code, message: e.message })
      }
    }
  })
  const stageTotals = {} as CarbonResult['stageTotals']
  for (const s of STAGES) {
    const vals = out.map((o) => o.stages[s])
    stageTotals[s] = { total: sumOrNull(vals), declared: vals.filter((x) => x !== null).length }
  }
  return {
    products: out,
    excluded,
    stageTotals,
    totalAC: sumOrNull(AC_STAGES.map((s) => stageTotals[s].total)),
    totalD: stageTotals.D.total,
    warnings,
  }
}

export interface Comparison {
  basis: 'A1-A3' | 'A-C'
  a_total: number
  b_total: number
  lower: 'A' | 'B' | 'equal'
  abs_diff: number
  pct_of_baseline: number | 'undefined'
  warnings: string[]
}

/** Option A is the baseline. Percentage = (B - A) / abs(A) x 100, `undefined` when A is 0. */
export function compareOptions(result: CarbonResult, optA: string, optB: string, basis: 'A1-A3' | 'A-C' = 'A1-A3'): Comparison {
  const pick = (o: string) => result.products.filter((p) => p.option === o)
  const value = (p: ProductValues) => (basis === 'A1-A3' ? p.stages['A1-A3'] : p.total_a_c)
  const [pa, pb] = [pick(optA), pick(optB)]
  if (!pa.length || !pb.length) throw new CarbonError('nothing-to-compare', `option ${optA} or ${optB} has no calculated product`)
  const a = clean(pa.reduce((s, p) => s + (value(p) ?? 0), 0))
  const b = clean(pb.reduce((s, p) => s + (value(p) ?? 0), 0))
  const warnings: string[] = []
  const ex = result.excluded.filter((x) => x.option === optA || x.option === optB)
  if (ex.length) warnings.push(`excluded products in the options: ${ex.map((x) => x.product_id).join(', ')}; totals are incomplete`)
  if (basis === 'A-C') {
    const set = (ps: ProductValues[]) => AC_STAGES.filter((s) => ps.some((p) => p.stages[s] !== null)).join('+')
    if (set(pa) !== set(pb)) warnings.push(`declared stages differ (${set(pa)} vs ${set(pb)}): not like for like`)
  }
  const diff = clean(Math.abs(b - a))
  return {
    basis,
    a_total: a,
    b_total: b,
    lower: a === b ? 'equal' : b < a ? 'B' : 'A',
    abs_diff: diff,
    pct_of_baseline: a === 0 ? (b === 0 ? 0 : 'undefined') : Math.round(((b - a) / Math.abs(a)) * 10000) / 100,
    warnings,
  }
}
