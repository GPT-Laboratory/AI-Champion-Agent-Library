// Phase 13 review fixes WR-01 (broken recognised submissions fail), WR-04 (top-level files are
// scanned with the same caps and symlink policy) and IN-05 (logged messages are redacted).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ingest } from './ingest.js'
import { freshDb, put, query, tmpDir } from './ingest.reviewfix.testkit.js'

const TEST_DB = './db/test-catalog-failures.db'
let prevFlag: string | undefined
let work: string
let errors: string[]
let logs: string[]

beforeEach(() => {
  prevFlag = process.env.AGENT_KINDS
  process.env.AGENT_KINDS = 'on'
  work = tmpDir('failures-')
  freshDb(TEST_DB)
  errors = []
  logs = []
  vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a.join(' ')))
  vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  if (prevFlag === undefined) delete process.env.AGENT_KINDS
  else process.env.AGENT_KINDS = prevFlag
  rmSync(TEST_DB, { force: true })
  rmSync(work, { recursive: true, force: true })
})

const count = () => query<{ n: number }>(TEST_DB, 'SELECT count(*) AS n FROM agents')[0]!.n

describe('WR-01 recognised but broken folders are failures', () => {
  it.each([
    ['catalog.yaml without a name', { 'bad/catalog.yaml': 'summary: no name here\ncategory: c\n' }],
    ['SKILL.md with a frontmatter fence but no name', { 'bad/SKILL.md': '---\ndescription: only a description\n---\nbody\n' }],
    ['SKILL.md with invalid frontmatter', { 'bad/SKILL.md': '---\n: : :\n  - [\n---\nbody\n' }],
    ['server.json declaring the MCP schema without a name', { 'bad/server.json': '{"$schema":"https://static.modelcontextprotocol.io/schemas/x.json","packages":[]}' }],
    ['an Oracle Agent that fails validation', { 'bad/agent.yaml': 'component_type: Agent\nname: Broken\n' }],
    ['a crew.json that is not valid JSON(C)', { 'bad/crew.json': '{"agents": [ oops' }],
  ])('%s', async (_n, files) => {
    put(work, files)
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res).toEqual({ succeeded: 0, failed: 1 })
    expect(errors.join('\n')).toContain('[SKIP] bad:')
    expect(logs.join('\n')).not.toContain('SKIP-INFO')
  })

  it('still skips a folder with no recognisable submission as info, not failure', async () => {
    put(work, { 'notes/README.md': '# just docs\n', 'notes/data.txt': 'x' })
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res).toEqual({ succeeded: 0, failed: 0 })
    expect(logs.join('\n')).toContain('[SKIP-INFO] notes')
  })

  it('names the reason in the failure message', async () => {
    put(work, { 'bad/catalog.yaml': 'summary: no name\n' })
    await ingest(work, TEST_DB, { embedder: null })
    expect(errors.join('\n')).toMatch(/catalog-manifest: missing: name/)
  })
})

describe('WR-04 top-level data files', () => {
  it('skips a symlinked data file instead of following it', async () => {
    put(work, { 'real/secret.yaml': 'component_type: Agent\nname: X\n' })
    symlinkSync(join(work, 'real', 'secret.yaml'), join(work, 'linked.yaml'))
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(errors.join('\n')).toContain('[SKIP] linked.yaml: symlinks are not followed')
    expect(res.failed).toBeGreaterThanOrEqual(1)
    expect(count()).toBe(0)
  })

  it('refuses a top-level file over the scanner size cap', async () => {
    writeFileSync(join(work, 'huge.yaml'), `component_type: Agent\nname: Huge\ndescription: ${'x'.repeat(300 * 1024)}\n`)
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res).toEqual({ succeeded: 0, failed: 1 })
    expect(errors.join('\n')).toContain('[SKIP] huge.yaml: file skipped')
    expect(count()).toBe(0)
  })

  it('still ingests a normal top-level file', async () => {
    put(work, {
      'ok.yaml': 'component_type: Agent\nname: Ok Agent\ndescription: d\nsystem_prompt: hi\nllm_config: {name: m}\n',
    })
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res).toEqual({ succeeded: 1, failed: 0 })
  })
})

describe('IN-05 logged messages are redacted', () => {
  it('does not echo inline tokens from failure reasons', async () => {
    put(work, { 'bad/agent.yaml': 'component_type: Agent\nname: sk-abcdefghijklmnopqrstuvwx\nllm_config: 7\n' })
    await ingest(work, TEST_DB, { embedder: null })
    expect(errors.join('\n')).not.toContain('sk-abcdefghijklmnopqrstuvwx')
  })
})
