// The post-run check on the container path (docs/tryitout-post-run-check.md). New file: the pre-existing runner
// tests stay unmodified (src/lib/mcptest/criteria.test.ts).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'

vi.mock('../tryItOutPrompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tryItOutPrompts')>()
  return {
    ...actual,
    loadPiSkill: vi.fn(async (slug: string) => ({
      basePrompt: 'BASE',
      skillMarkdown: `---\nname: ${slug}\ndescription: d\n---\nBODY`,
    })),
  }
})

type Fake = import('./runtimeFake').FakeRuntime
type Ctx = Parameters<Parameters<Fake['scriptExec']>[0]>[0]
let tmpDir: string
let jobsMod: typeof import('../tryItOutJobs')
let runJobInContainer: typeof import('./piRunner').runJobInContainer
let svcMod: typeof import('./service')
let fakeMod: typeof import('./runtimeFake')
let cfgMod: typeof import('./runnerConfig')
let proxy: typeof import('./llmProxy')
let fx: typeof import('./piFixtures')

const DIR = join(process.cwd(), 'data/tryitout-prompts/ifc-ebom-compiler')
const SAMPLE = readFileSync(join(DIR, 'sample-ifc-elements.txt'), 'utf8')
const KEY = readFileSync(join(DIR, 'example-result.md'), 'utf8')
const SAMPLE_E12 = `${SAMPLE.trimEnd()}\nE-12,IfcDuctFitting,Tee,EXHAUST-2,250,tee,,0.640,agree,K1\n`
const E11_ROW = '| E-11 | IfcPipeSegment | review | K3 | - | - | - | zero-qty |'
const SLIP = KEY.replace(E11_ROW, `${E11_ROW}\n| E-12 | IfcDuctFitting | review | K1 | - | - | - | no-catalogue |`)

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tryitout-postrun-pi-test-'))
  process.env.TRYITOUT_WORK_DIR = tmpDir
  jobsMod = await import('../tryItOutJobs')
  ;({ runJobInContainer } = await import('./piRunner'))
  svcMod = await import('./service')
  fakeMod = await import('./runtimeFake')
  cfgMod = await import('./runnerConfig')
  proxy = await import('./llmProxy')
  fx = await import('./piFixtures')
})

afterAll(async () => {
  delete process.env.TRYITOUT_WORK_DIR
  await rm(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  jobsMod.__resetJobs()
  proxy.__resetProxy()
})

afterEach(() => {
  svcMod.__setTryItOutServiceForTests(null)
})

/** A container run whose agent writes `result` to output/result.md; returns the job's events and artifact entries. */
async function run(slug: string, upload: string | null, result: string) {
  const runtime: Fake = fakeMod.createFakeRuntime()
  const svc = svcMod.createTryItOutService({ runtime, config: cfgMod.parseRunnerConfig({}), instanceId: 't' })
  svcMod.__setTryItOutServiceForTests(svc)
  let staged: { task: string; upload: string | null } | null = null
  runtime.scriptExec((ctx: Ctx) => {
    if (ctx.cmd[0] === 'timeout') {
      const read = (f: string) => {
        const v = ctx.files.get(`${ctx.workingDir}/input/${f}`)
        return v instanceof Uint8Array ? v : undefined // the fake also stores directory markers
      }
      const up = read('upload.txt')
      staged = { task: strFromU8(read('task.txt')!), upload: up ? strFromU8(up) : null }
      ctx.files.set(`${ctx.workingDir}/output/result.md`, new TextEncoder().encode(result))
      ctx.stdout(fx.PI_SUCCESS_STREAM)
    }
    return 0
  })
  const job = jobsMod.createJob(slug, 'Compile the attached upload', upload === null ? null : new File(['x'], 'in.txt'), 'anon:s1')
  if (upload !== null) {
    const p = jobsMod.inputFilePath(job.jobId)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, upload, 'utf-8')
  }
  jobsMod.setStatus(job.jobId, 'running')
  await runJobInContainer(job.jobId)
  const j = jobsMod.getJob(job.jobId)!
  const entries = j.status === 'succeeded' ? unzipSync(new Uint8Array(await readFile(jobsMod.artifactZipPath(job.jobId)))) : {}
  return { status: j.status, events: j.events.map((e) => e.summary), entries, staged: staged as { task: string; upload: string | null } | null }
}

describe('post-run check, container path', () => {
  it('the E-12 slip: mismatch line in the feed before the settled line, report in the artifact, agent file untouched', async () => {
    const r = await run('ifc-ebom-compiler', SAMPLE_E12, SLIP)
    expect(r.status).toBe('succeeded')
    const i = r.events.indexOf('helper check: 1 mismatch with the ebom-join helper (details in ebom-join-check.md)')
    expect(i).toBeGreaterThan(-1)
    expect(r.events[i + 1]).toBe('  E-12: rule is "no-catalogue", helper says "multi-catalogue"')
    expect(r.events.at(-1)).toBe('agent settled (clean exit)')
    expect(Object.keys(r.entries).sort()).toEqual(['ebom-join-check.md', 'ebom.xlsx', 'result.md'])
    expect(strFromU8(r.entries['result.md'])).toBe(SLIP)
    expect(strFromU8(r.entries['ebom-join-check.md'])).toContain('E-12: rule is "no-catalogue", helper says "multi-catalogue"')
  })

  it('a correct result gets the match line', async () => {
    const r = await run('ifc-ebom-compiler', SAMPLE, KEY)
    expect(r.events).toContain('helper check: the class rows match the ebom-join helper on every cell')
    expect(Object.keys(r.entries).sort()).toEqual(['ebom-join-check.md', 'ebom.xlsx', 'result.md'])
  })

  it('the tool step writes excluded_by and the untied rules into the staged upload, before pi starts', async () => {
    const r = await run('ifc-ebom-compiler', SAMPLE, KEY)
    expect(r.staged!.upload).toContain('loc_block,excluded_by\n')
    expect(r.staged!.upload).toContain('E-06,IfcPipeSegment,Copper pipe,SYN-SPRINKLER,15,straight,1.80,1.801,agree,K3,rules:1')
    expect(r.staged!.upload).toContain('## RULES NOT TIED TO DATA\nrules:3: Insulation of cold-water pipes is billed by the insulation contractor')
    const step = r.events.findIndex((e) => e.startsWith('tool step: excluded_by worked out for 11 elements from 2 rules (E-05 rules:2, E-06 rules:1)'))
    expect(step).toBeGreaterThan(-1)
    expect(step).toBeLessThan(r.events.indexOf('starting pi…'))
    // The check still compares with the original upload: the key matches.
    expect(r.events).toContain('helper check: the class rows match the ebom-join helper on every cell')
  })

  it('other agents: the upload is staged byte for byte, with no tool step', async () => {
    const r = await run('demo-rfi-triage', 'RFI text\r\nwith CRLF', 'triage result')
    expect(r.staged!.upload).toBe('RFI text\r\nwith CRLF')
    expect(r.events.some((e) => e.startsWith('tool step'))).toBe(false)
  })

  it('other agents: no check line and no extra file', async () => {
    const r = await run('demo-rfi-triage', 'RFI text', 'triage result')
    expect(r.status).toBe('succeeded')
    expect(r.events.some((e) => e.startsWith('helper check'))).toBe(false)
    expect(Object.keys(r.entries)).toEqual(['result.md'])
  })
})
