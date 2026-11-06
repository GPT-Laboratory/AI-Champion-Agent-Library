// CR-48 / CR-49: scripts must run (not exit 0 silently) when started from a path with a space or through a symlink.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tsx = resolve(__dirname, '../node_modules/.bin/tsx')
// Usage error exit code per script when started without valid arguments.
const SCRIPTS: [string, string[], number][] = [
  ['generate-mcp.ts', ['--bogus'], 64],
  ['validate-submission.ts', [], 2],
  ['tryout-run.ts', ['--bogus'], 2],
  ['mcp-propose-eval.ts', ['--bogus'], 64],
]

function run(path: string, args: string[]): number {
  try {
    execFileSync(tsx, [path, ...args], { encoding: 'utf8', stdio: 'pipe', timeout: 60_000 })
    return 0
  } catch (e) {
    return (e as { status?: number }).status ?? -1
  }
}

describe('script entry detection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'is main%'))
  const sub = join(dir, 'a b')
  mkdirSync(sub)
  for (const [name, args, code] of SCRIPTS) {
    it(`${name} runs through a symlink in a directory with a space`, () => {
      const link = join(sub, name)
      symlinkSync(resolve(__dirname, name), link)
      expect(run(link, args)).toBe(code)
    }, 90_000)
  }
  it('cleans up', () => rmSync(dir, { recursive: true, force: true }))
})
