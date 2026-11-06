// Phase 13 review fixes: WR-02 (shallowest candidate wins, ignored files are reported) and
// WR-03 (over-broad detectors no longer turn unrelated files into catalog entries).
import { describe, expect, it } from 'vitest'
import { detectFormats, parseSubmission } from '../registry.js'
import { byShallowest, ignoredWarning } from '../paths.js'

const NOW = '2026-01-01T00:00:00.000Z'
const f = (path: string, text: string) => ({ path, text })
const parse = (files: Array<{ path: string; text: string }>) => parseSubmission(files, { now: NOW })
const detected = (files: Array<{ path: string; text: string }>) => detectFormats(files).map((d) => d.format)

describe('paths helpers', () => {
  it('orders shallowest first, then alphabetically', () => {
    expect(byShallowest(['b/x', 'a/b/x', 'x', 'a/x'], (p) => p)).toEqual(['x', 'a/x', 'b/x', 'a/b/x'])
  })
  it('summarises ignored files', () => {
    expect(ignoredWarning('x', 'a', [])).toBeNull()
    expect(ignoredWarning('x', 'a', ['b', 'c'])).toBe('x: using a; 2 other file(s) ignored: b, c')
    expect(ignoredWarning('x', 'a', ['1', '2', '3', '4', '5', '6', '7'])).toContain('+2 more')
  })
})

describe('WR-02 shallowest candidate wins and the rest is reported', () => {
  it('SKILL.md at the root beats AAA/SKILL.md', () => {
    const skill = (n: string) => `---\nname: ${n}\ndescription: d\n---\nbody\n`
    const out = parse([f('AAA/SKILL.md', skill('aaa')), f('SKILL.md', skill('root-skill'))])
    expect(out.record?.slug).toBe('root-skill')
    expect(out.warnings.join('\n')).toContain('AAA/SKILL.md')
  })

  it('crew.json at the root beats a crew.json in a subfolder', () => {
    const crew = (n: string) => JSON.stringify({ name: n, agents: [{ role: 'r', goal: 'g' }] })
    const out = parse([f('AAA/crew.json', crew('Nested')), f('crew.json', crew('Root'))])
    expect(out.record?.title).toBe('Root')
    expect(out.warnings.join('\n')).toContain('AAA/crew.json')
  })

  it('catalog.yaml at the root beats nested catalog.yaml', () => {
    const out = parse([f('AAA/catalog.yaml', 'name: Nested\n'), f('catalog.yaml', 'name: Root\n')])
    expect(out.record?.title).toBe('Root')
    expect(out.warnings.join('\n')).toContain('AAA/catalog.yaml')
  })

  it('server.json and langgraph.json prefer the shallowest file', () => {
    const srv = (n: string) => JSON.stringify({ name: n, packages: [] })
    const mcp = parse([f('AAA/server.json', srv('nested/one')), f('server.json', srv('root/one'))])
    expect(mcp.record?.specId).toBe('root/one')
    expect(mcp.warnings.join('\n')).toContain('AAA/server.json')
    const lg = JSON.stringify({ graphs: { a: './a.py:g' } })
    const lgOut = parseSubmission([f('AAA/langgraph.json', lg), f('langgraph.json', lg)], { now: NOW, hint: 'proj' })
    expect(lgOut.record?.slug).toBe('proj')
    expect(lgOut.warnings.join('\n')).toContain('AAA/langgraph.json')
  })

  it('Oracle: reports every other definition left out of the single record', () => {
    const agent = (n: string) => `component_type: Agent\nname: ${n}\ndescription: d\nsystem_prompt: p\nllm_config: {name: m}\n`
    const out = parse([f('b.yaml', agent('Beta')), f('a/agent.yaml', agent('Alpha')), f('top.yaml', agent('Top'))])
    expect(out.record?.title).toBe('Beta')
    expect(out.warnings.join('\n')).toContain('2 other file(s) ignored: top.yaml, a/agent.yaml')
  })

  it('Oracle: a system still outranks a plain agent and the agent is reported', () => {
    const sys = 'component_type: Swarm\nname: Team\nfirst_agent: {id: a, name: A, component_type: Agent}\n'
    const agent = 'component_type: Agent\nname: Lone\ndescription: d\nsystem_prompt: p\nllm_config: {name: m}\n'
    const out = parse([f('agent.yaml', agent), f('sub/team.yaml', sys)])
    expect(out.kindInfo?.kind).toBe('system')
    expect(out.warnings.join('\n')).toContain('agent.yaml')
  })

  it('a lone candidate produces no ignored-files warning', () => {
    const out = parse([f('catalog.yaml', 'name: Only\n')])
    expect(out.warnings.join('\n')).not.toContain('ignored')
  })
})

describe('WR-03 detectors need content signals', () => {
  it('an unrelated crew.json is not a CrewAI crew', () => {
    expect(detected([f('crew.json', '{"films":[1,2]}')])).toEqual([])
    expect(detected([f('crew.jsonc', '[1,2,3]')])).toEqual([])
    expect(parse([f('crew.json', '{"films":[1,2]}')]).record).toBeNull()
  })
  it('crew.json with agents or tasks, or with sibling agent files, is a crew', () => {
    expect(detected([f('crew.json', '{"agents":[]}')])).toEqual(['crewai-jsonc'])
    expect(detected([f('crew.json', '{"tasks":{"t":{}}}')])).toEqual(['crewai-jsonc'])
    expect(detected([f('crew.json', '{"name":"x"}'), f('agents/a.json', '{"role":"r"}')])).toEqual(['crewai-jsonc'])
    expect(detected([f('crew.json', '{"name":"x"}'), f('other/agents/a.json', '{"role":"r"}')])).toEqual([])
  })
  it('a malformed crew.json is still detected so the author hears about it', () => {
    const out = parse([f('crew.json', '{"agents": [ oops')])
    expect(out.format).toBe('crewai-jsonc')
    expect(out.missingFromAuthor).toEqual(['valid crew.jsonc'])
  })
  it('a crew.json no longer outranks a real SKILL.md', () => {
    const files = [f('crew.json', '{"films":[1]}'), f('SKILL.md', '---\nname: real\ndescription: d\n---\nb\n')]
    expect(detected(files)).toEqual(['agent-skill'])
  })

  const blog = '---\nname: My blog post\ndescription: Thoughts\n---\nLong body that must not become a system prompt.\n'
  it('markdown with name and description but no agent signal is not a subagent', () => {
    expect(detected([f('docs/post.md', blog)])).toEqual([])
    expect(detected([f('CHANGELOG.md', blog)])).toEqual([])
    expect(parse([f('docs/post.md', blog)]).record).toBeNull()
  })
  it('a subagent is recognised by tools or model keys, or by an agents/ folder', () => {
    expect(detected([f('x.md', blog.replace('description: Thoughts', 'description: T\ntools: Read'))])).toEqual(['claude-subagent'])
    expect(detected([f('x.md', blog.replace('description: Thoughts', 'description: T\nmodel: opus'))])).toEqual(['claude-subagent'])
    expect(detected([f('.claude/agents/x.md', blog)])).toEqual(['claude-subagent'])
    expect(detected([f('agents/x.md', blog)])).toEqual(['claude-subagent'])
    expect(detected([f('not-agents/x.md', blog)])).toEqual([])
  })
})
