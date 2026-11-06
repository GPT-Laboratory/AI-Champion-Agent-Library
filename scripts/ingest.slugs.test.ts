// Phase 13 review fix CR-02: slugs never collide across submissions, are never empty, and a
// kind change never lets a new row inherit a previous agent's try-it-out settings.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import { ingest } from './ingest.js'
import { exec, freshDb, put, query, tmpDir } from './ingest.reviewfix.testkit.js'
import { parseSubmission } from '../src/lib/spec/registry.js'

const TEST_DB = './db/test-catalog-slugs.db'
const LG = JSON.stringify({ graphs: { main: './g.py:graph' }, dependencies: ['.'] })
const AGENT = [
  'component_type: Agent',
  'name: Plain Agent',
  'description: d',
  'system_prompt: You help.',
  'llm_config: {name: m}',
  'metadata: {category: C, tags: [t], github_url: "https://example.com/x", maturity: beta}',
  '',
].join('\n')

let prevFlag: string | undefined
let work: string

beforeEach(() => {
  prevFlag = process.env.AGENT_KINDS
  process.env.AGENT_KINDS = 'on'
  work = tmpDir('slugs-')
  freshDb(TEST_DB)
})
afterEach(() => {
  if (prevFlag === undefined) delete process.env.AGENT_KINDS
  else process.env.AGENT_KINDS = prevFlag
  rmSync(TEST_DB, { force: true })
  rmSync(work, { recursive: true, force: true })
})

const slugs = () => query<{ slug: string }>(TEST_DB, 'SELECT slug FROM agents ORDER BY slug').map((r) => r.slug)

describe('CR-02 fallback slugs', () => {
  it('two root-level langgraph.json submissions get different slugs and both ingest', async () => {
    put(work, { 'alpha-app/langgraph.json': LG, 'beta-app/langgraph.json': LG })
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res).toEqual({ succeeded: 2, failed: 0 })
    expect(slugs()).toEqual(['alpha-app', 'beta-app'])
  })

  it('two root-level crewai-yaml submissions do not overwrite each other', async () => {
    const agents = 'researcher:\n  role: R\n  goal: g\n'
    put(work, { 'crew-one/config/agents.yaml': agents, 'crew-one/config/tasks.yaml': 't:\n  description: d\n', 'crew-two/config/agents.yaml': agents, 'crew-two/config/tasks.yaml': 't:\n  description: d\n' })
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res).toEqual({ succeeded: 2, failed: 0 })
    expect(slugs()).toEqual(['crew-one', 'crew-two'])
  })

  it('a non-ASCII name gets the folder name as slug instead of an empty primary key', async () => {
    put(work, { 'nippon/catalog.yaml': 'name: 日本語\nsummary: s\ncategory: c\n', 'korea/catalog.yaml': 'name: 한국어\nsummary: s\ncategory: c\n' })
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res).toEqual({ succeeded: 2, failed: 0 })
    expect(slugs()).toEqual(['korea', 'nippon'])
  })

  it('top-level data files use the file stem as hint', async () => {
    put(work, { 'langgraph.json': LG })
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res.failed).toBe(0)
    expect(slugs()).toEqual(['langgraph'])
  })
})

describe('registry slug finalisation', () => {
  const NOW = '2026-01-01T00:00:00.000Z'
  it('falls back to a stable hash when neither name nor hint has ASCII letters', () => {
    const a = parseSubmission([{ path: 'catalog.yaml', text: 'name: 日本語\n' }], { now: NOW })
    const b = parseSubmission([{ path: 'catalog.yaml', text: 'name: 日本語\n' }], { now: NOW })
    const c = parseSubmission([{ path: 'catalog.yaml', text: 'name: 한국어\n' }], { now: NOW })
    expect(a.record?.slug).toMatch(/^item-[0-9a-f]{8}$/)
    expect(a.record?.slug).toBe(b.record?.slug)
    expect(a.record?.slug).not.toBe(c.record?.slug)
  })
  it('uses the hint for a name-less-ASCII mcp server.json and a root langgraph', () => {
    const mcp = parseSubmission([{ path: 'server.json', text: JSON.stringify({ name: '日本語', packages: [] }) }], { now: NOW, hint: 'srv-dir' })
    expect(mcp.record?.slug).toBe('srv-dir')
    const lg = parseSubmission([{ path: 'langgraph.json', text: LG }], { now: NOW, hint: 'My Graph' })
    expect(lg.record?.slug).toBe('my-graph')
  })
  it('caps very long names', () => {
    const long = 'a'.repeat(300_000 / 3)
    const out = parseSubmission([{ path: 'catalog.yaml', text: `name: ${long}\n` }], { now: NOW })
    expect(out.record!.slug.length).toBeLessThanOrEqual(80)
    expect(Buffer.byteLength(out.record!.title)).toBeLessThanOrEqual(200)
  })
})

describe('CR-02 try-it-out settings do not leak across kinds', () => {
  const setRunnable = (slug: string) =>
    exec(TEST_DB, "UPDATE agents SET try_it_out_mode = 'runnable', try_it_out_url = 'https://x.example/t', try_it_out_task_template = 'tpl' WHERE slug = ?", slug)
  const tio = (slug: string) =>
    query<{ try_it_out_mode: string; try_it_out_url: string | null; try_it_out_task_template: string | null }>(
      TEST_DB, 'SELECT try_it_out_mode, try_it_out_url, try_it_out_task_template FROM agents WHERE slug = ?', slug)[0]

  it('keeps settings on an unchanged re-ingest', async () => {
    put(work, { 'thing/catalog.yaml': 'name: Same Name\nsummary: s\ncategory: c\n' })
    await ingest(work, TEST_DB, { embedder: null })
    setRunnable('same-name')
    await ingest(work, TEST_DB, { embedder: null })
    expect(tio('same-name')?.try_it_out_mode).toBe('runnable')
  })

  it('resets settings when the slug is reused by a different kind', async () => {
    put(work, { 'thing/catalog.yaml': 'name: Same Name\nsummary: s\ncategory: c\n' })
    await ingest(work, TEST_DB, { embedder: null })
    setRunnable('same-name')
    put(work, { 'thing/catalog.yaml': 'name: Same Name\nkind: skill\nsummary: s\ncategory: c\n' })
    await ingest(work, TEST_DB, { embedder: null })
    expect(tio('same-name')).toEqual({ try_it_out_mode: 'none', try_it_out_url: null, try_it_out_task_template: null })
    expect(query<{ kind: string }>(TEST_DB, "SELECT kind FROM agent_kinds WHERE slug = 'same-name'")[0]?.kind).toBe('skill')
  })

  it('resets settings when the slug is reused by a different source format', async () => {
    put(work, { 'thing/catalog.yaml': 'name: Plain Agent\nsummary: s\ncategory: c\n' })
    await ingest(work, TEST_DB, { embedder: null })
    setRunnable('plain-agent')
    rmSync(`${work}/thing`, { recursive: true })
    put(work, { 'agent.yaml': AGENT })
    await ingest(work, TEST_DB, { embedder: null })
    expect(tio('plain-agent')?.try_it_out_mode).toBe('none')
  })

  it('does not reset curated settings when the flag is first turned on for a legacy row', async () => {
    delete process.env.AGENT_KINDS
    put(work, { 'agent.yaml': AGENT })
    await ingest(work, TEST_DB, { embedder: null })
    setRunnable('plain-agent')
    expect(query(TEST_DB, "SELECT name FROM sqlite_master WHERE name = 'agent_kinds'")).toHaveLength(0)
    process.env.AGENT_KINDS = 'on'
    await ingest(work, TEST_DB, { embedder: null })
    expect(tio('plain-agent')?.try_it_out_mode).toBe('runnable')
  })
})
