// Phase 34-01: own-design labels are explicit and identical in entry, notices and inventory.
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'

const notices = readFileSync('docs/third-party-notices.md', 'utf8')
const inventory = readFileSync('docs/consortium-agents-inventory.md', 'utf8')

const FRAMING = new RegExp(['MCP', 'LVI', ['S', 'TK'].join(''), 'Prysmian', 'Rakennustieto'].join('|'))
const D2 = 'D2 = Finnish National Building Code part D2 (indoor climate and ventilation)'
const L9 = 'no DDC basis (own design); the DDC prefab-optimization skill is not a pipe-spool or cut-list skill'
const AGENTS: Record<string, { row: number; label: string }> = {
  'etim-classification-repair': { row: 1, label: 'inspired by 1_DDC_Toolkit/BIM-Analysis/bim-classification-ai (own design for ETIM-style mapping)' },
  'product-sourcing-mbom': { row: 5, label: 'inspired by 1_DDC_Toolkit/CWICR-Database/cwicr-material-procurement (method only; no CWICR data)' },
  'cut-sheet-qa': { row: 8, label: 'inspired by 1_DDC_Toolkit/Document-Control/submittal-tracker (+ 2_DDC_Book/2.4-PDF-CAD-to-Data/specification-extractor)' },
  'spooling-and-cutting': { row: 9, label: L9 },
  'd2-code-validation': { row: 10, label: 'no DDC basis (own design)' },
}

function filesOf(slug: string): string[] {
  const dir = `data/tryitout-prompts/${slug}`
  const extra = existsSync(dir) ? readdirSync(dir).map((f) => `${dir}/${f}`) : []
  return [`data/agents/${slug}.yaml`, ...extra]
}

describe('own-design labels', () => {
  for (const [slug, { row, label }] of Object.entries(AGENTS)) {
    describe(slug, () => {
      const entry = readFileSync(`data/agents/${slug}.yaml`, 'utf8')
      it('attribution, description/assumptions, notices and inventory carry the label', () => {
        expect(entry).toMatch(new RegExp(`attribution: "${label.replace(/[()+.]/g, '\\$&')}`))
        const assumptions = entry.slice(entry.indexOf('assumptions:'), entry.indexOf('gaps:'))
        expect(assumptions).toContain(slug === 'd2-code-validation' ? 'no DDC basis (own design)' : label)
        expect(entry.split('\n').find((l) => l.startsWith('description:'))).toMatch(/Own design/)
        const noticeRow = notices.split('\n').find((l) => l.startsWith(`| ${slug} |`)) ?? ''
        expect(noticeRow).toContain(label)
        const invRow = inventory.split('\n').find((l) => l.startsWith(`| ${row} |`)) ?? ''
        expect(invRow).toContain(label)
      })
      it('does not claim to follow or be built on a skill', () => {
        for (const f of filesOf(slug)) {
          expect(readFileSync(f, 'utf8'), f).not.toMatch(/follows? (the )?(DDC )?skill|built on the (DDC )?skill/i)
        }
      })
    })
  }

  it('agent 5 keeps the CWICR licence caveat and has no MCP-source framing', () => {
    expect(notices).toContain('CC BY-NC')
    for (const f of filesOf('product-sourcing-mbom')) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(FRAMING)
    }
    expect(readFileSync('data/agents/product-sourcing-mbom.yaml', 'utf8')).toContain('generic synthetic product data')
  })

  it('agent 9 says prefab-optimization is not a pipe-spool skill', () => {
    expect(readFileSync('data/agents/spooling-and-cutting.yaml', 'utf8')).toContain('prefab-optimization skill is not a pipe-spool')
  })

  it('agent 10 shows the D2 assumption in description and assumptions with open alternatives', () => {
    const entry = readFileSync('data/agents/d2-code-validation.yaml', 'utf8')
    const desc = entry.split('\n').find((l) => l.startsWith('description:')) ?? ''
    const assumptions = entry.slice(entry.indexOf('assumptions:'), entry.indexOf('gaps:'))
    expect(desc).toContain(D2)
    expect(desc).toContain('Alok/Jussi')
    expect(assumptions).toContain(D2)
    expect(assumptions).toMatch(/Open alternatives:.*Alok\/Jussi/)
    expect(readFileSync('data/tryitout-prompts/d2-code-validation/SKILL.md', 'utf8')).toMatch(/D2/)
  })
})
