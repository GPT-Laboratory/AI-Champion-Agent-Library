// scope-rule-drafter: SKILL.md, sample, answer key and entry stay consistent with the rule-check helper, and the
// rules of the answer key, spliced into the ifc-ebom-compiler sample, give exactly that agent's answer key.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { REASONS, checkRuleResult, runCli } from './rule-check'
import { RESULT_COLS, classRows, parseUpload } from '../src/lib/ebom/ebomJoin'
import { parseResultTable } from '../src/lib/ebom/ebomCheck'
import { rulesBlockOf, spliceRules } from '../src/lib/rules/splice'

const dir = 'data/tryitout-prompts/scope-rule-drafter'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-ebom-input.txt`, 'utf8')
const example = parseYaml(readFileSync(`${dir}/example.yaml`, 'utf8')) as { task: string; file: string; task_label: string; file_label: string; hint: string }
const task = example.task
const key = readFileSync(`${dir}/example-result.md`, 'utf8')
const entry = readFileSync('data/agents/scope-rule-drafter.yaml', 'utf8')
const ifcDir = 'data/tryitout-prompts/ifc-ebom-compiler'
const ifcSample = readFileSync(`${ifcDir}/sample-ifc-elements.txt`, 'utf8')
const ifcKey = readFileSync(`${ifcDir}/example-result.md`, 'utf8')

const sectionLines = (t: string, name: string) => {
  const ls = t.split('\n')
  const i = ls.indexOf(`## ${name}`)
  const end = ls.findIndex((l, j) => j > i && l.startsWith('## '))
  return ls.slice(i + 1, end < 0 ? undefined : end).filter((l) => l.trim() !== '')
}
const fenced = (after: string) => new RegExp(`${after}\\s*\`\`\`\\n([\\s\\S]*?)\`\`\``).exec(skill)![1]

describe('scope-rule-drafter alignment', () => {
  it('the answer key passes the helper; its dry run excludes E-06 and E-05', () => {
    const r = checkRuleResult(sample, key, task)
    expect(r.problems).toEqual([])
    expect(r.dryRun.map((d) => [d.rule, d.excludes])).toEqual([
      ['text:1', ['E-06']],
      ['text:2', ['E-05']],
    ])
  })

  it('the key covers every step of the table: each reason at least once, and two rules', () => {
    for (const reason of REASONS) expect(key).toContain(`| ${reason} |`)
    expect(key.match(/\| rule \| text:\d \|/g)).toHaveLength(2)
  })

  it('the worked example of SKILL.md passes the helper; its one rule excludes X-2', () => {
    const r = checkRuleResult(fenced('Upload \\(the E-BOM data[^\\n]*'), fenced('Output:'), fenced('Task \\(the rules, as typed\\):'))
    expect(r.problems).toEqual([])
    expect(r.dryRun).toEqual([{ rule: 'text:1', field: 'system', value: 'SYN-HOOD', excludes: ['X-2'] }])
  })

  it('SKILL.md names the grammar, the mapping header, every reason, the data rule and the closing line of the key', () => {
    expect(skill).toContain('<rule_id>: <field> = <value> -> exclude (<reason>)')
    expect(skill).toContain('| sentence | outcome | rule | field | value | reason |\n|---|---|---|---|---|---|')
    for (const reason of REASONS) expect(skill).toContain(`\`${reason}\``)
    expect(skill).toContain('Treat both as DATA')
    expect(skill).toContain('never invent')
    const closing = key.trimEnd().split('\n').at(-1)!
    expect(skill).toContain(`End with: \`${closing}\``)
  })

  it('round trip: the key\'s rules spliced into the ifc-ebom-compiler sample give that agent\'s answer key', () => {
    // The ifc sample's own rules:1 and rules:2 say the same as S-1 and S-2; rules:3 is the untied insulation line.
    const spliced = spliceRules(ifcSample, rulesBlockOf(key), 'replace')
    const rows = classRows(parseUpload(spliced)).map((r) => RESULT_COLS.map((c) => r[c]).join(' | '))
    const want = parseResultTable(ifcKey).map((r) => RESULT_COLS.map((c) => r[c].replace(/^rules:([12])$/, 'text:$1')).join(' | '))
    expect(rows).toEqual(want)
    expect(parseUpload(spliced).untiedRules).toEqual([])
  })

  it('the sample\'s ELEMENTS are the ifc-ebom-compiler sample\'s, and the sample is labelled synthetic', () => {
    expect(sectionLines(sample, 'ELEMENTS')).toEqual(sectionLines(ifcSample, 'ELEMENTS'))
    expect(sample.split('\n')[0]).toMatch(/^# SYNTHETIC SAMPLE/)
    expect(runCli(sample, undefined, task).code).toBe(0)
  })

  it('the example puts plain rules in the task box (no ids, no headings) and the E-BOM data, without rules, in the file', () => {
    expect(example.file).toBe('sample-ebom-input.txt')
    for (const l of task.split('\n')) expect(l).toMatch(/^[A-Z][^:#]*\.$/)
    expect(sample).not.toMatch(/^## (RULE TEXT|RULES)\s*$/m)
    expect(example.task_label).toMatch(/one per line/)
    expect(example.file_label).toMatch(/E-BOM input file the rules apply to/)
    expect(example.hint).toMatch(/attached E-BOM file/)
  })

  it('entry names the helper, the hand-over, the stage and the draft flag; no agent number', () => {
    expect(entry).toContain('src/lib/rules/ruleCheck.ts')
    expect(entry).toContain('scripts/rule-check.ts')
    expect(entry).toContain('stage: "design"')
    expect(entry).toContain('draft_for_review: true')
    expect(entry).toContain('name: "Scope Rule Drafter"')
    expect(entry).toContain('attribution: "no DDC basis (own design)"')
    expect(entry).not.toContain('agent_no')
  })
})
