// Seeded PRNG for the mock upstream (Phase 15). All randomness in mock/ goes through this seeded generator.

/** mulberry32: small, fast, deterministic. Returns a function yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer in [0, n). */
export function pickIndex(rand: () => number, n: number): number {
  return Math.floor(rand() * n)
}

/** Pick one element. */
export function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[pickIndex(rand, xs.length)]
}
