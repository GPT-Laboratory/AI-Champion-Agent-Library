// Prints the warranty register with the precomputed columns (end_date_expected, dates_consistent, days_remaining,
// status_class, document_present, contact_present, coverage_present) from the deterministic helper
// src/lib/warranty/warrantyStatus.ts. Input: `#` label lines, a line `as_of: YYYY-MM-DD`, a header with at least
// warranty_id,item,system,warranty_type,start_date,end_date,duration_years,documents,contact,coverage (extra
// columns are ignored and recomputed) and one row per warranty. With a second argument (a result.md whose
// `## Warranty register check` table is compared cell by cell with the helper). No network, no writes.
// Usage: npx tsx scripts/warranty-status.ts <register.csv> [result.md]
// Exit codes: 0 ok (and no mismatches), 1 mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { runCli } from '../src/lib/warranty/resultCheck.js'

export * from '../src/lib/warranty/resultCheck.js'

if (isMainModule(import.meta.url, process.argv[1])) {
  const [inFile, resFile] = [process.argv[2], process.argv[3]]
  if (!inFile) {
    console.error('usage: warranty-status.ts <register.csv> [result.md]')
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
  const r = runCli(a, b)
  if (r.code === 2) console.error(r.out)
  else console.log(r.out)
  process.exit(r.code)
}
