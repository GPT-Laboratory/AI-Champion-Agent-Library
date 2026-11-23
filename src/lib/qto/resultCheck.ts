// Parsing, helper run and cell-by-cell result comparison for the qto-normalization agent. Shared by the CLI
// (scripts/qto-group-totals.ts) and the app's post-run check (src/lib/server/tryitout/postRunCheck.ts). No I/O.
// Moved unchanged from scripts/qto-group-totals.ts, which re-exports everything here.
import { QtoError, groupTotals, normaliseRows, type InputRow, type NormalisedRow } from './groupTotals'

export class ParseError extends Error {}

export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') (out.push(cur), (cur = ''))
    else cur += c
  }
  out.push(cur)
  return out
}

export function parseInputCsv(text: string): InputRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))
  if (lines.length < 2) throw new ParseError('no header and rows found')
  const head = splitCsvLine(lines[0]).map((s) => s.trim())
  const want = ['row_id', 'group', 'description', 'quantity', 'unit', 'level']
  if (want.some((w, i) => head[i] !== w)) throw new ParseError(`header must be ${want.join(',')}`)
  return lines.slice(1).map((l, i) => {
    const c = splitCsvLine(l)
    if (c.length !== 6) throw new ParseError(`row ${i + 1} has ${c.length} cells, expected 6`)
    const [row_id, group, description, quantity, unit, level] = c
    return { row_id: row_id.trim(), group, description, quantity, unit, level }
  })
}

export const RESULT_COLS = ['row_id', 'group', 'level', 'qty', 'unit', 'factor', 'dup_of', 'issue'] as const

export function parseResultTable(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s*Normalised rows\s*$/i.test(l.trim()))
  if (start < 0) throw new ParseError('no `## Normalised rows` section in the result')
  const rows: Record<string, string>[] = []
  let head: string[] | null = null
  for (const l of lines.slice(start + 1)) {
    const t = l.trim()
    if (/^##\s/.test(t)) break
    if (!t.startsWith('|')) continue
    const cells = t.replace(/^\||\|$/g, '').split('|').map((s) => s.trim())
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue
    if (!head) {
      head = cells
      continue
    }
    const rec: Record<string, string> = {}
    head.forEach((h, i) => (rec[h] = cells[i] ?? ''))
    rows.push(rec)
  }
  if (!head) throw new ParseError('no table found under `## Normalised rows`')
  const missing = RESULT_COLS.filter((c) => !head!.includes(c))
  if (missing.length) throw new ParseError(`result table lacks columns: ${missing.join(', ')}`)
  return rows
}

export function compare(expected: NormalisedRow[], got: Record<string, string>[]): string[] {
  const out: string[] = []
  if (got.length !== expected.length) out.push(`row count: helper ${expected.length}, result ${got.length}`)
  const byId = new Map(got.map((g) => [g.row_id, g]))
  expected.forEach((e, i) => {
    const g = byId.get(e.row_id)
    if (!g) return void out.push(`${e.row_id}: missing in result`)
    if (got[i]?.row_id !== e.row_id) out.push(`${e.row_id}: out of input order`)
    for (const c of RESULT_COLS) {
      if (c === 'row_id') continue
      if (g[c] !== String(e[c])) out.push(`${e.row_id}: ${c} is "${g[c]}", helper says "${e[c]}"`)
    }
  })
  return out
}

export function formatReport(rows: NormalisedRow[]): string {
  const t = groupTotals(rows)
  const out = ['by group | unit | total | rows']
  for (const l of t.byGroup) out.push(`${l.key} | ${l.unit} | ${l.total} | ${l.rows}`)
  out.push('', 'by level | unit | total | rows')
  for (const l of t.byLevel) out.push(`${l.key} | ${l.unit} | ${l.total} | ${l.rows}`)
  out.push('', 'excluded | reason')
  for (const x of t.excluded) out.push(`${x.row_id} | ${x.reason}`)
  return out.join('\n')
}

export function runCli(inputText: string, resultText?: string): { code: number; out: string } {
  try {
    const rows = normaliseRows(parseInputCsv(inputText))
    let out = formatReport(rows)
    if (resultText !== undefined) {
      const diffs = compare(rows, parseResultTable(resultText))
      out += diffs.length ? `\n\nMISMATCHES (${diffs.length})\n${diffs.join('\n')}` : '\n\nresult table matches the helper on every cell'
      return { code: diffs.length ? 1 : 0, out }
    }
    return { code: 0, out }
  } catch (e) {
    if (e instanceof ParseError || e instanceof QtoError) return { code: 2, out: `error: ${e.message}` }
    throw e
  }
}
