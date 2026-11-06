// Review fixes CR-01, CR-03, CR-04, WR-04, WR-05, WR-08 for the container path. Fake runtime only: no engine,
// no image build. Whether a real engine accepts the image and commands stays a pending human check.
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadSuite } from '$lib/mcptest/core/suite'
import { runSuite } from '$lib/mcptest/core/runner'
import { fakeSubject } from '$lib/mcptest/core/subjects'
import type { DriverRequest } from '$lib/mcptest/driverRequest'
import { createFakeRuntime } from '../tryitout/runtimeFake'
import { buildCreateOptions } from '../tryitout/runtimeDockerode'
import { parseRunnerConfig } from '../tryitout/runnerConfig'
import { LABEL_MANAGED, LABEL_OWNER, type ContainerRuntime, type StagedFile } from '../tryitout/runtime'
import { DRIVER_CMD, RUNNER_USER, mcpTestRunnerConfig, missingGoldens, readDriverTree, runInContainer } from './containerRun'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const enc = new TextEncoder()
const fakeReq: DriverRequest = { v: 1, subject: { kind: 'fake', variant: 'good' }, cases: ['T1-STD-CATALOG'] }
const tree: StagedFile[] = [{ path: 'src/lib/mcptest/driver.ts', content: '// driver' }]

let reportJson = ''
beforeAll(async () => {
  const suite = await loadSuite()
  if (!suite.ok) throw new Error('suite')
  const report = await runSuite({ subject: fakeSubject('good'), cases: suite.cases.filter((c) => c.def.id === 'T1-STD-CATALOG'), runtime: 'container' })
  reportJson = JSON.stringify(report)
}, 60_000)

async function listFiles(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await listFiles(dir, r)))
    else if (e.isFile()) out.push(r)
  }
  return out.sort()
}

describe('driver tree staging (CR-01)', () => {
  const suiteDir = join(ROOT, 'src/lib/mcptest/suite')

  it('stages every file under the suite directory, including golden.jsonl and csv fixtures', async () => {
    const staged = new Set(readDriverTree().map((f) => f.path))
    const onDisk = await listFiles(suiteDir)
    expect(onDisk.some((f) => f.endsWith('golden.jsonl'))).toBe(true)
    expect(onDisk.some((f) => f.endsWith('.csv'))).toBe(true)
    for (const f of onDisk) expect(staged.has(`src/lib/mcptest/suite/${f}`), f).toBe(true)
  })

  it('the suite loaded from the staged tree equals the host suite', async () => {
    const host = await loadSuite()
    if (!host.ok) throw new Error('suite')
    const dest = await mkdtemp(join(tmpdir(), 'mcptest-tree-'))
    try {
      for (const f of readDriverTree()) {
        const abs = join(dest, f.path)
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, String(f.content))
      }
      const inContainer = await loadSuite(join(dest, 'src/lib/mcptest/suite'))
      if (!inContainer.ok) throw new Error(inContainer.errors.join('\n'))
      const shape = (cs: typeof host.cases) =>
        cs.map((c) => ({ id: c.def.id, golden: c.golden, fixtures: c.fixtureFiles.map((f) => f.path) }))
      expect(shape(inContainer.cases)).toEqual(shape(host.cases))
      expect(inContainer.cases.every((c) => c.golden.length > 0)).toBe(true)
    } finally {
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('missingGoldens names suite cases without a golden.jsonl', () => {
    const p = 'src/lib/mcptest/suite'
    expect(missingGoldens([{ path: `${p}/T2-A/case.yaml` }, { path: `${p}/T2-A/golden.jsonl` }])).toEqual([])
    expect(missingGoldens([{ path: `${p}/T2-A/case.yaml` }])).toEqual(['T2-A'])
  })

  it('runInContainer refuses a driver tree that lacks a golden before touching the engine', async () => {
    const rt = createFakeRuntime()
    const bad: StagedFile[] = [...tree, { path: 'src/lib/mcptest/suite/T2-A/case.yaml', content: 'id: T2-A' }]
    const res = await runInContainer(rt, fakeReq, [], { driverTree: bad })
    expect(res).toMatchObject({ ok: false, code: 'exec_failed' })
    expect(rt.calls).toEqual([])
  })
})

describe('image and command contract (CR-03, CR-04)', () => {
  const file = readFileSync(join(ROOT, 'Containerfile.mcp-test-runner'), 'utf8')
  const spec = { name: 'x', labels: {}, env: [] as string[] }

  it('the container user named by buildCreateOptions is the user the Containerfile ends with', () => {
    const user = [...file.matchAll(/^USER\s+(\S+)\s*$/gm)].map((m) => m[1]).pop()
    const opts = buildCreateOptions(mcpTestRunnerConfig({}), spec)
    expect(user).toBe('pi') // D-464: was 'node' before the pi user was added
    expect(opts.User).toBe(user)
    expect(RUNNER_USER).toBe(user)
  })

  it('mounts no /home/pi/agent tmpfs for this image, and keeps the Pi defaults for the Pi image', () => {
    const opts = buildCreateOptions(mcpTestRunnerConfig({}), spec)
    expect(Object.keys(opts.HostConfig?.Tmpfs ?? {})).toEqual(['/work', '/tmp'])
    const pi = buildCreateOptions(parseRunnerConfig({}), spec)
    expect(pi.User).toBe('pi')
    expect(Object.keys(pi.HostConfig?.Tmpfs ?? {})).toContain('/home/pi/agent')
  })

  it('the driver executable is reachable: absolute under /node_modules/.bin and on PATH', () => {
    expect(DRIVER_CMD[0]).toBe('/node_modules/.bin/tsx')
    expect(file).toMatch(/mv \/deps\/node_modules \/node_modules/) // E10 D4 (was: npm install --prefix /)
    expect(file).toMatch(/^ENV PATH=\/node_modules\/\.bin:/m)
    expect(DRIVER_CMD[1]).toBe('/work/src/lib/mcptest/driver.ts')
  })
})

describe('leak and cancellation (WR-04, WR-08)', () => {
  it('labels the container so the existing orphan sweep finds it', async () => {
    const rt = createFakeRuntime()
    let labels: Record<string, string> = {}
    rt.scriptExec(async () => {
      labels = (await rt.listManaged())[0].labels
      return 0
    })
    await runInContainer(rt, fakeReq, [], { driverTree: tree, ownerId: 'owner-1' })
    expect(labels[LABEL_MANAGED]).toBe('1')
    expect(labels[LABEL_OWNER]).toBe('owner-1')
    expect(labels['aic.mcptest']).toBe('1')
  })

  it('removes a container whose create call finishes after the timeout fired', async () => {
    const rt = createFakeRuntime()
    const release = rt.hang('createAndStart')
    const res = await runInContainer(rt, fakeReq, [], { driverTree: tree, timeoutMs: 40 })
    expect(res).toMatchObject({ ok: false, code: 'timeout' })
    expect(rt.containers()).toEqual([])
    release()
    for (let i = 0; i < 50 && (rt.calls.filter((c) => c === 'remove').length === 0 || rt.containers().length > 0); i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(rt.calls).toContain('remove')
    expect(rt.containers()).toEqual([])
  })

  it('aborts the exec signal when the run times out', async () => {
    const rt = createFakeRuntime()
    let signal: AbortSignal | undefined
    const wrapped: ContainerRuntime = {
      ...rt,
      exec: (_id, o) => {
        signal = o.signal
        return new Promise(() => {})
      }
    }
    const res = await runInContainer(wrapped, fakeReq, [], { driverTree: tree, timeoutMs: 40 })
    expect(res).toMatchObject({ ok: false, code: 'timeout' })
    expect(signal?.aborted).toBe(true)
  })

  it('honours the configured job timeout through mcpTestRunnerConfig', () => {
    expect(mcpTestRunnerConfig({ MCPTEST_JOB_TIMEOUT_MS: '45000' }).jobTimeoutMs).toBe(45000)
  })
})

describe('report served from validated data (WR-05)', () => {
  it('drops keys the schema does not know instead of passing the raw container text through', async () => {
    const forged = JSON.parse(reportJson) as Record<string, unknown>
    forged.injected = 'x'.repeat(5000)
    ;(forged.subject as Record<string, unknown>).extra = 'forged'
    const rt = createFakeRuntime()
    rt.scriptExec(({ files }) => {
      files.set('/work/out/report.json', enc.encode(JSON.stringify(forged)))
      return 0
    })
    const res = await runInContainer(rt, fakeReq, [], { driverTree: tree })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.reportJson).not.toContain('injected')
      expect(res.reportJson).not.toContain('forged')
      expect(JSON.parse(res.reportJson)).toEqual(res.report)
    }
  })
})
