// TEST ONLY - never import from production code.
import { createHash } from 'node:crypto'
import { EMBEDDING_DIM, type Embedder } from './embedder.js'

function tokenVector(token: string): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM)
  let block = 0
  let filled = 0
  while (filled < EMBEDDING_DIM) {
    const h = createHash('sha256').update(`${token}:${block++}`).digest()
    for (let i = 0; i < h.length && filled < EMBEDDING_DIM; i++) {
      v[filled++] = h[i] / 127.5 - 1
    }
  }
  return v
}

function embedOne(text: string): Float32Array {
  const sum = new Float32Array(EMBEDDING_DIM)
  const tokens = text.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean)
  for (const t of tokens.length ? tokens : ['']) {
    const tv = tokenVector(t)
    for (let i = 0; i < EMBEDDING_DIM; i++) sum[i] += tv[i]
  }
  let norm = 0
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += sum[i] * sum[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < EMBEDDING_DIM; i++) sum[i] /= norm
  return sum
}

export function createFakeEmbedder(): Embedder {
  return {
    id: 'fake-hash',
    async embed(texts: string[]) {
      return texts.map(embedOne)
    },
  }
}
