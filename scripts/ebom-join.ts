// The tool step after the ifc-ebom-compiler agent (deterministic helper src/lib/ebom/ebomJoin.ts). Input: the upload of
// data/tryitout-prompts/ifc-ebom-compiler/ (## BLOCKS, ## CATALOGUE, ## RULES, ## ELEMENTS).
// - Without a result: prints the helper's own class rows (the SKILL.md step table), review items and E-BOM lines.
// - With a result.md: checks the agent's `## E-BOM class rows` against the contract (every element exactly one
//   outcome, catalogue names, positive quantities, known blocks), compares them cell by cell with the helper and
//   prints the E-BOM lines joined from the AGENT's billed rows.
// Lines: billed metres and pieces per block x designation, metres rounded up to whole sticks (--stick-m, default 3;
// 0 = no rounding). No network, no writes.
// The app runs the same check after every Try It Out job of the agent (docs/tryitout-post-run-check.md).
// Usage: npx tsx scripts/ebom-join.ts <upload.txt> [result.md] [--stick-m <metres>]
// Exit codes: 0 ok (and no problems or mismatches), 1 problems or mismatches found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { checkEbomResult } from '../src/lib/ebom/ebomCheck.js'

// The parser and the check live in src/lib/ebom/ebomCheck.ts, so the app's post-run check runs the same code.
export { ParseError, parseResultTable, formatLines } from '../src/lib/ebom/ebomCheck.js'

export function runCli(inputText: string, resultText?: string, stickM = '3'): { code: number; out: string } {
  const { code, out } = checkEbomResult(inputText, resultText, stickM)
  return { code, out }
}

export function parseArgs(argv: string[]): { files: string[]; stickM: string } | null {
  const files: string[] = []
  let stickM = '3'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--stick-m') {
      const v = argv[++i]
      if (v === undefined) return null
      stickM = v
    } else if (argv[i].startsWith('--')) return null
    else files.push(argv[i])
  }
  return files.length >= 1 && files.length <= 2 ? { files, stickM } : null
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    console.error('usage: ebom-join.ts <upload.txt> [result.md] [--stick-m <metres>]')
    process.exit(2)
  }
  let a: string
  let b: string | undefined
  try {
    a = readFileSync(args.files[0], 'utf8')
    b = args.files[1] ? readFileSync(args.files[1], 'utf8') : undefined
  } catch (e) {
    console.error(`error: cannot read file: ${(e as Error).message}`)
    process.exit(2)
  }
  const r = runCli(a, b, args.stickM)
  if (r.code === 2) console.error(r.out)
  else console.log(r.out)
  process.exit(r.code)
}
