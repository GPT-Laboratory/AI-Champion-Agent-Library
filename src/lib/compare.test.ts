import { describe, expect, it } from 'vitest'
import {
  MAX_COMPARE,
  buildCompareRows,
  catalogCompareData,
  layoutCompareData,
  parseCompareSlugs,
  type CompareAgentInput,
} from './compare'

const agent = (o: Partial<CompareAgentInput> = {}): CompareAgentInput => ({
  slug: 'a',
  title: 'A',
  summary: 's',
  category: 'ops',
  tags: ['x'],
  llmName: 'gpt-4o',
  llmTemperature: null,
  toolNames: [],
  inputFields: [],
  requiresHumanApproval: false,
  maturityStatus: 'beta',
  tryItOutMode: 'none',
  githubUrl: null,
  customizableFields: null,
  ...o,
})

describe('parseCompareSlugs', () => {
  it('splits commas, repeated params, trims and de-duplicates', () => {
    expect(parseCompareSlugs(['a, b', 'b', 'c']).slugs).toEqual(['a', 'b', 'c'])
  })
  it('caps at 3 and reports truncation', () => {
    const r = parseCompareSlugs(['a,b,c,d,e'])
    expect(r.slugs).toHaveLength(MAX_COMPARE)
    expect(r.truncated).toBe(true)
  })
  it('drops invalid slugs via the allow-list', () => {
    const r = parseCompareSlugs(['../etc,a%00,a b,<script>,ok-1.2_x,', null, undefined])
    expect(r.slugs).toEqual(['ok-1.2_x'])
    expect(r.invalidCount).toBe(4)
  })
  it('rejects over-long slugs', () => {
    expect(parseCompareSlugs(['a'.repeat(101)]).slugs).toEqual([])
  })
})

describe('buildCompareRows', () => {
  it('flags differing rows only', () => {
    const rows = buildCompareRows([agent(), agent({ slug: 'b', llmName: 'claude', tags: ['x'] })])
    const by = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(by.llm.differs).toBe(true)
    expect(by.tags.differs).toBe(false)
    expect(by.llm.cells.map((c) => c.text)).toEqual(['gpt-4o', 'claude'])
  })
  it('has no kind row unless requested', () => {
    expect(buildCompareRows([agent(), agent()]).some((r) => r.key === 'kind')).toBe(false)
    expect(
      buildCompareRows([agent({ kind: 'system' }), agent()], { kinds: true }).find((r) => r.key === 'kind')?.differs
    ).toBe(true)
  })
  it('only allows http(s) github links', () => {
    const rows = buildCompareRows([
      agent({ githubUrl: 'javascript:alert(1)' }),
      agent({ githubUrl: 'https://github.com/x/y' }),
    ])
    const gh = rows.find((r) => r.key === 'github')!
    expect(gh.cells[0].href).toBeUndefined()
    expect(gh.cells[1].href).toBe('https://github.com/x/y')
  })
  it('renders tailorable fields and input names', () => {
    const rows = buildCompareRows([
      agent({ customizableFields: ['systemPrompt'], inputFields: [{ name: 'topic' }] }),
      agent(),
    ])
    expect(rows.find((r) => r.key === 'tailorable')!.cells.map((c) => c.text)).toEqual(['systemPrompt', 'All fields'])
    expect(rows.find((r) => r.key === 'invocation')!.cells[0].text).toBe('topic')
  })
})

describe('loader extension helpers', () => {
  const url = new URL('http://x/catalog?compare=a,b,../x')
  it('add no keys when the flag is off', () => {
    expect(catalogCompareData(url, {})).toEqual({})
    expect(layoutCompareData({})).toEqual({})
  })
  it('add keys when on, validated', () => {
    expect(catalogCompareData(url, { AGENT_COMPARE: '1' })).toEqual({ compareEnabled: true, compare: ['a', 'b'] })
    expect(layoutCompareData({ AGENT_COMPARE: '1' })).toEqual({ compareEnabled: true })
  })
})
