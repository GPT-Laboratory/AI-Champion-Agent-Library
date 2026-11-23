// Reads the text an agent writes (result.md) or reads (the sample upload) into a small block tree, so the page can
// show tables as tables (src/lib/components/ResultView.svelte) and offer them as a spreadsheet (src/lib/xlsx.ts).
// Client-safe, no I/O. Only the subset the agents use is read: headings, pipe tables, lists, fenced code and plain
// lines; in an input also `# ` notes, `key: value` lines, CSV blocks and pipe blocks without outer pipes. The tree
// holds plain strings only; nothing is ever turned into HTML.

export type Inline = { t: 'text' | 'code' | 'strong'; v: string }

export type Block =
  | { kind: 'heading'; level: number; text: Inline[] }
  | { kind: 'table'; header: string[]; rows: string[][]; title: string | null }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'lines'; lines: Inline[][] }
  | { kind: 'note'; text: string }
  | { kind: 'fields'; rows: [string, string][] }

/** 'result': Markdown as the agents write it. 'input': a sample upload (`#` notes, `## SECTION` headings, CSV). */
export type ParseMode = 'result' | 'input'

const FENCE = /^\s*```/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const LIST_ITEM = /^\s*(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/
const SEPARATOR_CELL = /^:?-{1,}:?$/
// `key: value` or `key=value`; the key is one word, so "rules:1: ..." and CSV rows are not fields.
const FIELD = /^([A-Za-z_][A-Za-z0-9_]{0,40})\s*(?::\s|=)\s*(.*)$/

/** Splits one Markdown table row on `|`, honouring `\|` and code spans. */
export function splitPipeRow(line: string, outerPipes = true): string[] {
  let t = line.trim()
  if (outerPipes) {
    if (t.startsWith('|')) t = t.slice(1)
    if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  }
  const cells: string[] = []
  let cur = ''
  let inCode = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '\\' && t[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '`') {
      inCode = !inCode
      cur += ch
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

/** Splits one CSV line (commas, double-quoted fields with "" escapes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"' && cur.trim() === '') {
      quoted = true
      cur = ''
    } else if (ch === ',') {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

/** `code` spans and **strong** runs; everything else is text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) })
    out.push(m[1] !== undefined ? { t: 'code', v: m[1] } : { t: 'strong', v: m[2] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) })
  return out
}

/** Plain text of inline runs (for sheet names and labels). */
export const inlineText = (runs: Inline[]): string => runs.map((r) => r.v).join('')

function rectangular(header: string[], rows: string[][]): { header: string[]; rows: string[][] } {
  const width = Math.max(header.length, ...rows.map((r) => r.length))
  const pad = (r: string[]) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r)
  return { header: pad(header), rows: rows.map(pad) }
}

const isCsvLine = (l: string): boolean => l.includes(',') && !l.trim().startsWith('#') && !l.trim().startsWith('|')
const isBarLine = (l: string): boolean => / \| /.test(l) && !l.trim().startsWith('|') && !l.trim().startsWith('#')

/** Parses agent or input text into blocks. Never throws. */
export function parseDocument(text: string, mode: ParseMode = 'result'): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let title: string | null = null
  let para: Inline[][] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'lines', lines: para })
    para = []
  }
  const pushTable = (header: string[], rows: string[][]) => {
    flush()
    blocks.push({ kind: 'table', ...rectangular(header, rows), title })
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (FENCE.test(line)) {
      flush()
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++])
      i++ // closing fence (or end of text)
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    if (trimmed === '') {
      flush()
      i++
      continue
    }

    if (mode === 'input' && /^#(\s|$)/.test(trimmed)) {
      flush()
      blocks.push({ kind: 'note', text: trimmed.replace(/^#\s?/, '') })
      i++
      continue
    }
    const h = HEADING.exec(trimmed)
    if (h) {
      flush()
      const level = mode === 'input' ? Math.max(2, h[1].length) : h[1].length
      blocks.push({ kind: 'heading', level, text: parseInline(h[2]) })
      title = h[2].replace(/[`*]/g, '').trim() || null
      i++
      continue
    }

    if (trimmed.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitPipeRow(lines[i])
        if (!cells.every((c) => SEPARATOR_CELL.test(c))) rows.push(cells)
        i++
      }
      if (rows.length) pushTable(rows[0], rows.slice(1))
      continue
    }

    if (mode === 'input' && isBarLine(line) && i + 1 < lines.length && isBarLine(lines[i + 1])) {
      const rows: string[][] = []
      while (i < lines.length && isBarLine(lines[i])) rows.push(splitPipeRow(lines[i++], false))
      pushTable(rows[0], rows.slice(1))
      continue
    }
    if (mode === 'input' && isCsvLine(line) && i + 1 < lines.length && isCsvLine(lines[i + 1])) {
      const rows: string[][] = []
      while (i < lines.length && isCsvLine(lines[i])) rows.push(splitCsvLine(lines[i++]))
      pushTable(rows[0], rows.slice(1))
      continue
    }
    if (mode === 'input' && FIELD.test(trimmed)) {
      flush()
      const rows: [string, string][] = []
      for (let m = FIELD.exec(lines[i]?.trim() ?? ''); i < lines.length && m; m = FIELD.exec(lines[i]?.trim() ?? '')) {
        rows.push([m[1], m[2]])
        i++
      }
      blocks.push({ kind: 'fields', rows })
      continue
    }

    const li = LIST_ITEM.exec(line)
    if (li) {
      flush()
      const ordered = li[2] !== undefined
      const items: Inline[][] = []
      for (let m = LIST_ITEM.exec(lines[i] ?? ''); i < lines.length && m && (m[2] !== undefined) === ordered; m = LIST_ITEM.exec(lines[i] ?? '')) {
        items.push(parseInline(m[3]))
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    para.push(parseInline(trimmed))
    i++
  }
  flush()
  return blocks
}

/** True when the parsed text has at least one table (the spreadsheet download needs one). */
export const hasTable = (blocks: Block[]): boolean => blocks.some((b) => b.kind === 'table')

export type Tone = 'good' | 'warn' | 'bad' | 'muted'

const GOOD = /^(ok|bill|billed|pass|passed|match|matched|agree|agrees|active|complete|completed|closed|delivered|on-time|ordered|in-stock|verified)$|-ok$/
const BAD = /(missing|expired|overdue|fail|failed|failure|mismatch|inconsistent|incomplete|no-match|bad[-_]data|invalid|rejected|not-found)/
const WARN = /(review|soon|ambiguous|unsettled|estimate|pending|partial|warning|at-risk|delayed|late|short|unverified|open)/
const MUTED = /^(exclude|excluded|skip|skipped|n\/a|none)$/

/**
 * A colour hint for a short status word in a table cell (bill, review, expired, register-ok ...), or null for
 * anything else (numbers, ids, names, sentences). Only a hint: the word itself is always shown.
 */
export function cellTone(value: string): Tone | null {
  const v = value.trim().toLowerCase()
  if (!/^[a-z][a-z0-9_/-]{1,30}$/.test(v)) return null
  if (GOOD.test(v)) return 'good'
  if (MUTED.test(v)) return 'muted'
  if (BAD.test(v)) return 'bad'
  if (WARN.test(v)) return 'warn'
  return null
}

/**
 * Columns whose cells get colour chips: those where at least half of the filled cells (not "-") are status words.
 * Keeps a column of mixed reasons (stated, count, loc-review ...) plain instead of colouring a few of them.
 */
export function toneColumns(rows: string[][], width: number): boolean[] {
  return Array.from({ length: width }, (_, c) => {
    const vals = rows.map((r) => (r[c] ?? '').trim()).filter((v) => v !== '' && v !== '-')
    return vals.length > 0 && vals.filter((v) => cellTone(v) !== null).length * 2 >= vals.length
  })
}
