// Cheap structural dialect detection for the sql-ddl adapter. Markers only, no guessing: when
// markers of two dialects are present the input stays "generic" and the ambiguity is reported.
import type { ScanOpts } from './sql-scan.js'

export type Dialect = 'generic' | 'postgres' | 'mysql' | 'sqlite'

const MARKERS: Record<Exclude<Dialect, 'generic'>, RegExp[]> = {
  postgres: [
    /\bpg_catalog\b/i,
    /PostgreSQL database dump/i,
    /\bALTER\s+TABLE\s+ONLY\b/i,
    /\bOWNER\s+TO\b/i,
    /\bCREATE\s+SEQUENCE\b/i,
    /\bCREATE\s+TYPE\s+[^;]{0,200}\bAS\s+ENUM\b/i,
    /\bSET\s+(?:statement_timeout|client_encoding|search_path|lock_timeout|default_tablespace)\b/i,
    /::\s*(?:text|regclass|integer|bigint|character\s+varying|numeric)\b/i,
    /\bnextval\s*\(/i,
  ],
  mysql: [/\bENGINE\s*=/i, /\bAUTO_INCREMENT\b/i, /\/\*!\d{5}/, /MySQL dump/i, /\bUNIQUE\s+KEY\b/i, /\bLOCK\s+TABLES\b/i, /\bDEFAULT\s+CHARSET\s*=/i],
  sqlite: [/\bAUTOINCREMENT\b/i, /\bWITHOUT\s+ROWID\b/i, /\bsqlite_sequence\b/i, /\)\s*STRICT\s*(?:;|,|$)/im, /\bPRAGMA\b/i],
}

export const DIALECT_LABEL: Record<Dialect, string> = {
  generic: 'generic SQL',
  postgres: 'PostgreSQL (pg_dump)',
  mysql: 'MySQL (mysqldump)',
  sqlite: 'SQLite (.schema or .dump)',
}

export function detectDialect(text: string, opts: { hasCopy?: boolean } = {}): { dialect: Dialect; ambiguous: Dialect[] } {
  const hit: Dialect[] = []
  for (const d of ['postgres', 'mysql', 'sqlite'] as const) {
    if (MARKERS[d].some((re) => re.test(text)) || (d === 'postgres' && opts.hasCopy)) hit.push(d)
  }
  if (hit.length === 1) return { dialect: hit[0], ambiguous: [] }
  if (hit.length > 1) return { dialect: 'generic', ambiguous: hit }
  return { dialect: 'generic', ambiguous: [] }
}

export function scanOptsFor(d: Dialect): ScanOpts {
  if (d === 'postgres') return { brackets: false, backslash: false }
  if (d === 'mysql') return { brackets: false, backslash: true, mysqlComments: true }
  return { brackets: true, backslash: false }
}

/** A Prisma schema has `model Name {` at the start of a line. */
export function looksLikePrisma(text: string): boolean {
  return /^[ \t]*model[ \t]+[A-Za-z_]\w*[ \t]*\{/m.test(text)
}
