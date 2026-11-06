// Review fix IN-06: CLI output never carries C1 controls, and the entry check works for any path.
import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import { clean, isMainModule, main, type CliIo } from './generate-mcp.js'

describe('clean', () => {
  it('replaces C0, DEL and C1 controls, including the 8-bit CSI', () => {
    const csi = String.fromCharCode(0x9b)
    const text = `a${csi}31mb${String.fromCharCode(0x1b)}[0mc${String.fromCharCode(0x7f)}d${String.fromCharCode(0x85)}e`
    const out = clean(text)
    expect(out).toBe('a 31mb [0mc d e')
    for (let c = 0; c < 0x20; c++) expect(out.includes(String.fromCharCode(c))).toBe(false)
    for (let c = 0x7f; c <= 0x9f; c++) expect(out.includes(String.fromCharCode(c))).toBe(false)
  })
  it('keeps ordinary text, including non-ASCII letters', () => {
    expect(clean('Tuotteet ja hinnat: äö')).toBe('Tuotteet ja hinnat: äö')
  })
  it('gap text from a hostile spec cannot drive a terminal through the CLI', async () => {
    const csi = String.fromCharCode(0x9b)
    const errs: string[] = []
    const io: CliIo = {
      readFile: async () => `swagger: "2.0"\ninfo:\n  title: t${csi}2J\n`,
      fileSize: async () => 40,
      readdir: async () => [],
      writeFile: async () => {},
      mkdir: async () => {},
      log: () => {},
      error: (s) => errs.push(s),
    }
    const code = await main(['--adapter', 'auto', 'in.yaml', '--out', 'out'], io)
    expect(code).not.toBe(0)
    expect(errs.join('\n')).not.toContain(csi)
  })
})

describe('isMainModule', () => {
  it('matches a path with spaces and non-ASCII characters', () => {
    for (const p of ['/tmp/my project/scripts/generate-mcp.ts', '/tmp/projekti äö/generate-mcp.ts', '/tmp/a%20b/c.ts']) {
      expect(isMainModule(pathToFileURL(p).href, p)).toBe(true)
    }
  })
  it('does not match another file or a missing entry', () => {
    expect(isMainModule(pathToFileURL('/tmp/a.ts').href, '/tmp/b.ts')).toBe(false)
    expect(isMainModule(pathToFileURL('/tmp/a.ts').href, undefined)).toBe(false)
    expect(isMainModule(pathToFileURL('/tmp/a.ts').href, '')).toBe(false)
  })
  it('the old raw comparison failed on such a path (documents why it was replaced)', () => {
    const p = '/tmp/my project/generate-mcp.ts'
    expect(pathToFileURL(p).href === `file://${p}`).toBe(false)
  })
})
