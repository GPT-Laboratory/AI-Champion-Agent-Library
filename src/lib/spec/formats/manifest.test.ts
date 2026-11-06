import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { manifestAdapter as adapter } from './manifest.js'

const NOW = '2026-01-01T00:00:00.000Z'
function fx(dir: string) {
  const text = readFileSync(join(process.cwd(), 'fixtures/submissions', dir, 'catalog.yaml'), 'utf8')
  return [{ path: 'catalog.yaml', text }]
}
const cat = (text: string) => [{ path: 'catalog.yaml', text }]
const parse = (files: { path: string; text: string }[]) => adapter.parse(files, { now: NOW })

describe('catalog.yaml manifest adapter', () => {
  it('detects catalog.yaml with a name at 0.9, ignores others', () => {
    expect(adapter.detect(fx('manifest-system'))).toEqual({ format: 'catalog-manifest', confidence: 0.9 })
    expect(adapter.detect([{ path: 'sub/catalog.yml', text: 'name: X' }])?.confidence).toBe(0.9)
    expect(adapter.detect([{ path: 'other.yaml', text: 'name: X' }])).toBeNull()
    expect(adapter.detect(cat('name: [unterminated'))).toBeNull()
    expect(adapter.detect(cat('- a\n- b'))).toBeNull()
  })

  it('system fixture: code-only framework with members', () => {
    const out = parse(fx('manifest-system'))
    expect(out.status).toBe('ingestible')
    expect(out.kindInfo?.kind).toBe('system')
    expect(out.kindInfo?.framework).toBe('langgraph')
    expect(out.kindInfo?.topology).toBe('graph')
    expect(out.kindInfo?.members.map((m) => [m.name, m.role])).toEqual([
      ['Planner', 'manager'], ['Searcher', 'worker'], ['Writer', 'step'],
    ])
    expect(out.kindInfo?.sourceFormat).toBe('catalog-manifest@1')
    expect(out.kindInfo?.extras.owner_team).toBe('Acme Labs')
    expect(out.unknownFields).toEqual(['owner_team'])
    expect(out.record?.slug).toBe('example-research-graph')
    expect(out.record?.githubUrl).toBe('https://example.com/acme/research-graph')
    expect(out.record?.linkLabel).toBe('View source')
    expect(out.record?.maturityStatus).toBe('beta')
    expect(out.record?.llm.name).toBe('n/a')
    expect(out.record?.systemPrompt).toBe('')
  })

  it('mcp fixture: tools, env names only', () => {
    const out = parse(fx('manifest-mcp'))
    expect(out.kindInfo?.kind).toBe('mcp-server')
    expect(out.record?.toolNames).toEqual(['get_forecast', 'get_alerts'])
    const mcp = out.kindInfo?.extras.mcp as Record<string, unknown>
    expect(mcp.transport).toBe('stdio')
    expect(mcp.package).toBe('example-weather-mcp')
    expect(mcp.envVarNames).toEqual(['WEATHER_API_KEY', 'WEATHER_REGION'])
    const json = JSON.stringify(out.kindInfo)
    expect(json).not.toContain('sk-this-is')
    expect(json).not.toContain('"eu"')
  })

  it('redacts secret-looking values in unknown keys', () => {
    const out = parse(cat('name: A\ncategory: C\nsummary: S\nextra:\n  api_key: abc123\n'))
    expect((out.kindInfo?.extras.extra as Record<string, string>).api_key).toBe('[redacted]')
    expect(out.warnings.some((w) => w.includes('redacted'))).toBe(true)
  })

  it('missing name -> missing-from-author without throwing', () => {
    const out = parse(cat('summary: no name here\n'))
    expect(out.status).toBe('missing-from-author')
    expect(out.missingFromAuthor).toEqual(['name'])
    expect(out.record).toBeNull()
  })

  it('missing category/summary -> partial; invalid kind and maturity warn', () => {
    const out = parse(cat('name: Bare\nkind: nonsense\nmaturity: stable\n'))
    expect(out.status).toBe('partial')
    expect(out.missingFromAuthor).toEqual(['summary', 'category'])
    expect(out.kindInfo?.kind).toBe('agent')
    expect(out.warnings.join('|')).toContain('invalid kind')
    expect(out.warnings.join('|')).toContain('unknown maturity')
    expect(out.record?.maturityStatus).toBe('experimental')
  })

  it('drops non-http repo_url with a warning', () => {
    const out = parse(cat('name: A\nrepo_url: javascript:alert(1)\n'))
    expect(out.record?.githubUrl).toBeNull()
    expect(out.warnings.join('|')).toContain('repo_url')
    expect(parse(cat('name: A\nrepo_url: file:///etc/passwd\n')).record?.githubUrl).toBeNull()
  })

  it('model string becomes llm.name; members are capped', () => {
    const members = Array.from({ length: 60 }, (_, i) => `  - name: M${i}`).join('\n')
    const out = parse(cat(`name: Big\nmodel: some-model\nkind: system\nmembers:\n${members}\n`))
    expect(out.record?.llm.name).toBe('some-model')
    expect(out.kindInfo?.members).toHaveLength(50)
    expect(out.warnings.join('|')).toContain('capped')
    expect(out.kindInfo?.members[0]?.role).toBe('participant')
  })

  it('never throws on malformed input', () => {
    for (const files of [[], [{ path: 'catalog.yaml', text: ':\n  - [' }], [{ path: 'catalog.yaml', text: '' }],
      [null as never], [{ path: 'catalog.yaml', text: 5 as never }], undefined as never]) {
      expect(() => parse(files)).not.toThrow()
      expect(parse(files).record).toBeNull()
    }
    const bad = parse(cat('name: A\nmembers: nope\ntags: 5\ntools: x\n'))
    expect(bad.kindInfo?.members).toEqual([])
    expect(bad.warnings.join('|')).toContain('members is not a list')
  })
})
