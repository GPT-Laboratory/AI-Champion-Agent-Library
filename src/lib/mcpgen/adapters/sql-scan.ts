// Shared, quote-aware scanning helpers for the sql-ddl adapter. Hand-written, no SQL library.
// Every function walks the text with an index and never revisits a position: time is linear in
// the input length, also for unterminated quotes, quote bombs and very deep parentheses (an
// unterminated quote or dollar-quote simply runs to the end of the text, once).

export interface ScanOpts {
  /** [name] is an identifier quote (SQLite, SQL Server). Off for PostgreSQL and MySQL, where [ is an array bracket. */
  brackets: boolean
  /** Backslash escapes inside '...' and "..." (MySQL). PostgreSQL E'...' strings are detected separately. */
  backslash: boolean
  /** MySQL comment rules: `#` starts a line comment, and `--` only when followed by whitespace (CR-12). */
  mysqlComments?: boolean
}

export const GENERIC_SCAN: ScanOpts = { brackets: true, backslash: false }

const IDENT_CHAR = /[A-Za-z0-9_$]/
const DOLLAR_OPEN = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y

/**
 * If a quoted run (' " ` [ ), or a PostgreSQL dollar-quoted string starts at i, return the index just
 * past it (the end of the text when it is never closed). Otherwise -1.
 */
export function skipSpecial(s: string, i: number, o: ScanOpts): number {
  const ch = s[i]
  if (ch === "'" || ch === '"' || ch === '`' || (ch === '[' && o.brackets)) {
    const close = ch === '[' ? ']' : ch
    const escE = ch === "'" && (s[i - 1] === 'E' || s[i - 1] === 'e') && (i < 2 || !IDENT_CHAR.test(s[i - 2]))
    const bs = escE || (o.backslash && (ch === "'" || ch === '"'))
    let j = i + 1
    while (j < s.length) {
      const c = s[j]
      if (bs && c === '\\') {
        j += 2
        continue
      }
      if (c === close) {
        if (close !== ']' && s[j + 1] === close) {
          j += 2
          continue
        }
        return j + 1
      }
      j++
    }
    return s.length
  }
  if (ch === '$' && (i === 0 || !IDENT_CHAR.test(s[i - 1]))) {
    DOLLAR_OPEN.lastIndex = i
    const m = DOLLAR_OPEN.exec(s)
    if (m) {
      const end = s.indexOf(m[0], i + m[0].length)
      return end < 0 ? s.length : end + m[0].length
    }
  }
  return -1
}

/** Remove line comments and block comments (this includes MySQL conditional comments), keeping quoted text intact. */
export function stripComments(sql: string, o: ScanOpts = GENERIC_SCAN): string {
  const out: string[] = []
  let i = 0
  let from = 0
  while (i < sql.length) {
    const ch = sql[i]
    const end = skipSpecial(sql, i, o)
    if (end >= 0) {
      i = end
    } else if ((ch === '-' && sql[i + 1] === '-' && (!o.mysqlComments || i + 2 >= sql.length || /[\s\x00-\x1f]/.test(sql[i + 2]))) || (ch === '#' && o.mysqlComments)) {
      out.push(sql.slice(from, i))
      while (i < sql.length && sql[i] !== '\n') i++
      from = i
    } else if (ch === '/' && sql[i + 1] === '*') {
      out.push(sql.slice(from, i), ' ')
      const close = sql.indexOf('*/', i + 2)
      i = close < 0 ? sql.length : close + 2
      from = i
    } else i++
  }
  out.push(sql.slice(from))
  return out.join('')
}

/** Split on semicolons outside quotes. Trigger bodies (BEGIN ... END) stay one statement. */
export function splitStatements(sql: string, o: ScanOpts = GENERIC_SCAN): string[] {
  const parts: string[] = []
  let i = 0
  let from = 0
  while (i < sql.length) {
    const end = skipSpecial(sql, i, o)
    if (end >= 0) i = end
    else if (sql[i] === ';') {
      parts.push(sql.slice(from, i))
      i++
      from = i
    } else i++
  }
  parts.push(sql.slice(from))
  const out: string[] = []
  let trigger: string | undefined
  for (const p of parts.map((x) => x.trim()).filter((x) => x !== '')) {
    if (trigger !== undefined) {
      trigger += `; ${p}`
      if (/^END\b/i.test(p)) {
        out.push(trigger)
        trigger = undefined
      }
    } else if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i.test(p) && /\bBEGIN\b/i.test(p) && !/\bEND\s*$/i.test(p)) {
      trigger = p
    } else out.push(p)
  }
  if (trigger !== undefined) out.push(trigger)
  return out
}

/** Split on top-level commas (outside parentheses and quotes). */
export function splitTop(body: string, o: ScanOpts = GENERIC_SCAN): string[] {
  const out: string[] = []
  let depth = 0
  let from = 0
  let i = 0
  while (i < body.length) {
    const end = skipSpecial(body, i, o)
    if (end >= 0) {
      i = end
      continue
    }
    const ch = body[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      out.push(body.slice(from, i).trim())
      from = i + 1
    }
    i++
  }
  const last = body.slice(from).trim()
  if (last !== '') out.push(last)
  return out
}

/** Index of the parenthesis that closes the one at `open`, or -1. Iterative: deep nesting cannot overflow the stack. */
export function matchParen(s: string, open: number, o: ScanOpts = GENERIC_SCAN): number {
  let depth = 0
  let i = open
  while (i < s.length) {
    const end = skipSpecial(s, i, o)
    if (end >= 0) {
      i = end
      continue
    }
    const ch = s[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/** Same-length copy with the inside of '...' strings and dollar-quoted strings blanked (quotes of identifiers are kept). */
export function maskStrings(s: string, o: ScanOpts = GENERIC_SCAN): string {
  const out: string[] = []
  let i = 0
  let from = 0
  while (i < s.length) {
    const end = skipSpecial(s, i, o)
    if (end >= 0 && (s[i] === "'" || s[i] === '$')) {
      out.push(s.slice(from, i), ' '.repeat(end - i))
      i = end
      from = i
    } else i = end >= 0 ? end : i + 1
  }
  out.push(s.slice(from))
  return out.join('')
}

/** Read one possibly quoted, possibly schema-qualified identifier. Returns the last part. */
export function readIdent(s: string): { name: string; rest: string } | undefined {
  let rest = s.trimStart()
  let name: string | undefined
  for (let part = 0; part < 4; part++) {
    const m = /^(?:"((?:[^"]|"")+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))/.exec(rest)
    if (!m) return name === undefined ? undefined : { name, rest }
    name = (m[1] ?? m[2] ?? m[3] ?? m[4]).replace(/""/g, '"')
    rest = rest.slice(m[0].length)
    const dot = /^\s*\.\s*/.exec(rest)
    if (!dot) return { name, rest }
    rest = rest.slice(dot[0].length)
  }
  return name === undefined ? undefined : { name, rest }
}

export function identList(s: string, o: ScanOpts = GENERIC_SCAN): string[] | undefined {
  const names: string[] = []
  for (const item of splitTop(s, o)) {
    const id = readIdent(item)
    if (!id) return undefined
    names.push(id.name)
  }
  return names
}
