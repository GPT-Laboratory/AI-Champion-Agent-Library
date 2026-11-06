// sql-ddl adapter (CUST-02): CREATE TABLE statements -> entities with PKs, FKs and types, plus
// read-only SELECT operations. Hand-written tolerant parser (no SQL library, no new dependency).
// Only schema text is read. Data-changing statements are reported and ignored; their values are
// never kept. Anything ambiguous or unsupported becomes a Gap, never a guess.
//
// Dialects (D-540..D-545): pg_dump (--schema-only), SQLite `.schema` and mysqldump (--no-data) are
// folded into the same table model. ALTER TABLE ... ADD PRIMARY KEY / FOREIGN KEY / UNIQUE are
// applied to the tables (pg_dump writes its keys that way); other ALTERs stay reported writes.
// COPY ... FROM stdin data blocks are removed before anything else (../sqlcopy.ts) and only their
// line count is reported. The generated backend is always a read-only SQLite file.
import { gap } from '../diagnostics.js'
import { stripSqlDumpData } from '../sqlcopy.js'
import type { FieldType, Gap, GenerateOptions, InputAdapter, ParseResult, RawInput, SourceModel } from '../types.js'
import { MAX_COLUMNS, MAX_TABLES, SAFE, buildSqlModel, makeGapSink, serverTitle, type Col, type Table } from './sql-common.js'
import { DIALECT_LABEL, detectDialect, looksLikePrisma, scanOptsFor, type Dialect } from './sql-dialect.js'
import { identList, matchParen, maskStrings, readIdent, skipSpecial, splitStatements, splitTop, stripComments, type ScanOpts } from './sql-scan.js'

const INT_TYPES = new Set(['INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT', 'SERIAL', 'BIGSERIAL', 'SMALLSERIAL', 'INT2', 'INT4', 'INT8'])
const NUM_TYPES = new Set(['REAL', 'FLOAT', 'FLOAT4', 'FLOAT8', 'DOUBLE', 'NUMERIC', 'DECIMAL', 'MONEY', 'NUMBER'])
const BOOL_TYPES = new Set(['BOOL', 'BOOLEAN', 'BIT'])
const TEXT_TYPES = new Set(['CHAR', 'VARCHAR', 'NCHAR', 'NVARCHAR', 'CHARACTER', 'VARYING', 'TEXT', 'STRING', 'CLOB', 'DATE', 'TIME', 'TIMESTAMP', 'DATETIME', 'TIMESTAMPTZ', 'TIMETZ', 'UUID', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT', 'YEAR', 'INTERVAL', 'BPCHAR', 'CITEXT'])
const MAX_ENUM_VALUES = 200
const MAX_ENUM_VALUE_LENGTH = 80

function mapType(raw: string): { type: FieldType; known: boolean; composite: boolean } {
  const t = raw.trim().toUpperCase()
  if (t === '') return { type: 'string', known: false, composite: false }
  // `[\d\s]*` (not `\s*\d*\s*`): the three-way split backtracked quadratically on long runs of spaces.
  if (/\[[\d\s]*\]\s*$/.test(t) || /\bARRAY\b/.test(t) || /^(JSON|JSONB|XML|HSTORE|STRUCT|MAP|ROW)\b/.test(t)) return { type: 'string', known: false, composite: true }
  const base = /^[A-Z0-9_]+/.exec(t)?.[0] ?? ''
  if (INT_TYPES.has(base)) return { type: 'integer', known: true, composite: false }
  if (NUM_TYPES.has(base)) return { type: 'number', known: true, composite: false }
  if (BOOL_TYPES.has(base)) return { type: 'boolean', known: true, composite: false }
  if (TEXT_TYPES.has(base)) return { type: 'string', known: true, composite: false }
  return { type: 'string', known: false, composite: false }
}

const CONSTRAINT_START = /(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|REFERENCES|DEFAULT|UNIQUE|CHECK|CONSTRAINT|COLLATE|GENERATED|AUTO_INCREMENT|AUTOINCREMENT|COMMENT|AS|IDENTITY)\b/iy

/** Index of the first column-constraint keyword outside quotes and parentheses, or -1. */
function cutConstraints(s: string, so: ScanOpts): number {
  let depth = 0
  let i = 0
  while (i < s.length) {
    const end = skipSpecial(s, i, so)
    if (end >= 0) {
      i = end
      continue
    }
    const ch = s[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0 && /[A-Za-z]/.test(ch) && (i === 0 || !/[A-Za-z0-9_$]/.test(s[i - 1]))) {
      CONSTRAINT_START.lastIndex = i
      if (CONSTRAINT_START.test(s)) return i
    }
    i++
  }
  return -1
}

/** The labels of `('a','b')` (a PostgreSQL enum body or a MySQL inline enum), or undefined when anything is not a plain string. */
function enumLabels(inner: string, so: ScanOpts): string[] | undefined {
  const items = splitTop(inner, so)
  if (items.length === 0 || items.length > MAX_ENUM_VALUES) return undefined
  const out: string[] = []
  for (const it of items) {
    const m = /^'((?:[^']|'')*)'$/s.exec(it)
    if (!m) return undefined
    const v = m[1].replace(/''/g, "'")
    // eslint-disable-next-line no-control-regex
    if (v === '' || v.length > MAX_ENUM_VALUE_LENGTH || /[\u0000-\u001f\u007f]/.test(v)) return undefined
    out.push(v)
  }
  return out
}

const INSERT_HEAD = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*(?:INSERT|REPLACE)\b/i

/**
 * The dump with ALL row data removed: COPY blocks (stripSqlDumpData) and INSERT / REPLACE statements. Used where text
 * leaves the process (the context pack): row data can hold personal data that no credential scan recognises (review
 * CR-27). Text without row data comes back unchanged. Statement splitting is quote aware.
 */
export function stripSqlRowData(text: string): { text: string; changed: boolean } {
  const s = stripSqlDumpData(text)
  if (!/^\s*(?:INSERT|REPLACE)\b/im.test(s.text)) return { text: s.text, changed: s.changed }
  const statements = splitStatements(s.text, scanOptsFor(detectDialect(s.text).dialect))
  const kept = statements.filter((st) => !INSERT_HEAD.test(st))
  if (kept.length === statements.length) return { text: s.text, changed: s.changed }
  return { text: kept.length > 0 ? `${kept.join(';\n')};\n` : '', changed: true }
}

export const sqlDdlAdapter: InputAdapter = {
  id: 'sql-ddl',
  label: 'SQL DDL (CREATE TABLE; pg_dump, SQLite, mysqldump)',
  detect: (input: RawInput) => (/\bcreate\s+(?:\w+\s+){0,3}?table\b/i.test(typeof input.text === 'string' ? input.text : '') ? 0.9 : 0),
  scrubSource: stripSqlRowData,
  parse(input: RawInput, options?: GenerateOptions): ParseResult {
    try {
      return parseDdl(input, options)
    } catch {
      return { rejected: [gap('adapter-failed', 'The SQL input could not be parsed.', { severity: 'error' })] }
    }
  },
}

interface PendingAlter {
  table: string
  actions: string[]
}

const WRITE_VERBS = ['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'DROP', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE', 'MERGE']
/** Housekeeping a dialect dump is full of; counted, never reported one by one (only when a dialect was recognised). */
const NOISE_VERBS = new Set(['SET', 'SELECT', 'COMMENT', 'GRANT', 'REVOKE', 'LOCK', 'UNLOCK', 'DELIMITER', 'USE', 'PRAGMA', 'BEGIN', 'COMMIT', 'ROLLBACK', 'START', 'END', 'DROP', 'ANALYZE', 'VACUUM', 'REINDEX', 'RESET'])
const NOISE_CREATE = /^CREATE\s+(?:UNIQUE\s+)?(?:EXTENSION|SCHEMA|SEQUENCE|INDEX|COLLATION|CAST|PUBLICATION|SUBSCRIPTION|TABLESPACE|ROLE|USER)\b/i
const OLD_NOISE_VERBS = ['BEGIN', 'COMMIT', 'ROLLBACK', 'PRAGMA', 'SET', 'USE', 'START', 'END']

const IDENT_RE = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|\\w+)'
const CONSTRAINT_PREFIX = `(?:CONSTRAINT\\s+${IDENT_RE}\\s+)?`
const RE_ADD_PK = new RegExp(`^ADD\\s+${CONSTRAINT_PREFIX}PRIMARY\\s+KEY\\s*\\(([^)]*)\\)`, 'i')
const RE_ADD_FK = new RegExp(`^ADD\\s+${CONSTRAINT_PREFIX}FOREIGN\\s+KEY\\s*\\(([^)]*)\\)\\s*REFERENCES\\s+(.+)$`, 'is')
const RE_ADD_UNIQUE = new RegExp(`^ADD\\s+${CONSTRAINT_PREFIX}UNIQUE\\b[^(]*\\(([^)]*)\\)`, 'i')
const RE_ADD_CHECK = new RegExp(`^ADD\\s+${CONSTRAINT_PREFIX}(?:CHECK|EXCLUDE)\\b`, 'i')
const RE_SET_DEFAULT_SEQ = /^ALTER\s+(?:COLUMN\s+)?(?:"[^"]+"|`[^`]+`|\w+)\s+SET\s+DEFAULT\s+nextval\s*\(/i
const RE_IDENTITY = /^ALTER\s+(?:COLUMN\s+)?(?:"[^"]+"|`[^`]+`|\w+)\s+(?:ADD\s+GENERATED\b|SET\s+(?:GENERATED|SEQUENCE)\b)/i
const RE_SET_NOT_NULL = /^ALTER\s+(?:COLUMN\s+)?("[^"]+"|`[^`]+`|\w+)\s+SET\s+NOT\s+NULL\s*$/i
const RE_OWNER = /^OWNER\s+TO\b/i
const RE_KEYISH = /\b(?:PRIMARY|UNIQUE|KEY|CONSTRAINT|INDEX)\b/i

function parseDdl(input: RawInput, options?: GenerateOptions): ParseResult {
  const raw = typeof input.text === 'string' ? input.text : ''
  // Row data first: nothing below ever sees a COPY row (the registry scans the same stripped text).
  const stripped = stripSqlDumpData(raw)
  const text = stripped.text
  const sink = makeGapSink()
  const { gaps, push } = sink
  const { dialect, ambiguous } = detectDialect(text, { hasCopy: stripped.blocks > 0 })
  const so = scanOptsFor(dialect)
  const quiet = dialect !== 'generic'
  if (stripped.blocks > 0) {
    push(gap('data-rows-skipped', `${stripped.skippedLines} data line${stripped.skippedLines === 1 ? '' : 's'} in ${stripped.blocks} COPY block${stripped.blocks === 1 ? '' : 's'} were skipped; row data is never read or kept.`, { severity: 'info' }))
    if (stripped.unterminated) push(gap('copy-block-unterminated', 'The last COPY block has no end marker; everything after it was treated as row data and skipped.', { severity: 'warn' }))
  }
  if (ambiguous.length > 0) push(gap('dialect-ambiguous', `The input has markers of more than one SQL dialect (${ambiguous.map((d) => DIALECT_LABEL[d]).join(', ')}); it was read as generic SQL. Check the result.`, { severity: 'warn' }))
  if (dialect !== 'generic') push(gap('sql-dialect-detected', `The input was recognised as ${DIALECT_LABEL[dialect]} output.`, { severity: 'info' }))
  if (dialect === 'postgres' || dialect === 'mysql') {
    push(gap('sqlite-backend-only', `The generated sql server reads a read-only SQLite database file. This ${DIALECT_LABEL[dialect]} schema only describes the tables: provide a SQLite file with the same tables and columns (same names) for the server to open.`, { severity: 'info' }))
  }
  if (looksLikePrisma(text)) push(gap('ambiguous-input', 'The input also looks like a Prisma schema; it was read as SQL. Force the prisma adapter if that is what it is.', { severity: 'warn' }))

  const pendingTables: string[] = []
  const pendingAlters: PendingAlter[] = []
  const enums = new Map<string, string[]>()
  const dropped = new Set<string>()
  const ignoredWrites = new Map<string, { verb: string; table: string; n: number; severity: 'info' | 'warn' }>()
  let noise = 0
  const addIgnored = (verb: string, table: string) => {
    const key = `${verb}:${table}`
    dropped.add(key.toLowerCase())
    const prev = ignoredWrites.get(key)
    if (prev) prev.n++
    else ignoredWrites.set(key, { verb, table, n: 1, severity: ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(verb) ? 'info' : 'warn' })
  }

  for (const stmt of splitStatements(stripComments(text, so), so)) {
    const verb = /^[A-Za-z]+/.exec(stmt)?.[0].toUpperCase() ?? ''
    if (verb === 'CREATE' && /^CREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY)\s+|UNLOGGED\s+)?TABLE\b/i.test(stmt)) {
      pendingTables.push(stmt)
      continue
    }
    if (verb === 'CREATE' && /^CREATE\s+TYPE\b/i.test(stmt)) {
      const id = readIdent(stmt.replace(/^CREATE\s+TYPE\s+/i, ''))
      const body = id ? /^\s*AS\s+ENUM\s*\(/i.exec(id.rest) : null
      if (id && body) {
        const open = id.rest.indexOf('(', body.index)
        const close = matchParen(id.rest, open, so)
        const labels = close > open ? enumLabels(id.rest.slice(open + 1, close), so) : undefined
        if (labels) enums.set(id.name.toLowerCase(), labels)
        else push(gap('unsupported-type', 'An enum type has values that cannot be read; columns of that type are exposed as text.', { path: id.name.slice(0, 40) }))
        continue
      }
    }
    if (verb === 'ALTER' && /^ALTER\s+TABLE\b/i.test(stmt)) {
      const head = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?/i.exec(stmt)!
      const id = readIdent(stmt.slice(head[0].length))
      if (id) {
        pendingAlters.push({ table: id.name, actions: splitTop(id.rest.replace(/^\s*\*/, ''), so) })
        continue
      }
    }
    if (quiet && (NOISE_VERBS.has(verb) || (verb === 'ALTER' && !/^ALTER\s+TABLE\b/i.test(stmt)) || (verb === 'CREATE' && NOISE_CREATE.test(stmt)))) {
      noise++
      continue
    }
    if (WRITE_VERBS.includes(verb) || verb === 'TRUNCATE') {
      let table = '*'
      const m =
        verb === 'INSERT' || verb === 'REPLACE'
          ? /^(?:INSERT|REPLACE)\s+(?:OR\s+\w+\s+)?(?:INTO\s+)?(.*)$/is.exec(stmt)
          : verb === 'UPDATE'
            ? /^UPDATE\s+(?:OR\s+\w+\s+)?(.*)$/is.exec(stmt)
            : verb === 'DELETE'
              ? /^DELETE\s+FROM\s+(.*)$/is.exec(stmt)
              : verb === 'DROP' || verb === 'TRUNCATE'
                ? /^(?:DROP|TRUNCATE)\s+(?:TABLE\s+|VIEW\s+|INDEX\s+|TRIGGER\s+)?(?:IF\s+EXISTS\s+)?(.*)$/is.exec(stmt)
                : verb === 'ALTER'
                  ? /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(.*)$/is.exec(stmt)
                  : null
      const id = m ? readIdent(m[1]) : undefined
      if (id && SAFE.test(id.name)) table = id.name
      addIgnored(verb, table)
      continue
    }
    if (OLD_NOISE_VERBS.includes(verb)) {
      push(gap('unsupported-statement', `A ${verb} statement was ignored.`, { severity: 'info' }))
      continue
    }
    const what = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:MATERIALIZED\s+)?([A-Za-z]+)/i.exec(stmt)?.[1]?.toUpperCase()
    push(gap('unsupported-statement', `${what ? `CREATE ${what}` : verb || 'A'} statement is not supported and was ignored.`))
  }

  const tables: Table[] = []
  const tableCtx = { so, enums, noise: () => noise++ }
  for (const stmt of pendingTables) {
    if (tables.length >= MAX_TABLES) {
      push(gap('too-many-tables', `Only the first ${MAX_TABLES} tables are used.`, { severity: 'warn' }))
      continue
    }
    const t = parseCreateTable(stmt, push, tableCtx)
    if (!t) continue
    if (tables.some((x) => x.name === t.name)) {
      push(gap('duplicate-table', 'A table is defined twice; the later definition was ignored.', { path: t.name }))
      continue
    }
    tables.push(t)
  }

  // ALTER TABLE: constraints are folded into the tables, noise is counted, everything else stays a reported write.
  const alterIgnoredOn = new Set<string>()
  for (const a of pendingAlters) {
    const t = tables.find((x) => x.name.toLowerCase() === a.table.toLowerCase())
    let reported = false
    for (const action of a.actions) {
      const outcome = t ? foldAlterAction(t, action, push, so) : classifyOnly(action)
      if (outcome === 'folded') continue
      if (outcome === 'noise') {
        noise++
        continue
      }
      if (!t && outcome === 'constraint') {
        push(gap('alter-target-missing', 'An ALTER TABLE constraint names a table that is not in the input; it was ignored.', { path: a.table.slice(0, 40) }))
        continue
      }
      if (outcome === 'bad') continue
      reported = true
      if (RE_KEYISH.test(action)) alterIgnoredOn.add(a.table)
    }
    if (reported) addIgnored('ALTER', SAFE.test(a.table) ? a.table : '*')
  }
  for (const t of tables) {
    if (t.pk.length === 0 && alterIgnoredOn.has(t.name)) {
      push(gap('alter-may-hold-keys', 'The table has no primary key and an ALTER TABLE statement on it could not be read; the missing key may be defined there.', { path: t.name }))
    }
  }
  if (noise > 0) {
    push(gap('dialect-noise-ignored', `${noise} housekeeping statement${noise === 1 ? '' : 's'} (for example SET, COMMENT ON, GRANT, OWNER TO, sequences, indexes, DROP IF EXISTS) ${noise === 1 ? 'was' : 'were'} ignored; ${noise === 1 ? 'it does' : 'they do'} not change the table model.`, { severity: 'info' }))
  }
  for (const w of [...ignoredWrites.values()].sort((a, b) => (a.verb + a.table < b.verb + b.table ? -1 : 1))) {
    push(gap('statement-ignored', `${w.verb} on ${w.table} was ignored (${w.n} statement${w.n === 1 ? '' : 's'}); the generated server is read-only and no values are kept.`, { severity: w.severity, path: `${w.verb.toLowerCase()}:${w.table}` }))
  }
  sink.flush()

  if (tables.length === 0) {
    return { rejected: [...gaps, gap('no-tables', 'No usable CREATE TABLE statement was found.', { severity: 'error' })] }
  }
  const name = serverTitle(options, input.filename)
  const model: SourceModel = buildSqlModel(tables, { name, options, gaps, push, dropped: [...dropped] })
  return { model, gaps }
}

type AlterOutcome = 'folded' | 'noise' | 'constraint' | 'bad' | 'other'

/** Classify an ALTER TABLE action without a target table (to tell constraint actions from other writes). */
function classifyOnly(action: string): AlterOutcome {
  if (RE_ADD_PK.test(action) || RE_ADD_FK.test(action) || RE_ADD_UNIQUE.test(action) || RE_ADD_CHECK.test(action)) return 'constraint'
  if (RE_SET_DEFAULT_SEQ.test(action) || RE_IDENTITY.test(action) || RE_OWNER.test(action)) return 'noise'
  return 'other'
}

function foldAlterAction(t: Table, action: string, push: (g: Gap) => void, so: ScanOpts): AlterOutcome {
  let m: RegExpExecArray | null
  // SQL identifiers are case-insensitive: resolve names to the declared spelling (CR-11).
  const declared = (n: string) => t.cols.find((x) => x.name.toLowerCase() === n.toLowerCase())?.name ?? n
  const fix = (l: string[] | undefined) => l?.map(declared)
  const has = (c: string) => t.cols.some((x) => x.name === c)
  const bad = (msg: string) => {
    push(gap('unparsable-constraint', msg, { path: t.name }))
    return 'bad' as const
  }
  if ((m = RE_ADD_PK.exec(action))) {
    const names = fix(identList(m[1], so))
    if (!names || names.length === 0 || !names.every(has)) return bad('A PRIMARY KEY constraint added with ALTER TABLE names a column that does not exist or cannot be read; it was ignored.')
    if (t.pk.length > 0) {
      push(gap('duplicate-primary-key', 'The table already has a primary key; a second one added with ALTER TABLE was ignored.', { path: t.name }))
      return 'bad'
    }
    t.pk = names.filter((n, i, a) => a.indexOf(n) === i)
    return 'folded'
  }
  if ((m = RE_ADD_FK.exec(action))) {
    const local = fix(identList(m[1], so))
    const target = readIdent(m[2])
    const refCols = target ? /^\s*\(([^)]*)\)/.exec(target.rest) : null
    const remote = refCols ? identList(refCols[1], so) : undefined
    if (!local || !target || !local.every(has)) return bad('A FOREIGN KEY constraint added with ALTER TABLE could not be read or names a missing column; it was ignored.')
    local.forEach((c, i) => {
      t.fks.push({ column: c, table: target.name, ref: remote?.[i] })
      t.cols.find((x) => x.name === c)!.ref = { table: target.name, column: remote?.[i] }
    })
    return 'folded'
  }
  if ((m = RE_ADD_UNIQUE.exec(action))) {
    const names = fix(identList(m[1], so))
    if (!names || !names.every(has)) return bad('A UNIQUE constraint added with ALTER TABLE names a column that does not exist or cannot be read; it was ignored.')
    if (names.length === 1) t.cols.find((x) => x.name === names[0])!.unique = true
    return 'folded'
  }
  if (RE_ADD_CHECK.test(action)) return 'folded'
  if (RE_SET_DEFAULT_SEQ.test(action) || RE_IDENTITY.test(action) || RE_OWNER.test(action)) return 'noise'
  if ((m = RE_SET_NOT_NULL.exec(action))) {
    const c = readIdent(m[1])
    const col = c ? t.cols.find((x) => x.name.toLowerCase() === c.name.toLowerCase()) : undefined
    if (col) {
      col.nullable = false
      return 'folded'
    }
  }
  return 'other'
}

function parseCreateTable(stmt: string, push: (g: Gap) => void, ctx: { so: ScanOpts; enums: Map<string, string[]>; noise: () => void }): Table | undefined {
  const { so, enums } = ctx
  const head = /^CREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY)\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(stmt)!
  const id = readIdent(stmt.slice(head[0].length))
  if (!id) {
    push(gap('unparsable-table', 'A CREATE TABLE statement has no readable table name and was skipped.'))
    return undefined
  }
  const tname = id.name
  if (/^sqlite_/i.test(tname)) {
    ctx.noise() // sqlite_sequence, sqlite_stat1: bookkeeping tables, not data
    return undefined
  }
  if (!SAFE.test(tname)) {
    push(gap('unsafe-identifier', 'A table name has characters that cannot be used safely and the table was skipped.', { path: tname.slice(0, 40) }))
    return undefined
  }
  const open = id.rest.trimStart()
  if (!open.startsWith('(')) {
    push(gap('unparsable-table', 'CREATE TABLE without a column list (for example AS SELECT or PARTITION OF) is not supported; the table was skipped.', { path: tname }))
    return undefined
  }
  const end = matchParen(open, 0, so)
  if (end < 0) {
    push(gap('unparsable-table', 'The column list is not closed; the table was skipped.', { path: tname }))
    return undefined
  }
  const items = splitTop(open.slice(1, end), so)
  const cols: Col[] = []
  const tablePk: string[] = []
  const tableUnique: string[][] = []
  const fks: Table['fks'] = []
  for (const item of items) {
    let s = item.replace(/^CONSTRAINT\s+(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)\s+/i, '')
    let m: RegExpExecArray | null
    if ((m = /^PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(s))) {
      const names = identList(m[1], so)
      if (names) tablePk.push(...names)
      else push(gap('unsupported-syntax', 'A table-level PRIMARY KEY could not be read.', { path: tname }))
      continue
    }
    if ((m = /^FOREIGN\s+KEY\s*(?:\w+\s*)?\(([^)]*)\)\s*REFERENCES\s+(.+)$/is.exec(s))) {
      const local = identList(m[1], so)
      const target = readIdent(m[2])
      const refCols = target ? /^\s*\(([^)]*)\)/.exec(target.rest) : null
      const remote = refCols ? identList(refCols[1], so) : undefined
      if (local && target) local.forEach((c, i) => fks.push({ column: c, table: target.name, ref: remote?.[i] }))
      else push(gap('unsupported-syntax', 'A FOREIGN KEY clause could not be read.', { path: tname }))
      continue
    }
    if ((m = /^UNIQUE\b(?:\s+(?:KEY|INDEX))?[^(]*\(([^)]*)\)/i.exec(s))) {
      const names = identList(m[1], so)
      if (names) tableUnique.push(names)
      continue
    }
    // Constraint-shaped items that are skipped. A column may be NAMED key, index, period or exclude, so the
    // patterns require the real constraint shape: CHECK (, EXCLUDE [USING m] (, PERIOD FOR, and KEY/INDEX
    // [name] ( identifiers ) where the list is not a type argument (digits) or enum/set labels (quotes) (CR-10).
    if (
      /^(?:(?:FULLTEXT|SPATIAL)\s+)?(?:KEY|INDEX)\b[^(]*\((?!\s*(?:\d+\s*(?:,\s*\d+\s*)?\)|'))/i.test(s) ||
      /^CHECK\s*\(/i.test(s) ||
      /^EXCLUDE\s*(?:USING\s+\w+\s*)?\(/i.test(s) ||
      /^PERIOD\s+FOR\b/i.test(s)
    )
      continue
    if (/^LIKE\b/i.test(s)) {
      push(gap('unsupported-syntax', 'A LIKE clause (columns copied from another table) is not supported; those columns are missing.', { path: tname }))
      continue
    }
    const cid = readIdent(s)
    if (!cid || (!/^\s+\S/.test(cid.rest) && cid.rest.trim() !== '')) {
      push(gap('unsupported-syntax', 'A column definition was not recognised and was skipped.', { path: tname }))
      continue
    }
    s = cid.rest
    const cutAt = cutConstraints(s, so)
    const typeText = (cutAt >= 0 ? s.slice(0, cutAt) : s).trim()
    const constraints = cutAt >= 0 ? s.slice(cutAt) : ''
    const masked = maskStrings(constraints, so)
    if (!SAFE.test(cid.name)) {
      push(gap('unsafe-identifier', 'A column name has characters that cannot be used safely and the column was left out.', { path: `${tname}.${cid.name.slice(0, 40)}` }))
      continue
    }
    let mt = mapType(typeText)
    let labels: string[] | undefined
    const inline = /^ENUM\s*\(/i.exec(typeText)
    if (inline) {
      const close = matchParen(typeText, typeText.indexOf('('), so)
      labels = close > 0 && /^(?:(?:CHARACTER\s+SET|CHARSET)\s+\w+)?$/i.test(typeText.slice(close + 1).trim()) ? enumLabels(typeText.slice(typeText.indexOf('(') + 1, close), so) : undefined
      if (labels) mt = { type: 'string', known: true, composite: false }
    } else {
      const tid = readIdent(typeText)
      if (tid && tid.rest.trim() === '' && enums.has(tid.name.toLowerCase())) {
        labels = enums.get(tid.name.toLowerCase())
        mt = { type: 'string', known: true, composite: false }
      }
    }
    if (mt.composite) push(gap('unsupported-type', 'A composite or array type is not supported; the column is exposed as text.', { path: `${tname}.${cid.name}` }))
    else if (!mt.known) push(gap('unknown-type', 'A column type was not recognised; string was used.', { severity: 'info', path: `${tname}.${cid.name}` }))
    const col: Col = { name: cid.name, type: mt.type, pk: /\bPRIMARY\s+KEY\b/i.test(masked) }
    if (/\bNOT\s+NULL\b/i.test(masked)) col.nullable = false
    if (/\bUNIQUE\b/i.test(masked)) col.unique = true
    if (labels) col.enum = labels
    const r = /\bREFERENCES\s+/i.exec(masked)
    if (r) {
      const target = readIdent(constraints.slice(r.index + r[0].length))
      const rc = target ? /^\s*\(([^)]*)\)/.exec(target.rest) : null
      if (target) col.ref = { table: target.name, column: rc ? identList(rc[1], so)?.[0] : undefined }
    }
    cols.push(col)
  }
  if (cols.length === 0) {
    push(gap('unparsable-table', 'No column could be read; the table was skipped.', { path: tname }))
    return undefined
  }
  if (cols.length > MAX_COLUMNS) {
    push(gap('unparsable-table', `The table has more than ${MAX_COLUMNS} columns and was skipped.`, { path: tname }))
    return undefined
  }
  const seen = new Set<string>()
  for (const c of cols) {
    if (seen.has(c.name.toLowerCase())) {
      push(gap('duplicate-column', 'A column name appears twice; the table was skipped.', { path: `${tname}.${c.name}` }))
      return undefined
    }
    seen.add(c.name.toLowerCase())
  }
  const declared = (n: string) => cols.find((c) => c.name.toLowerCase() === n.toLowerCase())?.name ?? n
  const pk = [...cols.filter((c) => c.pk).map((c) => c.name), ...tablePk.map(declared)].filter((n, i, a) => a.indexOf(n) === i)
  for (const n of pk) {
    if (!cols.some((c) => c.name === n)) {
      push(gap('unparsable-table', 'A primary key names a column that does not exist (or was left out); the table was skipped.', { path: tname }))
      return undefined
    }
  }
  for (const fk of fks) {
    const c = cols.find((x) => x.name.toLowerCase() === fk.column.toLowerCase())
    if (c) {
      fk.column = c.name
      c.ref = { table: fk.table, column: fk.ref }
    }
  }
  for (const u of tableUnique) {
    if (u.length === 1) {
      const c = cols.find((x) => x.name.toLowerCase() === u[0].toLowerCase())
      if (c) c.unique = true
    }
  }
  return { name: tname, cols, pk, fks }
}
