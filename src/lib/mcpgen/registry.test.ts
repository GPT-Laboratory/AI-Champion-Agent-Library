import { describe, expect, it, vi } from 'vitest'
import { detectAdapters, listAdapters, parseInput } from './registry'
import { MAX_INPUT_BYTES } from './api-contract'
import type { InputAdapter, SourceModel } from './types'

const model: SourceModel = {
  name: 'Example',
  backend: { kind: 'http' },
  auth: { scheme: 'none' },
  entities: [],
  operations: [],
  limits: { maxResponseItems: 10 },
  gaps: [],
  writeOperationsDropped: [],
}
const fake = (over: Partial<InputAdapter> = {}): InputAdapter => ({
  id: 'fake',
  label: 'Fake',
  detect: () => 0.9,
  parse: () => ({ model, gaps: [] }),
  ...over,
})

describe('registry', () => {
  it('lists the registered adapters', () => {
    expect(listAdapters().map((a) => a.id)).toEqual(['openapi', 'tabular-catalog', 'sql-ddl', 'prisma', 'odata'])
  })
  it('reports unrecognized input', () => {
    expect(parseInput({ text: 'hello' })).toMatchObject({
      ok: false,
      gaps: [{ code: 'unrecognized-input' }],
    })
  })
  it('reports unknown adapter ids', () => {
    expect(parseInput({ text: 'x' }, { adapterId: 'nope', adapters: [fake()] })).toMatchObject({
      ok: false,
      gaps: [{ code: 'unknown-adapter' }],
    })
  })
  it('turns a throwing adapter into a gap without the stack', () => {
    const r = parseInput(
      { text: 'x' },
      {
        adapters: [
          fake({
            parse: () => {
              throw new Error('secret internals at /home/x')
            },
          }),
        ],
      },
    )
    expect(r).toMatchObject({ ok: false, gaps: [{ code: 'adapter-failed' }] })
    expect(JSON.stringify(r)).not.toContain('internals')
  })
  it('passes rejected gaps through', () => {
    const gaps = [{ code: 'bad', message: 'no', severity: 'error' as const }]
    const r = parseInput({ text: 'x' }, { adapters: [fake({ parse: () => ({ rejected: gaps }) })] })
    expect(r).toEqual({ ok: false, gaps })
  })
  it('rejects oversized input before any adapter runs', () => {
    const detect = vi.fn(() => 1)
    const r = parseInput({ text: 'a'.repeat(MAX_INPUT_BYTES + 1) }, { adapters: [fake({ detect })] })
    expect(r).toMatchObject({ ok: false, gaps: [{ code: 'input-too-large' }] })
    expect(detect).not.toHaveBeenCalled()
  })
  it('succeeds with the best detecting adapter, ties by order', () => {
    const a = fake({ id: 'a', detect: () => 0.5 })
    const b = fake({ id: 'b', detect: () => 0.9 })
    const c = fake({ id: 'c', detect: () => 0.9 })
    expect(detectAdapters({ text: 'x' }, [a, b, c]).map((h) => h.adapter.id)).toEqual(['b', 'c', 'a'])
    expect(parseInput({ text: 'x' }, { adapters: [a, b, c] })).toMatchObject({ ok: true, adapterId: 'b' })
  })
  it('never throws on a throwing detector', () => {
    const r = parseInput(
      { text: 'x' },
      {
        adapters: [
          fake({
            detect: () => {
              throw new Error('x')
            },
          }),
        ],
      },
    )
    expect(r.ok).toBe(false)
  })
})
