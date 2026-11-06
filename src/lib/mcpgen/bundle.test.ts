import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { toZip, BundleError } from './bundle.js'

const files = [
  { path: 'b.txt', content: 'B' },
  { path: 'a/x.py', content: 'print(1)\n' },
]

describe('toZip', () => {
  it('round-trips under a top-level folder', () => {
    const out = unzipSync(toZip(files, 'acme'))
    expect(Object.keys(out).sort()).toEqual(['acme/a/x.py', 'acme/b.txt'])
    expect(strFromU8(out['acme/b.txt'])).toBe('B')
  })
  it('is deterministic and order independent', () => {
    const a = toZip(files, 'acme')
    const b = toZip(files.slice().reverse(), 'acme')
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })
  it('rejects bad paths', () => {
    for (const p of ['../x', '/etc/x', 'a\\b', 'a/../b', '', 'C:/x', 'a//b']) {
      expect(() => toZip([{ path: p, content: '' }])).toThrow(BundleError)
    }
  })
  it('enforces the output cap', () => {
    expect(() => toZip([{ path: 'big', content: 'x'.repeat(2_000_001) }])).toThrow(BundleError)
  })
  it('falls back to a safe folder name', () => {
    expect(Object.keys(unzipSync(toZip(files, '../evil')))[0].startsWith('server/')).toBe(true)
  })
})
