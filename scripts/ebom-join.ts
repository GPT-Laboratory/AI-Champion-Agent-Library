// The tool step after the ifc-ebom-compiler agent (deterministic helper src/lib/ebom/ebomJoin.ts). Input: the upload of
// data/tryitout-prompts/ifc-ebom-compiler/ (## BLOCKS, ## CATALOGUE, ## RULES, ## ELEMENTS).
// - Without a result: prints the helper's own class rows (the SKILL.md step table), review items and E-BOM lines.
// - With a result.md: checks the agent's `## E-BOM class rows` against the contract (every element exactly one
//   outcome, catalogue names, positive quantities, known blocks), compares them cell by cell with the helper and
//   prints the E-BOM lines joined from the AGENT's billed rows.
// Lines: billed metres and pieces per block x designation, metres rounded up to whole sticks (--stick-m, default 3;
// 0 = no rounding). No network, no writes.
// Usage: npx tsx scripts/ebom-join.ts <upload.txt> [result.md] [--stick-m <metres>]
// Exit codes: 0 ok (and no problems or mismatches), 1 problems or mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import {
  EbomError,
  RESULT_COLS,
  checkOutcomes,
  classRows,
  compareRows,
  joinLines,
  parseUpload,
  reviewItems,
  type Line,
  type ResultRow,
} from '../src/lib/ebom/ebomJoin.js'

export class ParseError extends Error {}

const ROWS_HEADING = /^##\s*E-BOM class rows\s*$/i

/** The `## E-BOM class rows` table of an agent result. */
export function parseResultTable(text: string): ResultRow[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => ROWS_HEADING.test(l.trim()))
  if (start < 0) throw new ParseError('no `## E-BOM class rows` section in the result')
  const rows: ResultRow[] = []
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
    rows.push(rec as ResultRow)
  }
  if (!head) throw new ParseError('no table found under `## E-BOM class rows`')
  const missing = RESULT_COLS.filter((c) => !head!.includes(c))
  if (missing.length) throw new ParseError(`result table lacks columns: ${missing.join(', ')}`)
  return rows
}

const table = (cols: string[], rows: string[][]): string =>
  [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

export function formatLines(lines: Line[]): string {
  if (lines.length === 0) return 'none'
  return table(
    ['block', 'designation', 'unit', 'measured', 'billed', 'elements', 'stick_rounded'],
    lines.map((l) => [l.block, l.designation, l.unit, l.measured, l.billed, String(l.elements), l.stick_rounded ? 'Y' : 'N']),
  )
}

export function runCli(inputText: string, resultText?: string, stickM = '3'): { code: number; out: string } {
  try {
    const upload = parseUpload(inputText)
    const ref = classRows(upload)
    if (resultText === undefined) {
      const review = reviewItems(ref)
      const out = [
        '## E-BOM class rows (helper)',
        table([...RESULT_COLS], ref.map((r) => RESULT_COLS.map((c) => r[c]))),
        '',
        '## Review items (helper)',
        review.length ? table(['where', 'members', 'kind', 'what'], review.map((i) => [i.where, i.members, i.kind, i.what])) : 'none',
        '',
        '## Rules not tied to data',
        upload.untiedRules.length ? upload.untiedRules.join('\n') : 'none',
        '',
        `## E-BOM lines (stick ${stickM} m)`,
        formatLines(joinLines(ref, stickM)),
      ]
      return { code: 0, out: out.join('\n') }
    }
    const got = parseResultTable(resultText)
    const problems = checkOutcomes(upload, got)
    const diffs = compareRows(ref, got)
    const out = [
      problems.length ? `CONTRACT PROBLEMS (${problems.length})\n${problems.join('\n')}` : 'contract: every element has exactly one valid outcome',
      diffs.length ? `MISMATCHES WITH THE HELPER (${diffs.length})\n${diffs.join('\n')}` : 'result table matches the helper on every cell',
    ]
    if (problems.length === 0) out.push(`## E-BOM lines from the result (stick ${stickM} m)\n${formatLines(joinLines(got, stickM))}`)
    return { code: problems.length || diffs.length ? 1 : 0, out: out.join('\n\n') }
  } catch (e) {
    if (e instanceof ParseError || e instanceof EbomError) return { code: 2, out: `error: ${e.message}` }
    throw e
  }
}

export function parseArgs(argv: string[]): { files: string[]; stickM: string } | null {
  const files: string[] = []
  let stickM = '3'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--stick-m') {
      const v = argv[++i]
      if (v === undefined) return null
      stickM = v
    } else if (argv[i].startsWith('--')) return null
    else files.push(argv[i])
  }
  return files.length >= 1 && files.length <= 2 ? { files, stickM } : null
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    console.error('usage: ebom-join.ts <upload.txt> [result.md] [--stick-m <metres>]')
    process.exit(2)
  }
  let a: string
  let b: string | undefined
  try {
    a = readFileSync(args.files[0], 'utf8')
    b = args.files[1] ? readFileSync(args.files[1], 'utf8') : undefined
  } catch (e) {
    console.error(`error: cannot read file: ${(e as Error).message}`)
    process.exit(2)
  }
  const r = runCli(a, b, args.stickM)
  if (r.code === 2) console.error(r.out)
  else console.log(r.out)
  process.exit(r.code)
}
