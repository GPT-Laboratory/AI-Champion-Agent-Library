// Suite-wide criteria for the 12 synthetic cases: consistency with the fidelity table, golden isolation,
// synthetic-only content and agreement with the mock dataset constants.
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { GoldenCheck } from './cases'
import { CASE_IDS, FIDELITY } from './fidelity'
import { checkGoldenIsolation } from './isolation'
import { defaultSuiteRoot, loadSuite } from './suite'
import type { SuiteCase } from './suite'
import { HINTS, TOOL_NAMES } from '../mock/contract'
import { KNOWN_ITEM_ID, MISSING_ITEM_ID, catalogItems, codeFor } from '../mock/datasets'

const BEHAVIOUR = [
  'lookup_by_id',
  'lookup_by_alt_key',
  'partition_filter',
  'derived_filter',
  'projection',
  'pagesize_clamp',
  'pagination_ceiling',
  'bad_input',
  'empty_vs_error',
  'auth_fail'
]
const SPECIAL = [
  'grounding',
  'profile',
  'composite',
  'large_response',
  'fault_retry',
  'fault_timeout',
  'fault_malformed',
  'secret_canary',
  'i18n_codes',
  'rerun_variance',
  'generator_side'
]
const KINDS = new Set([...BEHAVIOUR, ...SPECIAL])
const NO_HINT_BINDING = new Set(['T2-CATALOG-DUMP', 'T4-PARTIAL-SPEC'])

let cases: SuiteCase[] = []
const byId = (id: string) => cases.find((c) => c.def.id === id) as SuiteCase

beforeAll(async () => {
  const r = await loadSuite()
  if (!r.ok) throw new Error(r.errors.join('\n'))
  cases = r.cases
})

async function walk(dir: string, out: { path: string; content: string }[]): Promise<void> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, out)
    else if (e.isFile()) out.push({ path: p, content: await readFile(p, 'utf8') })
  }
}

describe('suite shape', () => {
  it('has exactly the 12 case ids with tiers 1x1, 2x3, 3x4, 4x4', () => {
    expect(cases.map((c) => c.def.id).sort()).toEqual([...CASE_IDS].sort())
    const tiers = [1, 2, 3, 4].map((t) => cases.filter((c) => c.def.tier === t).length)
    expect(tiers).toEqual([1, 3, 4, 4])
  })

  it('every implemented fidelity case has a loaded suite case; none is designed-only-gap', () => {
    for (const f of FIDELITY.filter((e) => e.group === 'case')) {
      if (f.platformStatus === 'implemented' || f.platformStatus === 'implemented-minimal') {
        expect(cases.some((c) => c.def.id === f.id), f.id).toBe(true)
        expect(cases.find((c) => c.def.id === f.id)?.def.tier).toBe(f.tier)
      }
    }
    const gaps = FIDELITY.filter((e) => e.group === 'case' && e.platformStatus === 'designed-only-gap').map((e) => e.id)
    for (const id of gaps) expect(cases.some((c) => c.def.id === id)).toBe(false)
  })

  it('has non-empty golden, x-applies-to and a title naming Acme', () => {
    for (const c of cases) {
      expect(c.golden.length, c.def.id).toBeGreaterThan(0)
      expect(c.x.appliesTo?.length, c.def.id).toBeGreaterThan(0)
      expect(String(c.def.title), c.def.id).toMatch(/Acme|Example/)
    }
  })

  it('only the dump case needs a real runtime', () => {
    expect(cases.filter((c) => c.x.requires === 'real-runtime').map((c) => c.def.id)).toEqual(['T2-CATALOG-DUMP'])
  })

  it('T2-CATALOG-API carries the 9 source ids plus all 10 behaviour kinds', () => {
    const g = byId('T2-CATALOG-API').golden
    const ids = g.map((x) => x.id)
    for (const id of [
      'tool_exists_lookup',
      'lookup_by_id',
      'lookup_by_code',
      'search_keyword',
      'search_empty',
      'bad_id',
      'supplier_filter',
      'pagination_page2',
      'auth_failure'
    ])
      expect(ids).toContain(id)
    const kinds = g.map((x) => x.check_kind).filter(Boolean)
    for (const k of BEHAVIOUR) expect(kinds, k).toContain(k)
  })
})

describe('golden lines', () => {
  it('check_kind values are known and ids are unique per case', () => {
    for (const c of cases) {
      const seen = new Set<string>()
      for (const g of c.golden) {
        if (g.check_kind) expect(KINDS.has(g.check_kind), `${c.def.id}/${g.id}`).toBe(true)
        expect(seen.has(g.id), `${c.def.id}/${g.id}`).toBe(false)
        seen.add(g.id)
      }
    }
  })

  it('tool_hint regexes compile and match exactly one mock tool name', () => {
    const names = Object.values(TOOL_NAMES) as string[]
    for (const c of cases) {
      if (NO_HINT_BINDING.has(c.def.id)) continue
      for (const g of c.golden) {
        if (!g.tool_hint) continue
        const hits = names.filter((n) => new RegExp(g.tool_hint as string, 'i').test(n))
        expect(hits.length, `${c.def.id}/${g.id} ${g.tool_hint}`).toBe(1)
        if (g.check_kind && HINTS[g.check_kind]) {
          const want = names.filter((n) => new RegExp(HINTS[g.check_kind as string], 'i').test(n))
          expect(hits, `${c.def.id}/${g.id} agrees with contract hint`).toEqual(want)
        }
      }
    }
  })
})

describe('mock dataset agreement', () => {
  it('x-identity values equal the dataset constants', () => {
    const c = byId('T2-CATALOG-API')
    const id = c.x.identity
    expect(id).toBeDefined()
    const seed = c.x.upstream?.a.seed ?? 1
    const items = catalogItems(seed)
    const known = items.find((i) => i.id === KNOWN_ITEM_ID)
    expect(id?.knownId).toBe(KNOWN_ITEM_ID)
    expect(id?.badId).toBe(MISSING_ITEM_ID)
    expect(id?.knownAlt).toBe(codeFor(42))
    expect(known?.code).toBe(id?.knownAlt)
    expect(id?.partitionValue).toBe(known?.supplier.id)
    const red = items
      .filter((i) => i.attributes.some((a) => a.key === id?.derivedKey && a.value === id?.derivedValue))
      .map((i) => i.id)
    expect(id?.expectedDerivedIds).toEqual(red)
    expect(id?.expectedDerivedIds.length).toBeGreaterThan(0)
  })

  it('catalog-case golden values match the dataset', () => {
    const known = catalogItems(1).find((i) => i.id === KNOWN_ITEM_ID)
    const g = byId('T2-CATALOG-API').golden
    expect(g.find((x) => x.id === 'lookup_by_id')?.expect?.field_value).toEqual({ id: KNOWN_ITEM_ID })
    expect(g.find((x) => x.id === 'lookup_by_code')?.expect?.field_value).toEqual({ code: known?.code })
  })
})

describe('golden isolation', () => {
  it('no golden or identity expected string appears in a fixture shown to a generator', () => {
    for (const c of cases) {
      const shown = c.fixtureFiles.filter((f) => f.path.startsWith('spec/') || f.path.startsWith('docs/'))
      const pseudo: GoldenCheck[] = [{ id: 'identity', type: 'call', expect: { field_value: {} } }]
      if (c.x.identity) {
        const i = c.x.identity
        pseudo[0].expect = {
          field_value: { a: [i.knownId, i.knownAlt, i.badId, i.partitionValue, ...i.expectedDerivedIds] }
        }
      }
      const r = checkGoldenIsolation(shown, [...c.golden, ...pseudo])
      expect(r.violations, c.def.id).toEqual([])
    }
  })

  it('the dump fixture does contain rows (so isolation is only about the header file)', () => {
    const c = byId('T2-CATALOG-DUMP')
    const dump = c.fixtureFiles.find((f) => f.path === 'dump/acme-catalog.csv')
    const header = c.fixtureFiles.find((f) => f.path === 'spec/acme-catalog-header.csv')
    expect(dump?.content.split('\n').length).toBeGreaterThan(40)
    expect(header?.content).not.toMatch(/ACD-\d/)
  })
})

describe('synthetic-only content', () => {
  let files: { path: string; content: string }[] = []
  beforeAll(async () => {
    await walk(defaultSuiteRoot(), files)
    files = files.filter((f) => !f.path.endsWith('.test.ts'))
  })

  it('has files to scan', () => {
    expect(files.length).toBeGreaterThan(36)
  })

  it('has no non-loopback URL literal', () => {
    for (const f of files) {
      for (const m of f.content.matchAll(/[a-z][a-z0-9+.-]*:\/\/([^\s/:'")]+)/gi)) {
        expect(['127.0.0.1', 'localhost'], `${f.path}: ${m[0]}`).toContain(m[1])
      }
    }
  })

  it('has no forbidden token', () => {
    const forbidden = [['mcp-gen', '-comparison'], ['L', 'VI'], ['ET', 'IM'], ['TT', '0'], ['ST', 'K']].map((p) => p.join(''))
    for (const f of files) for (const t of forbidden) expect(f.content.includes(t), `${f.path} has ${t}`).toBe(false)
  })

  it('has no secret-shaped string', () => {
    const pats = [/sk-[A-Za-z0-9]{10,}/, /ghp_[A-Za-z0-9]{10,}/, /AKIA[0-9A-Z]{8,}/, /[A-Fa-f0-9]{32,}/, /[A-Za-z0-9+/_-]{32,}={0,2}/]
    for (const f of files) for (const p of pats) expect(p.test(f.content), `${f.path} ${p}`).toBe(false)
  })
})
