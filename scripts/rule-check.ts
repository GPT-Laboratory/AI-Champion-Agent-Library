// Checks a scope-rule-drafter result against its input with the deterministic helper src/lib/rules/ruleCheck.ts:
// every `## RULES` line in the grammar ifc-ebom-compiler reads, its field an ELEMENTS column and its value present,
// one `## Sentence mapping` row per sentence, the sentences not turned into a rule listed exactly, and a dry run of
// which elements each rule would exclude. Without a result: the rules and the values a rule may name.
// The rules are the lines of the task text (--task, as typed in the task box), or a `## RULE TEXT` section of the
// upload. No network, no writes.
// Usage: npx tsx scripts/rule-check.ts <upload.txt> [result.md] [--task <task.txt>]
//        npx tsx scripts/rule-check.ts <upload.txt> --prepare   (the tool step before the run: adds ## VALUES)
// Exit codes: 0 ok (and a valid result), 1 problems found, 2 usage or validation error.
import { readFileSync } from 'node:fs'
import { isMainModule } from './is-main.js'
import { prepareRuleUpload, runCli } from '../src/lib/rules/ruleCheck.js'

export * from '../src/lib/rules/ruleCheck.js'

if (isMainModule(import.meta.url, process.argv[1])) {
  const all = process.argv.slice(2)
  const prepare = all.includes('--prepare')
  const args = all.filter((a) => a !== '--prepare')
  const t = args.indexOf('--task')
  const taskFile = t >= 0 ? args[t + 1] : undefined
  const [inFile, resFile] = args.filter((_, i) => t < 0 || (i !== t && i !== t + 1))
  if (!inFile || (t >= 0 && !taskFile)) {
    console.error('usage: rule-check.ts <upload.txt> [result.md] [--task <task.txt>]')
    process.exit(2)
  }
  let a: string
  let b: string | undefined
  let task: string | undefined
  try {
    a = readFileSync(inFile, 'utf8')
    b = resFile ? readFileSync(resFile, 'utf8') : undefined
    task = taskFile ? readFileSync(taskFile, 'utf8') : undefined
  } catch (e) {
    console.error(`error: cannot read file: ${(e as Error).message}`)
    process.exit(2)
  }
  if (prepare) {
    const p = prepareRuleUpload(a)
    if (!p) {
      console.error('error: the upload has no ## ELEMENTS section with a header')
      process.exit(2)
    }
    process.stdout.write(p.text)
    process.exit(0)
  }
  const r = runCli(a, b, task)
  if (r.code === 2) console.error(r.out)
  else console.log(r.out)
  process.exit(r.code)
}
