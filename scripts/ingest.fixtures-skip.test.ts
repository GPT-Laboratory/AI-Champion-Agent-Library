// D-466: with AGENT_KINDS on, ingest skips every directory named `fixtures` (any depth under the ingest root).
// Flag off is unchanged; validate-submission validates whatever path it is given, including a fixtures folder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingest } from './ingest.js'
import { readSubmissionDir } from '../src/lib/spec/scan.js'
import { validateSubmissionPath } from './validate-submission.js'

const TEST_DB = './db/test-catalog-fixtures-skip.db'
const REAL_DIR = './data/agents'

let root: string
let prevFlag: string | undefined
let prevEmb: string | undefined

function slugs(): string[] {
  const db = new Database(TEST_DB)
  try {
    return (db.prepare('SELECT slug FROM agents ORDER BY slug').all() as { slug: string }[]).map((r) => r.slug)
  } finally {
    db.close()
  }
}

beforeEach(() => {
  prevFlag = process.env.AGENT_KINDS
  prevEmb = process.env.SEARCH_EMBEDDINGS
  process.env.SEARCH_EMBEDDINGS = 'off'
  delete process.env.AGENT_KINDS
  if (existsSync(TEST_DB)) rmSync(TEST_DB)
  const db = new Database(TEST_DB)
  db.exec(readFileSync('./scripts/ingest.kinds.test.ts', 'utf8').match(/const LEGACY_DDL = `([\s\S]*?)`/)![1])
  db.close()
  root = mkdtempSync(join(tmpdir(), 'ingest-fixtures-'))
  // One real agent at the top level, the same agent copied into fixtures/ (top level and nested in a sub-folder).
  const src = join(REAL_DIR, 'airo.yaml')
  cpSync(src, join(root, 'airo.yaml'))
  mkdirSync(join(root, 'fixtures'))
  writeFileSync(join(root, 'fixtures', 'only-in-fixtures.yaml'), readFileSync(src, 'utf8').replace(/airo/g, 'only-in-fixtures'))
  mkdirSync(join(root, 'Fixtures'))
  writeFileSync(join(root, 'Fixtures', 'upper.yaml'), readFileSync(src, 'utf8').replace(/airo/g, 'upper-case-fixtures'))
})

afterEach(() => {
  if (prevFlag === undefined) delete process.env.AGENT_KINDS
  else process.env.AGENT_KINDS = prevFlag
  if (prevEmb === undefined) delete process.env.SEARCH_EMBEDDINGS
  else process.env.SEARCH_EMBEDDINGS = prevEmb
  if (existsSync(TEST_DB)) rmSync(TEST_DB)
  rmSync(root, { recursive: true, force: true })
})

describe('flag-on ingest skips fixtures directories (D-466)', () => {
  it('the catalog never contains data/agents/fixtures/minimal-agent', async () => {
    process.env.AGENT_KINDS = 'on'
    await ingest(REAL_DIR, TEST_DB)
    expect(slugs()).not.toContain('minimal-agent')
    expect(slugs()).toContain('airo')
  })

  it('skips fixtures at the top level (case-insensitive) without counting a failure', async () => {
    process.env.AGENT_KINDS = 'on'
    const r = await ingest(root, TEST_DB)
    expect(slugs()).toEqual(['airo'])
    expect(r.failed).toBe(0)
  })

  it('skips a fixtures directory nested inside a submission folder', async () => {
    process.env.AGENT_KINDS = 'on'
    const sub = join(root, 'my-agent')
    mkdirSync(join(sub, 'tests', 'fixtures'), { recursive: true })
    cpSync(join(REAL_DIR, 'airo.yaml'), join(sub, 'agent.yaml'))
    writeFileSync(join(sub, 'tests', 'fixtures', 'noise.yaml'), 'name: noise\n')
    const withSkip = readSubmissionDir(sub, { skipDirNames: ['fixtures'] })
    expect(withSkip.files.map((f) => f.path)).toEqual(['agent.yaml'])
    expect(withSkip.skipped).toContain('tests/fixtures')
    // The scanner default (used by validate-submission) reads everything it is given.
    expect(readSubmissionDir(sub).files.map((f) => f.path)).toContain('tests/fixtures/noise.yaml')
  })

  it('flag off is unchanged: only top-level data files are ingested (no directory scanning at all)', async () => {
    await ingest(root, TEST_DB)
    expect(slugs()).toEqual(['airo'])
  })

  it('validate-submission validates a fixtures folder it is given', () => {
    const items = validateSubmissionPath(join(root, 'fixtures')).items
    expect(items.map((i) => i.status)).toEqual(['ingestible'])
    const real = validateSubmissionPath('data/agents/fixtures/minimal-agent.yaml').items
    expect(JSON.stringify(real)).toMatch(/minimal-agent/)
  })
})
