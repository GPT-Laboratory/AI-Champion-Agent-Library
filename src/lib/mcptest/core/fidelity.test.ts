import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CASE_IDS, CHECK_IDS, FIDELITY, GAPS } from './fidelity'

const doc = readFileSync(join(process.cwd(), 'docs', 'mcp-test-port-fidelity.md'), 'utf8')

describe('FIDELITY table', () => {
  const cases = FIDELITY.filter((e) => e.group === 'case')
  it('has exactly 12 case entries with the platform ids', () => {
    expect(cases.map((c) => c.id)).toEqual([...CASE_IDS])
    expect(CASE_IDS).toHaveLength(12)
  })
  it('has tiers 1x1, 2x3, 3x4, 4x4', () => {
    const n = (t: number) => cases.filter((c) => c.tier === t).length
    expect([n(1), n(2), n(3), n(4)]).toEqual([1, 3, 4, 4])
  })
  it('gives every case full metadata', () => {
    for (const c of cases) {
      expect(c.sourceStatus).toBeTruthy()
      expect(c.port).toBeTruthy()
      expect(c.platformStatus).toBeTruthy()
      expect(c.where).toBeTruthy()
      expect(c.note.length).toBeGreaterThan(0)
    }
  })
  it('has an entry for each of the 10 checks and component rows', () => {
    expect(CHECK_IDS).toHaveLength(10)
    for (const id of CHECK_IDS)
      expect(FIDELITY.some((e) => e.group === 'check' && e.id === id)).toBe(true)
    expect(FIDELITY.filter((e) => e.group === 'component').length).toBeGreaterThanOrEqual(15)
  })
  it('only uses allowed platform statuses', () => {
    for (const e of FIDELITY)
      expect(['implemented', 'implemented-minimal', 'designed-only-gap']).toContain(e.platformStatus)
  })
  it('has unique ids per group', () => {
    const keys = FIDELITY.map((e) => `${e.group}:${e.id}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('lists the required gaps', () => {
    const ids = GAPS.map((g) => g.id)
    for (const g of [
      'legacy-http-sse',
      'real-profile-mapping',
      'generator-http-transport',
      'generator-composite',
      'real-fastmcp-run'
    ])
      expect(ids).toContain(g)
  })
  it('appears in the fidelity doc: every case, check and gap id', () => {
    for (const id of [...CASE_IDS, ...CHECK_IDS, ...GAPS.map((g) => g.id)]) expect(doc).toContain(id)
  })
})
