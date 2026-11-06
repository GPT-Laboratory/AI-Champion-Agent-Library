// Pattern groups and findings table for the clash-prioritization hand-off (runs after the Try It Out step).
// Reads the input clash CSV and the agent's result.md (per-clash table), prints `## Pattern groups` and
// `## Findings for RFI drafting`. No network, no writes.
// Usage: npx tsx scripts/clash-patterns.ts <clash-report.csv> <result.md>
// Exit codes: 0 ok, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import {
  ClashParseError,
  buildFindings,
  formatReport,
  parseClashCsv,
  parseClassifiedTable,
} from '../src/lib/clash/clashPatterns.js'

export function runCli(csvText: string, resultText: string): { code: number; out: string } {
  try {
    const { groups, findings } = buildFindings(parseClashCsv(csvText), parseClassifiedTable(resultText))
    return { code: 0, out: formatReport(groups, findings) }
  } catch (e) {
    if (e instanceof ClashParseError) return { code: 2, out: `error: ${e.message}` }
    throw e
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const [csv, res] = process.argv.slice(2)
  if (!csv || !res) {
    console.error('usage: clash-patterns.ts <clash-report.csv> <result.md>')
    process.exit(2)
  }
  let a: string
  let b: string
  try {
    a = readFileSync(csv, 'utf8')
    b = readFileSync(res, 'utf8')
  } catch (e) {
    console.error(`error: cannot read input: ${(e as Error).message}`)
    process.exit(2)
  }
  const r = runCli(a, b)
  if (r.code === 0) console.log(r.out)
  else console.error(r.out)
  process.exit(r.code)
}
