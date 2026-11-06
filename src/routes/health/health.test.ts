// D-460: /health answers 503 { message } when the schema is missing and 200 otherwise.
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

afterEach(() => vi.unstubAllEnvs())

async function health(setup?: (d: Database.Database) => void) {
  const p = join(mkdtempSync(join(tmpdir(), 'health-')), 'c.db')
  const d = new Database(p)
  setup?.(d)
  d.close()
  vi.resetModules()
  vi.stubEnv('CATALOG_DB_PATH', p)
  const { GET } = await import('./+server')
  const res = (GET as unknown as () => Response)()
  return { res, body: await res.json() }
}

describe('GET /health', () => {
  it('200 {status:ok} when the agents table exists', async () => {
    const { res, body } = await health((d) => d.exec('CREATE TABLE agents (slug text primary key)'))
    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
  })

  it('503 {message} when the agents table is missing, without leaking internals', async () => {
    const { res, body } = await health()
    expect(res.status).toBe(503)
    expect(Object.keys(body)).toEqual(['message'])
    expect(JSON.stringify(body)).not.toMatch(/sqlite|no such table|agents|\.db/i)
  })

  it('503 when the agents table lacks the slug column (schema drift)', async () => {
    const { res } = await health((d) => d.exec('CREATE TABLE agents (id integer)'))
    expect(res.status).toBe(503)
  })
})
