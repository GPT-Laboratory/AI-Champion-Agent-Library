// CR-56: usage errors are not a pass.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from './validate-entries'

const dir = mkdtempSync(join(tmpdir(), 'valent23-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const io = () => {
  const lines: string[] = []
  return { lines, io: { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) } }
}

describe('validate-entries usage (CR-56)', () => {
  it('rejects an unknown flag', () => {
    const t = io()
    expect(main(['--strcit'], t.io)).toBe(2)
    expect(t.lines.join('\n')).toContain('unknown option')
  })
  it('fails when the directory holds no YAML files', () => {
    const t = io()
    expect(main([dir], t.io)).toBe(2)
    expect(t.lines.join('\n')).toContain('no entry files')
  })
})
