// Prints the delivery list with the precomputed columns (balance, balance_flag, days_late, late_flag, conflict)
// from the deterministic helper src/lib/delivery/deliveryCheck.ts. Input: `#` label lines, a line
// `as_of: YYYY-MM-DD`, a header with at least line_id,po_number,description,priority,status,unit,qty_ordered,
// qty_received,scheduled_date,actual_date,delay_reason (extra columns are ignored and recomputed) and one row per
// delivery line. With a second argument (a result.md whose `## Delivery check` table is compared cell by cell
// with the helper). No network, no writes.
// Usage: npx tsx scripts/delivery-check.ts <lines.csv> [result.md]
// Exit codes: 0 ok (and no mismatches), 1 mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { DeliveryError, enrichLines, type EnrichedLine, type RawLine } from '../src/lib/delivery/deliveryCheck.js'

export class ParseError extends Error {}

export const BASE_COLS = ['line_id', 'po_number', 'description', 'priority', 'status', 'unit', 'qty_ordered', 'qty_received', 'scheduled_date', 'actual_date', 'delay_reason'] as const
export const PRE_COLS = ['balance', 'balance_flag', 'days_late', 'late_flag', 'conflict'] as const
export const RESULT_COLS = ['line_id', 'status', 'balance', 'balance_flag', 'days_late', 'late_flag', 'conflict', 'reason_present', 'verdict'] as const

export function parseLines(text: string): { asOf: string; labels: string[]; items: RawLine[] } {
  const labels: string[] = []
  let asOf = ''
  const lines: string[] = []
  for (const l of text.split(/\r?\n/)) {
    const t = l.trim()
    if (t === '') continue
    if (t.startsWith('#')) labels.push(t)
    else if (/^as_of\s*:/i.test(t)) asOf = t.replace(/^as_of\s*:/i, '').trim()
    else lines.push(t)
  }
  if (!asOf) throw new ParseError('no `as_of: YYYY-MM-DD` line found')
  if (lines.length < 2) throw new ParseError('no header and rows found')
  const head = lines[0].split(',').map((s) => s.trim())
  const idx = BASE_COLS.map((c) => head.indexOf(c))
  const absent = BASE_COLS.filter((_, i) => idx[i] < 0)
  if (absent.length) throw new ParseError(`header lacks columns: ${absent.join(', ')}`)
  const items = lines.slice(1).map((l, n) => {
    const c = l.split(',')
    if (c.length !== head.length) throw new ParseError(`row ${n + 1} has ${c.length} cells, expected ${head.length}`)
    const o: Record<string, string> = {}
    BASE_COLS.forEach((k, i) => (o[k] = (c[idx[i]] ?? '').trim()))
    return o as unknown as RawLine
  })
  return { asOf, labels, items }
}

export function formatEnriched(asOf: string, labels: string[], rows: EnrichedLine[]): string {
  const out = [...labels, `as_of: ${asOf}`, [...BASE_COLS, ...PRE_COLS].join(',')]
  for (const r of rows) out.push([...BASE_COLS.map((c) => r[c]), ...PRE_COLS.map((c) => r[c])].join(','))
  return out.join('\n')
}

export function parseResultTable(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s*Delivery check\s*$/i.test(l.trim()))
  if (start < 0) throw new ParseError('no `## Delivery check` section in the result')
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
  if (!head) throw new ParseError('no table found under `## Delivery check`')
  const missing = RESULT_COLS.filter((c) => !head!.includes(c))
  if (missing.length) throw new ParseError(`result table lacks columns: ${missing.join(', ')}`)
  return rows
}

export function compare(expected: EnrichedLine[], got: Record<string, string>[]): string[] {
  const out: string[] = []
  if (got.length !== expected.length) out.push(`row count: helper ${expected.length}, result ${got.length}`)
  const byId = new Map(got.map((g) => [g.line_id, g]))
  expected.forEach((e, i) => {
    const g = byId.get(e.line_id)
    if (!g) return void out.push(`${e.line_id}: missing in result`)
    if (got[i]?.line_id !== e.line_id) out.push(`${e.line_id}: out of input order`)
    const want: Record<string, string> = { ...e }
    for (const c of RESULT_COLS) {
      if (c === 'line_id') continue
      if (g[c] !== want[c]) out.push(`${e.line_id}: ${c} is "${g[c]}", helper says "${want[c]}"`)
    }
  })
  return out
}

export function runCli(inputText: string, resultText?: string): { code: number; out: string } {
  try {
    const { asOf, labels, items } = parseLines(inputText)
    const rows = enrichLines(items, asOf)
    let out = formatEnriched(asOf, labels, rows)
    if (resultText !== undefined) {
      const diffs = compare(rows, parseResultTable(resultText))
      out += diffs.length ? `\n\nMISMATCHES (${diffs.length})\n${diffs.join('\n')}` : '\n\nresult table matches the helper on every cell'
      return { code: diffs.length ? 1 : 0, out }
    }
    return { code: 0, out }
  } catch (e) {
    if (e instanceof ParseError || e instanceof DeliveryError) return { code: 2, out: `error: ${e.message}` }
    throw e
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const [inFile, resFile] = [process.argv[2], process.argv[3]]
  if (!inFile) {
    console.error('usage: delivery-check.ts <lines.csv> [result.md]')
    process.exit(2)
  }
  let a: string
  let b: string | undefined
  try {
    a = readFileSync(inFile, 'utf8')
    b = resFile ? readFileSync(resFile, 'utf8') : undefined
  } catch (e) {
    console.error(`error: cannot read file: ${(e as Error).message}`)
    process.exit(2)
  }
  const r = runCli(a, b)
  if (r.code === 2) console.error(r.out)
  else console.log(r.out)
  process.exit(r.code)
}
