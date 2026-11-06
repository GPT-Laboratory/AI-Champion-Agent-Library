import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FormatAdapter } from '../kinds.js'

// The registry test needs a manifest adapter that detects catalog.yaml. The real one is a
// separate plan (13-04), so a stand-in with a manifest-like confidence (0.9) is wired in.
vi.mock('./index.js', async () => {
  const real = await vi.importActual<typeof import('./index.js')>('./index.js')
  const { langgraphAdapter } = await vi.importActual<typeof import('./langgraph.js')>('./langgraph.js')
  const fakeManifest: FormatAdapter = {
    id: 'catalog-manifest',
    detect: (files) => (files.some((f) => f.path.endsWith('catalog.yaml')) ? { format: 'catalog-manifest', confidence: 0.9 } : null),
    parse: () => ({
      status: 'ingestible', format: 'catalog-manifest', record: null, kindInfo: null,
      missingFromAuthor: [], unknownFields: [], warnings: [],
    }),
  }
  return { ...real, ADAPTERS: [fakeManifest, langgraphAdapter] }
})

import { langgraphAdapter as adapter } from './langgraph.js'
import { parseSubmission } from '../registry.js'

const NOW = '2026-01-01T00:00:00.000Z'
const fixture = (path = 'langgraph.json') => [
  { path, text: readFileSync(join(process.cwd(), 'fixtures/submissions/langgraph/langgraph.json'), 'utf8') },
]
const parse = (f: { path: string; text: string }[]) => adapter.parse(f, { now: NOW })

describe('langgraph.json detector', () => {
  it('detects with low confidence only when graphs is an object', () => {
    expect(adapter.detect(fixture())?.confidence).toBe(0.5)
    expect(adapter.detect([{ path: 'langgraph.json', text: '{"graphs":[]}' }])).toBeNull()
    expect(adapter.detect([{ path: 'langgraph.json', text: '{bad' }])).toBeNull()
  })

  it('records graph ids and dependencies, status partial', () => {
    const out = parse(fixture())
    expect(out.status).toBe('partial')
    expect(out.kindInfo?.kind).toBe('system')
    expect(out.kindInfo?.framework).toBe('langgraph')
    expect(out.kindInfo?.topology).toBeNull()
    expect(out.kindInfo?.members).toEqual([])
    expect(out.record?.title).toBe('LangGraph application')
    expect(out.missingFromAuthor).toEqual(['name', 'summary', 'members', 'topology', 'category (add catalog.yaml)'])
    const x = out.kindInfo!.extras
    expect(x.graphIds).toEqual(['researcher', 'writer'])
    expect(x.graphEntrypoints).toEqual({
      researcher: './src/example/researcher.py:graph',
      writer: './src/example/writer.py:graph',
    })
    expect(x.dependencies).toEqual(['.'])
    expect(x.pythonVersion).toBe('3.12')
    expect(x.envFile).toBeNull()
  })

  it('never stores env object values; keeps a string env path; title from folder', () => {
    const out = parse(fixture())
    expect(JSON.stringify(out)).not.toContain('synthetic-value-not-stored')
    const p = parse([{ path: 'my-app/langgraph.json', text: '{"graphs":{"a":"./a.py:g"},"env":".env"}' }])
    expect(p.record?.title).toBe('my-app')
    expect(p.record?.slug).toBe('my-app')
    expect(p.kindInfo?.extras.envFile).toBe('.env')
  })

  it('invalid JSON never throws', () => {
    const out = parse([{ path: 'langgraph.json', text: '{x' }])
    expect(out.status).toBe('missing-from-author')
    expect(parse([{ path: 'a', text: '' }]).status).toBe('missing-from-author')
  })

  it('registry prefers a catalog.yaml manifest over the langgraph detector', () => {
    const alone = parseSubmission(fixture(), { now: NOW })
    expect(alone.format).toBe('langgraph-json')
    const both = parseSubmission([...fixture(), { path: 'catalog.yaml', text: 'name: X\n' }], { now: NOW })
    expect(both.format).toBe('catalog-manifest')
  })
})
