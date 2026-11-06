// Prints lifecycle carbon evidence for the carbon-epd-enrichment agent: the deterministic mapping, stage totals,
// A-C total and the option A vs B comparison, computed from the agent input (products + synthetic EPD excerpt).
// With a result.md the model's `## Per-product rows` table is checked cell by cell against the helper mapping
// (epd, declared unit, stage cells, flags, status) and the totals are also computed from the model's cells.
// No network, no writes. Usage: npx tsx scripts/carbon-lifecycle.ts <input.txt> [result.md] [--convert]
// Exit codes: 0 ok, 1 mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import {
  CarbonError,
  STAGES,
  compareOptions,
  fmt,
  mapProducts,
  runCarbon,
  type CarbonResult,
  type EpdRow,
  type ProductRow,
  type Stage,
} from '../src/lib/carbon/lifecycleCarbon.js'

export class ParseError extends Error {}

function csv(line: string): string[] {
  return line.split(',').map((s) => s.trim())
}

export function parseInput(text: string): { ref: string; products: ProductRow[]; epds: EpdRow[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !/^#(?!#)/.test(l))
  const refLine = lines.find((l) => /^reference_date:/i.test(l))
  if (!refLine) throw new ParseError('no reference_date: line')
  const ref = refLine.split(':')[1].trim()
  const iP = lines.findIndex((l) => /^##\s*PRODUCTS/i.test(l))
  const iE = lines.findIndex((l) => /^##\s*EPD EXCERPT/i.test(l))
  if (iP < 0 || iE < 0 || iE < iP) throw new ParseError('need `## PRODUCTS` then `## EPD EXCERPT`')
  const pRows = lines.slice(iP + 2, iE)
  const eRows = lines.slice(iE + 2)
  if (csv(lines[iP + 1]).join() !== 'product_id,description,material_key,qty,unit,option') throw new ParseError('product header mismatch')
  if (csv(lines[iE + 1]).join() !== 'epd_id,material_key,product_name,declared_unit,gwp_a1_a3,gwp_a4,gwp_a5,gwp_b,gwp_c,gwp_d,valid_until,source') throw new ParseError('EPD header mismatch')
  const products = pRows.map((l, i) => {
    const c = csv(l)
    if (c.length !== 6) throw new ParseError(`product row ${i + 1} has ${c.length} cells, expected 6`)
    return { product_id: c[0], description: c[1], material_key: c[2], qty: c[3], unit: c[4], option: c[5] }
  })
  const epds = eRows.map((l, i) => {
    const c = csv(l)
    if (c.length !== 12) throw new ParseError(`EPD row ${i + 1} has ${c.length} cells, expected 12`)
    return {
      epd_id: c[0],
      material_key: c[1],
      product_name: c[2],
      declared_unit: c[3],
      gwp: { 'A1-A3': c[4], A4: c[5], A5: c[6], B: c[7], C: c[8], D: c[9] },
      valid_until: c[10],
    }
  })
  return { ref, products, epds }
}

export const RESULT_COLS = ['product_id', 'option', 'qty', 'unit', 'epd', 'declared_unit', 'A1-A3', 'A4', 'A5', 'B', 'C', 'D', 'unit_ok', 'expired', 'status'] as const

export function parseResultTable(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s*Per-product rows\s*$/i.test(l.trim()))
  if (start < 0) throw new ParseError('no `## Per-product rows` section in the result')
  const rows: Record<string, string>[] = []
  let head: string[] | null = null
  for (const l of lines.slice(start + 1)) {
    const t = l.trim()
    if (/^##\s/.test(t)) break
    if (!t.includes('|')) continue // the result table may be written with or without leading and trailing pipes
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
  if (!head) throw new ParseError('no table found under `## Per-product rows`')
  const missing = RESULT_COLS.filter((c) => !head!.includes(c))
  if (missing.length) throw new ParseError(`result table lacks columns: ${missing.join(', ')}`)
  return rows
}

const norm = (s: string | undefined) => (s ?? '').trim().replace(/^not declared$/i, 'ND')

/** Expected cells per product from the helper mapping. */
export function expectedRows(products: ProductRow[], epds: EpdRow[], ref: string): Record<string, string>[] {
  const maps = mapProducts(products, epds, ref)
  return products.map((p, i) => {
    const m = maps[i]
    const single = m.cand.length === 1 ? epds.find((e) => e.epd_id === m.cand[0])! : undefined
    const row: Record<string, string> = {
      product_id: p.product_id,
      option: p.option,
      qty: String(p.qty),
      unit: p.unit,
      epd: m.cand.length ? m.cand.join(',') : 'NONE',
      declared_unit: single ? single.declared_unit : '-',
      unit_ok: single ? (p.unit === single.declared_unit ? 'Y' : 'N') : '-',
      expired: single ? (new Date(single.valid_until) < new Date(ref) ? 'Y' : 'N') : '-',
      status: m.status,
    }
    for (const s of STAGES) row[s] = m.status === 'matched' && single ? String(single.gwp[s as Stage]) : '-'
    return row
  })
}

export function compareRows(expected: Record<string, string>[], got: Record<string, string>[]): string[] {
  const out: string[] = []
  if (got.length !== expected.length) out.push(`row count: helper ${expected.length}, result ${got.length}`)
  expected.forEach((e, i) => {
    const g = got.find((x) => x.product_id === e.product_id)
    if (!g) return void out.push(`${e.product_id}: missing in result`)
    if (got[i]?.product_id !== e.product_id) out.push(`${e.product_id}: out of input order`)
    for (const c of RESULT_COLS) {
      if (c === 'product_id') continue
      // stage cells of non-matched rows and the declared unit of multi-candidate rows are '-'
      if (norm(g[c]) !== norm(e[c])) out.push(`${e.product_id}: ${c} is "${g[c]}", helper says "${e[c]}"`)
    }
  })
  return out
}

export function formatReport(r: CarbonResult, products: ProductRow[], convert: boolean): string {
  const out = [`stage | total kgCO2e | products declared${convert ? ' (kg/t conversion ON)' : ''}`]
  for (const s of STAGES) out.push(`${s} | ${fmt(r.stageTotals[s].total)} | ${r.stageTotals[s].declared}`)
  out.push(`A-C total (module D excluded) | ${fmt(r.totalAC)}`, '', 'excluded | reason')
  for (const x of r.excluded) out.push(`${x.product_id} | ${x.message}`)
  for (const w of r.warnings) out.push(`warning | ${w}`)
  const opts = [...new Set(products.map((p) => p.option).filter((o) => o !== '-'))]
  if (opts.length >= 2) {
    for (const basis of ['A1-A3', 'A-C'] as const) {
      const c = compareOptions(r, opts[0], opts[1], basis)
      out.push('', `comparison option ${opts[0]} vs ${opts[1]} on ${basis}: ${fmt(c.a_total)} vs ${fmt(c.b_total)}, lower ${c.lower}, difference ${fmt(c.abs_diff)}, ${typeof c.pct_of_baseline === 'number' ? fmt(c.pct_of_baseline) + ' % of baseline' : 'percentage undefined'}`)
      for (const w of c.warnings) out.push(`warning | ${w}`)
    }
  }
  return out.join('\n')
}

/** Rebuilds calculation inputs from the model's own table cells (matched rows only), so the helper totals show what the model's mapping would give. */
function fromResult(rows: Record<string, string>[], products: ProductRow[], ref: string, epds: EpdRow[]): CarbonResult {
  const ps: ProductRow[] = []
  const es: EpdRow[] = []
  for (const r of rows) {
    if (r.status !== 'matched') continue
    const p = products.find((x) => x.product_id === r.product_id)
    if (!p) continue
    ps.push({ ...p, material_key: r.product_id })
    const valid = epds.find((e) => e.epd_id === r.epd)?.valid_until ?? '9999-12-31'
    es.push({ epd_id: r.epd, material_key: r.product_id, product_name: r.epd, declared_unit: r.declared_unit, gwp: { 'A1-A3': r['A1-A3'], A4: r.A4, A5: r.A5, B: r.B, C: r.C, D: r.D }, valid_until: valid })
  }
  return runCarbon(ps, es, ref)
}

export function runCli(inputText: string, resultText?: string, convert = false): { code: number; out: string } {
  try {
    const { ref, products, epds } = parseInput(inputText)
    const r = runCarbon(products, epds, ref, { convertUnits: convert })
    let out = formatReport(r, products, convert)
    if (resultText !== undefined) {
      const got = parseResultTable(resultText)
      const diffs = compareRows(expectedRows(products, epds, ref), got)
      out += `\n\nhelper totals from the model's matched rows\n${formatReport(fromResult(got, products, ref, epds), products, false)}`
      out += diffs.length ? `\n\nMISMATCHES (${diffs.length})\n${diffs.join('\n')}` : '\n\nresult table matches the helper on every cell'
      return { code: diffs.length ? 1 : 0, out }
    }
    return { code: 0, out }
  } catch (e) {
    if (e instanceof ParseError || e instanceof CarbonError) return { code: 2, out: `error: ${e.message}` }
    throw e
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2)
  const convert = args.includes('--convert')
  const [inFile, resFile] = args.filter((a) => !a.startsWith('--'))
  if (!inFile) {
    console.error('usage: carbon-lifecycle.ts <input.txt> [result.md] [--convert]')
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
  const r = runCli(a, b, convert)
  if (r.code === 2) console.error(r.out)
  else console.log(r.out)
  process.exit(r.code)
}
