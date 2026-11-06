import { describe, it, expect, vi } from 'vitest'
import {
  EMBEDDING_DIM,
  blobToVector,
  vectorToBlob,
  createTransformersEmbedder,
} from './embedder.js'
import { createFakeEmbedder } from './embedder.fake.js'

describe('blob round trip', () => {
  const v = Float32Array.from({ length: EMBEDDING_DIM }, (_, i) => Math.sin(i))

  it('round-trips exactly', () => {
    const blob = vectorToBlob(v)
    expect(blob.length).toBe(EMBEDDING_DIM * 4)
    expect(Array.from(blobToVector(blob))).toEqual(Array.from(v))
  })

  it('handles odd byteOffset buffers', () => {
    const odd = Buffer.concat([Buffer.alloc(1), vectorToBlob(v)]).subarray(1)
    expect(odd.byteOffset % 4).not.toBe(0)
    expect(Array.from(blobToVector(odd))).toEqual(Array.from(v))
  })
})

describe('fake embedder', () => {
  it('is deterministic and unit norm', async () => {
    const e = createFakeEmbedder()
    expect(e.id).toBe('fake-hash')
    const [a1, a2, b] = await e.embed(['a', 'a', 'b'])
    expect(a1.length).toBe(EMBEDDING_DIM)
    expect(Array.from(a1)).toEqual(Array.from(a2))
    expect(Array.from(a1)).not.toEqual(Array.from(b))
    const norm = Math.sqrt(a1.reduce((s, x) => s + x * x, 0))
    expect(norm).toBeCloseTo(1, 5)
  })
})

describe('createTransformersEmbedder', () => {
  it('returns null and warns when the loader fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await createTransformersEmbedder(() => Promise.reject(new Error('no model')))
    expect(r).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  function loaderWith(makeData: (n: number) => Float32Array) {
    return () =>
      Promise.resolve({
        env: {},
        pipeline: async () => async (texts: string[]) => ({ data: makeData(texts.length) }),
      })
  }

  it('slices batched output into one 384-d vector per text (WR-09)', async () => {
    const e = await createTransformersEmbedder(
      loaderWith((n) => Float32Array.from({ length: n * EMBEDDING_DIM }, (_, i) => i)),
    )
    const out = await e!.embed(['a', 'b'])
    expect(out).toHaveLength(2)
    expect(out[0]).toHaveLength(EMBEDDING_DIM)
    expect(out[1][0]).toBe(EMBEDDING_DIM)
  })

  it('rejects a tensor whose size does not match texts x dim instead of truncating (WR-09)', async () => {
    const e = await createTransformersEmbedder(loaderWith((n) => new Float32Array(n * 100)))
    await expect(e!.embed(['a'])).rejects.toThrow(/unexpected embedding tensor size/)
    const short = await createTransformersEmbedder(loaderWith((n) => new Float32Array(n * EMBEDDING_DIM - 1)))
    await expect(short!.embed(['a', 'b'])).rejects.toThrow(/unexpected embedding tensor size/)
  })
})

