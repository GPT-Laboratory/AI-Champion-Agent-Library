import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mcpServerJsonAdapter as adapter } from './mcp-server-json.js'

const NOW = '2026-01-01T00:00:00.000Z'
const fixture = () => [
  { path: 'server.json', text: readFileSync(join(process.cwd(), 'fixtures/submissions/mcp-server-json/server.json'), 'utf8') },
]
const one = (obj: unknown) => [{ path: 'server.json', text: JSON.stringify(obj) }]
const parse = (f: { path: string; text: string }[]) => adapter.parse(f, { now: NOW })

describe('mcp server.json adapter', () => {
  it('detects registry server.json only', () => {
    expect(adapter.detect(fixture())?.confidence).toBe(0.85)
    expect(adapter.detect(one({ name: 'x/y' }))).toBeNull()
    expect(adapter.detect(one({ name: 'x/y', $schema: 'https://static.modelcontextprotocol.io/s.json' }))).not.toBeNull()
    expect(adapter.detect([{ path: 'package.json', text: '{"name":"a","packages":[]}' }])).toBeNull()
    expect(adapter.detect([{ path: 'server.json', text: '{bad' }])).toBeNull()
  })

  it('parses the fixture into an mcp-server record', () => {
    const out = parse(fixture())
    expect(out.status).toBe('partial')
    expect(out.kindInfo?.kind).toBe('mcp-server')
    expect(out.kindInfo?.framework).toBe('mcp')
    expect(out.kindInfo?.members).toEqual([])
    expect(out.record?.title).toBe('Acme Catalog Server')
    expect(out.record?.specId).toBe('io.github.example/acme-catalog-server')
    expect(out.record?.slug).toBe('io-github-example-acme-catalog-server')
    expect(out.record?.summary).toBe('Example MCP server exposing a catalog lookup.')
    expect(out.record?.githubUrl).toBe('https://github.com/example/acme-catalog-server')
    expect(out.record?.toolNames).toEqual([])
    expect(out.missingFromAuthor).toEqual(['tool list', 'category'])
    expect(out.kindInfo?.extras.mcp).toEqual({
      name: 'io.github.example/acme-catalog-server',
      version: '1.2.3',
      transports: ['stdio', 'streamable-http'],
      packageIdentifiers: ['@example/acme-catalog-server'],
      remoteUrls: ['https://example.com/mcp'],
      envVarNames: ['ACME_API_KEY', 'ACME_REGION'],
    })
  })

  it('never stores environment variable values or defaults', () => {
    const out = parse(fixture())
    const json = JSON.stringify(out)
    expect(json).not.toContain('SYNTHETICNOTREAL')
    expect(json).not.toContain('"eu"')
  })

  it('preserves unknown keys and tolerates camelCase', () => {
    const out = parse(fixture())
    expect(out.unknownFields).toEqual(['futureField'])
    expect(out.kindInfo?.extras.unknown).toEqual({ futureField: { x: 1 } })
    const c = parse(one({ name: 'a/b', remotes: [{ type: 'sse', url: 'https://e.test/x' }], environmentVariables: [{ name: 'Z_TOKEN', value: 'v' }] }))
    expect((c.kindInfo?.extras.mcp as { envVarNames: string[] }).envVarNames).toEqual(['Z_TOKEN'])
  })

  it('does not keep a non-http repository url', () => {
    const out = parse(one({ name: 'a/b', packages: [], repository: { url: 'javascript:alert(1)' } }))
    expect(out.record?.githubUrl).toBeNull()
  })

  it('invalid JSON or missing name returns outcomes without throwing', () => {
    const bad = parse([{ path: 'server.json', text: '{nope' }])
    expect(bad.status).toBe('missing-from-author')
    expect(bad.missingFromAuthor).toEqual(['valid server.json'])
    expect(parse(one({ packages: [] })).missingFromAuthor).toEqual(['name'])
    expect(parse([{ path: 'x', text: '' }]).status).toBe('missing-from-author')
  })
})
