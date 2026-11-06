import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSubmissionDir, SCAN_MAX_FILES, SCAN_MAX_FILE_BYTES } from './scan.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scan-test-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readSubmissionDir', () => {
  it('reads sorted relative posix paths and skips env, git, node_modules, binaries', () => {
    mkdirSync(join(dir, 'sub'))
    mkdirSync(join(dir, 'node_modules'))
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, 'b.yaml'), 'b: 1')
    writeFileSync(join(dir, 'a.yaml'), 'a: 1')
    writeFileSync(join(dir, 'sub', 'c.md'), 'c')
    writeFileSync(join(dir, '.env.local'), 'KEY=1')
    writeFileSync(join(dir, 'node_modules', 'x.js'), 'x')
    writeFileSync(join(dir, '.git', 'config'), 'x')
    writeFileSync(join(dir, 'logo.png'), 'x')
    const { files, skipped } = readSubmissionDir(dir)
    expect(files.map((f) => f.path)).toEqual(['a.yaml', 'b.yaml', 'sub/c.md'])
    expect(skipped).toEqual(expect.arrayContaining(['.env.local', 'node_modules', '.git', 'logo.png']))
  })
  it('skips symlinks, oversize and NUL-containing files', () => {
    writeFileSync(join(dir, 'real.txt'), 'hi')
    symlinkSync(join(dir, 'real.txt'), join(dir, 'link.txt'))
    writeFileSync(join(dir, 'big.txt'), 'x'.repeat(SCAN_MAX_FILE_BYTES + 1))
    writeFileSync(join(dir, 'bin.txt'), Buffer.from([65, 0, 66]))
    const { files, skipped } = readSubmissionDir(dir)
    expect(files.map((f) => f.path)).toEqual(['real.txt'])
    expect(skipped).toEqual(expect.arrayContaining(['link.txt', 'big.txt', 'bin.txt']))
  })
  it('enforces file count and depth caps', () => {
    for (let i = 0; i < SCAN_MAX_FILES + 5; i++) writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.txt`), 'x')
    expect(readSubmissionDir(dir).files).toHaveLength(SCAN_MAX_FILES)
    const d2 = mkdtempSync(join(tmpdir(), 'scan-depth-'))
    try {
      const deep = join(d2, 'a', 'b', 'c', 'd', 'e')
      mkdirSync(deep, { recursive: true })
      writeFileSync(join(d2, 'a', 'b', 'c', 'd', 'ok.txt'), 'x')
      writeFileSync(join(deep, 'too-deep.txt'), 'x')
      expect(readSubmissionDir(d2).files.map((f) => f.path)).toEqual(['a/b/c/d/ok.txt'])
    } finally {
      rmSync(d2, { recursive: true, force: true })
    }
  })
  it('accepts a single file path and tolerates a missing path', () => {
    writeFileSync(join(dir, 'one.yaml'), 'k: v')
    expect(readSubmissionDir(join(dir, 'one.yaml')).files).toEqual([{ path: 'one.yaml', text: 'k: v' }])
    expect(readSubmissionDir(join(dir, 'nope')).files).toEqual([])
  })
})
