import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RESULT_COLS, classRows, parseUpload } from '$lib/ebom/ebomJoin'
import { table } from '$lib/ebom/ebomCheck'
import { ebomUpload, existingRules, readCsv, rulesOfResult, sourcingInput } from './rulesToMbom'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PIPE = 'data/pipelines/rules-to-mbom'
const MAPPING = read(`${PIPE}/designation-mapping.csv`)
const CATALOG = read(`${PIPE}/catalog-excerpt.csv`)
const RULE_DATA = read('data/tryitout-prompts/scope-rule-drafter/sample-ebom-input.txt')
const RULE_KEY = read('data/tryitout-prompts/scope-rule-drafter/example-result.md')
const IFC_SAMPLE = read('data/tryitout-prompts/ifc-ebom-compiler/sample-ifc-elements.txt')
const IFC_KEY = read('data/tryitout-prompts/ifc-ebom-compiler/example-result.md')

/** The E-BOM agent's class rows as the tool decides them, in its output format. */
const toolResult = (upload: string) =>
  `## E-BOM class rows\n${table([...RESULT_COLS], classRows(parseUpload(upload)).map((r) => RESULT_COLS.map((c) => r[c])))}\n`

describe('rules -> E-BOM upload', () => {
  it('the data\'s own rules are read; the three choices add, replace or keep them', () => {
    expect(existingRules(IFC_SAMPLE)).toHaveLength(3)
    expect(existingRules(RULE_DATA)).toEqual([])
    const rules = rulesOfResult(RULE_KEY)
    expect(existingRules(ebomUpload(IFC_SAMPLE, rules, 'add'))).toHaveLength(5)
    expect(existingRules(ebomUpload(IFC_SAMPLE, rules, 'replace'))).toEqual(rules)
    expect(ebomUpload(IFC_SAMPLE, rules, 'mine')).toBe(IFC_SAMPLE)
  })
})

describe('E-BOM -> sourcing input', () => {
  it('the E-BOM answer key gives three lines joined by the tool, mapped, in the sourcing format', () => {
    const h = sourcingInput(IFC_SAMPLE, IFC_KEY, MAPPING, CATALOG)
    expect(h.problems).toEqual([])
    expect(h.unmapped).toEqual([])
    expect(h.lines.map((l) => [l.line_id, l.designation, l.block, l.req_class, l.req_dn, l.qty, l.unit])).toEqual([
      ['EB-01', 'SYN Bend 100', 'K1', 'SYN-EC202', '100', '1', 'pcs'],
      ['EB-02', 'SYN Round duct 250', 'K1', 'SYN-EC201', '250', '3', 'm'],
      ['EB-03', 'SYN Round duct 100', 'K2', 'SYN-EC201', '100', '3', 'm'],
    ])
    expect(h.lines[2]).toMatchObject({ measured: '2.275', stickRounded: true })
    expect(h.text).toContain('## E-BOM\nline_id,description,req_class,req_dn,req_material,qty,unit\nEB-01,SYN Bend 100 in K1,SYN-EC202,100,galvanized steel,1,pcs\n')
    expect(h.text).toContain('## CATALOG EXCERPT\nproduct_id,supplier,name,class,dn,material,sales_unit,in_stock\nSP-01,')
    // The sourcing agent's own sample has the same two sections and columns.
    const sample = read('data/tryitout-prompts/product-sourcing-mbom/sample-ebom-catalog.txt')
    for (const head of ['## E-BOM', 'line_id,description,req_class,req_dn,req_material,qty,unit', '## CATALOG EXCERPT', 'product_id,supplier,name,class,dn,material,sales_unit,in_stock']) {
      expect(sample).toContain(head)
    }
  })

  it('every mapped class has a catalog row, and the mapping covers every E-BOM sample designation', () => {
    const classes = new Set(readCsv(CATALOG).rows.map((r) => r.class))
    for (const r of readCsv(MAPPING).rows) if (r.req_class !== 'SYN-EC203') expect(classes.has(r.req_class), r.designation).toBe(true)
    const designations = readCsv(MAPPING).rows.map((r) => r.designation)
    for (const c of parseUpload(IFC_SAMPLE).catalogue) expect(designations, c.name).toContain(c.name)
  })

  it('nothing is handed over from rows that break the contract, an unreadable result or no billed line', () => {
    const broken = IFC_KEY.replace('| SYN Bend 100 | kpl | 1 | count |', '| SYN Bend 999 | kpl | 1 | count |')
    expect(sourcingInput(IFC_SAMPLE, broken, MAPPING, CATALOG)).toMatchObject({ text: '', lines: [] })
    expect(sourcingInput(IFC_SAMPLE, broken, MAPPING, CATALOG).problems[0]).toMatch(/^E-BOM class rows: /)
    expect(sourcingInput(IFC_SAMPLE, 'prose', MAPPING, CATALOG).problems[0]).toMatch(/^cannot read the E-BOM input or result/)
    expect(sourcingInput(IFC_SAMPLE, IFC_KEY, 'designation,req_class,req_dn,req_material\n', CATALOG)).toMatchObject({
      text: '',
      unmapped: ['SYN Bend 100', 'SYN Round duct 250', 'SYN Round duct 100'],
      problems: ['no billed E-BOM line has a product mapping'],
    })
  })
})

describe('the whole chain, with tools only', () => {
  it('rule key -> spliced into the rule agent\'s E-BOM data -> the E-BOM tool -> the sourcing input', () => {
    const upload = ebomUpload(RULE_DATA, rulesOfResult(RULE_KEY), 'add')
    const h = sourcingInput(upload, toolResult(upload), MAPPING, CATALOG)
    expect(h.problems).toEqual([])
    expect(h.lines.map((l) => `${l.line_id} ${l.designation} in ${l.block}: ${l.qty} ${l.unit}`)).toEqual([
      'EB-01 SYN Bend 100 in K1: 1 pcs',
      'EB-02 SYN Round duct 250 in K1: 3 m',
      'EB-03 SYN Round duct 100 in K2: 3 m',
    ])
  })
})
