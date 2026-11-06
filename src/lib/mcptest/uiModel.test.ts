import { describe, it, expect } from 'vitest'
import { CELL_STATES } from './core/report'
import { caseBadge, CELL_STATE_VALUES, flagsBlockersFirst, groupByTier, stateLabel } from './uiModel'

describe('uiModel', () => {
  it('stateLabel covers every report cell state with distinct text', () => {
    expect([...CELL_STATE_VALUES].sort()).toEqual([...CELL_STATES].sort())
    const labels = CELL_STATES.map(stateLabel)
    expect(new Set(labels).size).toBe(10)
    expect(labels).not.toContain('Unknown')
    expect(stateLabel('NA_MODALITY')).toBe('N/A (input kind)')
    expect(stateLabel('PENDING_HUMAN')).toBe('Pending human')
  })
  it('groupByTier gives four ordered groups', () => {
    const g = groupByTier([{ tier: 3 }, { tier: 1 }, { tier: 3 }])
    expect(g.map((x) => x.tier)).toEqual([1, 2, 3, 4])
    expect(g.map((x) => x.cases.length)).toEqual([1, 0, 2, 0])
  })
  it('flagsBlockersFirst is stable', () => {
    const out = flagsBlockersFirst([
      { id: 'a', severity: 'warning' },
      { id: 'b', severity: 'blocker' },
      { id: 'c', severity: 'warning' },
      { id: 'd', severity: 'blocker' }
    ])
    expect(out.map((f) => f.id)).toEqual(['b', 'd', 'a', 'c'])
  })
  it('caseBadge returns the four badge texts', () => {
    expect(caseBadge({ where: 'S+G', platformStatus: 'implemented' })).toBe('implemented')
    expect(caseBadge({ where: 'S', platformStatus: 'implemented-minimal' })).toBe('synthetic')
    expect(caseBadge({ where: 'G', platformStatus: 'implemented' })).toBe('generator-only')
    expect(caseBadge({ where: 'S-real', platformStatus: 'implemented' })).toBe('needs real runtime')
  })
})
