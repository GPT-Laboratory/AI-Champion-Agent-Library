import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crewaiAdapter as adapter, stripJsonc } from './crewai.js'

const NOW = '2026-01-01T00:00:00.000Z'
const root = join(process.cwd(), 'fixtures/submissions')
const rd = (p: string) => ({ path: p.split('/').slice(1).join('/'), text: readFileSync(join(root, p), 'utf8') })
const jsoncFiles = () => [
  rd('crewai-jsonc/crew.jsonc'),
  rd('crewai-jsonc/agents/example-researcher.jsonc'),
  rd('crewai-jsonc/agents/example-writer.jsonc'),
]
const yamlFiles = () => [rd('crewai-yaml/config/agents.yaml'), rd('crewai-yaml/config/tasks.yaml')]
const parse = (f: { path: string; text: string }[]) => adapter.parse(f, { now: NOW })

describe('stripJsonc', () => {
  it('keeps // inside strings, strips comments and trailing commas', () => {
    const t = '{"a": "x // y", /* c */ "b": [1, 2,], // tail\n "c": "/* no */",}'
    expect(JSON.parse(stripJsonc(t))).toEqual({ a: 'x // y', b: [1, 2], c: '/* no */' })
  })
  it('handles escaped quotes and unterminated input without throwing', () => {
    expect(JSON.parse(stripJsonc('{"a": "q\\" // z"}'))).toEqual({ a: 'q" // z' })
    expect(() => stripJsonc('{"a": "open /* x')).not.toThrow()
  })
})

describe('crewai adapter', () => {
  it('detects both styles, nothing else', () => {
    expect(adapter.detect(jsoncFiles())?.confidence).toBe(0.85)
    expect(adapter.detect(yamlFiles())?.confidence).toBe(0.8)
    expect(adapter.detect([yamlFiles()[0]!])).toBeNull()
    expect(adapter.detect([{ path: 'a.txt', text: '' }])).toBeNull()
  })

  it('JSONC: sequential crew becomes a pipeline of steps', () => {
    const out = parse(jsoncFiles())
    expect(out.status).toBe('partial')
    expect(out.format).toBe('crewai-jsonc')
    expect(out.kindInfo?.kind).toBe('system')
    expect(out.kindInfo?.framework).toBe('crewai')
    expect(out.kindInfo?.topology).toBe('pipeline')
    expect(out.kindInfo?.members.map((m) => [m.ref, m.name, m.role, m.description])).toEqual([
      ['example-researcher', 'Example Researcher', 'step', 'Find reliable facts about a topic'],
      ['example-writer', 'Example Writer', 'step', 'Turn research notes into a short brief'],
    ])
    expect(out.record?.slug).toBe('example-research-crew')
    expect(out.record?.summary).toContain('// not a comment inside a string')
    expect(out.record?.llm.name).toBe('n/a')
    expect(out.missingFromAuthor).toEqual(['category', 'tags', 'github_url'])
    const x = out.kindInfo!.extras
    expect(x.models).toEqual(['example-model-large', 'example-model-small'])
    expect(x.unloadedToolRefs).toEqual(['custom:example_search', 'python:example_pkg.tools.search_tool'])
    expect(out.warnings.join(' ')).toContain('not loaded')
    expect(out.record?.toolNames).toEqual([])
  })

  it('JSONC: hierarchical with manager_agent naming a member puts it first', () => {
    const files = jsoncFiles()
    files[0] = {
      path: 'crew.jsonc',
      text: '{"name":"H","process":"hierarchical","manager_agent":"example-writer","agents":["example-researcher","example-writer"]}',
    }
    const out = parse(files)
    expect(out.kindInfo?.topology).toBe('manager-workers')
    expect(out.kindInfo?.members.map((m) => [m.ref, m.role])).toEqual([
      ['example-writer', 'manager'],
      ['example-researcher', 'worker'],
    ])
  })

  it('JSONC: manager_llm alone is hierarchical with all workers', () => {
    const out = parse([{ path: 'crew.json', text: '{"name":"M","manager_llm":"m1","agents":[{"role":"A","goal":"g"}]}' }])
    expect(out.kindInfo?.topology).toBe('manager-workers')
    expect(out.kindInfo?.members[0]?.role).toBe('worker')
    expect(out.kindInfo?.extras.models).toEqual(['m1'])
  })

  it('JSONC: unknown keys are preserved', () => {
    const out = parse([{ path: 'crew.jsonc', text: '{"name":"U","agents":[],"weird":{"a":1}}' }])
    expect(out.unknownFields).toEqual(['weird'])
    expect(out.kindInfo?.extras.unknown).toEqual({ weird: { a: 1 } })
  })

  it('YAML: agents, tasks and the custom tool ref', () => {
    const out = parse(yamlFiles())
    expect(out.format).toBe('crewai-yaml')
    expect(out.kindInfo?.topology).toBe('pipeline')
    expect(out.kindInfo?.members.map((m) => [m.ref, m.name, m.description])).toEqual([
      ['planner', 'Example Planner', 'Break a request into steps'],
      ['reviewer', 'Example Reviewer', 'Check the output for mistakes'],
    ])
    expect(out.kindInfo?.extras.tasks).toEqual([
      { name: 'plan_task', agent: 'planner', context: [], description: 'Plan the work for the request.' },
      { name: 'review_task', agent: 'reviewer', context: ['plan_task'], description: 'Review the plan.' },
    ])
    expect(out.kindInfo?.extras.unloadedToolRefs).toEqual(['custom:example_tool'])
    expect(out.status).toBe('partial')
    expect(out.missingFromAuthor).toContain('name')
    expect(out.warnings.join(' ')).toContain('assumed sequential')
  })

  it('malformed input returns outcomes and never throws', () => {
    const bad = parse([{ path: 'crew.jsonc', text: '{not json' }])
    expect(bad.status).toBe('missing-from-author')
    expect(bad.missingFromAuthor).toEqual(['valid crew.jsonc'])
    const badYaml = parse([
      { path: 'config/agents.yaml', text: 'a: [unclosed' },
      { path: 'config/tasks.yaml', text: 'x: 1' },
    ])
    expect(badYaml.status).toBe('missing-from-author')
    expect(parse([{ path: 'x.txt', text: '' }]).status).toBe('missing-from-author')
  })
})
