// Prints weighted bid totals and ranking for harness evidence. Reads a text file (the agent input with
// `## CRITERIA` / `## SCORES`, or a result.md with a `## Criteria and scores` pipe table). No network, no writes.
// Usage: npx tsx scripts/bid-weighted-score.ts <file>
// Exit codes: 0 ok, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { WeightedScoreError, rankBids, type Criterion } from '../src/lib/procurement/weightedScore.js'

export interface ParsedScores {
  criteria: Criterion[]
  bids: { id: string; scores: Record<string, number> }[]
}

export class ParseError extends Error {}

const num = (s: string, what: string): number => {
  const t = s.trim()
  if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) throw new ParseError(`${what}: "${s.trim()}" is not a number`)
  return Number(t)
}

function section(lines: string[], re: RegExp): string[] | null {
  const start = lines.findIndex((l) => re.test(l.trim()))
  if (start < 0) return null
  const out: string[] = []
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l.trim())) break
    if (l.trim() !== '') out.push(l.trim())
  }
  return out
}

function fromCsvSections(lines: string[]): ParsedScores | null {
  const crit = section(lines, /^##\s*CRITERIA\s*$/i)
  const sc = section(lines, /^##\s*SCORES\s*$/i)
  if (!crit || !sc) return null
  const criteria: Criterion[] = crit.slice(1).map((l) => {
    const [name, w] = l.split(',')
    return { name: name.trim(), weight: num(w ?? '', `weight of ${name}`) }
  })
  const head = sc[0].split(',').map((s) => s.trim())
  const letters = head.slice(1)
  const bids = letters.map((id) => ({ id, scores: {} as Record<string, number> }))
  for (const l of sc.slice(1)) {
    const cells = l.split(',').map((s) => s.trim())
    letters.forEach((id, i) => {
      if (cells[i + 1] === undefined) throw new ParseError(`score row "${cells[0]}" has no value for ${id}`)
      bids[i].scores[cells[0]] = num(cells[i + 1], `score ${cells[0]}/${id}`)
    })
  }
  return { criteria, bids }
}

function fromPipeTable(lines: string[]): ParsedScores | null {
  const t = section(lines, /^##\s*Criteria and scores\s*$/i)
  if (!t) return null
  const head = t[0].split('|').map((s) => s.trim())
  const letters = head.slice(2)
  const bids = letters.map((id) => ({ id, scores: {} as Record<string, number> }))
  const criteria: Criterion[] = []
  for (const l of t.slice(1)) {
    if (/^[-| :]+$/.test(l)) continue
    const cells = l.split('|').map((s) => s.trim())
    if (/^total\b/i.test(cells[0])) continue
    criteria.push({ name: cells[0], weight: num(cells[1] ?? '', `weight of ${cells[0]}`) })
    letters.forEach((id, i) => {
      if (cells[i + 2] === undefined) throw new ParseError(`row "${cells[0]}" has no value for ${id}`)
      bids[i].scores[cells[0]] = num(cells[i + 2], `score ${cells[0]}/${id}`)
    })
  }
  return { criteria, bids }
}

export function parseScoreText(text: string): ParsedScores {
  const lines = text.split(/\r?\n/)
  const p = fromCsvSections(lines) ?? fromPipeTable(lines)
  if (!p) throw new ParseError('no `## CRITERIA` + `## SCORES` sections and no `## Criteria and scores` table found')
  return p
}

export function formatReport(p: ParsedScores): string {
  const ranked = rankBids(p.criteria, p.bids)
  const out = [`weights: ${p.criteria.map((c) => `${c.name}=${c.weight}`).join(', ')}`, 'quote | total | rank']
  for (const r of ranked) out.push(`${r.id} | ${r.total.toFixed(2)} | ${r.rank}`)
  return out.join('\n')
}

export function runCli(text: string): { code: number; out: string } {
  try {
    return { code: 0, out: formatReport(parseScoreText(text)) }
  } catch (e) {
    if (e instanceof ParseError || e instanceof WeightedScoreError) return { code: 2, out: `error: ${e.message}` }
    throw e
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: bid-weighted-score.ts <file>')
    process.exit(2)
  }
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    console.error(`error: cannot read ${file}: ${(e as Error).message}`)
    process.exit(2)
  }
  const r = runCli(text)
  if (r.code === 0) console.log(r.out)
  else console.error(r.out)
  process.exit(r.code)
}
