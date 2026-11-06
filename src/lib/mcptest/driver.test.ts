import { describe, it, expect, afterEach } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runDriver } from './driver'
import { ReportSchema } from './core/report'
import { DRIVER_REQUEST_MAX_BYTES } from './driverRequest'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup(request: unknown | string) {
  const root = mkdtempSync(join(tmpdir(), 'driver-test-'))
  dirs.push(root)
  const io = { inDir: join(root, 'in'), outDir: join(root, 'out'), pkgRoot: join(root, 'pkg') }
  mkdirSync(io.inDir)
  mkdirSync(io.pkgRoot)
  writeFileSync(join(io.inDir, 'request.json'), typeof request === 'string' ? request : JSON.stringify(request))
  return io
}

describe('runDriver', () => {
  it('runs a fake variant and writes a valid container report', async () => {
    const io = setup({ v: 1, subject: { kind: 'fake', variant: 'good' }, cases: ['T1-STD-CATALOG'] })
    expect(await runDriver(io)).toBe(0)
    const report = ReportSchema.parse(JSON.parse(readFileSync(join(io.outDir, 'report.json'), 'utf8')))
    expect(report.run.runtime).toBe('container')
    expect(report.subject.id).toBe('fake:good')
    expect(report.cases).toHaveLength(1)
    expect(existsSync(join(io.outDir, 'error.json'))).toBe(false)
  }, 30_000)

  it('writes error.json and no report for an invalid request', async () => {
    for (const bad of ['{not json', { v: 1, subject: { kind: 'staged', command: 'sh', args: [], cwd: '/work/pkg', id: 'x' } }]) {
      const io = setup(bad)
      expect(await runDriver(io)).not.toBe(0)
      expect(existsSync(join(io.outDir, 'report.json'))).toBe(false)
      const e = JSON.parse(readFileSync(join(io.outDir, 'error.json'), 'utf8'))
      expect(typeof e.error).toBe('string')
    }
  })

  it('rejects an oversize request body', async () => {
    const io = setup(' '.repeat(DRIVER_REQUEST_MAX_BYTES + 1))
    expect(await runDriver(io)).not.toBe(0)
    expect(existsSync(join(io.outDir, 'error.json'))).toBe(true)
  })

  it('runs a staged stub package over stdio without throwing', async () => {
    const io = setup({
      v: 1,
      subject: { kind: 'staged', command: 'node', args: ['stubServer.mjs'], cwd: '/work/pkg', id: 'submitted:stub' },
      cases: ['T2-CATALOG-API'],
      reruns: 1
    })
    copyFileSync(fileURLToPath(new URL('./core/testing/stubServer.mjs', import.meta.url)), join(io.pkgRoot, 'stubServer.mjs'))
    expect(await runDriver(io)).toBe(0)
    const report = ReportSchema.parse(JSON.parse(readFileSync(join(io.outDir, 'report.json'), 'utf8')))
    expect(report.subject.id).toBe('submitted:stub')
    expect(report.cases[0].state).not.toBe('PENDING_HUMAN')
  }, 60_000)

  it('reads only the three allowed env names', () => {
    const src = readFileSync(fileURLToPath(new URL('./driver.ts', import.meta.url)), 'utf8')
    const names = [...src.matchAll(/process\.env\.([A-Za-z_]+)/g)].map((m) => m[1]).sort()
    expect(names).toEqual(['MCPTEST_IN', 'MCPTEST_OUT', 'MCPTEST_PKG_ROOT'])
    expect(src).not.toMatch(/process\.env\s*[^.]/)
  })
})
