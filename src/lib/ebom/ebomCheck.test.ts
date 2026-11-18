import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkEbomResult, hasResultTable, parseResultTable, ParseError } from './ebomCheck'
import { runCli } from '../../../scripts/ebom-join'

const DIR = join(process.cwd(), 'data/tryitout-prompts/ifc-ebom-compiler')
const SAMPLE = readFileSync(join(DIR, 'sample-ifc-elements.txt'), 'utf8')
const KEY = readFileSync(join(DIR, 'example-result.md'), 'utf8')

// A duplicate of E-04 under a new token, appended at the end of ## ELEMENTS (the last section).
const E12 = 'E-12,IfcDuctFitting,Tee,EXHAUST-2,250,tee,,0.640,agree,K1'
const SAMPLE_E12 = `${SAMPLE.trimEnd()}\n${E12}\n`
const E11_ROW = '| E-11 | IfcPipeSegment | review | K3 | - | - | - | zero-qty |'
const withE12 = (rule: string) => KEY.replace(E11_ROW, `${E11_ROW}\n| E-12 | IfcDuctFitting | review | K1 | - | - | - | ${rule} |`)

describe('checkEbomResult', () => {
  it('the saved example result matches the helper', () => {
    const r = checkEbomResult(SAMPLE, KEY)
    expect(r).toMatchObject({ code: 0, problems: [], diffs: [] })
    expect(r.out).toContain('result table matches the helper on every cell')
  })

  it('a copy of E-04 under a new token is multi-catalogue, like E-04', () => {
    expect(checkEbomResult(SAMPLE_E12, withE12('multi-catalogue'))).toMatchObject({ code: 0, diffs: [] })
  })

  it('flags the reported slip: E-12 sent to review as no-catalogue', () => {
    const r = checkEbomResult(SAMPLE_E12, withE12('no-catalogue'))
    expect(r.code).toBe(1)
    expect(r.problems).toEqual([])
    expect(r.diffs).toEqual(['E-12: rule is "no-catalogue", helper says "multi-catalogue"'])
  })

  it('a missing row is a contract problem and a mismatch', () => {
    const r = checkEbomResult(SAMPLE_E12, KEY)
    expect(r.code).toBe(1)
    expect(r.problems).toEqual(['E-12: no outcome'])
    expect(r.diffs).toContain('E-12: missing in result')
  })

  it('an unreadable upload or result is code 2, with the reason', () => {
    expect(checkEbomResult('no sections here', KEY)).toMatchObject({ code: 2, out: expect.stringMatching(/^error: /) })
    expect(checkEbomResult(SAMPLE, 'just prose')).toMatchObject({ code: 2, out: 'error: no `## E-BOM class rows` section in the result' })
  })

  it('without a result it prints the helper rows', () => {
    const r = checkEbomResult(SAMPLE)
    expect(r.code).toBe(0)
    expect(r.out).toContain('## E-BOM class rows (helper)')
  })

  it('the CLI prints exactly the shared check', () => {
    for (const [a, b] of [[SAMPLE, KEY], [SAMPLE_E12, withE12('no-catalogue')], [SAMPLE, undefined], ['x', KEY]] as const) {
      const r = checkEbomResult(a, b)
      expect(runCli(a, b)).toEqual({ code: r.code, out: r.out })
    }
  })
})

describe('result table helpers', () => {
  it('hasResultTable finds the heading', () => {
    expect(hasResultTable(KEY)).toBe(true)
    expect(hasResultTable('## Review items\n| a |')).toBe(false)
  })

  it('parseResultTable throws ParseError without a table', () => {
    expect(() => parseResultTable('## E-BOM class rows\nnone')).toThrow(ParseError)
  })
})
