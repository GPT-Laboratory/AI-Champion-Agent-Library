/**
 * E6 (D-401): a fresh checkout before `npm run db:push` has a database file with no tables.
 * SQLite reports that as "no such table: agents"; the catalog treats it as an empty catalog.
 */
export function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return /no such table/i.test(msg)
}
