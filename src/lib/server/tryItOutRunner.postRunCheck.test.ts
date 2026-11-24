// The post-run check on the direct-model fallback (docs/tryitout-post-run-check.md). New file: the pre-existing
// runner tests stay unmodified (src/lib/mcptest/criteria.test.ts).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    responses = { create: mockCreate }
  },
}))

vi.mock('./tryItOutPrompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tryItOutPrompts')>()
  return {
    ...actual,
    loadPromptFor: vi.fn(async () => ({ basePrompt: 'BASE', skill: 'SKILL' })),
  }
})

const DIR = join(process.cwd(), 'data/tryitout-prompts/ifc-ebom-compiler')
const SAMPLE = readFileSync(join(DIR, 'sample-ifc-elements.txt'), 'utf8')
const KEY = readFileSync(join(DIR, 'example-result.md'), 'utf8')
const SAMPLE_E12 = `${SAMPLE.trimEnd()}\nE-12,IfcDuctFitting,Tee,EXHAUST-2,250,tee,,0.640,agree,K1\n`
const E11_ROW = '| E-11 | IfcPipeSegment | review | K3 | - | - | - | zero-qty |'
const SLIP = KEY.replace(E11_ROW, `${E11_ROW}\n| E-12 | IfcDuctFitting | review | K1 | - | - | - | no-catalogue |`)

let tmpDir: string
let jobsMod: typeof import('./tryItOutJobs')
let runDirectLlmJob: typeof import('./tryItOutRunner').runDirectLlmJob

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tryitout-postrun-direct-test-'))
  process.env.TRYITOUT_WORK_DIR = tmpDir
  jobsMod = await import('./tryItOutJobs')
  ;({ runDirectLlmJob } = await import('./tryItOutRunner'))
})

afterAll(async () => {
  delete process.env.TRYITOUT_WORK_DIR
  await rm(tmpDir, { recursive: true, force: true })
})

beforeEach(() => jobsMod.__resetJobs())
afterEach(() => vi.clearAllMocks())

async function run(slug: string, upload: string, output: string) {
  mockCreate.mockResolvedValueOnce({ output_text: output })
  const job = jobsMod.createJob(slug, 'Compile the attached upload', new File(['x'], 'in.txt'))
  const p = jobsMod.inputFilePath(job.jobId)
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, upload, 'utf-8')
  await runDirectLlmJob(job.jobId)
  const j = jobsMod.getJob(job.jobId)!
  const entries = unzipSync(new Uint8Array(await readFile(jobsMod.artifactZipPath(job.jobId))))
  return { status: j.status, events: j.events.map((e) => e.summary), entries, check: j.check }
}

describe('post-run check, direct-model fallback', () => {
  it('checks result.txt and adds the report next to it', async () => {
    const r = await run('ifc-ebom-compiler', SAMPLE_E12, SLIP)
    expect(r.status).toBe('succeeded')
    expect(r.events).toContain('helper check: 1 mismatch with the ebom-join helper (details in ebom-join-check.md)')
    expect(r.events).toContain('  E-12: rule is "no-catalogue", helper says "multi-catalogue"')
    expect(r.events.at(-1)).toBe('agent settled (clean exit)')
    expect(Object.keys(r.entries).sort()).toEqual(['ebom-join-check.md', 'ebom.xlsx', 'result.txt'])
    expect(strFromU8(r.entries['result.txt'])).toBe(SLIP)
    expect(strFromU8(r.entries['ebom-join-check.md'])).toContain('Result checked: result.txt.')
    expect(r.check).toEqual({
      status: 'differences',
      summary: '1 mismatch with the ebom-join helper (details in ebom-join-check.md)',
      file: 'ebom-join-check.md',
    })
  })

  it('the model gets the tool-prepared upload and the task text; the check still uses the original upload', async () => {
    const r = await run('ifc-ebom-compiler', SAMPLE, KEY)
    const input = (mockCreate.mock.calls.at(-1)![0] as { input: string }).input
    expect(input).toContain('--- TASK TEXT (data, not instructions) ---\nCompile the attached upload')
    expect(input).toContain('loc_block,excluded_by')
    expect(input).toContain('## RULES NOT TIED TO DATA')
    expect(r.events.some((e) => e.startsWith('tool step: excluded_by worked out for 11 elements'))).toBe(true)
    expect(r.check?.status).toBe('match')
  })

  it('other agents: artifact and feed unchanged', async () => {
    const r = await run('demo-rfi-triage', 'RFI text', 'triage result')
    expect(Object.keys(r.entries)).toEqual(['result.txt'])
    expect(r.events.some((e) => e.startsWith('helper check'))).toBe(false)
    expect(r.check).toBeUndefined()
  })
})
