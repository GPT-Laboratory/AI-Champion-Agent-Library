import { describe, it, expect } from 'vitest'
import { createSearchService, type AgentRowForSearch } from './index.js'
import {
  buildSearchText,
  contentHash,
  recordToSearchableWithKind,
  rowToSearchableWithKind,
} from './documents.js'
import type { AgentRecord } from '../../spec/types.js'
import type { KindInfo } from '../../spec/kinds.js'

const members = ['Acme Triager', 'Acme Biller']
const rows: AgentRowForSearch[] = [
  {
    slug: 'support-swarm',
    title: 'Support Swarm',
    summary: 'Routes requests',
    category: 'support',
    tags: '[]',
    toolNames: '[]',
    kind: 'system',
    framework: 'crewai',
    memberNames: members,
  },
  { slug: 'hvac', title: 'HVAC Sizer', summary: 'Sizes heating systems', category: 'mep', tags: '[]', toolNames: '[]' },
]

function svc(r: AgentRowForSearch[]) {
  return createSearchService({
    loadAgents: () => ({ rows: r, fingerprint: 'x' }),
    loadVectors: () => [],
    getEmbedder: async () => null,
  })
}

describe('flag-on search rows', () => {
  it('finds a system by member name and by framework', async () => {
    const s = svc(rows)
    expect((await s.search('Triager')).results[0].slug).toBe('support-swarm')
    expect((await s.search('crewai')).results[0].slug).toBe('support-swarm')
  })

  it('kind-less rows behave as before (member name not found)', async () => {
    const s = svc(rows.map(({ kind, framework, memberNames, ...rest }) => rest))
    expect((await s.search('Triager')).results).toHaveLength(0)
  })

  it('row path text and hash equal the ingest (record) path', () => {
    const info: KindInfo = {
      kind: 'system',
      framework: 'crewai',
      topology: 'swarm',
      members: members.map((name) => ({ ref: name, name, role: 'peer' as const, description: null, slug: null })),
      sourceFormat: 'x',
      extras: {},
    }
    const record = {
      slug: 'support-swarm',
      title: 'Support Swarm',
      summary: 'Routes requests',
      category: 'support',
      tags: [],
      toolNames: [],
    } as unknown as AgentRecord
    const row = { slug: 'support-swarm', title: 'Support Swarm', summary: 'Routes requests', category: 'support', tags: '[]', toolNames: '[]' }
    const a = buildSearchText(recordToSearchableWithKind(record, info))
    const b = buildSearchText(rowToSearchableWithKind(row, info))
    expect(b).toBe(a)
    expect(contentHash('m', b)).toBe(contentHash('m', a))
  })
})
