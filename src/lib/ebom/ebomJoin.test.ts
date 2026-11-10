import { describe, expect, it } from 'vitest'
import {
  EbomError,
  checkOutcomes,
  classRows,
  compareRows,
  decideElement,
  fromMicro,
  joinLines,
  parseUpload,
  reviewItems,
  toMicro,
  type ResultRow,
  type Upload,
} from './ebomJoin'

const HEAD = 'token,ifc_class,type_name,system,size_mm,geom_family,stated_length_m,geom_centreline_m,geom_check,loc_block'
const upload = (elements: string[], rules: string[] = ['r1: system = HOOD -> exclude (by the kitchen supplier)']): string =>
  [
    '# SYNTHETIC',
    '## BLOCKS',
    'block_id,discipline,tab,title',
    'A,IV,1st floor,Flats',
    'B,IV,Roof,Plant room',
    '## CATALOGUE',
    'name,unit,ifc_class,geom_family,size_mm,discipline',
    'Duct 100,m,IfcDuctSegment,straight,100,IV',
    'Bend 100,kpl,IfcDuctFitting,bend,100,IV',
    'Tee 100,kpl,IfcDuctFitting,tee,100,IV',
    'Tee 100 reducing,kpl,IfcDuctFitting,tee,100,IV',
    '## RULES',
    ...rules,
    '## ELEMENTS',
    HEAD,
    ...elements,
  ].join('\n')

const one = (line: string, rules?: string[]) => {
  const u = parseUpload(upload([line], rules))
  return decideElement(u.elements[0], u)
}

describe('toMicro / fromMicro (integer micrometres)', () => {
  it('round-trips decimals and trims trailing zeros', () => {
    expect(fromMicro(toMicro('3.00'))).toBe('3')
    expect(fromMicro(toMicro('2.275'))).toBe('2.275')
    expect(fromMicro(toMicro('-0.40'))).toBe('-0.4')
    expect(fromMicro(toMicro('0.000001'))).toBe('0.000001')
  })
  it('sums without floating-point error (0.1 + 0.2)', () => {
    expect(fromMicro(toMicro('0.1') + toMicro('0.2'))).toBe('0.3')
  })
  it('rejects a decimal comma, more than 6 decimals and text', () => {
    for (const t of ['2,40', '1.0000001', 'abc', '', '1e3']) expect(() => toMicro(t)).toThrow(EbomError)
  })
})

describe('parseUpload', () => {
  it('reads labels, sections, tied and untied rules', () => {
    const u = parseUpload(upload(['E1,IfcDuctSegment,Duct,S1,100,straight,1.5,1.5,agree,A'], ['r1: system = HOOD -> exclude (x)', 'r2: free text rule', 'r3: colour = red -> exclude (no such field)']))
    expect(u.labels).toEqual(['# SYNTHETIC'])
    expect([u.blocks.length, u.catalogue.length, u.elements.length]).toEqual([2, 4, 1])
    expect(u.rules.map((r) => [r.id, r.field, r.value, r.reason])).toEqual([['r1', 'system', 'HOOD', 'x']])
    expect(u.untiedRules).toEqual(['r2: free text rule', 'r3: colour = red -> exclude (no such field)'])
  })
  it('a missing RULES section is allowed; a missing ELEMENTS section is not', () => {
    const noRules = upload(['E1,IfcDuctSegment,Duct,S1,100,straight,1.5,1.5,agree,A']).replace(/## RULES\n[^\n]*\n/, '')
    expect(parseUpload(noRules).rules).toEqual([])
    expect(() => parseUpload(upload([]).replace(/## ELEMENTS[\s\S]*/, ''))).toThrow(/missing-section/)
  })
  it('rejects bad input with typed errors', () => {
    const bad = (line: string) => () => parseUpload(upload([line]))
    expect(bad('E1,IfcDuctSegment,Duct,S1,100,straight,1.5,1.5,agree')).toThrow(/bad-row/)
    expect(bad('E1,IfcDuctSegment,Duct,S1,100,straight,"1,5",1.5,agree,A')).toThrow(EbomError)
    expect(bad('E1,IfcDuctSegment,Duct,S1,100,straight,1.5,1.5,maybe,A')).toThrow(/bad-value.*geom_check/)
    expect(bad('E1,IfcDuctSegment,Duct,S1,100,straight,1.5,1.5,agree,')).toThrow(/bad-value.*loc_block/)
    expect(() => parseUpload(upload(['E1,IfcDuctSegment,Duct,S1,100,straight,1,1,agree,A', 'E1,IfcDuctSegment,Duct,S1,100,straight,1,1,agree,A']))).toThrow(/duplicate.*E1/)
    expect(() => parseUpload(upload([]).replace('Duct 100,m,', 'Duct 100,mm,'))).toThrow(/bad-value.*unit/)
    expect(() => parseUpload('stray\n' + upload([]))).toThrow(/before the first section/)
  })
})

describe('decideElement: the SKILL.md step table, first step that fits', () => {
  it.each([
    ['1 scope rule', 'E,IfcDuctSegment,Hood,HOOD,100,straight,1.2,1.2,agree,A', 'exclude', 'r1', 1],
    ['2 loc review', 'E,IfcDuctSegment,Duct,S1,100,straight,1.2,1.2,agree,review', 'review', 'loc-review', 2],
    ['2 unknown block', 'E,IfcDuctSegment,Duct,S1,100,straight,1.2,1.2,agree,Z', 'review', 'loc-review', 2],
    ['3 no catalogue', 'E,IfcDuctSegment,Duct,S1,125,straight,1.2,1.2,agree,A', 'review', 'no-catalogue', 3],
    ['4 two names', 'E,IfcDuctFitting,Tee,S1,100,tee,,0.3,agree,A', 'review', 'multi-catalogue', 4],
    ['5 pieces', 'E,IfcDuctFitting,Bend,S1,100,bend,,0.2,differ,A', 'bill', 'count', 5],
    ['6 stated zero', 'E,IfcDuctSegment,Duct,S1,100,straight,0,1.2,agree,A', 'review', 'zero-qty', 6],
    ['6 stated negative', 'E,IfcDuctSegment,Duct,S1,100,straight,-0.4,1.2,agree,A', 'review', 'zero-qty', 6],
    ['6 stated 0.000', 'E,IfcDuctSegment,Duct,S1,100,straight,0.000,1.2,agree,A', 'review', 'zero-qty', 6],
    ['7 stated', 'E,IfcDuctSegment,Duct,S1,100,straight,2.40,2.412,differ,A', 'bill', 'stated', 7],
    ['8 geometry zero', 'E,IfcDuctSegment,Duct,S1,100,straight,,0,agree,A', 'review', 'zero-qty', 8],
    ['8 geometry empty', 'E,IfcDuctSegment,Duct,S1,100,straight,,,agree,A', 'review', 'zero-qty', 8],
    ['9 geometry', 'E,IfcDuctSegment,Duct,S1,100,straight,,1.853,agree,B', 'bill', 'measured:geom', 9],
    ['10 differ', 'E,IfcDuctSegment,Duct,S1,100,straight,,3.1,differ,A', 'review', 'length-unsettled', 10],
    ['10 none', 'E,IfcDuctSegment,Duct,S1,100,straight,,3.1,none,A', 'review', 'length-unsettled', 10],
  ])('%s', (_, line, outcome, rule, step) => {
    const r = one(line)
    expect([r.outcome, r.rule, r.step]).toEqual([outcome, rule, step])
  })
  it('a bill row copies the designation, the unit and the quantity text exactly', () => {
    const r = one('E,IfcDuctSegment,Duct,S1,100,straight,2.40,2.412,agree,A')
    expect([r.block, r.designation, r.unit, r.qty]).toEqual(['A', 'Duct 100', 'm', '2.40'])
  })
  it('exclude and review rows copy the block and write - for designation, unit and qty', () => {
    for (const line of ['E,IfcDuctSegment,Hood,HOOD,100,straight,1.2,1.2,agree,A', 'E,IfcDuctSegment,Duct,S1,125,straight,1,1,agree,B']) {
      const r = one(line)
      expect([r.designation, r.unit, r.qty]).toEqual(['-', '-', '-'])
      expect(r.block).toBe(line.split(',').at(-1))
    }
  })
  it('the scope rule wins over a missing block and a catalogue match; it matches exact text only', () => {
    expect(one('E,IfcDuctSegment,Hood,HOOD,100,straight,1.2,1.2,agree,review').rule).toBe('r1')
    expect(one('E,IfcDuctSegment,Hood,HOOD-2,100,straight,1.2,1.2,agree,A').rule).toBe('stated')
    expect(one('E,IfcDuctSegment,Hood,hood,100,straight,1.2,1.2,agree,A').rule).toBe('stated')
  })
  it('an untied rule is applied to nothing', () => {
    expect(one('E,IfcDuctSegment,Duct,S1,100,straight,1.2,1.2,agree,A', ['r2: all ducts are excluded']).outcome).toBe('bill')
  })
})

describe('reviewItems', () => {
  it('one item per review row; where is class for loc-review; fixed texts and kinds', () => {
    const u = parseUpload(upload(['E1,IfcDuctSegment,Duct,S1,100,straight,1,1,agree,review', 'E2,IfcDuctSegment,Duct,S1,100,straight,,2,none,A', 'E3,IfcDuctSegment,Duct,S1,100,straight,1,1,agree,A']))
    expect(reviewItems(classRows(u))).toEqual([
      { where: 'class', members: '1', kind: 'unsettled', what: 'E1: block not settled by the location step' },
      { where: 'A', members: '1', kind: 'estimate', what: 'E2: no stated length and the geometry readings do not agree' },
    ])
  })
})

describe('checkOutcomes (the contract on any class rows)', () => {
  const u: Upload = parseUpload(upload(['E1,IfcDuctSegment,Duct,S1,100,straight,1,1,agree,A', 'E2,IfcDuctFitting,Bend,S1,100,bend,,0.2,agree,A']))
  const row = (o: Partial<ResultRow>): ResultRow => ({ token: 'E1', ifc_class: 'IfcDuctSegment', outcome: 'bill', block: 'A', designation: 'Duct 100', unit: 'm', qty: '1', rule: 'stated', ...o })
  const e2 = row({ token: 'E2', ifc_class: 'IfcDuctFitting', designation: 'Bend 100', unit: 'kpl', qty: '1', rule: 'count' })
  it('the reference rows pass', () => {
    expect(checkOutcomes(u, classRows(u))).toEqual([])
  })
  it('reports a missing, doubled or unknown element', () => {
    expect(checkOutcomes(u, [row({})])).toEqual(['E2: no outcome'])
    expect(checkOutcomes(u, [row({}), row({}), e2])).toEqual(['E1: 2 rows, expected exactly one outcome'])
    expect(checkOutcomes(u, [row({}), e2, row({ token: 'E9' })])).toEqual(['E9: not an input element'])
  })
  it('reports an invented name, a wrong unit, a zero, a fraction of a piece, an unknown block and a missing reason', () => {
    expect(checkOutcomes(u, [row({ designation: 'Duct 999' }), e2])).toEqual(['E1: designation "Duct 999" is not in the catalogue'])
    expect(checkOutcomes(u, [row({ unit: 'kpl' }), e2])).toEqual(['E1: unit "kpl", catalogue says "m"'])
    expect(checkOutcomes(u, [row({ qty: '0' }), e2])).toEqual(['E1: qty 0 is not positive'])
    expect(checkOutcomes(u, [row({ qty: 'about 2' }), e2])).toEqual(['E1: qty "about 2" is not a number'])
    expect(checkOutcomes(u, [row({}), { ...e2, qty: '1.5' }])).toEqual(['E2: 1.5 pieces is not a whole number'])
    expect(checkOutcomes(u, [row({ block: 'Z' }), e2])).toEqual(['E1: billed in "Z", not a block of the template'])
    expect(checkOutcomes(u, [row({ outcome: 'review', rule: '-' }), e2])).toEqual(['E1: review row has no rule or reason'])
    expect(checkOutcomes(u, [row({ outcome: 'maybe' }), e2])).toEqual(['E1: outcome "maybe" is not bill, exclude or review'])
  })
})

describe('compareRows', () => {
  const u = parseUpload(upload(['E1,IfcDuctSegment,Duct,S1,100,straight,1.50,1.5,agree,A', 'E2,IfcDuctFitting,Bend,S1,100,bend,,0.2,agree,A']))
  const ref = classRows(u)
  const plain = ref.map(({ step: _s, review_kind: _k, ...r }) => r as ResultRow)
  it('equal rows give no differences', () => {
    expect(compareRows(ref, plain)).toEqual([])
  })
  it('a rounded quantity is a difference (the text is copied, not recomputed)', () => {
    expect(compareRows(ref, [{ ...plain[0], qty: '1.5' }, plain[1]])).toEqual(['E1: qty is "1.5", helper says "1.50"'])
  })
  it('order and count are checked', () => {
    expect(compareRows(ref, [plain[1], plain[0]])).toEqual(['E1: out of input order', 'E2: out of input order'])
    expect(compareRows(ref, [plain[0]])).toEqual(['row count: helper 2, result 1', 'E2: missing in result'])
  })
})

describe('joinLines', () => {
  const r = (token: string, block: string, designation: string, unit: string, qty: string, outcome = 'bill'): ResultRow => ({ token, ifc_class: 'X', outcome, block, designation, unit, qty, rule: '-' })
  const rows = [
    r('E1', 'B', 'Duct 100', 'm', '2.40'),
    r('E2', 'A', 'Duct 100', 'm', '1.853'),
    r('E3', 'A', 'Duct 100', 'm', '2.275'),
    r('E4', 'A', 'Bend 100', 'kpl', '1'),
    r('E5', 'A', 'Bend 100', 'kpl', '1'),
    r('E6', 'A', 'Duct 100', '-', '-', 'review'),
  ]
  it('sums per block x designation, rounds metres up to whole sticks, counts pieces, sorts by block then designation', () => {
    expect(joinLines(rows, '3')).toEqual([
      { block: 'A', designation: 'Bend 100', unit: 'kpl', measured: '2', billed: '2', elements: 2, stick_rounded: false },
      { block: 'A', designation: 'Duct 100', unit: 'm', measured: '4.128', billed: '6', elements: 2, stick_rounded: true },
      { block: 'B', designation: 'Duct 100', unit: 'm', measured: '2.4', billed: '3', elements: 1, stick_rounded: true },
    ])
  })
  it('an exact multiple of the stick is not rounded up; stick 0 means no rounding', () => {
    expect(joinLines([r('E1', 'A', 'Duct 100', 'm', '3.0'), r('E2', 'A', 'Duct 100', 'm', '3')], '3')[0].billed).toBe('6')
    expect(joinLines(rows, '0')[1]).toMatchObject({ measured: '4.128', billed: '4.128', stick_rounded: false })
    expect(joinLines(rows, '2.5')[1].billed).toBe('5')
  })
  it('rejects a bad stick length and mixed units on one line', () => {
    expect(() => joinLines(rows, '-3')).toThrow(/negative/)
    expect(() => joinLines(rows, 'three')).toThrow(/bad-number/)
    expect(() => joinLines([r('E1', 'A', 'Duct 100', 'm', '1'), r('E2', 'A', 'Duct 100', 'kpl', '1')])).toThrow(/units/)
  })
  it('only billed rows count', () => {
    expect(joinLines([r('E1', 'A', 'Duct 100', '-', '-', 'review'), r('E2', 'A', 'Duct 100', '-', '-', 'exclude')])).toEqual([])
  })
})
