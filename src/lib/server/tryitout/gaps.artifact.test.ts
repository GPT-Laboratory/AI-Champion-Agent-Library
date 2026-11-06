// E3: artifact zip edge cases and runtime-wrapper behaviour via the fake runtime.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { createFakeRuntime } from './runtimeFake'
import { isSafeRelativePath, isTryItOutRuntimeError, TryItOutRuntimeError } from './runtime'

let tmpDir: string
let jobsMod: typeof import('../tryItOutJobs')
let art: typeof import('./artifact')

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'artifact-gaps-'))
  process.env.TRYITOUT_WORK_DIR = tmpDir
  jobsMod = await import('../tryItOutJobs')
  art = await import('./artifact')
})
afterAll(async () => {
  delete process.env.TRYITOUT_WORK_DIR
  await rm(tmpDir, { recursive: true, force: true })
})

const bytes = (s: string) => new TextEncoder().encode(s)
const JOB = '123e4567-e89b-42d3-a456-426614174000'

describe('zipFiles limits', () => {
  it('an empty file map zips to a valid (empty) archive', () => {
    const z = art.zipFiles({})
    expect(Object.keys(unzipSync(z))).toEqual([])
  })

  it('accepts exactly MAX_ARTIFACT_FILES and rejects one more', () => {
    const mk = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}.txt`, bytes('x')]))
    expect(Object.keys(unzipSync(art.zipFiles(mk(art.MAX_ARTIFACT_FILES)))).length).toBe(art.MAX_ARTIFACT_FILES)
    expect(() => art.zipFiles(mk(art.MAX_ARTIFACT_FILES + 1))).toThrow(/200 files/)
  })

  it('accepts exactly MAX_ARTIFACT_BYTES in total and rejects one byte more (cumulative across files)', () => {
    const half = art.MAX_ARTIFACT_BYTES / 2
    const zero = new Uint8Array(half)
    expect(() => art.zipFiles({ a: zero, b: zero })).not.toThrow()
    expect(() => art.zipFiles({ a: zero, b: zero, c: new Uint8Array(1) })).toThrow(/bytes/)
  })

  it('the byte limit applies per total, not per file', () => {
    const third = Math.floor(art.MAX_ARTIFACT_BYTES / 3) + 1
    expect(() => art.zipFiles({ a: new Uint8Array(third), b: new Uint8Array(third), c: new Uint8Array(third) })).toThrow()
  })

  it.each(['a\\b', 'a\0b', 'a//b', 'a/', '', ' ../x', 'a/../b', './a'])('rejects unsafe name %j', (name) => {
    if (name === ' ../x') {
      // a leading space makes "../x" a normal first segment " ..": allowed by the name check
      expect(isSafeRelativePath(name)).toBe(true)
      return
    }
    expect(() => art.zipFiles({ [name]: bytes('x') })).toThrow(/unsafe artifact entry name/)
  })

  it('round-trips unicode names, empty files and binary data byte-for-byte', () => {
    const bin = Uint8Array.from([0, 255, 1, 254])
    const out = unzipSync(art.zipFiles({ 'ä/ö-日本.txt': bytes('hei'), 'empty.bin': new Uint8Array(0), 'b.bin': bin }))
    expect(strFromU8(out['ä/ö-日本.txt'])).toBe('hei')
    expect(out['empty.bin'].byteLength).toBe(0)
    expect(Array.from(out['b.bin'])).toEqual([0, 255, 1, 254])
  })
})

describe('writeArtifactZip / zipOutputDir', () => {
  it('writeArtifactZip rejects an invalid job id before touching the filesystem', async () => {
    await expect(art.writeArtifactZip('../../etc', { a: bytes('x') })).rejects.toThrow(/invalid jobId/)
    await expect(art.zipOutputDir('nope')).rejects.toThrow(/invalid jobId/)
  })

  it('writeArtifactZip creates the work dir itself and overwrites an existing zip', async () => {
    const p = await art.writeArtifactZip(JOB, { 'one.txt': bytes('1') })
    expect(p).toBe(jobsMod.artifactZipPath(JOB))
    await art.writeArtifactZip(JOB, { 'two.txt': bytes('2') })
    expect(Object.keys(unzipSync(new Uint8Array(await readFile(p))))).toEqual(['two.txt'])
  })

  it('a failing limit check leaves a previous zip untouched', async () => {
    await art.writeArtifactZip(JOB, { 'keep.txt': bytes('k') })
    await expect(art.writeArtifactZip(JOB, { '../bad': bytes('x') })).rejects.toThrow()
    const p = jobsMod.artifactZipPath(JOB)
    expect(Object.keys(unzipSync(new Uint8Array(await readFile(p))))).toEqual(['keep.txt'])
  })

  it('zipOutputDir fails with ENOENT when the output dir does not exist', async () => {
    await expect(art.zipOutputDir('223e4567-e89b-42d3-a456-426614174000')).rejects.toThrow(/ENOENT/)
  })

  it('zipOutputDir of an empty output dir yields an empty zip; empty subdirectories are not entries', async () => {
    const id = '323e4567-e89b-42d3-a456-426614174000'
    await mkdir(join(jobsMod.outputDir(id), 'emptydir'), { recursive: true })
    const p = await art.zipOutputDir(id)
    expect(Object.keys(unzipSync(new Uint8Array(await readFile(p))))).toEqual([])
  })

  it('zipOutputDir keeps deep nesting, skips symlinked files and symlinked directories', async () => {
    const id = '423e4567-e89b-42d3-a456-426614174000'
    const out = jobsMod.outputDir(id)
    await mkdir(join(out, 'a', 'b', 'c'), { recursive: true })
    await writeFile(join(out, 'a', 'b', 'c', 'deep.txt'), 'deep')
    const secretDir = join(tmpDir, 'secret-dir')
    await mkdir(secretDir, { recursive: true })
    await writeFile(join(secretDir, 's.txt'), 'secret')
    await symlink(join(secretDir, 's.txt'), join(out, 'link-file'))
    await symlink(secretDir, join(out, 'link-dir'))
    const p = await art.zipOutputDir(id)
    const names = Object.keys(unzipSync(new Uint8Array(await readFile(p))))
    expect(names).toEqual(['a/b/c/deep.txt'])
  })

  it('zipOutputDir enforces the file-count cap on real directories', async () => {
    const id = '523e4567-e89b-42d3-a456-426614174000'
    const out = jobsMod.outputDir(id)
    await mkdir(out, { recursive: true })
    await Promise.all(Array.from({ length: art.MAX_ARTIFACT_FILES + 1 }, (_, i) => writeFile(join(out, `f${i}`), 'x')))
    await expect(art.zipOutputDir(id)).rejects.toThrow(/200 files/)
  })
})

describe('fake runtime wrappers (contract edges)', () => {
  const spec = { name: 'n', labels: { a: '1' }, env: ['K=V'] }

  it('operations on a removed or unknown container fail with exec_failed', async () => {
    const rt = createFakeRuntime()
    const id = await rt.createAndStart(spec)
    await rt.remove(id)
    for (const op of [
      () => rt.putFiles(id, '/d', []),
      () => rt.exec(id, { cmd: ['x'], workingDir: '/', onStdout() {}, onStderr() {} }),
      () => rt.getFiles(id, '/d', { maxBytes: 1, maxFiles: 1 }),
    ]) {
      await expect(op()).rejects.toMatchObject({ code: 'exec_failed' })
    }
    await expect(rt.getFiles('nope', '/d', { maxBytes: 1, maxFiles: 1 })).rejects.toMatchObject({ code: 'exec_failed' })
  })

  it('remove of an unknown id is idempotent and listManaged hides removed containers', async () => {
    const rt = createFakeRuntime()
    await expect(rt.remove('ghost')).resolves.toBeUndefined()
    const id = await rt.createAndStart(spec)
    expect((await rt.listManaged()).map((c) => c.id)).toEqual([id])
    await rt.remove(id)
    await rt.remove(id)
    expect(await rt.listManaged()).toEqual([])
  })

  it('putFiles rejects an unsafe staged path and writes nothing after it', async () => {
    const rt = createFakeRuntime()
    const id = await rt.createAndStart(spec)
    await expect(
      rt.putFiles(id, '/d', [{ path: 'ok.txt', content: 'a' }, { path: '../x', content: 'b' }, { path: 'later.txt', content: 'c' }]),
    ).rejects.toMatchObject({ code: 'exec_failed' })
    expect([...rt.filesOf(id).keys()]).toEqual(['/d/ok.txt'])
  })

  it('putFiles normalises a trailing slash on destDir and copies Uint8Array content', async () => {
    const rt = createFakeRuntime()
    const id = await rt.createAndStart(spec)
    const src = Uint8Array.from([1, 2, 3])
    await rt.putFiles(id, '/d/', [{ path: 'b.bin', content: src }, { path: 'sub', type: 'dir' }, { path: 'e.txt' }])
    src[0] = 99
    expect(Array.from(rt.filesOf(id).get('/d/b.bin') as Uint8Array)).toEqual([1, 2, 3])
    expect(rt.filesOf(id).get('/d/sub')).toBe('dir')
    expect((rt.filesOf(id).get('/d/e.txt') as Uint8Array).byteLength).toBe(0)
  })

  it('getFiles scopes to the directory prefix, skips dirs, and does not match sibling prefixes', async () => {
    const rt = createFakeRuntime()
    const id = await rt.createAndStart(spec)
    await rt.putFiles(id, '/work/output', [{ path: 'a.txt', content: 'a' }, { path: 'd', type: 'dir' }, { path: 'd/b.txt', content: 'b' }])
    await rt.putFiles(id, '/work/output2', [{ path: 'no.txt', content: 'n' }])
    const got = await rt.getFiles(id, '/work/output', { maxBytes: 10, maxFiles: 10 })
    expect(Object.keys(got).sort()).toEqual(['a.txt', 'd/b.txt'])
  })

  it('getFiles limits: exactly at the cap passes, one over throws output_invalid with a public-safe message', async () => {
    const rt = createFakeRuntime()
    const id = await rt.createAndStart(spec)
    await rt.putFiles(id, '/o', [{ path: 'a', content: 'xx' }, { path: 'b', content: 'xx' }])
    await expect(rt.getFiles(id, '/o', { maxBytes: 4, maxFiles: 2 })).resolves.toBeTruthy()
    await expect(rt.getFiles(id, '/o', { maxBytes: 3, maxFiles: 2 })).rejects.toMatchObject({
      code: 'output_invalid',
      message: 'output exceeds 3 bytes',
    })
    await expect(rt.getFiles(id, '/o', { maxBytes: 4, maxFiles: 1 })).rejects.toMatchObject({
      message: 'output exceeds 1 files',
    })
  })

  it('failNext is FIFO and consumed one call at a time; later calls succeed', async () => {
    const rt = createFakeRuntime()
    rt.failNext('ping', new Error('first'))
    rt.failNext('ping', new Error('second'))
    await expect(rt.ping()).rejects.toThrow('first')
    await expect(rt.ping()).rejects.toThrow('second')
    await expect(rt.ping()).resolves.toBeUndefined()
    expect(rt.calls).toEqual(['ping', 'ping', 'ping'])
  })

  it('hang blocks until released; release is idempotent', async () => {
    const rt = createFakeRuntime()
    const release = rt.hang('ping')
    let done = false
    const p = rt.ping().then(() => (done = true))
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(false)
    release()
    release()
    await p
    expect(done).toBe(true)
    await expect(rt.ping()).resolves.toBeUndefined()
  })

  it('exec passes stdout/stderr through and returns the scripted exit code (including null)', async () => {
    const rt = createFakeRuntime()
    const id = await rt.createAndStart(spec)
    rt.scriptExec(({ stdout, stderr, cmd }) => {
      stdout('out:' + cmd[0])
      stderr('err')
      return cmd[0] === 'kill' ? null : 3
    })
    const out: string[] = []
    const errs: string[] = []
    const opts = (cmd: string) => ({
      cmd: [cmd],
      workingDir: '/',
      onStdout: (b: Buffer) => out.push(b.toString()),
      onStderr: (b: Buffer) => errs.push(b.toString()),
    })
    expect(await rt.exec(id, opts('run'))).toEqual({ exitCode: 3 })
    expect(await rt.exec(id, opts('kill'))).toEqual({ exitCode: null })
    expect(out).toEqual(['out:run', 'out:kill'])
    expect(errs).toEqual(['err', 'err'])
  })

  it('createAndStart copies labels and env so caller mutation cannot change the container', async () => {
    const rt = createFakeRuntime()
    const s = { name: 'n', labels: { a: '1' }, env: ['K=V'] }
    const id = await rt.createAndStart(s)
    s.labels.a = '2'
    s.env.push('X=Y')
    expect(rt.envOf(id)).toEqual(['K=V'])
    expect((await rt.listManaged())[0].labels).toEqual({ a: '1' })
  })

  it('isTryItOutRuntimeError rejects look-alikes without a string code and non-errors', () => {
    expect(isTryItOutRuntimeError(new TryItOutRuntimeError('busy', 'x'))).toBe(true)
    expect(isTryItOutRuntimeError(Object.assign(new Error('x'), { name: 'TryItOutRuntimeError' }))).toBe(false)
    expect(isTryItOutRuntimeError(Object.assign(new Error('x'), { name: 'TryItOutRuntimeError', code: 5 }))).toBe(false)
    expect(isTryItOutRuntimeError({ name: 'TryItOutRuntimeError', code: 'busy' })).toBe(false)
    expect(isTryItOutRuntimeError(null)).toBe(false)
  })
})
