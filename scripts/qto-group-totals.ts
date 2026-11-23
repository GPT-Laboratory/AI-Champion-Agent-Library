// Prints grouped QTO totals (by group and by level) for harness evidence. Reads the agent input CSV
// (`row_id,group,description,quantity,unit,level`, `#` lines before the header are labels) and optionally a
// result.md whose `## Normalised rows` table is checked cell by cell against the deterministic helper.
// No network, no writes. Usage: npx tsx scripts/qto-group-totals.ts <input.csv> [result.md]
// Exit codes: 0 ok (and no mismatches), 1 mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { runCli } from '../src/lib/qto/resultCheck.js'

export * from '../src/lib/qto/resultCheck.js'

if (isMainModule(import.meta.url, process.argv[1])) {
  const [inFile, resFile] = [process.argv[2], process.argv[3]]
  if (!inFile) {
    console.error('usage: qto-group-totals.ts <input.csv> [result.md]')
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
