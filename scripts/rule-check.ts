// Checks a scope-rule-drafter result against its upload with the deterministic helper src/lib/rules/ruleCheck.ts:
// every `## RULES` line in the grammar ifc-ebom-compiler reads, its field an ELEMENTS column and its value present,
// one `## Sentence mapping` row per sentence, the sentences not turned into a rule listed exactly, and a dry run of
// which elements each rule would exclude. Without a result: the sentences and the values a rule may name.
// No network, no writes.
// Usage: npx tsx scripts/rule-check.ts <upload.txt> [result.md]
// Exit codes: 0 ok (and a valid result), 1 problems found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { runCli } from '../src/lib/rules/ruleCheck.js'

export * from '../src/lib/rules/ruleCheck.js'

if (isMainModule(import.meta.url, process.argv[1])) {
  const [inFile, resFile] = [process.argv[2], process.argv[3]]
  if (!inFile) {
    console.error('usage: rule-check.ts <upload.txt> [result.md]')
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
