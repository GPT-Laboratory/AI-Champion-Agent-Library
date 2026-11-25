import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkSourcingResult, matchLines, parseSourcingInput, referenceResult, runCli, sourcingSummary } from './mbomCheck'
import { sourcingInput } from '$lib/pipeline/rulesToMbom'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const DIR = 'data/tryitout-prompts/product-sourcing-mbom'
const SAMPLE = read(`${DIR}/sample-ebom-catalog.txt`)
const KEY = read(`${DIR}/example-result.md`)
const SKILL = read(`${DIR}/SKILL.md`)
const problems = (result: string) => checkSourcingResult(SAMPLE, result).problems

describe('the skill\'s equality rules on the sample', () => {
  it('statuses, units, near misses and review, as the skill\'s own examples say', () => {
    const r = matchLines(parseSourcingInput(SAMPLE))
    expect(r.map((x) => `${x.line.line_id} ${x.status} ${x.review ? 'YES' : 'NO'}`)).toEqual([
      'BL-01 matched NO',
      'BL-02 ambiguous YES',
      'BL-03 no-match YES',
      'BL-04 no-match YES',
      'BL-05 matched YES',
      'BL-06 matched YES',
    ])
    expect(r[4].note).toBe('unit E-BOM pcs vs sales_unit pack10')
    expect(r[5].note).toBe('underspecified')
    // The worked check line of SKILL.md is what the helper writes.
    const worked = /`(BL-06 CP-06: [^`]+)`/.exec(SKILL)![1]
    expect(referenceResult(parseSourcingInput(SAMPLE))).toContain(worked)
  })

  it('the saved example result is the helper\'s reference and passes its check', () => {
    expect(KEY.trimEnd()).toBe(runCli(SAMPLE).out.trimEnd())
    expect(checkSourcingResult(SAMPLE, KEY).problems).toEqual([])
    expect(sourcingSummary(checkSourcingResult(SAMPLE, KEY).results)).toBe(
      'every checked cell matches the sourcing-match helper: 3 matched, 1 ambiguous, 2 no-match; 5 for review',
    )
  })
})

describe('checking a result', () => {
  it('a wrong status, a chosen candidate, a missing M-BOM row and a dropped open item are found', () => {
    expect(problems(KEY.replace('| BL-02 | Radiator valve | 20 | pcs | CP-02,CP-03 | ambiguous |', '| BL-02 | Radiator valve | 20 | pcs | CP-02 | matched |'))).toEqual(
      expect.arrayContaining(['BL-02: candidates is "CP-02", helper says "CP-02,CP-03"', 'BL-02: status is "matched", helper says "ambiguous"']),
    )
    expect(problems(KEY.replace('| BL-05 | CP-04 | SynSupplier B | 100 | pcs | pack10 |\n', ''))).toEqual([
      'M-BOM draft rows are BL-01, BL-06; expected the matched lines: BL-01, BL-05, BL-06',
    ])
    expect(problems(KEY.replace('BL-04, no-match, no catalog row of this class\n', ''))).toEqual([
      'open items are BL-02, BL-03, BL-05, BL-06; expected every review=YES line: BL-02, BL-03, BL-04, BL-05, BL-06',
    ])
    expect(problems(KEY.replace('| BL-01 | CP-01 | SynSupplier A | 120 | m | m |', '| BL-01 | CP-01 | SynSupplier B | 120 | m | m |'))).toEqual([
      'BL-01 (M-BOM): supplier is "SynSupplier B", helper says "SynSupplier A"',
    ])
  })

  it('id lists may be written with commas, spaces or "none"; the note and the reasons are free text', () => {
    const relaxed = KEY.replace('| CP-02,CP-03 |', '| CP-02, CP-03 |').replace('| underspecified |\n| BL-04', '| (underspecified) |\n| BL-04')
    expect(problems(relaxed)).toEqual([])
  })

  it('unreadable input or result is code 2', () => {
    expect(runCli('no sections', KEY).code).toBe(2)
    expect(runCli(SAMPLE, 'prose').out).toBe('error: no `## Per-line rows` section in the result')
  })
})

describe('in the pipeline', () => {
  it('the E-BOM lines handed over by the pipeline: one clean match, one unit mismatch, one ambiguous line', () => {
    const h = sourcingInput(
      read('data/tryitout-prompts/ifc-ebom-compiler/sample-ifc-elements.txt'),
      read('data/tryitout-prompts/ifc-ebom-compiler/example-result.md'),
      read('data/pipelines/rules-to-mbom/designation-mapping.csv'),
      read('data/pipelines/rules-to-mbom/catalog-excerpt.csv'),
    )
    const r = matchLines(parseSourcingInput(h.text))
    expect(r.map((x) => `${x.line.line_id} ${x.status} ${x.unitSame} ${x.review ? 'YES' : 'NO'}`)).toEqual([
      'EB-01 matched false YES',
      'EB-02 matched true NO',
      'EB-03 ambiguous null YES',
    ])
    expect(r[2].note).toBe('stock=N for SP-03')
  })
})
