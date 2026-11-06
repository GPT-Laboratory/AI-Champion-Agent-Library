import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { main, type CliIo } from './generate-mcp.js'

const fx = (n: string) => readFileSync(new URL(`../src/lib/mcpgen/testing/fixtures/${n}`, import.meta.url), 'utf8')

function fakeIo(files: Record<string, string>, existing: string[] = []) {
  const written: Record<string, string> = {}
  const reads: string[] = []
  const logs: string[] = []
  const errs: string[] = []
  const io: CliIo = {
    readFile: async (p) => {
      reads.push(p)
      if (!(p in files)) throw new Error('ENOENT')
      return files[p]
    },
    fileSize: async (p) => Buffer.byteLength(files[p] ?? '', 'utf8'),
    readdir: async () => existing,
    writeFile: async (p, c) => {
      written[p] = c
    },
    mkdir: async () => {},
    log: (s) => logs.push(s),
    error: (s) => errs.push(s),
  }
  return { io, written, reads, logs, errs }
}

describe('generate-mcp CLI', () => {
  it('writes a package and exits 0', async () => {
    const t = fakeIo({ 'in.yaml': fx('acme-openapi.yaml') })
    const code = await main(['--adapter', 'openapi', 'in.yaml', '--out', 'out'], t.io)
    expect(code).toBe(0)
    expect(Object.keys(t.written)).toContain('out/server.py')
    expect(t.reads).toEqual(['in.yaml'])
    expect(t.logs.join('\n')).toContain('Environment variables')
  })

  it('auto-detects with server name and limits', async () => {
    const t = fakeIo({ 'in.sql': fx('acme-schema.sql') })
    const code = await main(['in.sql', '--out', 'o', '--server-name', 'Mine', '--max-page-size', '50'], t.io)
    expect(code).toBe(0)
  })

  it('refuses a non-empty out dir unless --force', async () => {
    const t = fakeIo({ 'in.yaml': fx('acme-openapi.yaml') }, ['x'])
    expect(await main(['in.yaml', '--out', 'o'], t.io)).toBe(2)
    expect(Object.keys(t.written)).toHaveLength(0)
    expect(await main(['in.yaml', '--out', 'o', '--force'], t.io)).toBe(0)
  })

  it('refuses env files and oversized input without reading', async () => {
    const t = fakeIo({ '.env.local': 'A=1', 'big.txt': 'a'.repeat(262145) })
    expect(await main(['.env.local', '--out', 'o'], t.io)).toBe(2)
    expect(await main(['big.txt', '--out', 'o'], t.io)).toBe(2)
    expect(t.reads).toEqual([])
  })

  it('returns 2 with gaps on rejection, without echoing the secret', async () => {
    const secret = ['sk', 'abcdefghijklmnop1234567890'].join('-')
    const t = fakeIo({ 'in.yaml': `${fx('acme-openapi.yaml')}\napi_key: ${secret}\n` })
    expect(await main(['in.yaml', '--out', 'o'], t.io)).toBe(2)
    expect(t.errs.join('\n')).toContain('credential-rejected')
    expect(t.errs.join('\n')).not.toContain(secret)
    expect(Object.keys(t.written)).toHaveLength(0)
  })

  it('returns 64 on usage errors', async () => {
    const t = fakeIo({})
    expect(await main([], t.io)).toBe(64)
    expect(await main(['a', '--out', 'o', '--bogus'], t.io)).toBe(64)
    expect(await main(['a', '--out', 'o', '--max-page-size', 'x'], t.io)).toBe(64)
  })
})
