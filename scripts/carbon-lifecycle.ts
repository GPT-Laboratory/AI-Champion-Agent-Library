// Prints lifecycle carbon evidence for the carbon-epd-enrichment agent: the deterministic mapping, stage totals,
// A-C total and the option A vs B comparison, computed from the agent input (products + synthetic EPD excerpt).
// With a result.md the model's `## Per-product rows` table is checked cell by cell against the helper mapping
// (epd, declared unit, stage cells, flags, status) and the totals are also computed from the model's cells.
// No network, no writes. Usage: npx tsx scripts/carbon-lifecycle.ts <input.txt> [result.md] [--convert]
// Exit codes: 0 ok, 1 mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { runCli } from '../src/lib/carbon/resultCheck.js'

export * from '../src/lib/carbon/resultCheck.js'

if (isMainModule(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2)
  const convert = args.includes('--convert')
  const [inFile, resFile] = args.filter((a) => !a.startsWith('--'))
  if (!inFile) {
    console.error('usage: carbon-lifecycle.ts <input.txt> [result.md] [--convert]')
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
  const r = runCli(a, b, convert)
  if (r.code === 2) console.error(r.out)
  else console.log(r.out)
  process.exit(r.code)
}
