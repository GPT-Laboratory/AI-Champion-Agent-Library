import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'

let tmpDir: string
let jobsMod: typeof import('../tryItOutJobs')
let art: typeof import('./artifact')

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'artifact-test-'))
  process.env.TRYITOUT_WORK_DIR = tmpDir
  jobsMod = await import('../tryItOutJobs')
  art = await import('./artifact')
})

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

const bytes = (s: string) => new TextEncoder().encode(s)

describe('zipFiles', () => {
  it('rejects traversal and absolute names', () => {
    expect(() => art.zipFiles({ '../evil': bytes('x') })).toThrow()
    expect(() => art.zipFiles({ '/abs': bytes('x') })).toThrow()
    expect(() => art.zipFiles({ 'a/./b': bytes('x') })).toThrow() // SEC-12: dot segments
    expect(() => art.zipFiles({ '.': bytes('x') })).toThrow()
  })

  it('rejects more than MAX_ARTIFACT_FILES files', () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < art.MAX_ARTIFACT_FILES + 1; i++) files[`f${i}.txt`] = bytes('x')
    expect(() => art.zipFiles(files)).toThrow(/exceeds/)
  })

  it('rejects total size over MAX_ARTIFACT_BYTES', () => {
    expect(() =>
      art.zipFiles({ 'big.bin': new Uint8Array(art.MAX_ARTIFACT_BYTES + 1) }),
    ).toThrow(/exceeds/)
  })

  it('round-trips a nested entry', () => {
    const out = unzipSync(art.zipFiles({ 'a/b.txt': bytes('hi') }))
    expect(strFromU8(out['a/b.txt'])).toBe('hi')
  })
})

describe('zipOutputDir', () => {
  it('includes nested files and skips symlinks', async () => {
    const job = jobsMod.createJob('a', 't', null)
    const out = jobsMod.outputDir(job.jobId)
    await mkdir(join(out, 'sub'), { recursive: true })
    await writeFile(join(out, 'result.txt'), 'r')
    await writeFile(join(out, 'sub', 'n.txt'), 'n')
    const secret = join(tmpDir, 'secret.txt')
    await writeFile(secret, 'secret')
    await symlink(secret, join(out, 'link.txt'))

    const path = await art.zipOutputDir(job.jobId)
    const entries = unzipSync(new Uint8Array(await readFile(path)))
    expect(Object.keys(entries).sort()).toEqual(['result.txt', 'sub/n.txt'])
  })
})
