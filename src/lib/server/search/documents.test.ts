import { describe, it, expect } from 'vitest'
import { buildSearchText, contentHash, rowToSearchable, recordToSearchable } from './documents.js'
import type { AgentRecord } from '../../spec/types.js'

const base = {
  slug: 'rfi-triage',
  title: 'RFI Triage',
  summary: 'Sorts requests for information',
  category: 'Construction',
  tags: ['rfi', 'triage'],
  toolNames: ['read_document', 'search_web'],
}

describe('documents', () => {
  it('buildSearchText is deterministic and splits tool names', () => {
    const t = buildSearchText(base)
    expect(t).toBe(buildSearchText({ ...base }))
    expect(t).toContain('read document')
    expect(t).not.toContain('read_document')
    expect(t).toContain('RFI Triage')
    expect(t).toContain('Construction')
  })

  it('contentHash is stable 64 hex and sensitive to model and text', () => {
    const h = contentHash('m', 'text')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(contentHash('m', 'text')).toBe(h)
    expect(contentHash('m2', 'text')).not.toBe(h)
    expect(contentHash('m', 'text2')).not.toBe(h)
  })

  it('rowToSearchable and recordToSearchable agree', () => {
    const row = rowToSearchable({
      ...base,
      tags: JSON.stringify(base.tags),
      toolNames: JSON.stringify(base.toolNames),
    })
    const rec = recordToSearchable(base as unknown as AgentRecord)
    expect(row).toEqual(rec)
    expect(row).toEqual(base)
  })

  it('rowToSearchable tolerates bad JSON', () => {
    const s = rowToSearchable({ ...base, tags: 'nope', toolNames: '{}' })
    expect(s.tags).toEqual([])
    expect(s.toolNames).toEqual([])
  })
})
