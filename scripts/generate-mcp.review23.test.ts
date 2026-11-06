// CR-55: the real CLI IO refuses non-regular inputs, writes through no symlink, and prints a cleaned output path.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { defaultIo, main, type CliIo } from './generate-mcp'

const dir = mkdtempSync(join(tmpdir(), 'gen23-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('defaultIo (CR-55)', () => {
  it('fileSize refuses a FIFO and a directory instead of reading them', async () => {
    const fifo = join(dir, 'pipe')
    execFileSync('mkfifo', [fifo])
    await expect(defaultIo.fileSize(fifo)).rejects.toThrow(/regular file/)
    await expect(defaultIo.fileSize(dir)).rejects.toThrow(/regular file/)
  })
  it('fileSize still reports a regular file', async () => {
    const f = join(dir, 'a.txt')
    writeFileSync(f, 'hello')
    expect(await defaultIo.fileSize(f)).toBe(5)
  })
  it('writeFile does not write through an existing symlink', async () => {
    const victim = join(dir, 'victim.txt')
    writeFileSync(victim, 'keep')
    const out = join(dir, 'out')
    mkdirSync(out)
    symlinkSync(victim, join(out, 'server.py'))
    await expect(defaultIo.writeFile(join(out, 'server.py'), 'x')).rejects.toThrow(/symbolic link/)
    expect(readFileSync(victim, 'utf8')).toBe('keep')
    await defaultIo.writeFile(join(out, 'new.py'), 'y')
    expect(readFileSync(join(out, 'new.py'), 'utf8')).toBe('y')
  })
  it('the CLI reports a FIFO input as an error', async () => {
    const lines: string[] = []
    const io: CliIo = { ...defaultIo, log: (s) => lines.push(s), error: (s) => lines.push(s) }
    const code = await main(['--adapter', 'auto', join(dir, 'pipe'), '--out', join(dir, 'o2')], io)
    expect(code).toBe(2)
    expect(lines.join('\n')).toMatch(/regular file/)
  })
})
