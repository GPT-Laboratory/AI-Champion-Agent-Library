import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runPipeline } from '../mcpgen/pipeline'
import { loadSuite } from './core/suite'
import type { SuiteCase } from './core/suite'
import { runGeneratorSideChecks } from './generatorChecks'
import { deriveBinding, deriveEnvNames, generatorSubjects, resolveSample } from './generatorSubject'

let suite: SuiteCase[] | null = null
async function getCase(id: string): Promise<SuiteCase> {
  if (!suite) {
    const r = await loadSuite()
    if (!r.ok) throw new Error(r.errors.join('; '))
    suite = r.cases
  }
  const c = suite!.find((x) => x.def.id === id)
  if (!c) throw new Error('missing case ' + id)
  return c
}

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'gensubj-'))
  dirs.push(d)
  return d
}
const sampleText = (f: string) =>
  readFileSync(new URL(`../mcpgen/testing/fixtures/${f}`, import.meta.url), 'utf8')

describe('generatorSubjects', () => {
  const subjects = generatorSubjects()
  it('declares three generator subjects', () => {
    expect(subjects.map((s) => s.id)).toEqual(['generator:openapi', 'generator:tabular-catalog', 'generator:sql-ddl'])
    for (const s of subjects) {
      expect(s.kind).toBe('generator')
      expect(s.modality).toBe('spec')
      expect(s.llm).toBe(false)
      expect(s.transports).toEqual(['stdio'])
      expect(s.networkPolicy).toMatch(/no network/)
    }
  })

  it('resolves known samples only', () => {
    expect(resolveSample('generator:openapi')?.file).toBe('acme-openapi.yaml')
    expect(resolveSample('generator:nope')).toBeNull()
  })

  it('generates in process, writes the package and returns a stdio descriptor', async () => {
    const c = await getCase('T1-STD-CATALOG')
    const wd = await tmp()
    const r = await subjects[0].prepare(c.def, wd)
    expect(r.status).toBe('PASS')
    expect(r.launch).toMatchObject({ kind: 'stdio', command: 'python3', cwd: join(wd, 'pkg') })
    if (r.launch?.kind === 'stdio') {
      expect(r.launch.args[0]).toMatch(/server\.py$/)
      expect((await readFile(join(r.launch.cwd, r.launch.args[0]), 'utf8')).length).toBeGreaterThan(0)
    }
    expect(r.binding?.lookup_by_id?.tool).toBe('lookup_part_by_id')
    expect(r.envNames).toEqual({ baseUrl: 'ACME_PARTS_BASE_URL', apiKey: 'ACME_PARTS_API_KEY' })
    expect(r.extraChecks?.map((x) => x.id)).toEqual(['generates', 'reproducible'])
  })

  it('binds sql and tabular subjects to query_*', async () => {
    const c = await getCase('T1-STD-CATALOG')
    for (const i of [1, 2]) {
      const r = await subjects[i].prepare(c.def, await tmp())
      expect(r.status).toBe('PASS')
      expect(r.binding?.lookup_by_id?.tool).toMatch(/^query_/)
    }
  })

  it('reports NA for docs, composite and http cases', async () => {
    const wd = await tmp()
    expect((await subjects[0].prepare((await getCase('T3-RT-DOCS')).def, wd)).status).toBe('NA_MODALITY')
    expect((await subjects[0].prepare((await getCase('T3-COMPOSITE')).def, wd)).status).toBe('NA_MODALITY')
    const http = await subjects[0].prepare((await getCase('T2-CATALOG-HTTP')).def, wd)
    expect(http.status).toBe('NA_TRANSPORT')
    expect(http.error).toMatch(/generator-unsupported/)
  })

  it('maps the partial-spec case to the openapi sample only', async () => {
    const c = await getCase('T4-PARTIAL-SPEC')
    expect((await subjects[1].prepare(c.def, await tmp())).status).toBe('NA_MODALITY')
    const r = await subjects[0].prepare(c.def, await tmp())
    expect(r.status).toBe('PASS')
    expect(r.extraChecks?.find((x) => x.id === 'gap_reported')).toBeDefined()
  })

  it('returns GEN_FAILED with capped notes when the pipeline fails', async () => {
    const failing = generatorSubjects({
      runPipelineFn: () => ({ ok: false, gaps: [{ code: 'x', message: 'y'.repeat(500), severity: 'error' }] })
    })
    const r = await failing[0].prepare((await getCase('T1-STD-CATALOG')).def, await tmp())
    expect(r.status).toBe('GEN_FAILED')
    expect(r.error!.length).toBeLessThanOrEqual(200)
    expect(r.launch).toBeUndefined()
  })

  it('never imports child_process', () => {
    for (const f of ['generatorSubject.ts', 'generatorChecks.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
      expect(src).not.toMatch(/child_process/)
      expect(src).not.toMatch(/\$lib/)
    }
  })
})

describe('deriveBinding / deriveEnvNames', () => {
  it('maps tool prefixes', () => {
    const b = deriveBinding(['describe_x', 'query_x', 'list_things', 'search_x'])
    expect(b.lookup_by_id?.tool).toBe('query_x')
    expect(b.pagesize_clamp?.tool).toBe('list_things')
    expect(deriveBinding([])).toEqual({})
  })
  it('applies the suffix rule', () => {
    expect(
      deriveEnvNames([{ name: 'A_BASE_URL' }, { name: 'A_API_KEY' }, { name: 'A_BASE_URL_B' }, { name: 'A_DATA_PATH' }])
    ).toEqual({ baseUrl: 'A_BASE_URL', apiKey: 'A_API_KEY', baseUrlB: 'A_BASE_URL_B', dataPath: 'A_DATA_PATH' })
  })
  // CR-51: bearer and OAuth2 credentials and the data location are mapped too.
  it('maps bearer and OAuth2 tokens to the key and the data variables to the data path', () => {
    expect(deriveEnvNames([{ name: 'ACME_BASE_URL' }, { name: 'ACME_TOKEN' }])).toEqual({ baseUrl: 'ACME_BASE_URL', apiKey: 'ACME_TOKEN' })
    expect(deriveEnvNames([{ name: 'ACME_ACCESS_TOKEN' }])).toEqual({ apiKey: 'ACME_ACCESS_TOKEN' })
    expect(deriveEnvNames([{ name: 'ACME_WIDGETS_DATA_FILE' }])).toEqual({ dataPath: 'ACME_WIDGETS_DATA_FILE' })
    expect(deriveEnvNames([{ name: 'ACME_DB_PATH' }])).toEqual({ dataPath: 'ACME_DB_PATH' })
  })
})

describe('runGeneratorSideChecks', () => {
  const openapi = { id: 'openapi', input: sampleText('acme-openapi.yaml'), filename: 'acme-openapi.yaml' }

  it('generates and reproducible pass for the standard sample', () => {
    const r = runGeneratorSideChecks('T1-STD-CATALOG', { sample: openapi })
    expect(r.map((x) => [x.id, x.status, x.dimension])).toEqual([
      ['generates', 'PASS', 'D1'],
      ['reproducible', 'PASS', 'D6']
    ])
    expect(r.every((x) => x.kind === 'generator_side')).toBe(true)
  })

  it('a nondeterministic pipeline fails reproducible', () => {
    let n = 0
    const stub = ((raw: string) => {
      const real = runPipeline(raw)
      if (!real.ok) return real
      return { ...real, files: real.files.map((f) => ({ ...f, content: f.content + String(n++) })) }
    }) as typeof runPipeline
    const r = runGeneratorSideChecks('T1-STD-CATALOG', { sample: openapi, runPipelineFn: stub })
    expect(r.find((x) => x.id === 'reproducible')?.status).toBe('FAIL')
  })

  it('generates fails when the pipeline fails', () => {
    const stub = (() => ({ ok: false, gaps: [{ code: 'bad', message: 'm', severity: 'error' }] })) as unknown as typeof runPipeline
    const r = runGeneratorSideChecks('T1-STD-CATALOG', { sample: openapi, runPipelineFn: stub })
    expect(r[0].status).toBe('FAIL')
  })

  it('partial spec: every planted defect is now reported (D-463: example-schema-mismatch)', () => {
    const partial = {
      id: 'openapi',
      input: readFileSync(new URL('./suite/T4-PARTIAL-SPEC/fixture/spec/partial-openapi.yaml', import.meta.url), 'utf8'),
      filename: 'partial-openapi.yaml'
    }
    // The operation without a response type is omitted with a gap (which also covers the undocumented header on the
    // same operation); the stale example on the by-id operation is reported as example-schema-mismatch and the tool
    // is still generated from the schema.
    const gen = runPipeline(partial.input, { filename: partial.filename })
    expect(gen.ok && gen.report.gaps.some((g) => g.code === 'missing-response-schema')).toBe(true)
    expect(gen.ok && gen.report.gaps.some((g) => g.code === 'example-schema-mismatch' && g.severity === 'warn' && typeof g.path === 'string' && g.path.length > 0)).toBe(true)
    expect(gen.ok && gen.report.toolsEmitted).toEqual(['lookup_gadget_by_id'])
    const r = runGeneratorSideChecks('T4-PARTIAL-SPEC', { sample: partial })
    const gap = r.find((x) => x.id === 'gap_reported')!
    expect(gap.status).toBe('PASS')
    expect(gap.flags ?? []).toEqual([])
    expect(r.find((x) => x.id === 'reproducible')?.status).toBe('PASS')
  })

  it('SILENT_GUESS detection is intact: a subject that stays silent about the stale example still fails', () => {
    const partial = {
      id: 'openapi',
      input: readFileSync(new URL('./suite/T4-PARTIAL-SPEC/fixture/spec/partial-openapi.yaml', import.meta.url), 'utf8'),
      filename: 'partial-openapi.yaml'
    }
    // Synthetic subject: the real pipeline minus the example gap (what Phase 14 did before D-463).
    const silentOnExample = ((raw: string, o?: Parameters<typeof runPipeline>[1]) => {
      const real = runPipeline(raw, o)
      if (!real.ok) return real
      return { ...real, report: { ...real.report, gaps: real.report.gaps.filter((g) => g.code !== 'example-schema-mismatch') } }
    }) as typeof runPipeline
    const gap = runGeneratorSideChecks('T4-PARTIAL-SPEC', { sample: partial, runPipelineFn: silentOnExample }).find((x) => x.id === 'gap_reported')!
    expect(gap.status).toBe('FAIL')
    expect(gap.reason).toMatch(/stale example/)
    expect(gap.flags).toEqual([expect.objectContaining({ id: 'SILENT_GUESS', severity: 'warning' })])
  })

  it('partial spec: passes when every defect is reported', () => {
    const stub = (() => ({
      ok: true,
      files: [{ path: 'server.py', content: 'x' }],
      serverName: 's',
      adapterId: 'openapi',
      report: {
        toolsEmitted: [],
        toolsDropped: [],
        gaps: [],
        assumptions: [],
        envVars: []
      }
    })) as unknown as typeof runPipeline
    const r = runGeneratorSideChecks('T4-PARTIAL-SPEC', { sample: { id: 'openapi', input: 'a' }, runPipelineFn: stub })
    expect(r.find((x) => x.id === 'gap_reported')?.status).toBe('PASS')
  })

  it('rejects a credential-looking input without echoing it', () => {
    const r = runGeneratorSideChecks('T4-SEC-SECRETS', { sample: openapi })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'credential_rejected', dimension: 'D4', status: 'PASS' })
    const secret = ['sk', '-'].join('') + 'a'.repeat(30)
    const real = runPipeline(`${openapi.input}\n# api_key: ${secret}\n`)
    expect(real.ok).toBe(false)
    expect(JSON.stringify(real)).not.toContain(secret)
    expect(r[0].reason).not.toContain(secret)
  })

  it('credential_rejected fails if the pipeline accepts the dirty input', () => {
    const stub = (() => ({ ok: true, files: [], report: {}, serverName: 's', adapterId: 'a' })) as unknown as typeof runPipeline
    expect(runGeneratorSideChecks('T4-SEC-SECRETS', { sample: openapi, runPipelineFn: stub })[0].status).toBe('FAIL')
  })

  it('unknown case ids return nothing and never throw', () => {
    expect(runGeneratorSideChecks('T9-NOPE', { sample: openapi })).toEqual([])
    const boom = (() => {
      throw new Error('x')
    }) as unknown as typeof runPipeline
    expect(() => runGeneratorSideChecks('T1-STD-CATALOG', { sample: openapi, runPipelineFn: boom })).not.toThrow()
  })
})
