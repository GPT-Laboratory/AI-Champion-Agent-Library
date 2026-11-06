import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { OracleAgentSpecSchema } from '../../src/lib/spec/oracle-agentspec.js'
import { detectFormat, normalize } from '../../src/lib/spec/index.js'
import { generateAgents, writeScaleFixtures, TOPICS } from './generate-scale.js'

const SEED = 42

function snapshotAgentsDir(): string[] {
  const dir = resolve('data/agents')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort()
    .map(f => `${f}:${statSync(join(dir, f)).size}`)
}

describe('generateAgents', () => {
  const items = generateAgents(150, SEED)
  const parsed = items.map(i => ({ item: i, spec: parseYaml(i.yaml) as Record<string, any> }))

  it('returns 150 items with unique slugs and filenames', () => {
    expect(items).toHaveLength(150)
    expect(new Set(items.map(i => i.slug)).size).toBe(150)
    expect(new Set(items.map(i => i.filename)).size).toBe(150)
  })

  it('is deterministic for the same seed and differs for another seed', () => {
    expect(generateAgents(150, SEED)).toEqual(items)
    expect(generateAgents(150, SEED + 1)).not.toEqual(items)
  })

  it('every spec passes OracleAgentSpecSchema and normalizes', () => {
    for (const { spec } of parsed) {
      expect(OracleAgentSpecSchema.safeParse(spec).success).toBe(true)
      const fmt = detectFormat(spec)
      expect(() => normalize(fmt, spec)).not.toThrow()
    }
  })

  it('marks every agent as synthetic', () => {
    for (const { item, spec } of parsed) {
      expect(item.slug.startsWith('synthetic-')).toBe(true)
      expect(spec.name.startsWith('Synthetic ')).toBe(true)
      expect(spec.description).toContain('Synthetic test agent')
      expect(spec.metadata.tags).toContain('synthetic')
    }
  })

  it('varies categories, llms, maturities and topics with non-trivial groups', () => {
    const count = (f: (s: Record<string, any>) => string) => {
      const m = new Map<string, number>()
      for (const { spec } of parsed) m.set(f(spec), (m.get(f(spec)) ?? 0) + 1)
      return m
    }
    const cats = count(s => s.metadata.category)
    const llms = count(s => s.llm_config.name)
    const mats = count(s => s.metadata.maturity)
    const topics = count(s => s.metadata.tags[1])
    expect(cats.size).toBeGreaterThanOrEqual(5)
    expect(llms.size).toBeGreaterThanOrEqual(4)
    expect(mats.size).toBeGreaterThanOrEqual(3)
    expect(topics.size).toBeGreaterThanOrEqual(8)
    for (const n of cats.values()) expect(n).toBeGreaterThanOrEqual(2)
    for (const n of llms.values()) expect(n).toBeGreaterThanOrEqual(10)
    for (const n of mats.values()) expect(n).toBeGreaterThanOrEqual(10)
  })

  it('clusters text by topic keywords', () => {
    for (const { spec } of parsed) {
      const topic = TOPICS.find(t => t.id === spec.metadata.tags[1])
      expect(topic).toBeDefined()
      const desc = String(spec.description).toLowerCase()
      expect(topic!.keywords.some(k => desc.includes(k.toLowerCase()))).toBe(true)
      const toolNames = topic!.tools.map(t => t.name)
      for (const t of spec.tools) expect(toolNames).toContain(t.name)
    }
  })
})

describe('writeScaleFixtures', () => {
  it('writes one yaml per agent into a tmp dir and leaves data/agents untouched', () => {
    const before = snapshotAgentsDir()
    const dir = mkdtempSync(join(tmpdir(), 'scale-gen-'))
    try {
      const out = join(dir, 'nested', 'agents')
      expect(writeScaleFixtures(out, 150, SEED)).toBe(150)
      expect(readdirSync(out).filter(f => f.endsWith('.yaml'))).toHaveLength(150)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(snapshotAgentsDir()).toEqual(before)
  })

  it('refuses to write into data/agents or a subdirectory of it', () => {
    const before = snapshotAgentsDir()
    expect(() => writeScaleFixtures('data/agents', 3, SEED)).toThrow()
    expect(() => writeScaleFixtures('./data/agents/sub', 3, SEED)).toThrow()
    expect(snapshotAgentsDir()).toEqual(before)
  })
})
