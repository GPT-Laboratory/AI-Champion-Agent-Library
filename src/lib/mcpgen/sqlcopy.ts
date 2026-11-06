// Removes row data from a PostgreSQL dump before anything reads it. A pg_dump made WITHOUT
// --schema-only carries `COPY t (cols) FROM stdin;` blocks: one line per row, closed by a line
// that is exactly `\.`. Rows are data, can hold secrets and are never ingested: the registry
// scans (and the sql-ddl adapter parses) only the text this function returns. Only the number of
// skipped lines is kept, never a row. psql meta-commands (`\connect`, `\restrict <value>`) are
// dropped as well. Line based, one pass: time is linear in the input length.

export interface StrippedDump {
  text: string
  /** Data lines inside COPY blocks (the `\.` terminators are not counted). */
  skippedLines: number
  blocks: number
  /** True when a COPY block had no `\.` line and ran to the end of the text. */
  unterminated: boolean
  /** True when anything was removed. */
  changed: boolean
}

const COPY_HEAD = /^COPY\s[^\n]*\sFROM\s+stdin\b[^\n]*$/i
const PSQL_META = /^\\(?:connect|c|restrict|unrestrict|encoding|echo|set|unset|pset)(?:\s|$)/

export function stripSqlDumpData(text: string): StrippedDump {
  const out: string[] = []
  let skippedLines = 0
  let blocks = 0
  let unterminated = false
  let changed = false
  let pos = 0
  let inCopy = false
  while (pos <= text.length) {
    let nl = text.indexOf('\n', pos)
    if (nl < 0) nl = text.length
    const raw = text.slice(pos, nl)
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    pos = nl + 1
    if (inCopy) {
      if (line === '\\.') inCopy = false
      else skippedLines++
      continue
    }
    const c = line.charCodeAt(0)
    if ((c === 67 || c === 99) && COPY_HEAD.test(line)) {
      inCopy = true
      blocks++
      changed = true
      continue
    }
    if (c === 92 && PSQL_META.test(line)) {
      changed = true
      continue
    }
    out.push(raw)
  }
  if (inCopy) unterminated = true
  return { text: changed ? out.join('\n') : text, skippedLines, blocks, unterminated, changed }
}
