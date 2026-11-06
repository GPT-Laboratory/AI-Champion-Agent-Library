// Prints the warranty register with the precomputed columns (end_date_expected, dates_consistent, days_remaining,
// status_class, document_present, contact_present, coverage_present) from the deterministic helper
// src/lib/warranty/warrantyStatus.ts. Input: `#` label lines, a line `as_of: YYYY-MM-DD`, a header with at least
// warranty_id,item,system,warranty_type,start_date,end_date,duration_years,documents,contact,coverage (extra
// columns are ignored and recomputed) and one row per warranty. With a second argument (a result.md whose
// `## Warranty register check` table is compared cell by cell with the helper). No network, no writes.
// Usage: npx tsx scripts/warranty-status.ts <register.csv> [result.md]
// Exit codes: 0 ok (and no mismatches), 1 mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { WarrantyError, enrichWarranties, type EnrichedWarranty, type RawWarranty } from '../src/lib/warranty/warrantyStatus.js'

export class ParseError extends Error {}

export const BASE_COLS = ['warranty_id', 'item', 'system', 'warranty_type', 'start_date', 'end_date', 'duration_years', 'documents', 'contact', 'coverage'] as const
export const PRE_COLS = ['end_date_expected', 'dates_consistent', 'days_remaining', 'status_class', 'document_present', 'contact_present', 'coverage_present'] as const
export const RESULT_COLS = ['warranty_id', 'status_class', 'days_remaining', 'dates_consistent', 'document_present', 'contact_present', 'coverage_present', 'verdict'] as const

export function parseRegister(text: string): { asOf: string; labels: string[]; items: RawWarranty[] } {
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
    return o as unknown as RawWarranty
  })
  return { asOf, labels, items }
}

export function formatEnriched(asOf: string, labels: string[], rows: EnrichedWarranty[]): string {
  const out = [...labels, `as_of: ${asOf}`, [...BASE_COLS, ...PRE_COLS].join(',')]
  for (const r of rows) out.push([...BASE_COLS.map((c) => r[c]), ...PRE_COLS.map((c) => r[c])].join(','))
  return out.join('\n')
}

export function parseResultTable(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s*Warranty register check\s*$/i.test(l.trim()))
  if (start < 0) throw new ParseError('no `## Warranty register check` section in the result')
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
  if (!head) throw new ParseError('no table found under `## Warranty register check`')
  const missing = RESULT_COLS.filter((c) => !head!.includes(c))
  if (missing.length) throw new ParseError(`result table lacks columns: ${missing.join(', ')}`)
  return rows
}

export function compare(expected: EnrichedWarranty[], got: Record<string, string>[]): string[] {
  const out: string[] = []
  if (got.length !== expected.length) out.push(`row count: helper ${expected.length}, result ${got.length}`)
  const byId = new Map(got.map((g) => [g.warranty_id, g]))
  expected.forEach((e, i) => {
    const g = byId.get(e.warranty_id)
    if (!g) return void out.push(`${e.warranty_id}: missing in result`)
    if (got[i]?.warranty_id !== e.warranty_id) out.push(`${e.warranty_id}: out of input order`)
    const want: Record<string, string> = { ...e }
    for (const c of RESULT_COLS) {
      if (c === 'warranty_id') continue
      if (g[c] !== want[c]) out.push(`${e.warranty_id}: ${c} is "${g[c]}", helper says "${want[c]}"`)
    }
  })
  return out
}

export function runCli(inputText: string, resultText?: string): { code: number; out: string } {
  try {
    const { asOf, labels, items } = parseRegister(inputText)
    const rows = enrichWarranties(items, asOf)
    let out = formatEnriched(asOf, labels, rows)
    if (resultText !== undefined) {
      const diffs = compare(rows, parseResultTable(resultText))
      out += diffs.length ? `\n\nMISMATCHES (${diffs.length})\n${diffs.join('\n')}` : '\n\nresult table matches the helper on every cell'
      return { code: diffs.length ? 1 : 0, out }
    }
    return { code: 0, out }
  } catch (e) {
    if (e instanceof ParseError || e instanceof WarrantyError) return { code: 2, out: `error: ${e.message}` }
    throw e
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const [inFile, resFile] = [process.argv[2], process.argv[3]]
  if (!inFile) {
    console.error('usage: warranty-status.ts <register.csv> [result.md]')
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
