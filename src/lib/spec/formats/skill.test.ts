import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { skillAdapter as adapter } from './skill.js'

const NOW = '2026-01-01T00:00:00.000Z'
function fx(dir: string, file: string, as?: string) {
  const text = readFileSync(join(process.cwd(), 'fixtures/submissions', dir, file), 'utf8')
  return [{ path: as ?? `${dir}/${file}`, text }]
}
const parse = (files: { path: string; text: string }[]) => adapter.parse(files, { now: NOW })
const md = (path: string, text: string) => [{ path, text }]

describe('skill adapter: SKILL.md', () => {
  it('ingests the fixture as kind skill, never agent', () => {
    const files = fx('skill-example', 'SKILL.md')
    expect(adapter.detect(files)).toEqual({ format: 'agent-skill', confidence: 0.8 })
    const out = parse(files)
    expect(out.format).toBe('agent-skill')
    expect(out.kindInfo?.kind).toBe('skill')
    expect(out.kindInfo?.framework).toBe('agent-skills')
    expect(out.record?.title).toBe('skill-example')
    expect(out.record?.summary).toContain('meeting notes')
    expect(out.record?.systemPrompt).toBe('')
    expect(out.record?.llm.name).toBe('n/a')
    expect(out.record?.toolNames).toEqual(['Read', 'Grep'])
    expect(out.kindInfo?.extras.license).toBe('MIT')
    expect(out.kindInfo?.extras.metadata).toEqual({ author: 'example-org', version: '1.0' })
    expect(String(out.kindInfo?.extras.bodyExcerpt)).toContain('Meeting summariser')
    expect(out.warnings).toEqual([])
    expect(out.status).toBe('partial')
    expect(out.missingFromAuthor).toEqual(['category'])
  })

  it('lists scripts/references/assets paths without reading them', () => {
    const files = [
      ...fx('skill-example', 'SKILL.md'),
      { path: 'skill-example/scripts/run.sh', text: 'echo SHOULD-NOT-APPEAR' },
      { path: 'skill-example/references/guide.md', text: '# g' },
      { path: 'other/scripts/x.py', text: '' },
    ]
    const out = parse(files)
    expect(out.kindInfo?.extras.files).toEqual({
      scripts: ['skill-example/scripts/run.sh'],
      references: ['skill-example/references/guide.md'],
    })
    expect(JSON.stringify(out)).not.toContain('SHOULD-NOT-APPEAR')
  })

  it('limits give warnings and missingFromAuthor, not exceptions', () => {
    const long = 'a'.repeat(65)
    const out = parse(md(`${long}/SKILL.md`, `---\nname: ${long}\ndescription: ${'d'.repeat(1025)}\ncompatibility: ${'c'.repeat(501)}\n---\nbody`))
    expect(out.status).toBe('partial')
    expect(out.missingFromAuthor).toContain('valid skill name')
    expect(out.warnings.join('|')).toContain('max 64')
    expect(out.warnings.join('|')).toContain('max 1024')
    expect(out.warnings.join('|')).toContain('max 500')
    const bad = parse(md('Foo_Bar/SKILL.md', '---\nname: Foo_Bar\ndescription: x\n---\n'))
    expect(bad.missingFromAuthor).toContain('valid skill name')
    const mismatch = parse(md('one/SKILL.md', '---\nname: two\ndescription: x\n---\n'))
    expect(mismatch.warnings.join('|')).toContain('does not match directory')
  })

  it('missing name/description and bad frontmatter', () => {
    expect(parse(md('s/SKILL.md', '---\ndescription: x\n---\n')).missingFromAuthor).toEqual(['name'])
    const bad = parse(md('s/SKILL.md', '---\nname: s\n: : [\n---\n'))
    expect(bad.status).toBe('missing-from-author')
    expect(bad.missingFromAuthor).toEqual(['frontmatter with name and description'])
    const unterminated = parse(md('s/SKILL.md', '---\nname: s\ndescription: x\n'))
    expect(unterminated.missingFromAuthor).toEqual(['frontmatter with name and description'])
  })

  it('preserves unknown keys and redacts secrets', () => {
    const out = parse(md('s/SKILL.md', '---\nname: s\ndescription: x\nweird: 1\napi_key: abc\n---\n'))
    expect(out.unknownFields).toEqual(['weird', 'api_key'])
    expect(out.kindInfo?.extras.weird).toBe(1)
    expect(out.kindInfo?.extras.api_key).toBe('[redacted]')
  })
})

describe('skill adapter: Claude subagent', () => {
  it('ingests the fixture as agent, alias not stored as model', () => {
    const files = fx('claude-subagent', 'example-reviewer.md', '.claude/agents/example-reviewer.md')
    expect(adapter.detect(files)).toEqual({ format: 'claude-subagent', confidence: 0.6 })
    const out = parse(files)
    expect(out.format).toBe('claude-subagent')
    expect(out.kindInfo?.kind).toBe('agent')
    expect(out.kindInfo?.framework).toBe('claude-subagent')
    expect(out.record?.slug).toBe('example-reviewer')
    expect(out.record?.systemPrompt).toContain('careful reviewer')
    expect(out.record?.toolNames).toEqual(['Read', 'Grep', 'Glob'])
    expect(out.record?.llm.name).toBe('n/a')
    expect(out.kindInfo?.extras.modelAlias).toBe('sonnet')
    expect(out.kindInfo?.extras.permissionMode).toBe('default')
    expect(out.kindInfo?.extras.maxTurns).toBe(8)
    expect(out.unknownFields).toEqual(['permissionMode', 'maxTurns'])
  })

  it('real model strings are kept; tools may be a list; every alias is hidden', () => {
    const real = parse(md('agents/a.md', '---\nname: a\ndescription: d\nmodel: example-model-1\ntools:\n  - Read\n  - Bash\n---\nPrompt'))
    expect(real.record?.llm.name).toBe('example-model-1')
    expect(real.record?.toolNames).toEqual(['Read', 'Bash'])
    expect(real.kindInfo?.extras.modelAlias).toBeUndefined()
    for (const alias of ['inherit', 'sonnet', 'opus', 'haiku']) {
      const o = parse(md('a.md', `---\nname: a\ndescription: d\nmodel: ${alias}\n---\nP`))
      expect(o.record?.llm.name).toBe('n/a')
      expect(o.kindInfo?.extras.modelAlias).toBe(alias)
    }
  })

  it('plain markdown is not detected', () => {
    expect(adapter.detect(md('README.md', '# Title\n\nSome text'))).toBeNull()
    expect(adapter.detect(md('README.md', '---\ntitle: x\n---\nbody'))).toBeNull()
    expect(adapter.detect(md('a.md', '---\nname: a\n---\nbody'))).toBeNull()
    expect(parse(md('README.md', '# Title')).format).toBe('unknown')
  })

  it('never throws on malformed input', () => {
    for (const files of [[], [null as never], [{ path: 'SKILL.md', text: 5 as never }], undefined as never,
      md('SKILL.md', '---'), md('x.md', '---\n---\n'), md('SKILL.md', '---\n[\n---\n')]) {
      expect(() => parse(files)).not.toThrow()
      expect(() => adapter.detect(files)).not.toThrow()
    }
  })
})
