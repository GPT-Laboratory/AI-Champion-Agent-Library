// Review fix WR-09: the CLI must run when started through a path that a file URL encodes (spaces, '%', symlinks).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isMainModule } from './mcp-test'

const script = resolve(__dirname, 'mcp-test.ts')
const tsx = resolve(__dirname, '../node_modules/.bin/tsx')

describe('isMainModule', () => {
  it('matches the same file however the path is spelled', () => {
    const url = pathToFileURL(script).href
    expect(isMainModule(url, script)).toBe(true)
    expect(isMainModule(url, resolve(script, '..', 'mcp-test.ts'))).toBe(true)
    expect(isMainModule(url, undefined)).toBe(false)
    expect(isMainModule(url, join(__dirname, 'other.ts'))).toBe(false)
  })
  it('handles characters a file URL percent-encodes', () => {
    const odd = '/tmp/a b%c/ä/mcp-test.ts'
    // The module URL is encoded, the argv path is not: the old string comparison failed here.
    expect(pathToFileURL(odd).href).not.toBe(`file://${odd}`)
    expect(isMainModule(pathToFileURL(odd).href, odd)).toBe(true)
  })
})

describe('mcp-test entry', () => {
  it('runs (and lists) when started through a symlink in a directory with a space and a percent sign', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp test%'))
    try {
      const sub = join(dir, 'a b')
      mkdirSync(sub)
      const link = join(sub, 'mcp-test.ts')
      symlinkSync(script, link)
      const out = execFileSync(tsx, [link, '--list'], { encoding: 'utf8', timeout: 60_000 })
      expect(out).toContain('Subjects:')
      expect(out).toContain('Cases:')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 90_000)

  it('exits 2 on a usage error instead of silently doing nothing', () => {
    let code = 0
    try {
      execFileSync(tsx, [script], { encoding: 'utf8', stdio: 'pipe', timeout: 60_000 })
    } catch (e) {
      code = (e as { status?: number }).status ?? -1
    }
    expect(code).toBe(2)
  }, 90_000)
})
