import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'
import { checkRuleResult, dryRunSummary, hasExclusionWording, namesValue, parseRuleInput, parseRuleResult, ruleLines, runCli } from './ruleCheck'

const DIR = join(process.cwd(), 'data/tryitout-prompts/scope-rule-drafter')
const SAMPLE = readFileSync(join(DIR, 'sample-ebom-input.txt'), 'utf8')
const KEY = readFileSync(join(DIR, 'example-result.md'), 'utf8')
const TASK = (parseYaml(readFileSync(join(DIR, 'example.yaml'), 'utf8')) as { task: string }).task
const problems = (result: string, input = SAMPLE, task = TASK) => checkRuleResult(input, result, task).problems

describe('ruleLines', () => {
  it('one rule per non-empty line; bullets, S-numbers, # lines and a lead-in ending with ":" are dropped', () => {
    expect(ruleLines('Rules for this job:\n- Exclude all sprinkler elements.\n\n  2) Round ducts are not part of this contract.\n# note\nS-9: Kitchen ducts are excluded.')).toEqual([
      { id: 'S-1', text: 'Exclude all sprinkler elements.' },
      { id: 'S-2', text: 'Round ducts are not part of this contract.' },
      { id: 'S-3', text: 'Kitchen ducts are excluded.' },
    ])
  })
})

describe('parseRuleInput', () => {
  it('rules from the task box; data from the upload; ids of the upload\'s own rules', () => {
    const i = parseRuleInput(`${SAMPLE}\n## RULES\nrules:1: system = X -> exclude (r)\n`, TASK)
    expect(i.sentences.map((s) => s.id)).toEqual(['S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-6'])
    expect(i.sentences[0].text).toBe('Sprinkler piping is delivered by the sprinkler contractor.')
    expect(i.elements).toHaveLength(11)
    expect(i.existingIds).toEqual(['rules:1'])
  })

  it('a ## RULE TEXT section of the upload supplies the rules instead (not advertised, still read)', () => {
    const i = parseRuleInput(`## RULE TEXT\nS-1: Exclude all sprinkler elements.\n${SAMPLE}`, 'ignored when the upload has RULE TEXT')
    expect(i.sentences).toEqual([{ id: 'S-1', text: 'Exclude all sprinkler elements.' }])
    // With no upload, the task is the data; then the rules must be in its RULE TEXT section.
    expect(parseRuleInput(`## RULE TEXT\nExclude all sprinkler elements.\n${SAMPLE}`).sentences).toHaveLength(1)
  })

  it('no rules, no ELEMENTS or a ragged row are reported as unreadable (code 2)', () => {
    expect(checkRuleResult(SAMPLE, KEY).out).toBe('error: no rules: type them in the task box, one per line, and attach the E-BOM data as the file')
    expect(checkRuleResult(SAMPLE, KEY, SAMPLE).code).toBe(2) // the task is the data, so it cannot be the rules
    expect(checkRuleResult(SAMPLE, KEY, 'Rules:\n\n').out).toBe('error: no rules: the task box has no rule line')
    expect(checkRuleResult('just text', KEY, TASK).out).toBe('error: no "## ELEMENTS" section with a header in the attached data')
    expect(checkRuleResult(SAMPLE.replace('E-02,IfcDuctSegment', 'E-02,x,IfcDuctSegment'), KEY, TASK).out).toMatch(/ELEMENTS row 2 has 11 cells, expected 10/)
  })
})

describe('checkRuleResult', () => {
  it('the answer key is valid; the dry run uses the class step matching', () => {
    const r = checkRuleResult(SAMPLE, KEY, TASK)
    expect(r.problems).toEqual([])
    expect(r.code).toBe(0)
    expect(r.dryRun).toEqual([
      { rule: 'text:1', field: 'system', value: 'SYN-SPRINKLER', excludes: ['E-06'] },
      { rule: 'text:2', field: 'type_name', value: 'Temporary duct', excludes: ['E-05'] },
    ])
    expect(dryRunSummary(r.dryRun)).toBe('2 rules, all valid: text:1 excludes E-06; text:2 excludes E-05')
    expect(r.out).toContain('| text:1 | system | SYN-SPRINKLER | E-06 |')
  })

  it('your own two lines: both become rules, and the dry run shows what they remove', () => {
    const task = 'Exclude all sprinkler elements.\nRound ducts are not part of this contract.'
    const result = [
      '## RULES',
      'text:1: system = SYN-SPRINKLER -> exclude (S-1: Exclude all sprinkler elements.)',
      'text:2: type_name = Round duct -> exclude (S-2: Round ducts are not part of this contract.)',
      '## Sentence mapping',
      '| sentence | outcome | rule | field | value | reason |',
      '|---|---|---|---|---|---|',
      '| S-1 | rule | text:1 | system | SYN-SPRINKLER | - |',
      '| S-2 | rule | text:2 | type_name | Round duct | - |',
      '## Sentences not turned into a rule',
      'none',
    ].join('\n')
    const r = checkRuleResult(SAMPLE, result, task)
    expect(r.problems).toEqual([])
    expect(dryRunSummary(r.dryRun)).toBe('2 rules, all valid: text:1 excludes E-06; text:2 excludes E-01, E-02, E-09')
  })

  it('a shortened value matches nothing; an invented field is not a column', () => {
    expect(problems(KEY.split('SYN-SPRINKLER').join('SPRINKLER'))).toEqual(['text:1: no element has system = "SPRINKLER" (the rule matches nothing)'])
    expect(problems(KEY.replace('text:1: system', 'text:1: contractor').replace('| system |', '| contractor |'))).toContain('text:1: field "contractor" is not an ELEMENTS column')
  })

  it('grammar, ids, reasons, the mapping and the unturned list are checked', () => {
    expect(problems(KEY.replace('-> exclude (S-1', '-> drop (S-1'))[0]).toMatch(/^rule line 1 is not "<id>: <field> = <value> -> exclude \(<reason>\)"/)
    expect(problems(KEY.replace('text:1: system', 'rules:1: system'))).toContain('rule line 1: id is "rules:1", expected "text:1" (numbered in order)')
    expect(problems(KEY.replace('(S-1: Sprinkler', '(Sprinkler'))).toContain('text:1: the reason must start with the sentence id, e.g. "(S-1: ...)"')
    expect(problems(KEY.replace('| S-4 | not-a-rule | - | - | - | more-than-one-condition |\n', ''))).toContain(
      'mapping rows are S-1, S-2, S-3, S-5, S-6; expected one per sentence in input order: S-1, S-2, S-3, S-4, S-5, S-6',
    )
    expect(problems(KEY.replace('| S-5 | not-a-rule | - | - | - | not-an-exclusion |', '| S-5 | not-a-rule | - | - | - | requirement |'))).toContain(
      'S-5: reason "requirement" is not one of no-field-value, more-than-one-condition, not-about-elements, not-an-exclusion',
    )
    expect(problems(KEY.replace('| S-2 | rule | text:2 | type_name | Temporary duct | - |', '| S-2 | rule | text:2 | type_name | Round duct | - |'))).toContain(
      'S-2: field and value "type_name = Round duct" differ from text:2 ("type_name = Temporary duct")',
    )
    expect(problems(KEY.replace('S-4: Exhaust valves in the basement storage rooms are supplied by the owner.\n', ''))[0]).toMatch(/must list the not-a-rule sentences copied exactly/)
  })

  it('a rule id the upload already has is reported', () => {
    expect(problems(KEY, SAMPLE.replace('## ELEMENTS', '## RULES\ntext:1: system = X -> exclude (old)\n## ELEMENTS'))).toContain('text:1: the upload already has a rule with this id')
  })

  it('no rules at all: "none" in RULES and every sentence explained', () => {
    const result = '## RULES\nnone\n\n## Sentence mapping\n| sentence | outcome | rule | field | value | reason |\n|---|---|---|---|---|---|\n| S-1 | not-a-rule | - | - | - | not-an-exclusion |\n\n## Sentences not turned into a rule\nS-1: All ducts must be clean.\n\nDraft.'
    const r = checkRuleResult(SAMPLE, result, 'All ducts must be clean.')
    expect(r.problems).toEqual([])
    expect(dryRunSummary(r.dryRun)).toBe('no rules; every sentence is explained')
  })

  it('without a result: the rules and the values a rule may name; an unreadable result is code 2', () => {
    const r = runCli(SAMPLE, undefined, TASK)
    expect(r.code).toBe(0)
    expect(r.out).toContain('S-6: Kitchen hood ducts are delivered by the kitchen supplier.')
    expect(r.out).toContain('system: EXHAUST-2 | SYN-SPRINKLER | COLD-WATER-1')
    expect(r.out).not.toMatch(/^token:/m)
    expect(runCli(SAMPLE, 'prose only', TASK).out).toBe('error: no `## RULES` section in the result')
    expect(() => parseRuleResult('## RULES\nnone\n## Sentence mapping\nno table')).toThrow('no table found under `## Sentence mapping`')
  })
})

describe('exclusion wording and naming (the skill\'s step 1 and naming rule, checked on the notes)', () => {
  it('exclusion wordings: someone else delivers or owns it, or it is outside the contract; requirements are not', () => {
    for (const n of [
      'Sprinkler piping is delivered by the sprinkler contractor.',
      'All IfcAirTerminal elements come from a separate contractor.',
      'Everything in the shaft belongs to the shaft contractor.',
      'Temporary ducts are not part of this contract.',
      'Kitchen ducts are outside our scope.',
      'Exclude all sprinkler elements.',
    ]) expect(hasExclusionWording(n), n).toBe(true)
    for (const n of ['All round ducts must be spiral-seamed.', 'Copper pipes shall be pressure tested.', 'Note the new valve supplier.']) expect(hasExclusionWording(n), n).toBe(false)
  })

  it('a value is named only when it appears in the note itself', () => {
    expect(namesValue('Sprinkler piping is delivered by the sprinkler contractor.', 'SYN-SPRINKLER')).toBe(true)
    expect(namesValue('Temporary ducts are not part of this contract.', 'Temporary duct')).toBe(true)
    expect(namesValue('All IfcAirTerminal elements come from a separate contractor.', 'IfcAirTerminal')).toBe(true)
    expect(namesValue('Exhaust valves are supplied by the owner.', 'Exhaust valve')).toBe(true)
    expect(namesValue('Exhaust valves are supplied by the owner.', 'IfcAirTerminal')).toBe(false) // the class is not named
    expect(namesValue('Insulation of cold-water pipes is billed by the insulation contractor.', 'COLD-WATER-1')).toBe(false)
    expect(namesValue('Round ductwork is excluded.', 'Round duct')).toBe(false) // whole words only
  })

  it('the rules from the live run that went wrong are flagged; the right ones pass', () => {
    const notes = TASK
    const rules = [
      ['S-1', 'system', 'SYN-SPRINKLER'],
      ['S-2', 'type_name', 'Temporary duct'],
      ['S-3', 'system', 'SYN-SPRINKLER'],
      ['S-4', 'ifc_class', 'IfcAirTerminal'],
      ['S-5', 'type_name', 'Round duct'],
    ] as const
    const sentence = (id: string) => ruleLines(notes).find((x) => x.id === id)!.text
    const result = [
      '## RULES',
      ...rules.map(([s, f, v], i) => `text:${i + 1}: ${f} = ${v} -> exclude (${s}: ${sentence(s)})`),
      '## Sentence mapping',
      '| sentence | outcome | rule | field | value | reason |',
      '|---|---|---|---|---|---|',
      ...rules.map(([s, f, v], i) => `| ${s} | rule | text:${i + 1} | ${f} | ${v} | - |`),
      '| S-6 | not-a-rule | - | - | - | no-field-value |',
      '## Sentences not turned into a rule',
      `S-6: ${sentence('S-6')}`,
    ].join('\n')
    const p = checkRuleResult(SAMPLE, result, notes).problems
    expect(p).toContain('S-3: the note does not name "SYN-SPRINKLER"; a rule\'s value must appear in its note')
    expect(p).toContain('S-4: the note does not name "IfcAirTerminal"; a rule\'s value must appear in its note')
    expect(p).toContain('S-5: made a rule, but the note has no exclusion wording (a requirement or remark is not-an-exclusion)')
    expect(p.filter((x) => /^S-[12]:/.test(x))).toEqual([])
  })

  it('your added note becomes a valid rule; calling a note with an exclusion wording not-an-exclusion is flagged', () => {
    const notes = 'All IfcAirTerminal elements come from a separate contractor.'
    const ok = [
      '## RULES',
      `text:1: ifc_class = IfcAirTerminal -> exclude (S-1: ${notes})`,
      '## Sentence mapping',
      '| sentence | outcome | rule | field | value | reason |',
      '|---|---|---|---|---|---|',
      '| S-1 | rule | text:1 | ifc_class | IfcAirTerminal | - |',
      '## Sentences not turned into a rule',
      'none',
    ].join('\n')
    const r = checkRuleResult(SAMPLE, ok, notes)
    expect(r.problems).toEqual([])
    expect(dryRunSummary(r.dryRun)).toBe('1 rule, all valid: text:1 excludes E-10')
    const wrong = ['## RULES', 'none', '## Sentence mapping', '| sentence | outcome | rule | field | value | reason |', '|---|---|---|---|---|---|',
      '| S-1 | not-a-rule | - | - | - | not-an-exclusion |', '## Sentences not turned into a rule', `S-1: ${notes}`].join('\n')
    expect(checkRuleResult(SAMPLE, wrong, notes).problems).toEqual(['S-1: the note has an exclusion wording, so it is not not-an-exclusion'])
  })
})
