// The deterministic helper of product-sourcing-mbom (own design, no I/O). Shared by the CLI (scripts/sourcing-match.ts)
// and the app's post-run check (src/lib/server/tryitout/postRunCheck.ts).
// It applies the skill's equality rules (data/tryitout-prompts/product-sourcing-mbom/SKILL.md) to the E-BOM lines and
// the catalog excerpt: a catalog row is a candidate when its class equals the line's req_class and its dn and material
// equal req_dn and req_material (an empty requirement, written `any`, matches anything). From the candidates follow
// the status (0 no-match, 1 matched, 2+ ambiguous), the unit check, the near misses, the review flag, the M-BOM rows
// and the open items. Without a result it writes the whole reference result; with one, it compares the agent's
// `## Per-line rows`, `## M-BOM draft` and `## Open items for the engineer` with it.
export class ParseError extends Error {}

export const LINE_COLS = ['line_id', 'description', 'req_class', 'req_dn', 'req_material', 'qty', 'unit'] as const
export const CATALOG_COLS = ['product_id', 'supplier', 'name', 'class', 'dn', 'material', 'sales_unit', 'in_stock'] as const
export const PER_LINE_COLS = ['line_id', 'description', 'qty', 'unit', 'candidates', 'status', 'unit_same', 'near_miss', 'review', 'note'] as const
export const MBOM_COLS = ['line_id', 'product_id', 'supplier', 'qty', 'unit', 'sales_unit'] as const
export const OPEN_HEADING = 'Open items for the engineer'
export const CLOSING_LINE = 'Draft for engineer review. Candidates come only from the supplied synthetic catalog excerpt; no catalog lookup was made.'

type Row = Record<string, string>
export type Status = 'no-match' | 'matched' | 'ambiguous'

export interface SourcingInput {
  lines: Row[]
  catalog: Row[]
}

export interface LineResult {
  line: Row
  hits: Row[]
  sameClass: Row[]
  status: Status
  /** Y when req_dn or req_material is empty (written `any`). */
  underspecified: boolean
  /** For a matched line: the E-BOM unit equals the hit's sales_unit. */
  unitSame: boolean | null
  review: boolean
  note: string
}

/** `## NAME` sections, `#` label lines and blank lines dropped. */
function sections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let cur: string[] | null = null
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (/^##\s/.test(t)) {
      cur = []
      out.set(t.replace(/^##\s+/, '').trim().toUpperCase(), cur)
    } else if (t !== '' && !/^#(\s|$)/.test(t) && cur) cur.push(t)
  }
  return out
}

function csv(name: string, lines: string[] | undefined, cols: readonly string[]): Row[] {
  if (!lines || lines.length === 0) throw new ParseError(`no "## ${name}" section with a header`)
  const head = lines[0].split(',').map((c) => c.trim())
  const absent = cols.filter((c) => !head.includes(c))
  if (absent.length) throw new ParseError(`${name} lacks columns: ${absent.join(', ')}`)
  return lines.slice(1).map((l, n) => {
    const cells = l.split(',').map((c) => c.trim())
    if (cells.length !== head.length) throw new ParseError(`${name} row ${n + 1} has ${cells.length} cells, expected ${head.length}`)
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]))
  })
}

export function parseSourcingInput(text: string): SourcingInput {
  const s = sections(text)
  const lines = csv('E-BOM', s.get('E-BOM'), LINE_COLS)
  const catalog = csv('CATALOG EXCERPT', s.get('CATALOG EXCERPT'), CATALOG_COLS)
  const ids = new Set<string>()
  for (const l of lines) {
    if (ids.has(l.line_id)) throw new ParseError(`E-BOM: line_id ${l.line_id} appears twice`)
    ids.add(l.line_id)
  }
  return { lines, catalog }
}

const any = (v: string) => (v === '' ? 'any' : v)
const empty = (v: string) => (v === '' ? 'empty' : v)
const eq = (req: string, cat: string) => req === '' || req === cat

/** The skill's decision for every E-BOM line. */
export function matchLines(input: SourcingInput): LineResult[] {
  return input.lines.map((line) => {
    const sameClass = input.catalog.filter((c) => c.class === line.req_class)
    const hits = sameClass.filter((c) => eq(line.req_dn, c.dn) && eq(line.req_material, c.material))
    const status: Status = hits.length === 0 ? 'no-match' : hits.length === 1 ? 'matched' : 'ambiguous'
    const underspecified = line.req_dn === '' || line.req_material === ''
    const unitSame = status === 'matched' ? line.unit === hits[0].sales_unit : null
    const review = !(status === 'matched' && unitSame === true && !underspecified)
    const facts = [
      ...(underspecified ? ['underspecified'] : []),
      ...(unitSame === false ? [`unit E-BOM ${line.unit} vs sales_unit ${hits[0].sales_unit}`] : []),
      ...hits.filter((h) => h.in_stock === 'N').map((h) => `stock=N for ${h.product_id}`),
    ]
    return { line, hits, sameClass, status, underspecified, unitSame, review, note: facts.join('; ') || '-' }
  })
}

const ids = (rows: Row[]) => rows.map((r) => r.product_id).join(',')
const table = (cols: readonly string[], rows: string[][]) =>
  [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

/** The open-item reason the reference result writes: the note, or for no-match `near miss <ids>` / the status. */
function reason(r: LineResult): string {
  if (r.status === 'ambiguous') return `candidates ${ids(r.hits)}`
  if (r.status === 'no-match') return r.sameClass.length ? `near miss ${ids(r.sameClass)}` : 'no catalog row of this class'
  return r.note
}

/** The whole result as the skill asks for it, worked out by the helper. */
export function referenceResult(input: SourcingInput): string {
  const results = matchLines(input)
  const checks: string[] = []
  for (const r of results) {
    const l = r.line
    for (const c of input.catalog) {
      if (c.class !== l.req_class) {
        checks.push(`${l.line_id} ${c.product_id}: cls=${l.req_class}/${c.class} N => -`)
        continue
      }
      const dn = eq(l.req_dn, c.dn)
      const mat = eq(l.req_material, c.material)
      const hit = dn && mat
      checks.push(
        `${l.line_id} ${c.product_id}: cls=${l.req_class}/${c.class} Y dn=${any(l.req_dn)}/${empty(c.dn)} ${dn ? 'Y' : 'N'} mat=${any(l.req_material)}/${empty(c.material)} ${mat ? 'Y' : 'N'} => ${hit ? `HIT sup=${c.supplier} su=${c.sales_unit} stock=${c.in_stock}` : '-'}`,
      )
    }
    checks.push(
      `${l.line_id} req_dn=${any(l.req_dn)} req_mat=${any(l.req_material)} U=${r.underspecified ? 'Y' : 'N'} hits=${ids(r.hits) || 'none'} count=${r.hits.length} same_class=${ids(r.sameClass) || 'none'}`,
    )
    if (r.status === 'matched') checks.push(`${l.line_id} unit=${l.unit}/${r.hits[0].sales_unit} unit_same=${r.unitSame ? 'Y' : 'N'}`)
  }
  const perLine = results.map((r) => [
    r.line.line_id,
    r.line.description,
    r.line.qty,
    r.line.unit,
    ids(r.hits) || '-',
    r.status,
    r.unitSame === null ? '-' : r.unitSame ? 'Y' : 'N',
    r.status === 'no-match' && r.sameClass.length ? ids(r.sameClass) : '-',
    r.review ? 'YES' : 'NO',
    r.note,
  ])
  const matched = results.filter((r) => r.status === 'matched')
  const open = results.filter((r) => r.review)
  return [
    '## Match checks',
    ...checks,
    '',
    '## Per-line rows',
    table(PER_LINE_COLS, perLine),
    '',
    '## M-BOM draft',
    matched.length
      ? table(MBOM_COLS, matched.map((r) => [r.line.line_id, r.hits[0].product_id, r.hits[0].supplier, r.line.qty, r.line.unit, r.hits[0].sales_unit]))
      : 'none',
    '',
    `## ${OPEN_HEADING}`,
    ...(open.length ? open.map((r) => `${r.line.line_id}, ${r.status}, ${reason(r)}`) : ['none']),
    '',
    CLOSING_LINE,
    '',
  ].join('\n')
}

// ------------------------------------------------------------------ reading and comparing a result

/** The lines under `## <name>` (blank lines dropped), or null when the result has no such heading. */
function section(text: string, name: string): string[] | null {
  const ls = text.split(/\r?\n/)
  const i = ls.findIndex((l) => l.trim().toLowerCase() === `## ${name}`.toLowerCase())
  if (i < 0) return null
  const end = ls.findIndex((l, j) => j > i && /^##\s/.test(l.trim()))
  return ls.slice(i + 1, end < 0 ? undefined : end).map((l) => l.trim()).filter((l) => l !== '')
}

function readTable(lines: string[], cols: readonly string[], name: string): Row[] {
  let head: string[] | null = null
  const rows: Row[] = []
  for (const l of lines) {
    if (!l.startsWith('|')) continue
    const cells = l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue
    if (!head) {
      head = cells
      continue
    }
    rows.push(Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])))
  }
  if (!head) throw new ParseError(`no table under \`## ${name}\``)
  const missing = cols.filter((c) => !head!.includes(c))
  if (missing.length) throw new ParseError(`${name} table lacks columns: ${missing.join(', ')}`)
  return rows
}

/** A list of ids in any of the forms a model writes (`SP-02,SP-03`, `SP-02, SP-03`, `SP-02 SP-03`); `-`/`none` is empty. */
const idList = (v: string) => v.split(/[\s,;]+/).filter((x) => x !== '' && x !== '-' && x.toLowerCase() !== 'none').join(',')

export interface SourcingCheck {
  code: 0 | 1 | 2
  out: string
  problems: string[]
  results: LineResult[]
}

export function checkSourcingResult(inputText: string, resultText?: string): SourcingCheck {
  let input: SourcingInput
  try {
    input = parseSourcingInput(inputText)
  } catch (e) {
    if (e instanceof ParseError) return { code: 2, out: `error: ${e.message}`, problems: [], results: [] }
    throw e
  }
  const results = matchLines(input)
  if (resultText === undefined) return { code: 0, out: referenceResult(input), problems: [], results }

  const problems: string[] = []
  let perLine: Row[]
  let mbom: Row[] | null
  try {
    const pl = section(resultText, 'Per-line rows')
    if (!pl) throw new ParseError('no `## Per-line rows` section in the result')
    perLine = readTable(pl, PER_LINE_COLS, 'Per-line rows')
    const mb = section(resultText, 'M-BOM draft')
    if (!mb) throw new ParseError('no `## M-BOM draft` section in the result')
    mbom = mb.length === 1 && mb[0].toLowerCase() === 'none' ? [] : readTable(mb, MBOM_COLS, 'M-BOM draft')
  } catch (e) {
    if (e instanceof ParseError) return { code: 2, out: `error: ${e.message}`, problems: [], results }
    throw e
  }

  // Per-line rows: one per E-BOM line, in order; the copied cells and every derived cell (the note is free text).
  const want = results.map((r) => r.line.line_id)
  const got = perLine.map((r) => r.line_id)
  if (got.join(',') !== want.join(',')) problems.push(`Per-line rows are ${got.join(', ') || 'none'}; expected one per E-BOM line in order: ${want.join(', ')}`)
  for (const r of results) {
    const row = perLine.find((x) => x.line_id === r.line.line_id)
    if (!row) continue
    const id = r.line.line_id
    const expect: Record<string, string> = {
      description: r.line.description,
      qty: r.line.qty,
      unit: r.line.unit,
      candidates: ids(r.hits),
      status: r.status,
      unit_same: r.unitSame === null ? '-' : r.unitSame ? 'Y' : 'N',
      near_miss: r.status === 'no-match' ? ids(r.sameClass) : '',
      review: r.review ? 'YES' : 'NO',
    }
    for (const [col, v] of Object.entries(expect)) {
      const cell = col === 'candidates' || col === 'near_miss' ? idList(row[col] ?? '') : (row[col] ?? '')
      if (cell !== v) problems.push(`${id}: ${col} is "${row[col] ?? ''}", helper says "${v || '-'}"`)
    }
  }

  // M-BOM draft: exactly the matched lines, with the hit's supplier and sales unit and the E-BOM qty and unit.
  const matched = results.filter((r) => r.status === 'matched')
  const mGot = (mbom ?? []).map((r) => r.line_id)
  const mWant = matched.map((r) => r.line.line_id)
  if (mGot.join(',') !== mWant.join(',')) problems.push(`M-BOM draft rows are ${mGot.join(', ') || 'none'}; expected the matched lines: ${mWant.join(', ') || 'none'}`)
  for (const r of matched) {
    const row = (mbom ?? []).find((x) => x.line_id === r.line.line_id)
    if (!row) continue
    const expect = { product_id: r.hits[0].product_id, supplier: r.hits[0].supplier, qty: r.line.qty, unit: r.line.unit, sales_unit: r.hits[0].sales_unit }
    for (const [col, v] of Object.entries(expect)) if ((row[col] ?? '') !== v) problems.push(`${r.line.line_id} (M-BOM): ${col} is "${row[col] ?? ''}", helper says "${v}"`)
  }

  // Open items: one line per review=YES row, in order (the reason is free text).
  const open = section(resultText, OPEN_HEADING)
  const oGot = (open ?? []).filter((l) => l.toLowerCase() !== 'none' && !l.startsWith('Draft for')).map((l) => l.replace(/^[-*]\s*/, '').split(/[,\s]/)[0])
  const oWant = results.filter((r) => r.review).map((r) => r.line.line_id)
  if (open === null) problems.push(`no \`## ${OPEN_HEADING}\` section`)
  else if (oGot.join(',') !== oWant.join(',')) problems.push(`open items are ${oGot.join(', ') || 'none'}; expected every review=YES line: ${oWant.join(', ') || 'none'}`)

  const out = problems.length ? `MISMATCHES (${problems.length})\n${problems.join('\n')}` : 'result tables match the helper on every checked cell'
  return { code: problems.length ? 1 : 0, out, problems, results }
}

/** One line for the badge, with the counts a tool may make (the agent never counts). */
export function sourcingSummary(results: LineResult[]): string {
  const n = (s: Status) => results.filter((r) => r.status === s).length
  const review = results.filter((r) => r.review).length
  return `every checked cell matches the sourcing-match helper: ${n('matched')} matched, ${n('ambiguous')} ambiguous, ${n('no-match')} no-match; ${review} for review`
}

/** CLI shape shared with the other helpers (exit 0 ok, 1 problems listed after MISMATCHES (n), 2 unreadable). */
export function runCli(inputText: string, resultText?: string): { code: number; out: string } {
  const r = checkSourcingResult(inputText, resultText)
  return { code: r.code, out: r.out }
}
