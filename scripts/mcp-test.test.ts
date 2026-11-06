import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { ReportSchema } from '../src/lib/mcptest/core/report'
import { runCli, splitCommand, type CliIo } from './mcp-test'

const stub = fileURLToPath(new URL('../src/lib/mcptest/core/testing/stubServer.mjs', import.meta.url))

function fakeIo(dirs: string[] = []) {
  const written: Record<string, string> = {}
  const logs: string[] = []
  const errs: string[] = []
  const mkdirs: string[] = []
  const io: CliIo = {
    writeFile: async (p, c) => {
      written[p] = c
    },
    mkdir: async (p) => {
      mkdirs.push(p)
    },
    isDirectory: async (p) => dirs.includes(p),
    log: (s) => logs.push(s),
    error: (s) => errs.push(s),
    now: () => new Date('2026-01-01T00:00:00Z')
  }
  return { io, written, logs, errs, mkdirs }
}

describe('splitCommand', () => {
  it('splits on spaces and honours double quotes', () => {
    expect(splitCommand('python3 /a/b.py --x 1')).toEqual(['python3', '/a/b.py', '--x', '1'])
    expect(splitCommand('node "/my dir/s.js" "a\\"b"')).toEqual(['node', '/my dir/s.js', 'a"b'])
    expect(splitCommand('a "" b')).toEqual(['a', '', 'b'])
  })
  it('rejects NUL, control characters, unbalanced quotes and empty input', () => {
    for (const bad of ['a\u0000b', 'a\nb', 'a\tb\u0001', 'a "b', '', '   ']) expect(splitCommand(bad)).toBeNull()
  })
})

describe('mcp-test CLI', () => {
  it('--list prints subjects and cases and exits 0', async () => {
    const t = fakeIo()
    expect(await runCli(['--list'], t.io)).toBe(0)
    const out = t.logs.join('\n')
    expect(out).toContain('fake:good')
    expect(out).toContain('generator:openapi')
    expect(out).toContain('T1-STD-CATALOG  tier 1')
    expect(out).toContain('needs real runtime')
  })

  it('good fake passes (exit 0) and prints a summary', async () => {
    const t = fakeIo()
    const code = await runCli(['--subject', 'fake:good', '--case', 'T1-STD-CATALOG', '--case', 'T2-CATALOG-API', '--format', 'text'], t.io)
    expect(code).toBe(0)
    expect(t.logs.join('\n')).toContain('VERDICT: PASS')
  }, 30_000)

  it('mirror fake fails (exit 1)', async () => {
    const t = fakeIo()
    expect(await runCli(['--subject', 'fake:mirror', '--case', 'T2-CATALOG-API'], t.io)).toBe(1)
  }, 30_000)

  it('--format json prints a valid report and --out writes it validated', async () => {
    const t = fakeIo()
    const code = await runCli(
      ['--subject', 'fake:good', '--case', 'T1-STD-CATALOG', '--case', 'T2-CATALOG-API', '--format', 'json', '--out', 'rep/out.json'],
      t.io
    )
    expect(code).toBe(0)
    ReportSchema.parse(JSON.parse(t.logs.join('\n')))
    const path = resolve('rep/out.json')
    expect(Object.keys(t.written)).toEqual([path])
    ReportSchema.parse(JSON.parse(t.written[path]))
  }, 30_000)

  it('markdown format works', async () => {
    const t = fakeIo()
    await runCli(['--subject', 'fake:good', '--case', 'T1-STD-CATALOG', '--case', 'T2-CATALOG-API', '--format', 'markdown'], t.io)
    expect(t.logs.join('\n')).toContain('## Verdict: PASS')
  }, 30_000)

  it('usage errors return 2', async () => {
    const bad: string[][] = [
      [],
      ['--subject', 'fake:nope'],
      ['--subject', 'bogus'],
      ['--subject', 'fake:good', '--case', 'NOPE-CASE'],
      ['--subject', 'fake:good', '--reruns', '0'],
      ['--subject', 'fake:good', '--reruns', '4'],
      ['--subject', 'fake:good', '--wat'],
      ['--subject', 'fake:good', '--format', 'xml'],
      ['--subject', 'fake:good', '--env-base-url', 'lower'],
      ['--subject', 'cmd:node x', '--env-api-key', 'bad-name'],
      ['--subject', 'cmd:"unterminated']
    ]
    for (const argv of bad) {
      const t = fakeIo()
      expect(await runCli(argv, t.io), argv.join(' ')).toBe(2)
      expect(t.errs.length).toBeGreaterThan(0)
      expect(Object.keys(t.written)).toEqual([])
    }
  })

  it('refuses env files anywhere in the arguments', async () => {
    for (const argv of [
      ['--subject', 'fake:good', '--out', '/tmp/.env'],
      ['--subject', 'fake:good', '--out', '.env.local'],
      ['--subject', 'cmd:python3 /x/.env']
    ]) {
      const t = fakeIo()
      expect(await runCli(argv, t.io)).toBe(2)
      expect(t.errs.join('')).toContain('environment files')
      expect(Object.keys(t.written)).toEqual([])
    }
  })

  it('refuses an --out that is an existing directory', async () => {
    const t = fakeIo([resolve('somedir')])
    expect(await runCli(['--subject', 'fake:good', '--out', 'somedir'], t.io)).toBe(2)
  })

  it('cmd: subject without --allow-local-exec is PENDING_HUMAN and prints the exact re-run command', async () => {
    const t = fakeIo()
    const code = await runCli(['--subject', `cmd:node "${stub}"`, '--case', 'T2-CATALOG-API', '--reruns', '2'], t.io)
    expect(code).toBe(1)
    const out = t.logs.join('\n')
    expect(out).toContain('PENDING_HUMAN')
    expect(out).toContain(`npm run mcp-test -- --subject cmd:"node \\"${stub}\\"" --case T2-CATALOG-API --reruns 2 --allow-local-exec`)
  }, 30_000)

  it('cmd: subject with --allow-local-exec really runs the command (stub server) without a shell', async () => {
    const t = fakeIo()
    const code = await runCli(['--subject', `cmd:node "${stub}"`, '--case', 'T2-CATALOG-API', '--allow-local-exec', '--format', 'json'], t.io)
    expect(code).toBe(1)
    const report = ReportSchema.parse(JSON.parse(t.logs.join('\n')))
    expect(report.run.runtime).toBe('local-cli')
    expect(report.subject.id).toBe('cmd:node')
    expect(report.cases[0].state).not.toBe('PENDING_HUMAN')
    expect(report.subject.serverInfo.name).toBe('stub')
  }, 60_000)

  it('source never uses a shell, reads no env vars and imports no network module', () => {
    const src = readFileSync(fileURLToPath(new URL('./mcp-test.ts', import.meta.url)), 'utf8')
    expect(src).not.toMatch(/shell\s*:\s*true/)
    expect(src).not.toMatch(/child_process|node:http|node:net|fetch\(/)
    expect(src).not.toMatch(/process\.env/)
  })
})
