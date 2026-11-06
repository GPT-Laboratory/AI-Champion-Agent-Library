// Server-only embedding generation. The transformers package is ONLY
// imported dynamically so a missing model/package never breaks build or tests.
export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
export const EMBEDDING_DIM = 384

export interface Embedder {
  id: string
  embed(texts: string[]): Promise<Float32Array[]>
}

export function vectorToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))
}

export function blobToVector(b: Buffer): Float32Array {
  // Copy first: Buffer may sit at an unaligned byteOffset in a pooled ArrayBuffer.
  const copy = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  return new Float32Array(copy as ArrayBuffer)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loader = () => Promise<any>

export async function createTransformersEmbedder(
  loader: Loader = () => import('@huggingface/transformers'),
): Promise<Embedder | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let extractorPromise: Promise<any> | null = null
  try {
    const mod = await loader()
    mod.env.cacheDir = process.env.HF_CACHE_DIR ?? './db/models'
    const getExtractor = () => {
      if (!extractorPromise) extractorPromise = mod.pipeline('feature-extraction', MODEL_ID)
      return extractorPromise
    }
    // Resolve the model eagerly so failure yields null rather than a later throw.
    await getExtractor()
    return {
      id: MODEL_ID,
      async embed(texts: string[]): Promise<Float32Array[]> {
        if (texts.length === 0) return []
        const extractor = await getExtractor()
        const out = await extractor(texts, { pooling: 'mean', normalize: true })
        const data = out.data as Float32Array
        if (!data || data.length !== texts.length * EMBEDDING_DIM) {
          throw new Error(
            `unexpected embedding tensor size ${data?.length} (expected ${texts.length} x ${EMBEDDING_DIM})`,
          )
        }
        const vectors: Float32Array[] = []
        for (let i = 0; i < texts.length; i++) {
          vectors.push(Float32Array.from(data.subarray(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM)))
        }
        return vectors
      },
    }
  } catch (err) {
    extractorPromise = null
    // Callers retry with backoff, so this logs once per attempt rather than once per process.
    console.warn(`[search] embeddings unavailable: ${(err as Error).message}`)
    return null
  }
}
