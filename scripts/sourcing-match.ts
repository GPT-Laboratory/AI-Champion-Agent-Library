// The product-sourcing-mbom helper (src/lib/sourcing/mbomCheck.ts): applies the skill's equality rules to the E-BOM
// lines and the catalog excerpt. Without a result it prints the reference result (match checks, per-line rows, M-BOM
// draft, open items); with a result.md it compares the agent's tables with it cell by cell. No network, no writes.
// Usage: npx tsx scripts/sourcing-match.ts <upload.txt> [result.md]
// Exit codes: 0 ok (and no mismatches), 1 mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { runCli } from '../src/lib/sourcing/mbomCheck.js'

export * from '../src/lib/sourcing/mbomCheck.js'

if (isMainModule(import.meta.url, process.argv[1])) {
  const [inFile, resFile] = [process.argv[2], process.argv[3]]
  if (!inFile) {
    console.error('usage: sourcing-match.ts <upload.txt> [result.md]')
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
