import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  makeDataset,
  catalogItems,
  bulkItems,
  codesDataset,
  docsDataset,
  componentsDataset,
  assembliesDataset,
  isValidCode,
  KNOWN_ITEM_ID,
  MISSING_ITEM_ID,
} from './datasets'
import { mulberry32 } from './prng'
import { DATASETS, HINTS, TOOL_NAMES, ITEM_FIELD_COUNT_MIN } from './contract'

const here = dirname(fileURLToPath(import.meta.url))

describe('prng and determinism', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(5)
    const b = mulberry32(5)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
  it('same seed gives identical JSON, different seed differs', () => {
    for (const n of DATASETS) {
      expect(JSON.stringify(makeDataset(n, 1, 30))).toBe(JSON.stringify(makeDataset(n, 1, 30)))
    }
    expect(JSON.stringify(makeDataset('catalog', 1, 30))).not.toBe(JSON.stringify(makeDataset('catalog', 2, 30)))
  })
  it('no Math.random in mock/', () => {
    const needle = 'Math.' + 'random'
    for (const f of readdirSync(here).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      expect(readFileSync(join(here, f), 'utf8')).not.toContain(needle)
    }
  })
})

describe('catalog', () => {
  const items = catalogItems(1)
  it('has a stable known item across seeds', () => {
    const a = items.find((i) => i.id === KNOWN_ITEM_ID)!
    const b = catalogItems(99).find((i) => i.id === KNOWN_ITEM_ID)!
    expect(a.code).toBe(b.code)
    expect(a.name).toEqual(b.name)
    expect(items.find((i) => i.id === MISSING_ITEM_ID)).toBeUndefined()
  })
  it('spreads suppliers and categories, has a nested discriminator', () => {
    expect(new Set(items.map((i) => i.supplier.id)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(items.map((i) => i.category)).size).toBeGreaterThanOrEqual(3)
    const red = items.filter((i) => i.attributes.some((a) => a.key === 'Colour' && a.value === 'Red'))
    expect(red.length).toBeGreaterThanOrEqual(3)
    expect(items.length - red.length).toBeGreaterThan(3)
  })
  it('names in 3 languages with non-ASCII, >= 20 top-level keys', () => {
    for (const i of items) {
      expect(Object.keys(i).length).toBeGreaterThanOrEqual(ITEM_FIELD_COUNT_MIN)
      expect(Boolean(i.name.en && i.name.fi && i.name.sv)).toBe(true)
      expect(/[^\x00-\x7f]/.test(i.name.fi + i.name.sv)).toBe(true)
      expect(isValidCode(i.code)).toBe(true)
    }
  })
  it('leak-rule hygiene: no field name or value contains timestamp/status/error/path', () => {
    const re = /timestamp|status|error|path/i
    let bad = 0
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (re.test(k)) bad++
          walk(x)
        }
      } else if (re.test(String(v))) bad++
    }
    walk(items)
    expect(bad).toBe(0)
  })
})

describe('other datasets', () => {
  it('bulk is 5000 items, fast', () => {
    const t = Date.now()
    const b = bulkItems(1)
    expect(b).toHaveLength(5000)
    expect(Date.now() - t).toBeLessThan(1000)
    expect(b[0].attributes.length).toBeGreaterThan(0)
  })
  it('codes has valid and invalid 13-digit codes', () => {
    const c = codesDataset(1)
    expect(c.valid.every((p) => isValidCode(p.gtin))).toBe(true)
    expect(c.invalid.every((x) => /^\d{13}$/.test(x) && !isValidCode(x))).toBe(true)
    expect(isValidCode('abc')).toBe(false)
  })
  it('docs has 5 documented records; components join assemblies by id', () => {
    expect(docsDataset(1).widgets).toHaveLength(5)
    const comps = componentsDataset(1)
    const asm = assembliesDataset(1)
    for (const c of comps) expect(asm.some((a) => a.componentId === c.id)).toBe(true)
  })
})

describe('contract hints', () => {
  it('each hint matches exactly one tool name', () => {
    const names = Object.values(TOOL_NAMES)
    for (const [kind, src] of Object.entries(HINTS)) {
      const re = new RegExp(src, 'i')
      expect(names.filter((n) => re.test(n)), kind).toHaveLength(1)
    }
  })
})
