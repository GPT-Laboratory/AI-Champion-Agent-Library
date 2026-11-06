// Phase 15 architecture, safety and cross-plan contract invariants (15-13). Read-only filesystem checks,
// one git query and a few pure calls; no network. Forbidden tokens and secret shapes are assembled at
// runtime so this file does not match itself.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSuite } from './core/suite'
import { CASE_IDS, CHECK_IDS, FIDELITY } from './core/fidelity'
import { DriverRequestSchema } from './driverRequest'
import { VARIANTS } from './fake/variants'
import { mcpTesterEnabled } from '../flags'
import { createFakeRuntime } from '../server/tryitout/runtimeFake'
import { createRunStore } from '../server/mcptest/jobs'
import { executeRun } from '../server/mcptest/service'

const ROOT = resolve(process.cwd())
const MCPTEST = join(ROOT, 'src/lib/mcptest')
const read = (p: string) => readFileSync(p, 'utf8')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.svelte-kit') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}
const isTest = (p: string) => /\.test\.ts$/.test(p)
const rel = (p: string) => relative(ROOT, p)

const FIDELITY_DOC = join(ROOT, 'docs/mcp-test-port-fidelity.md')
const PLATFORM_DOC = join(ROOT, 'docs/mcp-test-platform.md')
const CONTAINERFILE = join(ROOT, 'Containerfile.mcp-test-runner')
const phaseDir = join(ROOT, '.planning/phases', readdirSync(join(ROOT, '.planning/phases')).find((d) => d.startsWith('15-'))!)

// Tester files (code, suite, fixtures, runner image, platform doc), excluding this self-check and other tests.
const testerFiles = [
  ...walk(MCPTEST).filter((p) => !isTest(p) && !p.endsWith('criteria.test.ts')),
  ...walk(join(ROOT, 'scripts')).filter((p) => /mcp-test[^/]*\.ts$/.test(p) && !isTest(p)),
  CONTAINERFILE,
  PLATFORM_DOC
]

// Forbidden tokens, built from fragments.
const STUDY = ['mcp-gen', 'comparison'].join('-')
const ONLY_ONCE = ['S', 'TK'].join('')
const NEVER = [
  { name: 'study repo name', re: new RegExp(STUDY, 'i') },
  { name: 'wp5', re: /\bwp5[-_]/i },
  { name: 'LV' + 'I', re: new RegExp('\\b' + ['L', 'VI'].join('') + '\\b') },
  { name: 'ET' + 'IM', re: new RegExp('\\b' + ['ET', 'IM'].join('')) },
  { name: 'TT' + '0', re: new RegExp('\\b' + ['TT', '0'].join('') + '\\b') },
  { name: ONLY_ONCE, re: new RegExp('\\b' + ONLY_ONCE + '\\b') }
]
const NEVER_NO_ONLYONCE = NEVER.slice(0, 5)

describe('purity of core, mock, fake and helpers', () => {
  it('no mcptest module imports $lib, svelte or @sveltejs', () => {
    const importRe = /(?:from|import)\s+['"]([^'"]+)['"]/g
    for (const p of walk(MCPTEST).filter((f) => f.endsWith('.ts') && !isTest(f))) {
      for (const m of read(p).matchAll(importRe)) {
        expect(/^(\$lib|svelte|@sveltejs)/.test(m[1]), `${rel(p)} imports ${m[1]}`).toBe(false)
      }
    }
  })
  it('child_process is used only by core/transports/stdio.ts', () => {
    for (const p of walk(MCPTEST).filter((f) => f.endsWith('.ts') && !isTest(f))) {
      const src = read(p)
      const uses = /(?:from|import|require\()\s*\(?\s*['"](?:node:)?child_process['"]/.test(src)
      expect(uses, rel(p)).toBe(rel(p) === 'src/lib/mcptest/core/transports/stdio.ts')
    }
  })
})

describe('forbidden tokens', () => {
  it('no study-specific token in tester code, suite, fixtures, runner image or the platform doc', () => {
    for (const p of testerFiles) {
      const src = read(p)
      for (const t of NEVER) expect(t.re.test(src), `${t.name} in ${rel(p)}`).toBe(false)
    }
  })
  it('the fidelity doc has no forbidden token except the single source id inside a case-table row', () => {
    const src = read(FIDELITY_DOC)
    for (const t of NEVER_NO_ONLYONCE) expect(t.re.test(src), t.name).toBe(false)
    const lines = src.split('\n')
    const hits = lines.filter((l) => l.includes(ONLY_ONCE))
    expect(hits.length).toBe(1)
    expect(hits[0].startsWith('|')).toBe(true)
    expect(hits[0]).toContain(`T2-${ONLY_ONCE}-API`)
    expect((src.match(new RegExp(ONLY_ONCE, 'g')) ?? []).length).toBe(1)
  })
  it('the source case id appears in no other file of the repository scope', () => {
    const scope = [
      ...walk(join(ROOT, 'src')),
      ...walk(join(ROOT, 'scripts')),
      ...walk(join(ROOT, 'docs')).filter((p) => p !== FIDELITY_DOC),
      join(ROOT, 'README.md'),
      join(ROOT, 'TECHNICAL_DOCUMENTATION.md'),
      CONTAINERFILE
    ].filter((p) => !p.endsWith('criteria.test.ts') && /\.(ts|svelte|md|mmd|ya?ml|json|jsonl|csv|txt|js)$|Containerfile/.test(p))
    const re = new RegExp('\\b' + ONLY_ONCE + '\\b')
    for (const p of scope) expect(re.test(read(p)), rel(p)).toBe(false)
  })
})

describe('secrets and URLs', () => {
  const secretRes = [
    new RegExp(['s', 'k-'].join('') + '[A-Za-z0-9_-]{20,}'),
    new RegExp(['gh', 'p_'].join('') + '[A-Za-z0-9]{20,}'),
    new RegExp(['AK', 'IA'].join('') + '[A-Z0-9]{16}'),
    /Bearer\s+[A-Za-z0-9._-]{24,}/,
    /\b[0-9a-f]{40,}\b/
  ]
  it('no secret-shaped strings in tester files', () => {
    for (const p of testerFiles) for (const re of secretRes) expect(re.test(read(p)), `${re} in ${rel(p)}`).toBe(false)
  })
  it('every http(s) URL literal in code, suite and fixtures is loopback', () => {
    const urlRe = /https?:\/\/(\[[^\]]+\]|[A-Za-z0-9.-]+)/g
    for (const p of testerFiles.filter((f) => f !== PLATFORM_DOC && f !== CONTAINERFILE)) {
      for (const m of read(p).matchAll(urlRe)) {
        const host = m[1].replace(/^\[|\]$/g, '')
        expect(['127.0.0.1', 'localhost', '::1'], `${m[0]} in ${rel(p)}`).toContain(host)
      }
    }
  })
  it('the platform doc links no host other than loopback or the public specification site', () => {
    for (const m of read(PLATFORM_DOC).matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      expect(['127.0.0.1', 'localhost', 'modelcontextprotocol.io', 'spec.modelcontextprotocol.io']).toContain(m[1])
    }
  })
  it('no .env file is read by the tester or its CLI', () => {
    for (const p of testerFiles.filter((f) => f.endsWith('.ts'))) {
      expect(/(readFile|readFileSync|createReadStream)\([^)]*\.env/.test(read(p)), rel(p)).toBe(false)
    }
  })
})

describe('flags', () => {
  it('MCP_TESTER defaults off, accepts the usual truthy values and is independent of MCP_GENERATOR', () => {
    expect(mcpTesterEnabled({})).toBe(false)
    for (const v of ['1', 'true', 'on', 'yes']) expect(mcpTesterEnabled({ MCP_TESTER: v })).toBe(true)
    expect(mcpTesterEnabled({ MCP_TESTER: '0' })).toBe(false)
    expect(mcpTesterEnabled({ MCP_GENERATOR: '1' })).toBe(false)
  })
  it('MCP_TESTER_RUNTIME is assigned in no committed config file', () => {
    const files = [
      join(ROOT, 'package.json'),
      CONTAINERFILE,
      ...readdirSync(ROOT).filter((f) => f.startsWith('.env')).map((f) => join(ROOT, f)),
      ...walk(join(ROOT, 'scripts')).filter((p) => !isTest(p))
    ]
    for (const p of files) expect(/MCP_TESTER_RUNTIME\s*[=:]/.test(read(p)), rel(p)).toBe(false)
  })
})

describe('cross-plan contracts', () => {
  const enc = new TextEncoder()
  async function capture(subject: string, cases: string[]): Promise<unknown> {
    const store = createRunStore()
    const run = store.createRun('criteria')
    const rt = createFakeRuntime()
    let req: unknown
    rt.scriptExec(({ files }) => {
      req = JSON.parse(Buffer.from(files.get('/work/in/request.json') as Uint8Array).toString('utf8'))
      files.set('/work/out/report.json', enc.encode('{}'))
      return 0
    })
    await executeRun(run.id, { subject, cases }, {
      store,
      env: { MCP_TESTER_RUNTIME: 'container' },
      runtimeFactory: () => rt,
      driverTree: [{ path: 'src/lib/mcptest/driver.ts', content: '// driver' }]
    })
    return req
  }
  it('requests built by the container-run path parse with the shared DriverRequestSchema', async () => {
    const fake = await capture('fake:good', ['T1-STD-CATALOG'])
    expect(DriverRequestSchema.safeParse(fake).success).toBe(true)
    const gen = await capture('generator:openapi', ['T2-CATALOG-API'])
    const parsed = DriverRequestSchema.safeParse(gen)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.subject.kind).toBe('staged')
  })
  it('DriverRequest is declared in one module only', () => {
    const decl = /(?:const|type|interface)\s+DriverRequest(?:Schema)?\b\s*[=<{]/
    const holders = [...walk(join(ROOT, 'src/lib')), ...walk(join(ROOT, 'scripts'))]
      .filter((p) => p.endsWith('.ts') && !isTest(p) && decl.test(read(p)))
      .map(rel)
    expect(holders).toEqual(['src/lib/mcptest/driverRequest.ts'])
  })
  it('every fake variant is labelled as a scorer fixture', () => {
    for (const v of Object.values(VARIANTS)) expect(v.description.startsWith('Scorer fixture:'), v.id).toBe(true)
  })
  it('the suite has the 12 cases of CASE_IDS and the fidelity table agrees with suite and docs', async () => {
    const suite = await loadSuite()
    if (!suite.ok) throw new Error(suite.errors.join('; '))
    expect(suite.cases.map((c) => c.def.id).sort()).toEqual([...CASE_IDS].sort())
    const fidelityCases = FIDELITY.filter((f) => f.group === 'case').map((f) => f.id)
    expect([...fidelityCases].sort()).toEqual([...CASE_IDS].sort())
    const fid = read(FIDELITY_DOC)
    const platform = read(PLATFORM_DOC)
    for (const id of CASE_IDS) {
      expect(fid, id).toContain(id)
      expect(platform, id).toContain(id)
    }
    for (const id of CHECK_IDS) {
      expect(fid, id).toContain(id)
      expect(platform, id).toContain(id)
    }
  })
})

describe('docs and pending-human list', () => {
  const needles = [
    'npm run mcp-test',
    'MCP_TESTER_RUNTIME=container',
    'podman build -t localhost/mcp-test-runner:latest',
    '--allow-local-exec',
    'pending human'
  ]
  it('the platform doc and the UAT file contain every pending-human command', () => {
    for (const f of [PLATFORM_DOC, join(phaseDir, '15-HUMAN-UAT.md')]) {
      expect(existsSync(f), f).toBe(true)
      const src = read(f)
      for (const n of needles) expect(src, `${n} in ${rel(f)}`).toContain(n)
    }
  })
  it('every UAT item is unchecked unless a live run (E9, E10) recorded it', () => {
    // Pre-existing pin, minimally relaxed (D-504): live Podman and CLI runs by a human-supervised session may tick items.
    const src = read(join(phaseDir, '15-HUMAN-UAT.md'))
    if (/- \[x\]/i.test(src)) expect(src).toMatch(/E10 update|E9 update/)
  })
})

describe('no pre-existing test file was modified by Phase 15', () => {
  // Baseline = parent of the commit that started the phase. jobs.test.ts changed later in a flake fix (D-163): exempt by name.
  // jobs.test.ts: flake fix (D-163). customize-button.mcp*.test.ts: import path only, helpers moved to $lib/pageFlags (build fix, B-002).
  const EXEMPT = [
    'src/routes/api/tryitout/jobs/jobs.test.ts',
    'src/routes/agents/customize-button.mcp.test.ts',
    'src/routes/agents/customize-button.mcptest.test.ts',
    // E8 decisions (D-461..D-466, decided by Ville 2026-10-14): each file below pins behaviour Ville changed; see .planning/exploration/E8-decisions-impl.md.
    'src/hooks.server.test.ts', // D-461: auth 401 body is { message }
    'src/routes/errorStates.api.test.ts', // D-462: it pinned that hooks define no handleError; now handleError exists and must stay generic
    'scripts/ingest.kinds.test.ts', // D-466: flag-on ingest skips fixtures directories, so the catalog no longer gains minimal-agent
    'src/lib/mcptest/containerfile.test.ts', // D-464: the image ends with USER pi (was node); D-500 (E10): install in /deps and move, not --prefix /
    'src/lib/server/mcptest/containerRun.fixes.test.ts', // D-464: RUNNER_USER and the Containerfile user are pi
    'src/lib/mcpgen/generate.test.ts', // FastMCP pin widened to <5 after live verification on 3.4.8 and 4.1.0 (2026-10-14); D-504 (E10 D3): file list gains mcptest-binding.json
    'src/lib/mcpgen/sanitize.test.ts', // D-504 (E10 D3): a generated package has six files (+ mcptest-binding.json)
    'src/lib/mcptest/generatorSubject.test.ts', // D-463: the stale example is now a reported gap, so the partial-spec case passes gap_reported
    'src/lib/mcpgen/adapters/openapi.test.ts', // D-520: Swagger 2.0 is read now (detect 0.95; an empty one is rejected as no-operations), see E11-swagger2.md
    // E12 (D-546): the prisma adapter is registered, so the adapter id lists in these two tests gain 'prisma'; see .planning/exploration/E12-sql-dialects.md.
    'src/lib/mcpgen/registry.test.ts',
    'src/lib/mcpgen/criteria.test.ts',
    'scripts/tryout-run.test.ts', // Phase 23 CR-52 (D-618..): a connection that never reached the server keeps no 0.50 USD reserve
    // Phase 25: each new catalog agent bumps the hard-coded agent count (25-02, 25-03).
    'src/lib/server/search/accuracy.test.ts',
  ]
  it('git diff --diff-filter=M against the baseline lists no test file', () => {
    let start = ''
    try {
      start = execFileSync('git', ['log', '--format=%H', '--grep=^docs(15): auto-generated context', '-n', '1'], { cwd: ROOT, encoding: 'utf8' }).trim()
    } catch {
      return // not a git checkout
    }
    if (!start) return // history unavailable (shallow clone)
    const out = execFileSync('git', ['diff', '--diff-filter=M', '--name-only', `${start}^..HEAD`], { cwd: ROOT, encoding: 'utf8' })
    const modified = out
      .split('\n')
      .filter((f) => /\.test\.(ts|js)$/.test(f))
      .filter((f) => !EXEMPT.includes(f))
    expect(modified).toEqual([])
  })
})
