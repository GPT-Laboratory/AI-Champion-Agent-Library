import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkRuleResult, dryRunSummary, parseRuleInput, parseRuleResult, runCli } from './ruleCheck'

const DIR = join(process.cwd(), 'data/tryitout-prompts/scope-rule-drafter')
const SAMPLE = readFileSync(join(DIR, 'sample-scope-rules.txt'), 'utf8')
const KEY = readFileSync(join(DIR, 'example-result.md'), 'utf8')
const problems = (result: string, input = SAMPLE) => checkRuleResult(input, result).problems

describe('parseRuleInput', () => {
  it('reads the sentences, the ELEMENTS columns and rows, and the ids of existing rules', () => {
    const i = parseRuleInput(`${SAMPLE}\n## RULES\nrules:1: system = X -> exclude (r)\nnot a rule\n`)
    expect(i.sentences.map((s) => s.id)).toEqual(['S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-6', 'S-7'])
    expect(i.elements).toHaveLength(11)
    expect(i.existingIds).toEqual(['rules:1', 'not a rule'])
  })

  it('rejects a missing section, a bad sentence line, a duplicate id and a ragged row', () => {
    const bad = (t: string) => checkRuleResult(t, KEY)
    expect(bad(SAMPLE.replace('## RULE TEXT', '## NOTES')).out).toBe('error: no "## RULE TEXT" section')
    expect(bad(SAMPLE.replace('S-4: Everything', 'Everything')).code).toBe(2)
    expect(bad(SAMPLE.replace('S-4:', 'S-3:')).out).toBe('error: RULE TEXT: S-3 appears twice')
    expect(bad(SAMPLE.replace('E-02,IfcDuctSegment', 'E-02,x,IfcDuctSegment')).out).toMatch(/ELEMENTS row 2 has 11 cells, expected 10/)
  })
})

describe('checkRuleResult', () => {
  it('the answer key is valid; the dry run uses the class step matching', () => {
    const r = checkRuleResult(SAMPLE, KEY)
    expect(r.problems).toEqual([])
    expect(r.code).toBe(0)
    expect(r.dryRun).toEqual([
      { rule: 'text:1', field: 'system', value: 'SYN-SPRINKLER', excludes: ['E-06'] },
      { rule: 'text:2', field: 'type_name', value: 'Temporary duct', excludes: ['E-05'] },
    ])
    expect(dryRunSummary(r.dryRun)).toBe('2 rules, all valid: text:1 excludes E-06; text:2 excludes E-05')
    expect(r.out).toContain('| text:1 | system | SYN-SPRINKLER | E-06 |')
  })

  it('a shortened value matches nothing; an invented field is not a column', () => {
    expect(problems(KEY.split('SYN-SPRINKLER').join('SPRINKLER'))).toEqual(['text:1: no element has system = "SPRINKLER" (the rule matches nothing)'])
    expect(problems(KEY.split('| system |').join('| contractor |').replace('= SYN', '= SYN').replace('text:1: system', 'text:1: contractor'))).toContain(
      'text:1: field "contractor" is not an ELEMENTS column',
    )
  })

  it('the cold-water trap is valid for the tool (the key and the judge catch it)', () => {
    const trap = KEY.replace(
      'text:2: type_name',
      'text:3: system = COLD-WATER-1 -> exclude (S-3: Insulation of cold-water pipes is billed by the insulation contractor.)\ntext:2: type_name',
    )
    expect(problems(trap)).toContain('rule line 2: id is "text:3", expected "text:2" (numbered in order)')
  })

  it('grammar, ids, reasons and the mapping are checked', () => {
    expect(problems(KEY.replace('-> exclude (S-1', '-> drop (S-1'))[0]).toMatch(/^rule line 1 is not "<id>: <field> = <value> -> exclude \(<reason>\)"/)
    expect(problems(KEY.replace('text:1: system', 'rules:1: system'))).toContain('rule line 1: id is "rules:1", expected "text:1" (numbered in order)')
    expect(problems(KEY.replace('(S-1: Sprinkler', '(Sprinkler'))).toContain('text:1: the reason must start with the sentence id, e.g. "(S-1: ...)"')
    expect(problems(KEY.replace('| S-4 | not-a-rule | - | - | - | no-field-value |\n', ''))).toContain(
      'mapping rows are S-1, S-2, S-3, S-5, S-6, S-7; expected one per sentence in input order: S-1, S-2, S-3, S-4, S-5, S-6, S-7',
    )
    expect(problems(KEY.replace('| S-6 | not-a-rule | - | - | - | not-an-exclusion |', '| S-6 | not-a-rule | - | - | - | requirement |'))).toContain(
      'S-6: reason "requirement" is not one of no-field-value, more-than-one-condition, not-about-elements, not-an-exclusion',
    )
    expect(problems(KEY.replace('| S-2 | rule | text:2 | type_name | Temporary duct | - |', '| S-2 | rule | text:2 | type_name | Round duct | - |'))).toContain(
      'S-2: field and value "type_name = Round duct" differ from text:2 ("type_name = Temporary duct")',
    )
    expect(problems(KEY.replace('S-4: Everything in the shaft belongs to the shaft contractor.\n', ''))[0]).toMatch(/must list the not-a-rule sentences copied exactly/)
  })

  it('an id the upload already has is reported', () => {
    expect(problems(KEY, SAMPLE.replace('## BLOCKS', '## RULES\ntext:1: system = X -> exclude (old)\n## BLOCKS'))).toContain('text:1: the upload already has a rule with this id')
  })

  it('no rules at all: "none" in RULES and every sentence explained', () => {
    const input = '## RULE TEXT\nS-1: All ducts must be clean.\n## ELEMENTS\ntoken,ifc_class,type_name,system,size_mm,geom_family,stated_length_m,geom_centreline_m,geom_check,loc_block\nE-1,IfcDuctSegment,Round duct,A,100,straight,1,1,agree,K1'
    const result = '## RULES\nnone\n\n## Sentence mapping\n| sentence | outcome | rule | field | value | reason |\n|---|---|---|---|---|---|\n| S-1 | not-a-rule | - | - | - | not-an-exclusion |\n\n## Sentences not turned into a rule\nS-1: All ducts must be clean.\n\nDraft.'
    const r = checkRuleResult(input, result)
    expect(r.problems).toEqual([])
    expect(dryRunSummary(r.dryRun)).toBe('no rules; every sentence is explained')
  })

  it('without a result: the sentences and the values a rule may name; unreadable results are code 2', () => {
    const r = runCli(SAMPLE)
    expect(r.code).toBe(0)
    expect(r.out).toContain('system: EXHAUST-2 | SYN-SPRINKLER | COLD-WATER-1')
    expect(r.out).not.toMatch(/^token:/m)
    expect(runCli(SAMPLE, 'prose only').out).toBe('error: no `## RULES` section in the result')
    expect(() => parseRuleResult('## RULES\nnone\n## Sentence mapping\nno table')).toThrow('no table found under `## Sentence mapping`')
  })
})
