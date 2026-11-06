import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { oracleSystemsAdapter as adapter } from './oracle-systems.js'
import { detectFormat, normalize } from '../index.js'
import { parse as parseYaml } from 'yaml'

const NOW = '2026-01-01T00:00:00.000Z'
function fx(dir: string, file: string) {
  const text = readFileSync(join(process.cwd(), 'fixtures/submissions', dir, file), 'utf8')
  return [{ path: file, text }]
}
const parse = (files: { path: string; text: string }[]) => adapter.parse(files, { now: NOW })
const yml = (text: string) => [{ path: 'x.yaml', text }]

describe('oracle systems adapter', () => {
  it('Swarm: first agent first, peers, relationships preserved', () => {
    const out = parse(fx('oracle-swarm', 'swarm.yaml'))
    expect(out.status).toBe('ingestible')
    expect(out.kindInfo?.kind).toBe('system')
    expect(out.kindInfo?.framework).toBe('oracle-agentspec')
    expect(out.kindInfo?.topology).toBe('swarm')
    expect(out.kindInfo?.members.map((m) => [m.ref, m.name, m.role, m.slug])).toEqual([
      ['triage-agent', 'Example Triage Agent', 'peer', null],
      ['billing-agent', 'Example Billing Agent', 'peer', null],
      ['tech-agent', 'Example Technical Agent', 'peer', null],
    ])
    expect(out.kindInfo?.members[0]?.description).toBe('Classifies incoming requests.')
    const rel = out.kindInfo?.extras.relationships as unknown[]
    expect(rel).toHaveLength(2)
    expect(JSON.stringify(rel[0])).toContain('$component_ref')
    expect(out.kindInfo?.extras.handoff).toBe('optional')
    expect(out.kindInfo?.sourceFormat).toBe('oracle-agentspec@25.4.1')
    expect(out.record?.slug).toBe('example-support-swarm')
    expect(out.record?.category).toBe('Support')
    expect(out.record?.llm.name).toBe('n/a')
    expect(out.record?.systemPrompt).toBe('')
    expect(out.record?.lastIngestedAt).toBe(NOW)
  })

  it('ManagerWorkers: manager then workers', () => {
    const out = parse(fx('oracle-manager-workers', 'team.yaml'))
    expect(out.kindInfo?.topology).toBe('manager-workers')
    expect(out.kindInfo?.members.map((m) => m.role)).toEqual(['manager', 'worker', 'worker'])
    expect(out.kindInfo?.sourceFormat).toBe('oracle-agentspec@unknown')
    expect(out.status).toBe('ingestible')
  })

  it('Flow: AgentNodes in control-flow order, other nodes counted', () => {
    const out = parse(fx('oracle-flow', 'flow.yaml'))
    expect(out.kindInfo?.topology).toBe('pipeline')
    expect(out.kindInfo?.members.map((m) => [m.name, m.role])).toEqual([
      ['Example Drafter', 'step'],
      ['Example Reviewer', 'step'],
    ])
    expect(out.kindInfo?.extras.nodeTypes).toEqual({ AgentNode: 2, LLMNode: 1, FlowNode: 1 })
  })

  it('A2AAgent: external-agent, url kept as text', () => {
    const out = parse(fx('oracle-a2a', 'remote.yaml'))
    expect(out.kindInfo?.kind).toBe('external-agent')
    expect(out.kindInfo?.topology).toBeNull()
    expect(out.kindInfo?.extras.agentUrl).toBe('https://example.com/a2a/agent')
  })

  it('single Agent delegates to normalize()', () => {
    const files = fx('oracle-single-agent', 'agent.yaml')
    const out = parse(files)
    const raw = parseYaml(files[0]!.text)
    expect(out.kindInfo?.kind).toBe('agent')
    expect(out.kindInfo?.framework).toBe('oracle-agentspec')
    expect(out.record).toEqual({ ...normalize(detectFormat(raw), raw), lastIngestedAt: NOW })
  })

  it('accepts `type` as discriminator; unknown type does not detect', () => {
    const out = parse(yml('type: Swarm\nname: Example\nfirst_agent: {id: a, name: A, component_type: Agent}\n'))
    expect(out.kindInfo?.topology).toBe('swarm')
    expect(adapter.detect(yml('type: Gizmo\nname: x\n'))).toBeNull()
    expect(adapter.detect(yml('name: x\n'))).toBeNull()
    expect(adapter.detect(yml('::: not yaml {{'))).toBeNull()
  })

  it('lists missing metadata as partial', () => {
    const out = parse(yml('component_type: ManagerWorkers\nname: Example\ngroup_manager: {id: m, name: M, component_type: Agent}\n'))
    expect(out.status).toBe('partial')
    expect(out.missingFromAuthor).toEqual(['summary', 'category', 'tags', 'github_url', 'maturity'])
  })

  it('unresolved refs keep the ref string with a warning; duplicate ids warn', () => {
    const out = parse(
      yml(
        [
          'component_type: Swarm', 'name: Example', 'first_agent: {$component_ref: ghost}',
          'agents:', '  - {id: d, name: D1, component_type: Agent}', '  - {id: d, name: D2, component_type: Agent}',
        ].join('\n'),
      ),
    )
    expect(out.kindInfo?.members[0]).toMatchObject({ ref: 'ghost', name: 'ghost' })
    expect(out.warnings.some((w) => w.includes('ghost'))).toBe(true)
    expect(out.warnings.some((w) => w.includes('duplicate component id: d'))).toBe(true)
  })

  it('preserves unknown fields and redacts secret-like values in extras', () => {
    const out = parse(
      yml(
        [
          'component_type: Swarm', 'name: Example', 'custom_thing: {a: 1}',
          'first_agent: {id: a, name: A, component_type: Agent, llm_config: {name: m, api_key: sk-abcdefgh1234}}',
        ].join('\n'),
      ),
    )
    expect(out.unknownFields).toContain('custom_thing')
    expect(out.kindInfo?.extras.custom_thing).toEqual({ a: 1 })
    expect(JSON.stringify(out.kindInfo?.extras)).not.toContain('sk-abcdefgh1234')
    expect(JSON.stringify(out.kindInfo?.extras)).toContain('[redacted]')
    expect(out.warnings.some((w) => w.includes('redacted'))).toBe(true)
  })

  it('caps members and requires a name', () => {
    const agents = Array.from({ length: 60 }, (_, i) => `  - {id: a${i}, name: A${i}, component_type: Agent}`)
    const out = parse(yml(['component_type: Swarm', 'name: Big', 'agents:', ...agents].join('\n')))
    expect(out.kindInfo?.members).toHaveLength(50)
    expect(out.warnings.some((w) => w.includes('capped'))).toBe(true)
    const noName = parse(yml('component_type: Swarm\nagents: []\n'))
    expect(noName.status).toBe('missing-from-author')
    expect(noName.record).toBeNull()
  })
})
