// IFC to E-BOM class step and join (own code, deterministic, no I/O). Text slice of the AIC IFC to E-BOM compiler:
// - classRows(): the reference decision of data/tryitout-prompts/ifc-ebom-compiler/SKILL.md, step table 1 to 10
//   (scope rule, block, catalogue match, unit and quantity; the first step that fits decides);
// - checkOutcomes(): the compiler's contract on any set of class rows (every element exactly one outcome, catalogue
//   names only, positive quantities, known blocks);
// - joinLines(): billed metres and pieces per block x designation, metres rounded UP to whole sticks per block x
//   designation, as the compiler's join does (ceil(measured / stick) * stick).
// Quantities are summed as integer micrometres, so no floating-point error reaches a total.
// No DDC basis (own design).

export type EbomErrorCode = 'missing-section' | 'bad-header' | 'bad-row' | 'bad-number' | 'bad-value' | 'duplicate'

export class EbomError extends Error {
  readonly code: EbomErrorCode
  constructor(code: EbomErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'EbomError'
    this.code = code
  }
}

export const BLOCK_COLS = ['block_id', 'discipline', 'tab', 'title'] as const
export const CATALOGUE_COLS = ['name', 'unit', 'ifc_class', 'geom_family', 'size_mm', 'discipline'] as const
export const ELEMENT_COLS = ['token', 'ifc_class', 'type_name', 'system', 'size_mm', 'geom_family', 'stated_length_m', 'geom_centreline_m', 'geom_check', 'loc_block'] as const
export const RESULT_COLS = ['token', 'ifc_class', 'outcome', 'block', 'designation', 'unit', 'qty', 'rule'] as const
export const UNITS = ['m', 'kpl'] as const
export const GEOM_CHECKS = ['agree', 'differ', 'none'] as const
export const OUTCOMES = ['bill', 'exclude', 'review'] as const

export type Block = Record<(typeof BLOCK_COLS)[number], string>
export type CatalogueRow = Record<(typeof CATALOGUE_COLS)[number], string>
export type ElementRow = Record<(typeof ELEMENT_COLS)[number], string>
export type ResultRow = Record<(typeof RESULT_COLS)[number], string>
export type Outcome = (typeof OUTCOMES)[number]
export type ReviewKind = 'unsettled' | 'bad_data' | 'estimate'
export type ReasonRule = 'loc-review' | 'no-catalogue' | 'multi-catalogue' | 'zero-qty' | 'length-unsettled'

export interface ScopeRule {
  id: string
  field: string
  value: string
  reason: string
  line: string
}

export interface Upload {
  labels: string[]
  blocks: Block[]
  catalogue: CatalogueRow[]
  rules: ScopeRule[]
  untiedRules: string[]
  elements: ElementRow[]
}

export interface ClassRow extends ResultRow {
  step: number
  review_kind: ReviewKind | '-'
}

export interface ReviewItem {
  where: string
  members: string
  kind: ReviewKind
  what: string
}

export interface Line {
  block: string
  designation: string
  unit: string
  measured: string
  billed: string
  elements: number
  stick_rounded: boolean
}

/** Fixed review texts of the SKILL.md output format, per reason rule. */
export const REVIEW_TEXT: Record<ReasonRule, string> = {
  'loc-review': 'block not settled by the location step',
  'no-catalogue': 'no catalogue name for this class, family and size',
  'multi-catalogue': 'two or more catalogue names fit',
  'zero-qty': 'zero or negative length',
  'length-unsettled': 'no stated length and the geometry readings do not agree',
}

const REVIEW_KIND: Record<ReasonRule, ReviewKind> = {
  'loc-review': 'unsettled',
  'no-catalogue': 'unsettled',
  'multi-catalogue': 'unsettled',
  'zero-qty': 'bad_data',
  'length-unsettled': 'estimate',
}

// ---------------------------------------------------------------- numbers (integer micrometres)

const MICRO = 1_000_000n
const DECIMAL = /^-?\d+(\.\d{1,6})?$/

/** Decimal text (point, at most 6 decimals) to integer micro-units; throws bad-number. */
export function toMicro(text: string, what = 'value'): bigint {
  const t = text.trim()
  if (!DECIMAL.test(t)) throw new EbomError('bad-number', `${what} "${text}" is not a decimal number with a point and at most 6 decimals`)
  const neg = t.startsWith('-')
  const [int, frac = ''] = (neg ? t.slice(1) : t).split('.')
  const v = BigInt(int) * MICRO + BigInt(frac.padEnd(6, '0'))
  return neg ? -v : v
}

/** Integer micro-units to the shortest decimal text (3.000000 -> "3", 5.275000 -> "5.275"). */
export function fromMicro(v: bigint): string {
  const neg = v < 0n
  const a = neg ? -v : v
  const int = a / MICRO
  const frac = (a % MICRO).toString().padStart(6, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`
}

// ---------------------------------------------------------------- parsing the upload

function csvSection(name: string, lines: string[], cols: readonly string[]): Record<string, string>[] {
  if (lines.length === 0) throw new EbomError('bad-header', `section ${name} has no header line`)
  const head = lines[0].split(',').map((s) => s.trim())
  const absent = cols.filter((c) => !head.includes(c))
  if (absent.length) throw new EbomError('bad-header', `section ${name} lacks columns: ${absent.join(', ')}`)
  return lines.slice(1).map((l, n) => {
    const cells = l.split(',')
    if (cells.length !== head.length) throw new EbomError('bad-row', `${name} row ${n + 1} has ${cells.length} cells, expected ${head.length}`)
    const o: Record<string, string> = {}
    cols.forEach((c) => (o[c] = cells[head.indexOf(c)].trim()))
    return o
  })
}

const RULE = /^(\S+?):\s*(\w+)\s*=\s*(.+?)\s*->\s*exclude\s*\((.+)\)\s*$/

/** Parses the four `## ` sections of the SKILL.md input; `#` lines (one hash, then a space or text) are labels. */
export function parseUpload(text: string): Upload {
  const labels: string[] = []
  const sections = new Map<string, string[]>()
  let cur: string[] | null = null
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (t === '') continue
    if (/^##\s/.test(t)) {
      const name = t.replace(/^##\s+/, '').trim().toUpperCase()
      if (sections.has(name)) throw new EbomError('duplicate', `section ${name} appears twice`)
      cur = []
      sections.set(name, cur)
    } else if (t.startsWith('#')) labels.push(t)
    else if (cur) cur.push(t)
    else throw new EbomError('bad-row', `text before the first section: "${t.slice(0, 60)}"`)
  }
  for (const s of ['BLOCKS', 'CATALOGUE', 'ELEMENTS']) {
    if (!sections.has(s)) throw new EbomError('missing-section', `no "## ${s}" section`)
  }

  const blocks = csvSection('BLOCKS', sections.get('BLOCKS')!, BLOCK_COLS) as Block[]
  const catalogue = csvSection('CATALOGUE', sections.get('CATALOGUE')!, CATALOGUE_COLS) as CatalogueRow[]
  const elements = csvSection('ELEMENTS', sections.get('ELEMENTS')!, ELEMENT_COLS) as ElementRow[]

  const seen = (rows: Record<string, string>[], key: string, name: string) => {
    const s = new Set<string>()
    for (const r of rows) {
      if (r[key] === '') throw new EbomError('bad-value', `${name}: empty ${key}`)
      if (s.has(r[key])) throw new EbomError('duplicate', `${name}: ${key} "${r[key]}" appears twice`)
      s.add(r[key])
    }
  }
  seen(blocks, 'block_id', 'BLOCKS')
  seen(catalogue, 'name', 'CATALOGUE')
  seen(elements, 'token', 'ELEMENTS')
  for (const c of catalogue) {
    if (!(UNITS as readonly string[]).includes(c.unit)) throw new EbomError('bad-value', `CATALOGUE ${c.name}: unit "${c.unit}" is not m or kpl`)
  }
  for (const e of elements) {
    if (!(GEOM_CHECKS as readonly string[]).includes(e.geom_check)) throw new EbomError('bad-value', `ELEMENTS ${e.token}: geom_check "${e.geom_check}" is not agree, differ or none`)
    if (e.stated_length_m !== '') toMicro(e.stated_length_m, `ELEMENTS ${e.token} stated_length_m`)
    if (e.geom_centreline_m !== '') toMicro(e.geom_centreline_m, `ELEMENTS ${e.token} geom_centreline_m`)
    if (e.loc_block === '') throw new EbomError('bad-value', `ELEMENTS ${e.token}: empty loc_block`)
  }

  const rules: ScopeRule[] = []
  const untiedRules: string[] = []
  for (const line of sections.get('RULES') ?? []) {
    const m = RULE.exec(line)
    if (m && (ELEMENT_COLS as readonly string[]).includes(m[2])) rules.push({ id: m[1], field: m[2], value: m[3], reason: m[4], line })
    else untiedRules.push(line)
  }
  return { labels, blocks, catalogue, rules, untiedRules, elements }
}

// ---------------------------------------------------------------- the reference decision (SKILL.md step table)

const blank = (e: ElementRow): Omit<ClassRow, 'outcome' | 'rule' | 'step' | 'review_kind'> => ({
  token: e.token,
  ifc_class: e.ifc_class,
  block: e.loc_block,
  designation: '-',
  unit: '-',
  qty: '-',
})

/** One element through steps 1 to 10; the first step that fits decides. */
export function decideElement(e: ElementRow, u: Upload): ClassRow {
  const review = (rule: ReasonRule, step: number): ClassRow => ({ ...blank(e), outcome: 'review', rule, step, review_kind: REVIEW_KIND[rule] })
  const bill = (c: CatalogueRow, qty: string, rule: string, step: number): ClassRow => ({
    ...blank(e),
    outcome: 'bill',
    designation: c.name,
    unit: c.unit,
    qty,
    rule,
    step,
    review_kind: '-',
  })

  const scope = u.rules.find((r) => e[r.field as keyof ElementRow] === r.value)
  if (scope) return { ...blank(e), outcome: 'exclude', rule: scope.id, step: 1, review_kind: '-' }
  if (e.loc_block === 'review' || !u.blocks.some((b) => b.block_id === e.loc_block)) return review('loc-review', 2)
  const hits = u.catalogue.filter((c) => c.ifc_class === e.ifc_class && c.geom_family === e.geom_family && c.size_mm === e.size_mm)
  if (hits.length === 0) return review('no-catalogue', 3)
  if (hits.length > 1) return review('multi-catalogue', 4)
  const c = hits[0]
  if (c.unit === 'kpl') return bill(c, '1', 'count', 5)
  if (e.stated_length_m !== '') {
    return toMicro(e.stated_length_m) <= 0n ? review('zero-qty', 6) : bill(c, e.stated_length_m, 'stated', 7)
  }
  if (e.geom_check === 'agree') {
    return toMicro(e.geom_centreline_m || '0') <= 0n ? review('zero-qty', 8) : bill(c, e.geom_centreline_m, 'measured:geom', 9)
  }
  return review('length-unsettled', 10)
}

export function classRows(u: Upload): ClassRow[] {
  return u.elements.map((e) => decideElement(e, u))
}

/** The review list of the SKILL.md output format, one item per review row, in input order. */
export function reviewItems(rows: ClassRow[]): ReviewItem[] {
  return rows
    .filter((r) => r.outcome === 'review')
    .map((r) => ({
      where: r.rule === 'loc-review' ? 'class' : r.block,
      members: '1',
      kind: r.review_kind as ReviewKind,
      what: `${r.token}: ${REVIEW_TEXT[r.rule as ReasonRule]}`,
    }))
}

// ---------------------------------------------------------------- contract check and comparison

/** The compiler's contract on any class rows: every element exactly one outcome, catalogue names, positive quantities. */
export function checkOutcomes(u: Upload, rows: ResultRow[]): string[] {
  const out: string[] = []
  const tokens = new Set(u.elements.map((e) => e.token))
  const count = new Map<string, number>()
  for (const r of rows) count.set(r.token, (count.get(r.token) ?? 0) + 1)
  for (const e of u.elements) {
    const n = count.get(e.token) ?? 0
    if (n === 0) out.push(`${e.token}: no outcome`)
    if (n > 1) out.push(`${e.token}: ${n} rows, expected exactly one outcome`)
  }
  for (const [t] of count) if (!tokens.has(t)) out.push(`${t}: not an input element`)
  for (const r of rows) {
    if (!(OUTCOMES as readonly string[]).includes(r.outcome)) {
      out.push(`${r.token}: outcome "${r.outcome}" is not bill, exclude or review`)
      continue
    }
    if (r.outcome !== 'bill') {
      if (!r.rule || r.rule === '-') out.push(`${r.token}: ${r.outcome} row has no rule or reason`)
      continue
    }
    if (!u.blocks.some((b) => b.block_id === r.block)) out.push(`${r.token}: billed in "${r.block}", not a block of the template`)
    const c = u.catalogue.find((k) => k.name === r.designation)
    if (!c) out.push(`${r.token}: designation "${r.designation}" is not in the catalogue`)
    else if (c.unit !== r.unit) out.push(`${r.token}: unit "${r.unit}", catalogue says "${c.unit}"`)
    let q: bigint | null = null
    try {
      q = toMicro(r.qty, `${r.token} qty`)
    } catch {
      out.push(`${r.token}: qty "${r.qty}" is not a number`)
    }
    if (q !== null && q <= 0n) out.push(`${r.token}: qty ${r.qty} is not positive`)
    if (q !== null && r.unit === 'kpl' && q % MICRO !== 0n) out.push(`${r.token}: ${r.qty} pieces is not a whole number`)
  }
  return out
}

/** Cell-by-cell comparison of result rows with the reference rows, in input order. */
export function compareRows(expected: ClassRow[], got: ResultRow[]): string[] {
  const out: string[] = []
  if (got.length !== expected.length) out.push(`row count: helper ${expected.length}, result ${got.length}`)
  const byToken = new Map(got.map((g) => [g.token, g]))
  expected.forEach((e, i) => {
    const g = byToken.get(e.token)
    if (!g) return void out.push(`${e.token}: missing in result`)
    if (got[i]?.token !== e.token) out.push(`${e.token}: out of input order`)
    for (const c of RESULT_COLS) {
      if (c !== 'token' && g[c] !== e[c]) out.push(`${e.token}: ${c} is "${g[c]}", helper says "${e[c]}"`)
    }
  })
  return out
}

// ---------------------------------------------------------------- the join

/**
 * Billed rows to lines per block x designation (sorted by block, then designation). kpl lines count pieces. m lines
 * sum the measured metres; with stickM > 0 the billed metres are rounded UP to whole sticks per line.
 * Rows that are not billed are ignored; call checkOutcomes first.
 */
export function joinLines(rows: ResultRow[], stickM = '3'): Line[] {
  const stick = toMicro(stickM, 'stick length')
  if (stick < 0n) throw new EbomError('bad-number', `stick length "${stickM}" is negative`)
  const acc = new Map<string, { block: string; designation: string; unit: string; sum: bigint; n: number }>()
  for (const r of rows) {
    if (r.outcome !== 'bill') continue
    const key = `${r.block}\u0000${r.designation}`
    const a = acc.get(key) ?? { block: r.block, designation: r.designation, unit: r.unit, sum: 0n, n: 0 }
    if (a.unit !== r.unit) throw new EbomError('bad-value', `${r.block} / ${r.designation}: units "${a.unit}" and "${r.unit}" on one line`)
    a.sum += toMicro(r.qty, `${r.token} qty`)
    a.n += 1
    acc.set(key, a)
  }
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  return [...acc.values()]
    .sort((x, y) => cmp(x.block, y.block) || cmp(x.designation, y.designation))
    .map((a) => {
      const round = a.unit === 'm' && stick > 0n
      const billed = round ? ((a.sum + stick - 1n) / stick) * stick : a.sum
      return {
        block: a.block,
        designation: a.designation,
        unit: a.unit,
        measured: fromMicro(a.sum),
        billed: fromMicro(billed),
        elements: a.n,
        stick_rounded: round,
      }
    })
}
