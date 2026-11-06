import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { validateEntryFile, validateEntriesDir, main } from './validate-entries'

const TEMPLATE = 'docs/templates/agent-entry.template.yaml'
const tmps: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'valent-'))
  tmps.push(d)
  return d
}
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true })
})

function template(): Record<string, any> {
  return parse(readFileSync(TEMPLATE, 'utf8'))
}
function writeEntry(doc: unknown): string {
  const p = join(tmp(), 'entry.yaml')
  writeFileSync(p, stringify(doc))
  return p
}

describe('validateEntryFile', () => {
  it('accepts the template as the reference valid entry', () => {
    const r = validateEntryFile(TEMPLATE)
    expect(r.errors).toEqual([])
    expect(r.status).toBe('ok')
  })

  const REQUIRED = [
    'stage',
    'purpose',
    'inputs',
    'outputs',
    'data_sources',
    'assumptions',
    'gaps',
    'draft_for_review',
    'sample_data',
  ]
  it.each(REQUIRED)('reports a missing %s by name', (key) => {
    const doc = template()
    delete doc.metadata[key]
    const r = validateEntryFile(writeEntry(doc))
    expect(r.status).toBe('error')
    expect(r.errors.join(' ')).toContain(key)
  })

  it('rejects draft_for_review false, bad stage, agent_no 21, empty inputs', () => {
    const cases: Array<[string, (d: any) => void]> = [
      ['draft_for_review', (d) => (d.metadata.draft_for_review = false)],
      ['stage', (d) => (d.metadata.stage = 'foo')],
      ['agent_no', (d) => (d.metadata.agent_no = 21)],
      ['inputs', (d) => (d.metadata.inputs = [])],
    ]
    for (const [key, mutate] of cases) {
      const doc = template()
      mutate(doc)
      const r = validateEntryFile(writeEntry(doc))
      expect(r.status, key).toBe('error')
      expect(r.errors.join(' '), key).toContain(key)
    }
  })

  it('skips an entry with none of the consortium keys (legacy)', () => {
    const doc = template()
    for (const k of ['stage', 'agent_no', 'purpose', 'inputs', 'outputs', 'data_sources', 'assumptions', 'gaps', 'draft_for_review', 'sample_data'])
      delete doc.metadata[k]
    const r = validateEntryFile(writeEntry(doc))
    expect(r.status).toBe('skipped')
    expect(r.errors).toEqual([])
  })

  it('reports a schema error for a missing system_prompt', () => {
    const doc = template()
    delete doc.system_prompt
    const r = validateEntryFile(writeEntry(doc))
    expect(r.status).toBe('error')
    expect(r.errors.join(' ')).toContain('system_prompt')
  })

  it('reports an error for a secret-like token in the entry', () => {
    const doc = template()
    doc.description = 'use key sk-abcdefghijklmnopqrstuvwx1234'
    const r = validateEntryFile(writeEntry(doc))
    expect(r.status).toBe('error')
    expect(r.errors.join(' ')).toMatch(/secret/i)
  })

  it('reports an unreadable or unparsable file as an error, never throws', () => {
    expect(validateEntryFile('/nonexistent/x.yaml').status).toBe('error')
    const p = join(tmp(), 'bad.yaml')
    writeFileSync(p, 'a: [unclosed')
    expect(validateEntryFile(p).status).toBe('error')
  })
})

describe('validateEntriesDir', () => {
  it('has zero errors for the real data/agents', () => {
    const rs = validateEntriesDir('data/agents')
    expect(rs.length).toBeGreaterThan(0)
    expect(rs.filter((r) => r.status === 'error')).toEqual([])
  })

  it('reads only top-level yaml files, not subdirectories', () => {
    const rs = validateEntriesDir('data/agents')
    expect(rs.every((r) => !r.path.includes('fixtures'))).toBe(true)
    expect(rs.every((r) => /\.ya?ml$/.test(r.path))).toBe(true)
  })
})

describe('main', () => {
  const io = () => {
    const lines: string[] = []
    return { lines, io: { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) } }
  }
  it('exits 0 on the template and 1 on an invalid entry', () => {
    const a = io()
    expect(main([TEMPLATE], a.io)).toBe(0)
    const doc = template()
    delete doc.metadata.gaps
    const b = io()
    expect(main([writeEntry(doc)], b.io)).toBe(1)
    expect(b.lines.join('\n')).toContain('gaps')
  })
  it('exits 2 on a missing path', () => {
    expect(main(['/nonexistent-path-xyz'], io().io)).toBe(2)
  })
})
