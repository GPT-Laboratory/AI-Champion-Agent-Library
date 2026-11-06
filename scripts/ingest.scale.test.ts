import { describe, it, expect, afterAll } from 'vitest'
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { ingest } from './ingest.js'
import { createScaleDb } from './fixtures/scale-test-helpers.js'

function snapshotAgentsDir(): string[] {
  const dir = resolve('data/agents')
  if (!existsSync(dir)) return []
  return readdirSync(dir).sort().map(f => `${f}:${statSync(join(dir, f)).size}`)
}

const scale = createScaleDb(150)
afterAll(() => scale.cleanup())

describe('ingest at scale (150 synthetic agents)', () => {
  it('ingests 150 agents, is idempotent, and logs timing', async () => {
    const before = snapshotAgentsDir()

    const t0 = performance.now()
    const first = await ingest(scale.dataDir, scale.dbPath)
    const firstMs = performance.now() - t0
    expect(first).toEqual({ succeeded: 150, failed: 0 })

    const read = <T>(sql: string): T => {
      const db = new Database(scale.dbPath, { readonly: true })
      try { return db.prepare(sql).get() as T } finally { db.close() }
    }
    expect(read<{ n: number }>('SELECT COUNT(*) n FROM agents').n).toBe(150)
    expect(read<{ n: number }>("SELECT COUNT(*) n FROM agents WHERE slug LIKE 'synthetic-%'").n).toBe(150)
    const maxFirst = read<{ m: string }>('SELECT MAX(last_ingested_at) m FROM agents').m

    await new Promise(r => setTimeout(r, 25))

    const t1 = performance.now()
    const second = await ingest(scale.dataDir, scale.dbPath)
    const secondMs = performance.now() - t1
    expect(second).toEqual({ succeeded: 150, failed: 0 })

    expect(read<{ n: number }>('SELECT COUNT(*) n FROM agents').n).toBe(150)
    expect(read<{ n: number }>('SELECT COUNT(DISTINCT slug) n FROM agents').n).toBe(150)
    const maxSecond = read<{ m: string }>('SELECT MAX(last_ingested_at) m FROM agents').m
    expect(maxSecond > maxFirst).toBe(true)

    console.log(`[scale] ingest 150 agents: ${firstMs.toFixed(0)}ms first, ${secondMs.toFixed(0)}ms re-ingest`)
    expect(firstMs).toBeLessThan(30000)
    expect(secondMs).toBeLessThan(30000)

    expect(snapshotAgentsDir()).toEqual(before)
  }, 60000)
})
