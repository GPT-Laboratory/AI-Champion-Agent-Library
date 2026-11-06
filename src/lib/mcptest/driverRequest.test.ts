import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DriverRequestSchema, DRIVER_REQUEST_MAX_BYTES, KNOWN_CASE_IDS } from './driverRequest'

const staged = { kind: 'staged', command: 'python3', args: ['server.py'], cwd: '/work/pkg/acme', id: 'generator:openapi' }
const fake = { kind: 'fake', variant: 'good' }
const ok = (o: unknown) => DriverRequestSchema.safeParse(o).success

describe('DriverRequestSchema', () => {
  it('accepts both subject shapes', () => {
    expect(ok({ v: 1, subject: fake })).toBe(true)
    expect(ok({ v: 1, subject: staged, cases: ['T2-CATALOG-API'], reruns: 3 })).toBe(true)
    expect(
      ok({
        v: 1,
        subject: { ...staged, cwd: '/work/pkg', binding: { lookup_by_id: { tool: 't', args: { id: 1 } } }, envNames: { baseUrl: 'ACME_BASE_URL' } }
      })
    ).toBe(true)
  })
  it('rejects unknown keys at every level', () => {
    expect(ok({ v: 1, subject: fake, extra: 1 })).toBe(false)
    expect(ok({ v: 1, subject: { ...staged, extra: 1 } })).toBe(false)
    expect(ok({ v: 1, subject: { ...staged, envNames: { other: 'ACME_X' } } })).toBe(false)
  })
  it('rejects bad commands, args and cwd', () => {
    expect(ok({ v: 1, subject: { ...staged, command: 'sh' } })).toBe(false)
    expect(ok({ v: 1, subject: { ...staged, args: ['../x.py'] } })).toBe(false)
    expect(ok({ v: 1, subject: { ...staged, args: ['a/../../x'] } })).toBe(false)
    expect(ok({ v: 1, subject: { ...staged, args: ['/etc/passwd'] } })).toBe(false)
    expect(ok({ v: 1, subject: { ...staged, args: Array(9).fill('a') } })).toBe(false)
    // WR-10: the first argument must be a script file; this line pinned the 8-argument cap with a bare 'a'.
    expect(ok({ v: 1, subject: { ...staged, args: ['server.py', ...Array(7).fill('a')] } })).toBe(true)
    expect(ok({ v: 1, subject: { ...staged, cwd: '/work/other' } })).toBe(false)
    expect(ok({ v: 1, subject: { ...staged, cwd: '/work/pkgx' } })).toBe(false)
    expect(ok({ v: 1, subject: { ...staged, cwd: '/work/pkg/../etc' } })).toBe(false)
  })
  it('rejects bad cases, reruns and version', () => {
    expect(ok({ v: 1, subject: fake, cases: ['NOPE'] })).toBe(false)
    expect(ok({ v: 1, subject: fake, cases: Array(13).fill('T1-STD-CATALOG') })).toBe(false)
    for (const r of [0, 4, 1.5]) expect(ok({ v: 1, subject: fake, reruns: r })).toBe(false)
    expect(ok({ v: 2, subject: fake })).toBe(false)
  })
  it('exposes a 64 KiB body cap', () => {
    expect(DRIVER_REQUEST_MAX_BYTES).toBe(64 * 1024)
  })
  it('KNOWN_CASE_IDS matches the suite directory', () => {
    const dir = fileURLToPath(new URL('./suite', import.meta.url))
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    expect([...KNOWN_CASE_IDS].sort()).toEqual(names)
  })
})
