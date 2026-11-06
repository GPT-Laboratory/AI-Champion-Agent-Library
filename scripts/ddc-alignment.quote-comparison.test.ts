// Phase 32-03: quote-comparison entry, SKILL.md and sample stay consistent with
// docs/ddc-alignment/quote-comparison.md (answer key section 8) and the corrected helper.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatReport, parseScoreText } from './bid-weighted-score'
import { rankBids } from '../src/lib/procurement/weightedScore'

const dir = 'data/tryitout-prompts/quote-comparison'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-quotes.txt`, 'utf8')
const entry = readFileSync('data/agents/quote-comparison.yaml', 'utf8')
const spec = readFileSync('docs/ddc-alignment/quote-comparison.md', 'utf8')

describe('quote-comparison alignment', () => {
  it('the sample parses through the CLI parser and the helper equals the answer key', () => {
    const p = parseScoreText(sample)
    expect(p.criteria.map((c) => c.weight)).toEqual([50, 20, 20, 10])
    const r = rankBids(p.criteria, p.bids)
    expect(r).toEqual([
      { id: 'B', total: 7.2, rank: 1 },
      { id: 'A', total: 6.6, rank: 2 },
      { id: 'C', total: 6.3, rank: 3 },
    ])
    const report = formatReport(p)
    expect(report).toContain('B | 7.20 | 1')
    expect(spec).toContain('6.60')
    expect(spec).toContain('7.20')
    expect(spec).toContain('6.30')
  })

  it('weighted and unweighted leaders differ on the sample', () => {
    const p = parseScoreText(sample)
    const unweighted = p.bids
      .map((b) => ({ id: b.id, s: Object.values(b.scores).reduce((x, y) => x + y, 0) }))
      .sort((a, b) => b.s - a.s)
    const weighted = rankBids(p.criteria, p.bids)
    expect(unweighted[0].id).toBe('A')
    expect(weighted[0].id).toBe('B')
  })

  it('the sample is labelled synthetic and has 5 RFQ lines and 3 quotes', () => {
    expect(sample.split('\n')[0]).toMatch(/^# SYNTHETIC SAMPLE/)
    expect((sample.match(/^R-0\d,/gm) ?? []).length).toBe(19) // 5 RFQ + 5 A + 4 B + 5 C
    expect((sample.match(/^## QUOTE /gm) ?? []).length).toBe(3)
  })

  it('SKILL.md keeps the tool placeholder, the draft label and the no-arithmetic rule', () => {
    expect(skill).toContain('to compute (tool)')
    expect(skill).toContain('DRAFT recommendation for engineer review')
    expect(skill).toContain('pending tool totals')
    expect(skill).toContain('no arithmetic, no decision')
    expect(skill).not.toMatch(/no scoring, no supplier recommendation/)
    expect(skill).toContain('## Criteria and scores')
  })

  it('entry states A-02, the helper and the draft recommendation', () => {
    expect(entry).toContain('A-02')
    expect(entry).toContain('scripts/bid-weighted-score.ts')
    expect(entry).toContain('draft for engineer review')
  })

  it('contains no MCP, LVI-INFO, Prysmian or Rakennustieto text and no forbidden source token', () => {
    const forbidden = new RegExp('\\bMCP|\\bLVI|\\bST' + 'K|Prysmian|Rakennustieto', 'i')
    for (const t of [skill, sample, entry]) expect(t).not.toMatch(forbidden)
  })
})
