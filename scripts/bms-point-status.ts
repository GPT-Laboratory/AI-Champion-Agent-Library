// Prints binding and threshold status for the bms-digital-twin agent input (points with readings, assets, tag hints with
// synthetic limits). With a result.md the model's `## Point mapping` table is checked cell by cell against the helper
// (asset, tag, unit, reading, low, high, binding, review); the model's status cell must be `to compute (tool)`.
// No network, no writes. Usage: npx tsx scripts/bms-point-status.ts <input.txt> [result.md]
// Exit codes: 0 ok, 1 mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { BmsError, bindPoints, type AssetRow, type BoundPoint, type HintRow, type PointRow } from '../src/lib/bms/pointStatus.js'

export class ParseError extends Error {}

const csv = (l: string) => l.split(',').map((s) => s.trim())

export function parseInput(text: string): { points: PointRow[]; assets: AssetRow[]; hints: HintRow[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !/^#(?!#)/.test(l))
  const idx = (re: RegExp) => lines.findIndex((l) => re.test(l))
  const iP = idx(/^##\s*POINTS/i)
  const iA = idx(/^##\s*ASSETS/i)
  const iH = idx(/^##\s*TAG HINTS/i)
  if (iP < 0 || iA < iP || iH < iA) throw new ParseError('need `## POINTS`, `## ASSETS`, `## TAG HINTS` in this order')
  const sect = (from: number, to: number, header: string, n: number) => {
    if (csv(lines[from + 1] ?? '').join() !== header) throw new ParseError(`header mismatch, expected ${header}`)
    return lines.slice(from + 2, to).map((l, i) => {
      const c = csv(l)
      if (c.length !== n) throw new ParseError(`row "${l}" (${i + 1}) has ${c.length} cells, expected ${n}`)
      return c
    })
  }
  const points = sect(iP, iA, 'point_id,point_name,description,unit,reading', 5).map((c) => ({ point_id: c[0], point_name: c[1], description: c[2], unit: c[3], reading: c[4] }))
  const assets = sect(iA, iH, 'asset_id,name,kind', 3).map((c) => ({ asset_id: c[0], name: c[1], kind: c[2] }))
  const hints = sect(iH, lines.length, 'keyword,tag,expected_unit,low,high', 5).map((c) => ({ keyword: c[0], tag: c[1], expected_unit: c[2], low: c[3], high: c[4] }))
  return { points, assets, hints }
}

export const RESULT_COLS = ['point_id', 'asset_id', 'tag', 'unit', 'reading', 'low', 'high', 'binding', 'status', 'review', 'note'] as const

export function parseResultTable(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s*Point mapping\s*$/i.test(l.trim()))
  if (start < 0) throw new ParseError('no `## Point mapping` section in the result')
  const rows: Record<string, string>[] = []
  let head: string[] | null = null
  for (const l of lines.slice(start + 1)) {
    const t = l.trim()
    if (/^##\s/.test(t)) break
    if (!t.includes('|')) continue
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
  if (!head) throw new ParseError('no table found under `## Point mapping`')
  const missing = RESULT_COLS.filter((c) => !head!.includes(c))
  if (missing.length) throw new ParseError(`result table lacks columns: ${missing.join(', ')}`)
  return rows
}

export function compareRows(expected: BoundPoint[], got: Record<string, string>[]): string[] {
  const out: string[] = []
  if (got.length !== expected.length) out.push(`row count: helper ${expected.length}, result ${got.length}`)
  expected.forEach((e, i) => {
    const g = got.find((x) => x.point_id === e.point_id)
    if (!g) return void out.push(`${e.point_id}: missing in result`)
    if (got[i]?.point_id !== e.point_id) out.push(`${e.point_id}: out of input order`)
    for (const c of ['asset_id', 'tag', 'unit', 'reading', 'low', 'high', 'binding', 'review'] as const) {
      const want = e[c] === '' && (c === 'unit' || c === 'reading') ? '-' : e[c]
      const have = (g[c] ?? '').trim() === '' ? '-' : g[c].trim()
      if (have !== want && !(want === '-' && have === '')) out.push(`${e.point_id}: ${c} is "${g[c]}", helper says "${e[c]}"`)
    }
    if (!/^to compute \(tool\)$/i.test((g.status ?? '').trim())) out.push(`${e.point_id}: status is "${g.status}", expected "to compute (tool)" (helper status: ${e.status})`)
  })
  return out
}

export function formatReport(rows: BoundPoint[]): string {
  const out = ['point_id | point_name | asset_id | tag | unit | reading | low | high | binding | status | review']
  for (const r of rows) out.push([r.point_id, r.point_name, r.asset_id, r.tag, r.unit || '-', r.reading || '-', r.low, r.high, r.binding, r.status, r.review].join(' | '))
  const flagged = rows.filter((r) => r.status === 'below_minimum' || r.status === 'above_maximum' || r.status === 'no-data')
  out.push('', 'threshold findings (helper) | point | status')
  for (const r of flagged) out.push(`${r.point_id} | ${r.point_name} | ${r.status}`)
  if (!flagged.length) out.push('none')
  return out.join('\n')
}

export function runCli(inputText: string, resultText?: string): { code: number; out: string } {
  try {
    const { points, assets, hints } = parseInput(inputText)
    const rows = bindPoints(points, assets, hints)
    let out = formatReport(rows)
    if (resultText !== undefined) {
      const diffs = compareRows(rows, parseResultTable(resultText))
      out += diffs.length ? `\n\nMISMATCHES (${diffs.length})\n${diffs.join('\n')}` : '\n\nresult table matches the helper on every checked cell'
      return { code: diffs.length ? 1 : 0, out }
    }
    return { code: 0, out }
  } catch (e) {
    if (e instanceof ParseError || e instanceof BmsError) return { code: 2, out: `error: ${e.message}` }
    throw e
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const [inFile, resFile] = process.argv.slice(2)
  if (!inFile) {
    console.error('usage: bms-point-status.ts <input.txt> [result.md]')
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
