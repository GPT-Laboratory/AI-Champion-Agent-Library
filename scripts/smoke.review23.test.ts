// CR-57: the fixtures filter tests the path below the agents directory, not the whole absolute path.
import { describe, expect, it } from 'vitest'
import { skipFixtures } from './smoke'

describe('skipFixtures (CR-57)', () => {
  const base = '/home/u/my-fixtures-repo/data/agents'
  const keep = skipFixtures(base)
  it('keeps agent files when the checkout path contains "fixtures"', () => {
    expect(keep(base)).toBe(true)
    expect(keep(`${base}/demo.yaml`)).toBe(true)
  })
  it('skips a fixtures directory and everything below it', () => {
    expect(keep(`${base}/fixtures`)).toBe(false)
    expect(keep(`${base}/fixtures/x.yaml`)).toBe(false)
  })
  it('keeps a file merely named like fixtures', () => {
    expect(keep(`${base}/fixtures-notes.yaml`)).toBe(true)
  })
})
