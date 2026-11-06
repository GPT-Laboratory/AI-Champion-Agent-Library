// G3: the flag-off (legacy) ingest path masks secret-looking tokens in the [SKIP] message,
// exactly like the flag-on path (sanitizeMessage).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rmSync } from 'node:fs'
import { ingest } from './ingest.js'
import { freshDb, put, tmpDir } from './ingest.reviewfix.testkit.js'

const TEST_DB = './db/test-catalog-legacy-redact.db'
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'
let prev: string | undefined
let work: string
let errors: string[]

beforeEach(() => {
  prev = process.env.AGENT_KINDS
  delete process.env.AGENT_KINDS
  work = tmpDir('legacy-redact-')
  freshDb(TEST_DB)
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a.join(' ')))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  if (prev === undefined) delete process.env.AGENT_KINDS
  else process.env.AGENT_KINDS = prev
  rmSync(TEST_DB, { force: true })
  rmSync(work, { recursive: true, force: true })
})

describe('legacy ingest [SKIP] messages', () => {
  it('never print a token-shaped string from the failing file', async () => {
    put(work, { 'broken.yaml': `key: [${TOKEN}\nother: : :\n` })
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res.failed).toBe(1)
    const out = errors.join('\n')
    expect(out).toContain('[SKIP] broken.yaml')
    expect(out).not.toContain(TOKEN)
  })
})
