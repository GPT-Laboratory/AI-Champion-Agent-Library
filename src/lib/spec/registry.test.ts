import { describe, expect, it } from 'vitest'
import { detectFormats, listAdapters, parseSubmission } from './registry.js'

const NOW = '2026-01-01T00:00:00.000Z'

describe('registry', () => {
  it('lists adapters in the documented order', () => {
    expect(listAdapters().map((a) => a.id)).toEqual([
      'oracle-agentspec', 'catalog-manifest', 'skill', 'crewai', 'mcp-server-json', 'langgraph',
    ])
  })
  it.each([
    ['empty list', []],
    ['garbage text', [{ path: 'x.yaml', text: '::: {{{ not yaml \u0000\u0001' }]],
    ['binary-ish', [{ path: 'a.bin', text: '\u0000\u0000ÿ' }]],
    ['scalar yaml', [{ path: 'x.yaml', text: '42' }]],
    ['not an array', undefined as never],
  ])('never throws and reports unrecognized: %s', (_n, files) => {
    const out = parseSubmission(files, { now: NOW })
    expect(out.status).toBe('missing-from-author')
    expect(out.record).toBeNull()
    expect(out.missingFromAuthor[0]).toContain('recognizable agent definition')
  })
  it('parses an Oracle swarm through the registry', () => {
    const files = [{ path: 'swarm.yaml', text: 'component_type: Swarm\nname: Example S\nfirst_agent: {id: a, name: A, component_type: Agent}\n' }]
    expect(detectFormats(files)[0]?.adapter.id).toBe('oracle-agentspec')
    const out = parseSubmission(files, { now: NOW })
    expect(out.kindInfo?.kind).toBe('system')
    expect(out.kindInfo?.members.map((m) => m.name)).toEqual(['A'])
  })
  it('redacts secrets found in extras and warns', () => {
    const files = [
      { path: 'r.yaml', text: 'component_type: A2AAgent\nname: Example R\nconnection_config:\n  api_key: sk-realsecret123\n' },
    ]
    const out = parseSubmission(files, { now: NOW })
    expect(JSON.stringify(out.kindInfo?.extras)).not.toContain('sk-realsecret123')
  })
})
