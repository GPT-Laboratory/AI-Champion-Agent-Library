import { describe, expect, it } from 'vitest'
import { formatReport, parseScoreText, runCli } from './bid-weighted-score'

const INPUT = `# SYNTHETIC
## CRITERIA
criterion,weight
price,50
delivery_time,20
technical_compliance,20
references,10
## SCORES
criterion,A,B,C
price,6,9,5
delivery_time,5,8,9
technical_compliance,9,4,8
references,8,3,4
`

const RESULT = `## Criteria and scores
criterion | weight | A | B | C
price | 50 | 6 | 9 | 5
delivery_time | 20 | 5 | 8 | 9
technical_compliance | 20 | 9 | 4 | 8
references | 10 | 8 | 3 | 4
total | - | to compute (tool) | to compute (tool) | to compute (tool)

## Scope gaps
`

describe('bid-weighted-score parser', () => {
  it('parses the input CRITERIA and SCORES sections', () => {
    const p = parseScoreText(INPUT)
    expect(p.criteria.map((c) => c.weight)).toEqual([50, 20, 20, 10])
    expect(p.bids.map((b) => b.id)).toEqual(['A', 'B', 'C'])
    expect(p.bids[1].scores.price).toBe(9)
  })
  it('parses the result.md pipe table and ignores the total row', () => {
    const p = parseScoreText(RESULT)
    expect(p).toEqual(parseScoreText(INPUT))
  })
  it('prints one line per quote with total and rank, plus the weights', () => {
    const out = formatReport(parseScoreText(INPUT))
    expect(out).toContain('weights: price=50, delivery_time=20, technical_compliance=20, references=10')
    expect(out).toContain('B | 7.20 | 1')
    expect(out).toContain('A | 6.60 | 2')
    expect(out).toContain('C | 6.30 | 3')
  })
  it('reports validation errors with exit code 2', () => {
    const bad = INPUT.replace('price,6,9,5', 'price,6,19,5')
    const r = runCli(bad)
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/bad-score/)
    expect(runCli('nothing here').code).toBe(2)
    expect(runCli(INPUT.replace('technical_compliance,9,4,8\n', '')).code).toBe(2)
    expect(runCli(INPUT.replace('price,50', 'price,abc')).code).toBe(2)
  })
  it('returns code 0 for good input', () => {
    expect(runCli(INPUT).code).toBe(0)
  })
})
