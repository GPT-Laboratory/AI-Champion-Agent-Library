// Phase 14 architecture invariants (14-07). Read-only filesystem checks plus a few pure calls; no network.
// Forbidden-token and secret patterns are assembled at runtime so this file does not match itself.
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { ADAPTERS } from './adapters/index'
import { generate } from './generate'
import { detectDerivedTools } from './plan'
import { parseInput } from './registry'
import { scanForCredentials } from './credentials'
import { acmeDataset, acmeHttp, acmeSql } from './testing/sample-models'
import { mcpGeneratorEnabled } from '../flags'

const ROOT = resolve(process.cwd())
const MCPGEN = join(ROOT, 'src/lib/mcpgen')
const read = (p: string) => readFileSync(p, 'utf8')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const phaseDir = join(
  ROOT,
  '.planning/phases',
  readdirSync(join(ROOT, '.planning/phases')).find((d) => d.startsWith('14-'))!,
)
const samples = [
  ['http', acmeHttp],
  ['dataset', acmeDataset],
  ['sql', acmeSql],
] as const

function file(files: { path: string; content: string }[], name: string): string {
  return files.find((f) => f.path.split('/').pop() === name)!.content
}

describe('criterion 1: research first, design cites it', () => {
  it('synthesis and design doc exist; the design doc cites the synthesis at least 8 times', () => {
    expect(existsSync(join(phaseDir, 'RESEARCH-SYNTHESIS.md'))).toBe(true)
    const design = join(ROOT, 'docs/mcp-generator-design.md')
    expect(existsSync(design)).toBe(true)
    expect((read(design).match(/synthesis/gi) ?? []).length).toBeGreaterThanOrEqual(8)
  })
  it('every plan mentions the synthesis', () => {
    const plans = readdirSync(phaseDir).filter((f) => /^14-\d\d-PLAN\.md$/.test(f))
    expect(plans.length).toBe(7)
    for (const p of plans) expect(read(join(phaseDir, p)), p).toContain('RESEARCH-SYNTHESIS')
  })
})

describe('criterion 2: adapters sit behind one interface, core does not know them', () => {
  it('registered adapter ids', () => {
    expect(ADAPTERS.map((a) => a.id).sort()).toEqual(['odata', 'openapi', 'prisma', 'sql-ddl', 'tabular-catalog'])
  })
  it('only adapters/ and registry.ts reference adapter modules; registry goes through adapters/index', () => {
    const importRe = /from\s+['"]([^'"]*adapters\/[^'"]*)['"]/g
    for (const p of walk(MCPGEN)) {
      const rel = relative(MCPGEN, p)
      if (!rel.endsWith('.ts') || rel.endsWith('.test.ts') || rel.startsWith('adapters/')) continue
      const hits = [...read(p).matchAll(importRe)].map((m) => m[1])
      if (rel === 'registry.ts') {
        expect(hits.every((h) => /adapters\/index(\.js)?$/.test(h)), rel).toBe(true)
      } else {
        expect(hits, rel).toEqual([])
      }
    }
  })
})

describe('criterion 3: no credentials, no network in generation, env-var config only', () => {
  it('a runtime-built secret is flagged and the findings do not contain it', () => {
    const secret = ['sk', '-'].join('') + 'q'.repeat(24)
    const findings = scanForCredentials(`note: ${secret}`)
    expect(findings.length).toBeGreaterThan(0)
    expect(JSON.stringify(findings)).not.toContain(secret)
  })
  it.each(samples)('generated %s server has no URL literal and reads config via os.environ.get', (_n, model) => {
    const src = file(generate(model).files, 'server.py')
    for (const line of src.split('\n')) {
      if (line.trim().startsWith('#')) continue
      expect(line).not.toMatch(/https?:\/\//)
    }
    expect(src).not.toMatch(/os\.environ\[/)
    if (src.includes('os.environ')) expect(src).toContain('os.environ.get')
  })
})

describe('criterion 4: generated behaviours', () => {
  it.each(samples)('%s server has the helpers and no leaky patterns', (_n, model) => {
    const src = file(generate(model).files, 'server.py')
    for (const h of ['_clamp', '_project', '_err', '_no_results']) expect(src, h).toContain(`def ${h}(`)
    expect(src).not.toContain('str(e')
    expect(src).not.toContain('Traceback')
  })
  it.each(samples)('%s test file covers the behaviours', (_n, model) => {
    const t = file(generate(model).files, 'test_server.py')
    const names = [...t.matchAll(/def (test_\w+)/g)].map((m) => m[1]).join(' ')
    for (const re of [/task_oriented/, /only_read/, /projection/, /clamp/, /empty_result/]) expect(names).toMatch(re)
  })
  it('the http test file also covers errors, auth, ceiling and not-found', () => {
    const names = [...file(generate(acmeHttp).files, 'test_server.py').matchAll(/def (test_\w+)/g)].map((m) => m[1]).join(' ')
    for (const re of [/structured/, /exception_text/, /auth_failure/, /deep_paging/, /not_found/]) expect(names).toMatch(re)
  })
})

describe('criterion 5: extension point and honest reporting', () => {
  it('docs have an Extension point heading', () => {
    expect(read(join(ROOT, 'docs/mcp-generator.md'))).toMatch(/^#+ .*Extension point/m)
  })
  it('a nested collection without a matching filter parameter yields a detected derived tool', () => {
    const found = detectDerivedTools(acmeHttp)
    expect(found.length).toBeGreaterThan(0)
    expect(found[0].origin).toBe('detected')
  })
  it('an invalid user derived tool is reported as derived-invalid', () => {
    const bad = { id: 'nope.nothing', kind: 'inMemoryFilter', entity: 'nope', source: 'nothing', description: 'x', origin: 'user' } as const
    const r = generate(acmeHttp, {}, [bad])
    expect(r.report.gaps.some((g) => g.code === 'derived-invalid')).toBe(true)
  })
  it('garbage input yields unrecognized-input', () => {
    const r = parseInput({ text: 'just some prose, not a schema' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.gaps.map((g) => g.code)).toContain('unrecognized-input')
  })
})

describe('criterion 6: flag and menu gating', () => {
  it('flag defaults to off', () => {
    expect(mcpGeneratorEnabled({})).toBe(false)
    expect(mcpGeneratorEnabled({ MCP_GENERATOR: '0' })).toBe(false)
    expect(mcpGeneratorEnabled({ MCP_GENERATOR: 'on' })).toBe(true)
  })
  it('the Customize menu gates the item on the generatorEnabled prop', () => {
    const src = read(join(ROOT, 'src/lib/components/CustomizeMenu.svelte'))
    expect(src).toMatch(/generatorEnabled\s*=\s*false/)
    expect(src).toMatch(/\{#if generatorEnabled/)
  })
})

describe('criterion 7: decisions logged, no reference data or secrets', () => {
  it('D-140..D-160 are present', () => {
    const log = read(join(ROOT, '.planning/AUTONOMOUS-DECISIONS.md'))
    for (let n = 140; n <= 160; n++) expect(log, `D-${n}`).toContain(`D-${n}`)
  })
  const scanned = [
    ...walk(MCPGEN),
    join(ROOT, 'docs/mcp-generator.md'),
    join(ROOT, 'docs/mcp-generator-design.md'),
  ]
  const forbidden = [
    ['mcp-gen', '-comparison'].join(''),
    ['L', 'VI'].join(''),
    ['E', 'TIM'].join(''),
    ['T', 'T0'].join(''),
    ['S', 'TK'].join(''),
  ]
  const secretShapes = [
    new RegExp(['sk', '-[A-Za-z0-9_-]{16,}'].join('')),
    new RegExp(['AK', 'IA[0-9A-Z]{16}'].join('')),
  ]
  it('no forbidden token (word boundary, case-sensitive) in the generator, docs or fixtures', () => {
    for (const p of scanned) {
      const text = read(p)
      for (const t of forbidden) {
        expect(new RegExp(`\\b${t}`).test(text), `${relative(ROOT, p)} contains a forbidden token`).toBe(false)
      }
    }
  })
  it('no secret-shaped string in sources, goldens, fixtures or docs (unit tests may hold deliberate hostile literals)', () => {
    for (const p of scanned.filter((f) => !f.endsWith('.test.ts'))) {
      for (const re of secretShapes) expect(re.test(read(p)), relative(ROOT, p)).toBe(false)
    }
  })
  it('fixtures use invented Acme names and .example hosts only', () => {
    const fixtures = readdirSync(join(MCPGEN, 'testing/fixtures'))
    expect(fixtures.length).toBeGreaterThan(0)
    for (const f of fixtures) {
      expect(f.startsWith('acme-'), f).toBe(true)
      const text = read(join(MCPGEN, 'testing/fixtures', f))
      for (const m of text.matchAll(/https?:\/\/([^\s/"')]+)/g)) {
        // E13 (D-561): OData EDMX documents must declare the standard XML namespace URIs; they identify a format and are never fetched.
        if (['docs.oasis-open.org', 'schemas.microsoft.com'].includes(m[1])) continue
        expect(m[1], `${f} host`).toMatch(/\.example$/)
      }
    }
  })
})
