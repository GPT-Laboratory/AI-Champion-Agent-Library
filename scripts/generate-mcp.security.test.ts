// Phase 23 security audit, CLI file surfaces (T-23-03, T-23-06): the real file system, malicious layouts.
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultIo, main } from './generate-mcp.js'
import { collectPackFiles } from './mcp-pack-io.js'

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mcpgen-sec-'))
  dirs.push(d)
  return d
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const SPEC = join(__dirname, '..', 'src/lib/mcpgen/testing/fixtures/acme-openapi.yaml')
const quiet = { ...defaultIo, log: () => {}, error: () => {} }

describe('T-23-03 context pack inputs on a real file system', () => {
  it('symbolic links, environment files, dotfiles and deep trees are skipped or refused', async () => {
    const root = tmp()
    const secret = join(root, 'outside-secret.md')
    writeFileSync(secret, 'TOPSECRET')
    const docs = join(root, 'docs')
    mkdirSync(join(docs, 'a/b/c/d'), { recursive: true })
    writeFileSync(join(docs, 'ok.md'), 'plain notes')
    writeFileSync(join(docs, '.env'), 'KEY=TOPSECRET')
    writeFileSync(join(docs, '.hidden.md'), 'hidden')
    writeFileSync(join(docs, 'a/b/c/d/deep.md'), 'too deep')
    symlinkSync(secret, join(docs, 'link.md'))
    symlinkSync(root, join(docs, 'dirlink'))
    const r = await collectPackFiles(defaultIo as never, [docs], 'docs')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.files.map((f) => f.name)).toEqual(['docs/ok.md'])
    expect(JSON.stringify(r)).not.toContain('TOPSECRET')
    const explicit = await collectPackFiles(defaultIo as never, [join(docs, '.env')], 'docs')
    expect(explicit.ok).toBe(false)
    const viaLink = await collectPackFiles(defaultIo as never, [join(docs, 'link.md')], 'docs')
    expect(viaLink.ok && viaLink.files.length === 0).toBe(true)
  })
  it('a FIFO as an explicit path is not opened (no hang)', async () => {
    const root = tmp()
    const { spawnSync } = await import('node:child_process')
    const fifo = join(root, 'pipe.md')
    if (spawnSync('mkfifo', [fifo]).status !== 0) return
    const r = await collectPackFiles(defaultIo as never, [fifo], 'docs')
    expect(r.ok && r.files.length === 0).toBe(true)
  })
})

describe('T-23-06 output directory: no write through a planted symbolic link', () => {
  it('a symlinked subdirectory in a --force context-pack target is refused and nothing lands outside', async () => {
    const root = tmp()
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const out = join(root, 'pack')
    mkdirSync(out)
    symlinkSync(outside, join(out, 'source'))
    const code = await main([SPEC, '--context-pack', out, '--force'], quiet)
    expect(code).toBe(2)
    expect(readdirSync(outside)).toEqual([])
  })
  it('a symlinked subdirectory in a --force generate target is refused as well', async () => {
    const root = tmp()
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const out = join(root, 'pkg')
    mkdirSync(out)
    const gen = await main([SPEC, '--out', join(root, 'probe')], quiet)
    expect(gen).toBe(0)
    const sub = readdirSync(join(root, 'probe'), { withFileTypes: true }).find((e) => e.isDirectory())
    if (!sub) return // the package has no subdirectory: the context-pack case above covers the check
    symlinkSync(outside, join(out, sub.name))
    expect(await main([SPEC, '--out', out, '--force'], quiet)).toBe(2)
    expect(readdirSync(outside)).toEqual([])
  })
  it('a symlinked file is refused (CR-55c stays)', async () => {
    const root = tmp()
    const victim = join(root, 'victim.txt')
    writeFileSync(victim, 'keep')
    const out = join(root, 'pkg')
    mkdirSync(out)
    symlinkSync(victim, join(out, 'server.py'))
    expect(await main([SPEC, '--out', out, '--force'], quiet)).toBe(2)
    expect(readFileSync(victim, 'utf8')).toBe('keep')
  })
})

describe('T-23-06 mcp-propose-eval --write-packages', () => {
  it('does not write through a symlinked baseline or proposed directory', async () => {
    const { main: evalMain, defaultIo: evalIo } = await import('./mcp-propose-eval.js')
    const { loadFixture } = await import('../src/lib/mcpgen/proposals/testkit.js')
    const fx = loadFixture('acme-openapi.yaml')
    const root = tmp()
    const proposals = join(root, 'p.json')
    writeFileSync(proposals, JSON.stringify({ version: 1, baseline: { fingerprint: fx.fingerprint }, ops: [] }))
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const out = join(root, 'out')
    mkdirSync(out)
    symlinkSync(outside, join(out, 'baseline'))
    symlinkSync(outside, join(out, 'proposed'))
    const code = await evalMain([SPEC, '--proposals', proposals, '--write-packages', out], { ...evalIo, log: () => {}, error: () => {} })
    expect(code).toBe(2)
    expect(readdirSync(outside)).toEqual([])
  }, 60_000)
})
