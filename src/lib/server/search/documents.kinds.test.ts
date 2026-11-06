import { describe, it, expect } from 'vitest'
import {
  buildSearchText,
  recordToSearchable,
  recordToSearchableWithKind,
  rowToSearchable,
  rowToSearchableWithKind,
} from './documents.js'
import { defaultKindInfo } from '../../spec/kinds.js'
import type { AgentRecord } from '../../spec/types.js'

const base = { slug: 's', title: 'Title', summary: 'Sum', category: 'Cat', tags: ['a', 'b'], toolNames: ['do_thing'] }

describe('buildSearchText kind fields', () => {
  it('is byte-identical without kind fields', () => {
    expect(buildSearchText(base)).toBe('Title. Sum. Cat. a b. do thing')
  })
  it('kind agent adds nothing', () => {
    expect(buildSearchText({ ...base, kind: 'agent', framework: null, memberNames: [] })).toBe(buildSearchText(base))
  })
  it('appends kind, framework and member names after existing parts', () => {
    expect(buildSearchText({ ...base, kind: 'system', framework: 'crewai', memberNames: ['Acme Triager', 'Bob'] })).toBe(
      'Title. Sum. Cat. a b. do thing. system. crewai. Acme Triager Bob',
    )
  })
  it('row/record helpers agree and leave old helpers unchanged', () => {
    const row = { ...base, tags: JSON.stringify(base.tags), toolNames: JSON.stringify(base.toolNames) }
    const info = { ...defaultKindInfo(), kind: 'system' as const, framework: 'x' }
    expect(rowToSearchableWithKind(row, undefined)).toEqual(rowToSearchable(row))
    const rec = { ...base } as unknown as AgentRecord
    expect(recordToSearchable(rec)).not.toHaveProperty('kind')
    expect(buildSearchText(rowToSearchableWithKind(row, info))).toBe(
      buildSearchText(recordToSearchableWithKind(rec, info)),
    )
  })
})
