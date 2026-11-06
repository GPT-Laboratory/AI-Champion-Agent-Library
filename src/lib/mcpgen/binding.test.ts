// E10 D3: the generator emits mcptest-binding.json next to the server, derived from the plan by ONE function.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BINDING_FILE, deriveBinding, type Binding } from './binding'
import { runPipeline } from './pipeline'

const fx = (n: string) => readFileSync(fileURLToPath(new URL(`./testing/fixtures/${n}`, import.meta.url)), 'utf8')

function bindingOf(file: string): Binding {
  const r = runPipeline(fx(file), { filename: file })
  if (!r.ok) throw new Error('pipeline failed')
  const f = r.files.find((x) => x.path === BINDING_FILE)
  if (!f) throw new Error('no binding file')
  return JSON.parse(f.content) as Binding
}

describe('mcptest-binding.json', () => {
  it('is part of every generated package and next to server.py', () => {
    for (const file of ['acme-openapi.yaml', 'acme-catalog-header.csv', 'acme-schema.sql']) {
      const r = runPipeline(fx(file), { filename: file })
      if (!r.ok) throw new Error('pipeline failed')
      expect(r.files.map((f) => f.path)).toContain(BINDING_FILE)
      expect(r.files.map((f) => f.path)).toContain('server.py')
    }
  })

  it('binds the openapi sample roles to the emitted tool names and parameter names', () => {
    const b = bindingOf('acme-openapi.yaml')
    expect(b.lookup_by_id).toEqual({ tool: 'lookup_part_by_id', argMap: { id: 'partId' } })
    expect(b.tool_exists_lookup).toEqual({ tool: 'lookup_part_by_id' })
    expect(b.search_keyword).toEqual({ tool: 'search_part', argMap: { query: 'q', per_page: 'page_size' } })
    expect(b.pagesize_clamp?.tool).toBe('search_part')
    expect(b.derived_filter).toEqual({ tool: 'filter_part_by_features', argMap: { attribute: 'key' } })
  })

  it('every bound tool exists in the emitted server and is derived deterministically', () => {
    const r = runPipeline(fx('acme-openapi.yaml'), { filename: 'acme-openapi.yaml' })
    if (!r.ok) throw new Error('pipeline failed')
    const b = bindingOf('acme-openapi.yaml')
    for (const e of Object.values(b)) expect(r.report.toolsEmitted).toContain(e.tool)
    expect(bindingOf('acme-openapi.yaml')).toEqual(b)
    const again = runPipeline(fx('acme-openapi.yaml'), { filename: 'acme-openapi.yaml' })
    if (!again.ok) throw new Error('pipeline failed')
    expect(again.files.find((f) => f.path === BINDING_FILE)?.content).toBe(r.files.find((f) => f.path === BINDING_FILE)?.content)
  })

  it('the emitted file contains no credential-looking text and no argument values', () => {
    const r = runPipeline(fx('acme-openapi.yaml'), { filename: 'acme-openapi.yaml' })
    if (!r.ok) throw new Error('pipeline failed')
    const text = r.files.find((f) => f.path === BINDING_FILE)?.content ?? ''
    expect(text).not.toMatch(/ACM-|api[_-]?key\b|bearer|sk-/i)
  })

  it('name-only derivation (no plan) keeps the prefix rules', () => {
    const b = deriveBinding(['describe_x', 'query_x', 'list_things', 'search_x'])
    expect(b.lookup_by_id?.tool).toBe('query_x')
    expect(b.pagesize_clamp?.tool).toBe('list_things')
    expect(deriveBinding([])).toEqual({})
  })

  it('omits roles with no matching tool instead of binding something unrelated', () => {
    const b = deriveBinding([{ name: 'describe_x', kind: 'describe' }])
    expect(b).toEqual({})
  })
})
