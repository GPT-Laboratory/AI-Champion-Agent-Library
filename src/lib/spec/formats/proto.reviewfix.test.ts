// Phase 13 review fix WR-06: author-controlled keys never corrupt stored extras or the prototype chain.
import { describe, expect, it } from 'vitest'
import { parseSubmission } from '../registry.js'

const NOW = '2026-01-01T00:00:00.000Z'
const parse = (path: string, text: string) => parseSubmission([{ path, text }], { now: NOW })

describe('WR-06 author-controlled keys', () => {
  const flow = [
    'component_type: Flow',
    'name: Proto Flow',
    'start_node: n1',
    'nodes:',
    '  - {id: n1, component_type: constructor, name: One}',
    '  - {id: n2, component_type: toString, name: Two}',
    '  - {id: n3, component_type: constructor, name: Three}',
    '  - {id: n4, component_type: AgentNode, name: Four, agent: {id: ag, component_type: Agent, name: Inner}}',
    'control_flow_connections: []',
    '',
  ].join('\n')

  it('counts node types by value, never reading inherited members', () => {
    const out = parse('flow.yaml', flow)
    expect(out.kindInfo?.extras.nodeTypes).toEqual({ constructor: 2, toString: 1, AgentNode: 1 })
    expect(JSON.stringify(out.kindInfo?.extras)).not.toContain('native code')
  })

  it('keeps members whose ref is constructor or toString as plain data', () => {
    const swarm = [
      'component_type: Swarm',
      'name: Proto Swarm',
      'first_agent: {id: constructor, name: C, component_type: Agent, tools: [x]}',
      'agents: [{id: toString, name: T, component_type: Agent, tools: [y]}]',
      '',
    ].join('\n')
    const out = parse('s.yaml', swarm)
    const fields = out.kindInfo?.extras.memberFields as Record<string, unknown>
    expect(Object.keys(fields).sort()).toEqual(['constructor', 'toString'])
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype)
  })

  it('does not let a __proto__ key replace the prototype of extras', () => {
    const doc = '{"component_type":"A2AAgent","name":"P","agent_url":"https://e.test/a","__proto__":{"polluted":1},"extra":2}'
    const out = parse('a.json', doc)
    const extras = out.kindInfo!.extras
    expect(Object.getPrototypeOf(extras)).toBe(Object.prototype)
    expect((extras as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(extras.extra).toBe(2)
  })

  it('does the same for catalog.yaml, skill frontmatter, crew and server.json unknown keys', () => {
    const cases: Array<[string, string]> = [
      ['catalog.yaml', 'name: A\n"__proto__": {polluted: 1}\nconstructor: keep\n'],
      ['SKILL.md', '---\nname: a\ndescription: d\n"__proto__": {polluted: 1}\nconstructor: keep\n---\nbody\n'],
      ['crew.json', '{"name":"C","agents":[],"__proto__":{"polluted":1},"constructor":"keep"}'],
      ['server.json', '{"name":"a/b","packages":[],"__proto__":{"polluted":1},"constructor":"keep"}'],
      ['langgraph.json', '{"graphs":{"__proto__":"x.py:g","constructor":"y.py:g"},"__proto__":{"polluted":1},"constructor":"keep"}'],
    ]
    for (const [path, text] of cases) {
      const out = parse(path, text)
      const extras = out.kindInfo?.extras as Record<string, unknown>
      expect(extras, path).toBeDefined()
      expect(Object.getPrototypeOf(extras), path).toBe(Object.prototype)
      expect(extras.polluted, path).toBeUndefined()
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
