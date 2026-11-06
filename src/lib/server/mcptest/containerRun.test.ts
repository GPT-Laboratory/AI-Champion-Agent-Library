import { beforeAll, describe, expect, it } from 'vitest'
import { loadSuite } from '$lib/mcptest/core/suite'
import { runSuite } from '$lib/mcptest/core/runner'
import { fakeSubject } from '$lib/mcptest/core/subjects'
import type { DriverRequest } from '$lib/mcptest/driverRequest'
import { createFakeRuntime } from '../tryitout/runtimeFake'
import { TryItOutRuntimeError, type StagedFile } from '../tryitout/runtime'
import { mcpTestRunnerConfig, readDriverTree, runInContainer, DRIVER_CMD, MAX_PKG_FILES } from './containerRun'

const enc = new TextEncoder()
const fakeReq: DriverRequest = { v: 1, subject: { kind: 'fake', variant: 'good' }, cases: ['T1-STD-CATALOG'] }
const stagedReq: DriverRequest = {
  v: 1,
  subject: { kind: 'staged', command: 'python3', args: ['server.py'], cwd: '/work/pkg', id: 'generator:openapi' },
  cases: ['T2-CATALOG-API']
}
const tree: StagedFile[] = [{ path: 'src/lib/mcptest/driver.ts', content: '// driver' }]

let reportJson = ''
beforeAll(async () => {
  const suite = await loadSuite()
  if (!suite.ok) throw new Error('suite')
  const report = await runSuite({
    subject: fakeSubject('good'),
    cases: suite.cases.filter((c) => c.def.id === 'T1-STD-CATALOG'),
    runtime: 'container'
  })
  reportJson = JSON.stringify(report)
}, 60_000)

function scripted(rt: ReturnType<typeof createFakeRuntime>, out: Record<string, string>, code = 0) {
  rt.scriptExec(({ files }) => {
    for (const [name, text] of Object.entries(out)) files.set(`/work/out/${name}`, enc.encode(text))
    return code
  })
}

describe('runInContainer with the fake runtime', () => {
  it('stages, execs the driver, collects the report and always removes', async () => {
    const rt = createFakeRuntime()
    let seen: { cmd: string[]; workingDir: string; files: string[]; env: string[]; labels: Record<string, string> } | null = null
    rt.scriptExec(({ containerId, cmd, workingDir, files }) => {
      seen = {
        cmd,
        workingDir,
        files: [...files.keys()],
        env: rt.envOf(containerId),
        labels: {}
      }
      files.set('/work/out/report.json', enc.encode(reportJson))
      return 0
    })
    const res = await runInContainer(rt, stagedReq, [{ path: 'server.py', content: 'print(1)' }], { driverTree: tree })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.report.schema).toBe('mcptest-report/1')
    const order = rt.calls.filter((c) => ['createAndStart', 'putFiles', 'exec', 'getFiles', 'remove'].includes(c))
    expect(order).toEqual(['createAndStart', 'putFiles', 'exec', 'getFiles', 'remove'])
    expect(seen!.cmd).toEqual(DRIVER_CMD)
    expect(seen!.workingDir).toBe('/work')
    expect(seen!.env).toEqual([])
    expect(seen!.files).toEqual(
      expect.arrayContaining(['/work/in/request.json', '/work/src/lib/mcptest/driver.ts', '/work/pkg/server.py'])
    )
    expect(rt.containers()).toEqual([])
    const listed = await rt.listManaged()
    expect(listed).toEqual([])
  })

  it('labels the container as an mcptest container', async () => {
    const rt = createFakeRuntime()
    let labels: Record<string, string> = {}
    rt.scriptExec(async () => {
      labels = (await rt.listManaged())[0].labels
      return 0
    })
    await runInContainer(rt, fakeReq, [], { driverTree: tree })
    expect(labels['aic.mcptest']).toBe('1')
    expect(labels['aic.instance']).toBeTruthy()
  })

  it('stores the request as written and parsed (strict schema)', async () => {
    const rt = createFakeRuntime()
    let req = ''
    rt.scriptExec(({ files }) => {
      req = Buffer.from(files.get('/work/in/request.json') as Uint8Array).toString('utf8')
      files.set('/work/out/report.json', enc.encode(reportJson))
      return 0
    })
    await runInContainer(rt, fakeReq, [], { driverTree: tree })
    expect(JSON.parse(req)).toEqual(fakeReq)
  })

  it('rejects an invalid request before any engine call', async () => {
    const rt = createFakeRuntime()
    const bad = { v: 1, subject: { kind: 'fake', variant: 'Bad Variant!' } } as unknown as DriverRequest
    const res = await runInContainer(rt, bad, [], { driverTree: tree })
    expect(res).toMatchObject({ ok: false, code: 'exec_failed' })
    const bad2 = { v: 1, subject: { kind: 'fake', variant: 'good' }, cases: ['NOPE'] } as unknown as DriverRequest
    expect((await runInContainer(rt, bad2, [], { driverTree: tree })).ok).toBe(false)
    expect(rt.calls).toEqual([])
  })

  it('rejects unsafe package paths and oversize packages before any engine call', async () => {
    const rt = createFakeRuntime()
    for (const path of ['/etc/passwd', '../x', 'a/../b', 'a\\b', 'a\0b']) {
      const res = await runInContainer(rt, stagedReq, [{ path, content: 'x' }], { driverTree: tree })
      expect(res).toMatchObject({ ok: false, code: 'exec_failed' })
    }
    const many = Array.from({ length: MAX_PKG_FILES + 1 }, (_, i) => ({ path: `f${i}.py`, content: '' }))
    expect((await runInContainer(rt, stagedReq, many, { driverTree: tree })).ok).toBe(false)
    const big = [{ path: 'big.py', content: 'x'.repeat(2_000_001) }]
    expect((await runInContainer(rt, stagedReq, big, { driverTree: tree })).ok).toBe(false)
    expect(rt.calls).toEqual([])
  })

  it('removes the container when exec throws and maps the error', async () => {
    const rt = createFakeRuntime()
    rt.failNext('exec', new TryItOutRuntimeError('exec_failed', 'boom sk-abcdef123456'))
    const res = await runInContainer(rt, fakeReq, [], { driverTree: tree })
    expect(res).toMatchObject({ ok: false, code: 'exec_failed' })
    expect(JSON.stringify(res)).not.toContain('sk-abcdef')
    expect(rt.calls).toContain('remove')
    expect(rt.containers()).toEqual([])
  })

  it('removes the container when getFiles throws', async () => {
    const rt = createFakeRuntime()
    rt.failNext('getFiles', new TryItOutRuntimeError('output_invalid', 'unsafe output path: /etc'))
    const res = await runInContainer(rt, fakeReq, [], { driverTree: tree })
    expect(res).toMatchObject({ ok: false, code: 'output_invalid' })
    expect(rt.containers()).toEqual([])
  })

  it('maps an unreachable engine to engine_unavailable', async () => {
    const rt = createFakeRuntime()
    rt.failNext('ensureNetwork', new TryItOutRuntimeError('engine_unavailable', 'socket /run/x.sock gone'))
    const res = await runInContainer(rt, fakeReq, [], { driverTree: tree })
    expect(res).toMatchObject({ ok: false, code: 'engine_unavailable', message: 'container engine unavailable' })
    expect(rt.calls).not.toContain('createAndStart')
  })

  it('times out, removes the container and ignores the late exec', async () => {
    const rt = createFakeRuntime()
    const release = rt.hang('exec')
    const res = await runInContainer(rt, fakeReq, [], { driverTree: tree, timeoutMs: 30 })
    expect(res).toMatchObject({ ok: false, code: 'timeout' })
    expect(rt.containers()).toEqual([])
    release()
  })

  it('aborts on the signal and removes the container', async () => {
    const rt = createFakeRuntime()
    rt.hang('exec')
    const ac = new AbortController()
    const p = runInContainer(rt, fakeReq, [], { driverTree: tree, signal: ac.signal })
    setTimeout(() => ac.abort(), 20)
    const res = await p
    expect(res.ok).toBe(false)
    expect(rt.containers()).toEqual([])
  })

  it('missing, oversize, malformed and error reports are output_invalid', async () => {
    let rt = createFakeRuntime()
    expect(await runInContainer(rt, fakeReq, [], { driverTree: tree })).toMatchObject({ ok: false, code: 'output_invalid' })

    rt = createFakeRuntime()
    scripted(rt, { 'report.json': 'x'.repeat(1_050_000) })
    expect(await runInContainer(rt, fakeReq, [], { driverTree: tree })).toMatchObject({ ok: false, code: 'output_invalid' })

    rt = createFakeRuntime()
    scripted(rt, { 'report.json': '{"schema":"other"}' })
    expect(await runInContainer(rt, fakeReq, [], { driverTree: tree })).toMatchObject({ ok: false, code: 'output_invalid' })

    rt = createFakeRuntime()
    scripted(rt, { 'report.json': 'not json' })
    expect(await runInContainer(rt, fakeReq, [], { driverTree: tree })).toMatchObject({ ok: false, code: 'output_invalid' })

    rt = createFakeRuntime()
    scripted(rt, { 'error.json': JSON.stringify({ error: 'invalid request: cases.0' }) })
    const res = await runInContainer(rt, fakeReq, [], { driverTree: tree })
    expect(res).toMatchObject({ ok: false, code: 'output_invalid' })
    expect(rt.containers()).toEqual([])
  })

  it('a non-zero exit without output is exec_failed', async () => {
    const rt = createFakeRuntime()
    rt.scriptExec(({ stderr }) => {
      stderr('Traceback: key sk-abcdef123456\n')
      return 3
    })
    const res = await runInContainer(rt, fakeReq, [], { driverTree: tree })
    expect(res).toMatchObject({ ok: false, code: 'exec_failed' })
    if (!res.ok) {
      expect(res.message).toContain('code 3')
      expect(res.message).not.toContain('sk-abcdef123456')
    }
  })
})

describe('driver tree', () => {
  it('reads text sources only, without tests, goldens or testing dirs, but with the suite', () => {
    const files = readDriverTree()
    const paths = files.map((f) => f.path)
    expect(paths).toContain('src/lib/mcptest/driver.ts')
    expect(paths).toContain('src/lib/mcptest/driverRequest.ts')
    expect(paths.some((p) => p.startsWith('src/lib/mcptest/suite/'))).toBe(true)
    expect(paths.some((p) => p.startsWith('src/lib/mcpgen/'))).toBe(true)
    expect(paths.some((p) => p.endsWith('.test.ts'))).toBe(false)
    expect(paths.some((p) => p.includes('__golden__') || p.includes('/testing/'))).toBe(false)
    expect(paths.every((p) => !p.includes('..') && !p.startsWith('/'))).toBe(true)
  })
})

describe('mcpTestRunnerConfig', () => {
  it('defaults to an internal, egress-free, tool-less config', () => {
    const cfg = mcpTestRunnerConfig({})
    expect(cfg.image).toBe('localhost/mcp-test-runner:latest')
    expect(cfg.network).toBe('aic-mcptest-internal')
    expect(cfg.network).not.toBe('aic-pi-internal')
    expect(cfg.allowOpenEgress).toBe(false)
    expect(cfg.proxyUrl).toBe('')
    expect(cfg.tools).toEqual([])
    expect(cfg.jobTokenBudget).toBe(0)
    expect(cfg.jobRequestBudget).toBe(0)
    expect(cfg.fsMode).toBe('tmpfs')
  })

  it('honours image and network overrides but ignores LLM and egress settings', () => {
    const cfg = mcpTestRunnerConfig({
      MCPTEST_RUNNER_IMAGE: 'localhost/other:1',
      MCPTEST_NETWORK: 'my-net',
      PI_LLM_PROXY_URL: 'http://proxy/v1',
      PI_RUNNER_ALLOW_OPEN_EGRESS: 'true',
      PI_RUNNER_TOOLS: 'bash'
    })
    expect(cfg.image).toBe('localhost/other:1')
    expect(cfg.network).toBe('my-net')
    expect(cfg.proxyUrl).toBe('')
    expect(cfg.allowOpenEgress).toBe(false)
    expect(cfg.tools).toEqual([])
  })

  it('fails closed when open egress is requested for the test runner', () => {
    expect(() => mcpTestRunnerConfig({ MCPTEST_ALLOW_OPEN_EGRESS: 'true' })).toThrow(/egress/)
  })
})
