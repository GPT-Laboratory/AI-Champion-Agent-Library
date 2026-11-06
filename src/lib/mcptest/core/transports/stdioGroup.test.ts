// Review fix WR-05: a subject that forks a daemon must not leave it running after the channel closes.
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { spawnStdioChannel } from './stdio'

function alive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3)
    return state !== 'Z' && state !== 'X'
  } catch {
    return false
  }
}

describe.skipIf(process.platform !== 'linux')('stdio subject process group (WR-05)', () => {
  it('kills a daemon forked by the subject when the channel closes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcptest-pg-'))
    const pidFile = join(dir, 'daemon.pid')
    const script = `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const d = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      fs.writeFileSync(process.argv[1], String(d.pid));
      setInterval(() => {}, 1000);
    `
    const ch = spawnStdioChannel({ command: process.execPath, args: ['-e', script, pidFile], allowLocalExec: true, graceMs: 50 })
    try {
      for (let i = 0; i < 200 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 25))
      const pid = Number(readFileSync(pidFile, 'utf8'))
      expect(pid).toBeGreaterThan(1)
      expect(alive(pid)).toBe(true)
      await ch.close()
      for (let i = 0; i < 100 && alive(pid); i++) await new Promise((r) => setTimeout(r, 25))
      expect(alive(pid)).toBe(false)
    } finally {
      await ch.close().catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15_000)
})
