// Prints binding and threshold status for the bms-digital-twin agent input (points with readings, assets, tag hints with
// synthetic limits). With a result.md the model's `## Point mapping` table is checked cell by cell against the helper
// (asset, tag, unit, reading, low, high, binding, review); the model's status cell must be `to compute (tool)`.
// No network, no writes. Usage: npx tsx scripts/bms-point-status.ts <input.txt> [result.md]
// Exit codes: 0 ok, 1 mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { runCli } from '../src/lib/bms/resultCheck.js'

export * from '../src/lib/bms/resultCheck.js'

if (isMainModule(import.meta.url, process.argv[1])) {
  const [inFile, resFile] = process.argv.slice(2)
  if (!inFile) {
    console.error('usage: bms-point-status.ts <input.txt> [result.md]')
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
