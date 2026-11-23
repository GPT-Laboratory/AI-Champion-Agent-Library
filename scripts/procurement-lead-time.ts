// Prints the procurement list with the precomputed columns (must_order_by, days_to_order, late_flag, soon_flag,
// status_class) from the deterministic helper src/lib/procurement/leadTime.ts. Input: `#` label lines, a line
// `as_of: YYYY-MM-DD`, a header with at least item_id,description,priority,status,required_date,lead_time_days,
// vendor,po_number (extra columns are ignored and recomputed) and one row per item. With a second argument
// (a result.md whose `## Lead time check` table is compared cell by cell with the helper). No network, no writes.
// Usage: npx tsx scripts/procurement-lead-time.ts <items.csv> [result.md]
// Exit codes: 0 ok (and no mismatches), 1 mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { runCli } from '../src/lib/procurement/resultCheck.js'

export * from '../src/lib/procurement/resultCheck.js'

if (isMainModule(import.meta.url, process.argv[1])) {
  const [inFile, resFile] = [process.argv[2], process.argv[3]]
  if (!inFile) {
    console.error('usage: procurement-lead-time.ts <items.csv> [result.md]')
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
