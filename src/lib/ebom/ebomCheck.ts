// The check of an ifc-ebom-compiler result against the deterministic helper (ebomJoin.ts), shared by the CLI
// (scripts/ebom-join.ts) and the app's post-run check (src/lib/server/tryitout/postRunCheck.ts). No I/O.
// - Without a result: the helper's own class rows (the SKILL.md step table), review items and E-BOM lines.
// - With a result: the agent's `## E-BOM class rows` checked against the contract (every element exactly one
//   outcome, catalogue names, positive quantities, known blocks), compared cell by cell with the helper, and the
//   E-BOM lines joined from the AGENT's billed rows.
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
} from './ebomJoin'

export class ParseError extends Error {}

export const ROWS_HEADING = /^##\s*E-BOM class rows\s*$/i

/** True when the text has a `## E-BOM class rows` heading line. */
export function hasResultTable(text: string): boolean {
  return text.split(/\r?\n/).some((l) => ROWS_HEADING.test(l.trim()))
}

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

export const table = (cols: string[], rows: string[][]): string =>
  [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

export function formatLines(lines: Line[]): string {
  if (lines.length === 0) return 'none'
  return table(
    ['block', 'designation', 'unit', 'measured', 'billed', 'elements', 'stick_rounded'],
    lines.map((l) => [l.block, l.designation, l.unit, l.measured, l.billed, String(l.elements), l.stick_rounded ? 'Y' : 'N']),
  )
}

export interface EbomCheck {
  /** 0 ok (no problems, no mismatches), 1 problems or mismatches found, 2 the upload or result could not be read. */
  code: 0 | 1 | 2
  /** The report text (the CLI prints it as is). */
  out: string
  problems: string[]
  diffs: string[]
  /** With a result that could be read: the agent's class rows. */
  rows?: ResultRow[]
  /** With a result that meets the contract: the E-BOM lines joined from the agent's billed rows. */
  lines?: Line[]
  /** The block titles of the upload (block_id -> title). */
  blockTitles?: Record<string, string>
}

/** Runs the helper on the upload and, given a result, checks and compares it. Throws only on a bug. */
export function checkEbomResult(inputText: string, resultText?: string, stickM = '3'): EbomCheck {
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
      return { code: 0, out: out.join('\n'), problems: [], diffs: [] }
    }
    const got = parseResultTable(resultText)
    const problems = checkOutcomes(upload, got)
    const diffs = compareRows(ref, got)
    const out = [
      problems.length ? `CONTRACT PROBLEMS (${problems.length})\n${problems.join('\n')}` : 'contract: every element has exactly one valid outcome',
      diffs.length ? `MISMATCHES WITH THE HELPER (${diffs.length})\n${diffs.join('\n')}` : 'result table matches the helper on every cell',
    ]
    const lines = problems.length === 0 ? joinLines(got, stickM) : undefined
    if (lines) out.push(`## E-BOM lines from the result (stick ${stickM} m)\n${formatLines(lines)}`)
    const blockTitles = Object.fromEntries(upload.blocks.map((b) => [b.block_id, b.title]))
    return { code: problems.length || diffs.length ? 1 : 0, out: out.join('\n\n'), problems, diffs, rows: got, lines, blockTitles }
  } catch (e) {
    if (e instanceof ParseError || e instanceof EbomError) return { code: 2, out: `error: ${e.message}`, problems: [], diffs: [] }
    throw e
  }
}
