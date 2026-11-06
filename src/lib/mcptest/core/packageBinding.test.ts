// E10 D3: the runner loads <package>/mcptest-binding.json for subjects that run a server from a package directory;
// explicit binding wins over the suite's regex hints and an argMap renames suite arguments.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyArgMap, bindTool, boundArgs } from './binding'
import { parseBindingFile } from './bindingSchema'
import { loadPackageBinding } from './packageBinding'
import { DriverRequestSchema } from '../driverRequest'

const dirs: string[] = []
async function pkg(content?: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'pkgbind-'))
  dirs.push(d)
  if (content !== undefined) await writeFile(join(d, 'mcptest-binding.json'), content)
  return d
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const tools = [
  { name: 'lookup_part_by_id', description: '', inputSchema: {} },
  { name: 'search_part', description: '', inputSchema: {} }
]

describe('loadPackageBinding', () => {
  it('returns the validated binding when the file is present', async () => {
    const d = await pkg(JSON.stringify({ lookup_by_id: { tool: 'lookup_part_by_id', argMap: { id: 'partId' } } }))
    expect(await loadPackageBinding(d)).toEqual({ lookup_by_id: { tool: 'lookup_part_by_id', argMap: { id: 'partId' } } })
  })
  it('returns undefined when absent, invalid, oversize or empty (never throws)', async () => {
    expect(await loadPackageBinding(await pkg())).toBeUndefined()
    expect(await loadPackageBinding(await pkg('not json'))).toBeUndefined()
    expect(await loadPackageBinding(await pkg('{}'))).toBeUndefined()
    expect(await loadPackageBinding(await pkg(JSON.stringify({ a: { tool: 'x'.repeat(70000) } })))).toBeUndefined()
    expect(await loadPackageBinding('/nonexistent-dir-for-test')).toBeUndefined()
  })
  it('rejects entries with unknown keys and bad argMap names, and neutralises a __proto__ argMap key', () => {
    expect(parseBindingFile(JSON.stringify({ a: { tool: 'x', extra: 1 } }))).toBeNull()
    expect(parseBindingFile(JSON.stringify({ a: { tool: 'x', argMap: { id: 'a b' } } }))).toBeNull()
    // zod drops a __proto__ key; either way it never becomes an own or inherited mapping.
    const p = parseBindingFile('{"a":{"tool":"x","argMap":{"__proto__":"y"}}}')
    expect(p === null || (Object.getPrototypeOf(p.a.argMap) === Object.prototype && Object.keys(p.a.argMap ?? {}).length === 0)).toBe(true)
    expect(applyArgMap({ __proto__x: 1, id: 2 } as never, { id: 'partId' })).toEqual({ __proto__x: 1, partId: 2 })
  })
})

describe('explicit binding wins over regex hints', () => {
  it('a hint that matches nothing binds through the explicit tool name', () => {
    const hint = { tool_hint: '^lookup_item$' }
    expect(bindTool(hint, tools).status).toBe('no_tool')
    expect(bindTool(hint, tools, { tool: 'lookup_part_by_id' })).toMatchObject({
      tool: 'lookup_part_by_id',
      boundBy: 'explicit',
      status: 'ok'
    })
  })
  it('a hint that would match another tool still loses to the explicit binding', () => {
    expect(bindTool({ tool_hint: 'search' }, tools, { tool: 'lookup_part_by_id' }).tool).toBe('lookup_part_by_id')
  })
})

describe('argument handling', () => {
  it('argMap renames keys and keeps values and templates', () => {
    expect(applyArgMap({ id: 'ACM-1', per_page: '{{pageSize}}', other: 2 }, { id: 'partId', per_page: 'page_size' })).toEqual({
      partId: 'ACM-1',
      page_size: '{{pageSize}}',
      other: 2
    })
  })
  it('explicit args replace the suite args; no binding keeps them', () => {
    expect(boundArgs({ args: { x: 1 } }, { id: 'a' })).toEqual({ x: 1 })
    expect(boundArgs(undefined, { id: 'a' })).toEqual({ id: 'a' })
    expect(boundArgs({ argMap: { id: 'partId' } }, undefined)).toEqual({})
  })
  it('the driver request accepts argMap bindings and rejects loader-unsafe ones', () => {
    const base = { v: 1, cases: ['T2-CATALOG-API'] }
    const staged = (binding: unknown) => ({
      ...base,
      subject: { kind: 'staged', command: 'python3', args: ['server.py'], cwd: '/work/pkg', id: 'cmd:x', binding }
    })
    expect(DriverRequestSchema.safeParse(staged({ lookup_by_id: { tool: 't', argMap: { id: 'partId' } } })).success).toBe(true)
    expect(DriverRequestSchema.safeParse(staged({ lookup_by_id: { tool: 't', argMap: { id: 'a-b' } } })).success).toBe(false)
  })
})
