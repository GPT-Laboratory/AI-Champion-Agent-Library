// Phase 13 review fixes at registry level: CR-01, WR-10, CR-03, CR-02 (slug), WR-07, IN-02.
import { describe, expect, it } from 'vitest'
import { parseSubmission } from './registry.js'
import { safeHttpUrl } from '../safeUrl.js'

const NOW = '2026-01-01T00:00:00.000Z'
const SK = 'sk-abcdefghijklmnopqrstuvwx'

describe('safeHttpUrl', () => {
  it('accepts http(s) only', () => {
    expect(safeHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeHttpUrl(' http://example.com ')).toBe('http://example.com')
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'example.com', '', null, 3]) {
      expect(safeHttpUrl(bad)).toBeNull()
    }
  })
})

describe('registry redaction is unconditional (CR-01)', () => {
  it('redacts an inline sk- token in crewai member text and task descriptions with no other finding', () => {
    const crew = JSON.stringify({
      name: 'Crew A',
      agents: [{ role: 'r', goal: `key ${SK} here` }],
      tasks: [{ name: 't', description: `use ${SK}` }],
    })
    const out = parseSubmission([{ path: 'crew.json', text: crew }], { now: NOW })
    const all = JSON.stringify([out.kindInfo?.members, out.kindInfo?.extras])
    expect(all).not.toContain(SK)
    expect(all).toContain('[redacted]')
    expect(out.warnings.some((w) => w.startsWith('secret-like values redacted'))).toBe(true)
  })

  it('redacts nested credentials stored under A2A connection_config', () => {
    const yaml = [
      'component_type: A2AAgent',
      'name: Remote',
      'agent_url: https://example.com/a2a',
      'connection_config:',
      '  credentials:',
      '    user: bob',
      '    pass: hunter2',
      '  session: abc123',
      '',
    ].join('\n')
    const out = parseSubmission([{ path: 'r.yaml', text: yaml }], { now: NOW })
    const extras = JSON.stringify(out.kindInfo?.extras)
    expect(extras).not.toMatch(/bob|hunter2|abc123/)
  })

  it('does not warn twice for values an adapter already redacted (IN-02)', () => {
    const yaml = 'component_type: A2AAgent\nname: R\nconnection_config:\n  headers:\n    Authorization: Bearer abcdefghijklmnopqrstuvwx\n'
    const out = parseSubmission([{ path: 'r.yaml', text: yaml }], { now: NOW })
    expect(out.warnings.filter((w) => w.startsWith('secret-like values redacted'))).toHaveLength(1)
  })

  it('reports values nested too deep to inspect', () => {
    let deep: Record<string, unknown> = { v: 'x' }
    for (let i = 0; i < 30; i++) deep = { d: deep }
    const crew = JSON.stringify({ name: 'Deep', agents: [{ role: 'r' }], ...deep })
    const out = parseSubmission([{ path: 'crew.json', text: crew }], { now: NOW })
    expect(out.warnings.some((w) => w.includes('nesting too deep'))).toBe(true)
  })
})

describe('free text in the record is scanned (WR-10)', () => {
  const sub = (body: string, desc = `Reviews ${SK} code`) => [
    {
      path: '.claude/agents/rev.md',
      text: `---\nname: reviewer\ndescription: ${desc}\ntools: Read\n---\n${body}\n`,
    },
  ]
  it('redacts inline tokens in the subagent system prompt, summary and warns', () => {
    const out = parseSubmission(sub(`Example: export KEY=${SK}\nand ghp_abcdefghijklmnopqrstuvwxyz0123456789`), { now: NOW })
    expect(out.record?.systemPrompt).not.toContain(SK)
    expect(out.record?.systemPrompt).not.toContain('ghp_')
    expect(out.record?.summary).not.toContain(SK)
    expect(out.warnings.join('\n')).toContain('redacted in record text')
  })
  it('leaves clean prompts byte-identical', () => {
    const out = parseSubmission(sub('You review code carefully.', 'Reviews code'), { now: NOW })
    expect(out.record?.systemPrompt).toBe('You review code carefully.')
    expect(out.warnings.join('\n')).not.toContain('record text')
  })
})

describe('record URL is http(s) or dropped (CR-03)', () => {
  const swarm = (url: string) =>
    [
      'component_type: Swarm',
      'name: Example S',
      `metadata: {github_url: "${url}", category: C}`,
      'first_agent: {id: a, name: A, component_type: Agent}',
      '',
    ].join('\n')
  it.each(['javascript:alert(document.cookie)', 'data:text/html,x', 'vbscript:x'])('drops %s', (url) => {
    const out = parseSubmission([{ path: 's.yaml', text: swarm(url) }], { now: NOW })
    expect(out.record?.githubUrl).toBeNull()
    expect(out.warnings).toContain('github_url is not an http(s) URL; dropped')
  })
  it('keeps a real https url', () => {
    const out = parseSubmission([{ path: 's.yaml', text: swarm('https://github.com/x/y') }], { now: NOW })
    expect(out.record?.githubUrl).toBe('https://github.com/x/y')
    expect(out.warnings).not.toContain('github_url is not an http(s) URL; dropped')
  })
})
