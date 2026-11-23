import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseDocument } from './resultMarkdown'
import { cellValue, columnName, sheetName, tablesToSheets, xlsxBytes, xmlEscape } from './xlsx'

const parts = (b: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(b)).map(([k, v]) => [k, strFromU8(v)]))

describe('helpers', () => {
  it('column names', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })
  it('numbers only for plain decimals', () => {
    expect(['3', '2.275', '-20', '0.5'].map(cellValue)).toEqual([3, 2.275, -20, 0.5])
    for (const s of ['007', '2026-03-02', 'E-01', '1e5', '1,5', '12345678901234567']) expect(cellValue(s)).toBe(s)
    expect(cellValue('  ')).toBeNull()
  })
  it('sheet names are valid and unique', () => {
    const used = new Set<string>()
    expect(sheetName('E-BOM class rows', used)).toBe('E-BOM class rows')
    expect(sheetName('e-bom CLASS rows', used)).toBe('e-bom CLASS rows (2)')
    expect(sheetName('a/b:c*?[d]', used)).toBe('a b c d')
    expect(sheetName('x'.repeat(40), used)).toHaveLength(31)
    expect(sheetName('History', used)).toBe('History 1')
    expect(sheetName("''", used)).toBe('Sheet')
  })
  it('escapes XML and drops characters XML cannot hold', () => {
    expect(xmlEscape('a<b>&"c"\u0007')).toBe('a&lt;b&gt;&amp;&quot;c&quot;')
  })
})

describe('xlsxBytes', () => {
  const book = parts(
    xlsxBytes([
      { name: 'Lines', rows: [['Block', 'Qty'], ['K1', 3], ['=HYPERLINK("x")', '<b>']] },
      { name: 'Lines', rows: [] },
    ]),
  )

  it('has the package parts and one worksheet per sheet', () => {
    for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      expect(book[p], p).toBeDefined()
    }
    expect(book['xl/workbook.xml']).toContain('<sheet name="Lines" sheetId="1" r:id="rId1"/><sheet name="Lines (2)" sheetId="2" r:id="rId2"/>')
    expect(book['xl/_rels/workbook.xml.rels']).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"')
  })

  it('bold frozen header, numbers as numbers, text never as a formula', () => {
    const s = book['xl/worksheets/sheet1.xml']
    expect(s).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
    expect(s).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Block</t></is></c>')
    expect(s).toContain('<c r="B2"><v>3</v></c>')
    expect(s).toContain('<t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t>')
    expect(s).toContain('&lt;b&gt;')
    expect(s).not.toContain('<f>')
  })
})

describe('tablesToSheets', () => {
  it('one sheet per table, named after its heading, cells typed', () => {
    const blocks = parseDocument('## Rows\n| id | `qty` |\n|---|---|\n| `E-01` | 2.5 |\n\n| a |\n|---|\n| b |')
    expect(tablesToSheets(blocks)).toEqual([
      { name: 'Rows', rows: [['id', 'qty'], ['E-01', 2.5]] },
      { name: 'Rows', rows: [['a'], ['b']] },
    ])
  })
})
