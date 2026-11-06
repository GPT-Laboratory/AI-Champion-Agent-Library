// Phase 13 review fixes: WR-08 (internal failure is a non-zero exit) and IN-05 (printed messages redacted).
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INTERNAL_ERROR_EXIT, main } from './validate-submission.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function sub(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'vs-fix-'))
  dirs.push(d)
  for (const [k, v] of Object.entries(files)) {
    mkdirSync(join(d, k, '..'), { recursive: true })
    writeFileSync(join(d, k), v)
  }
  return d
}

describe('WR-08 internal failure exit code', () => {
  const throwingOut = { out: () => { throw new Error('boom') }, err: () => {} }
  it('returns a non-zero code when something unexpected throws', () => {
    const d = sub({ 'catalog.yaml': 'name: A\nsummary: s\ncategory: c\n' })
    expect(main([d], throwingOut)).toBe(INTERNAL_ERROR_EXIT)
    expect(INTERNAL_ERROR_EXIT).not.toBe(0)
  })
  it('also fails with --strict and survives a throwing err sink', () => {
    const d = sub({ 'catalog.yaml': 'name: A\nsummary: s\ncategory: c\n' })
    expect(main([d, '--strict'], { out: throwingOut.out, err: () => { throw new Error('x') } })).toBe(INTERNAL_ERROR_EXIT)
  })
  it('keeps the normal exit codes', () => {
    const d = sub({ 'catalog.yaml': 'name: A\nsummary: s\ncategory: c\n' })
    const io = { out: () => {}, err: () => {} }
    expect(main([d], io)).toBe(0)
    expect(main([], io)).toBe(2)
  })
})

describe('IN-05 printed messages are redacted', () => {
  it('does not print inline tokens from warnings', () => {
    const d = sub({ 'catalog.yaml': 'name: A\nsummary: s\ncategory: c\nmaturity: ghp_abcdefghijklmnopqrstuvwxyz0123456789\n' })
    const out: string[] = []
    main([d], { out: (s) => void out.push(s), err: () => {} })
    expect(out.join('\n')).not.toContain('ghp_abcdefghijklmnop')
  })
})
