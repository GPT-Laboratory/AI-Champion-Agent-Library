import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  ping: vi.fn(),
  createContainer: vi.fn(),
  getNetwork: vi.fn(),
  createNetwork: vi.fn(),
  getContainer: vi.fn(),
  constructed: vi.fn(),
}))

vi.mock('dockerode', () => ({
  default: class {
    modem = { demuxStream: vi.fn() }
    constructor(opts: unknown) {
      mocks.constructed(opts)
    }
    ping = mocks.ping
    createContainer = mocks.createContainer
    getNetwork = mocks.getNetwork
    createNetwork = mocks.createNetwork
    getContainer = mocks.getContainer
  },
}))

import tar from 'tar-stream'
import { buildCreateOptions, createDockerodeRuntime, isEngineConnectionError } from './runtimeDockerode'
import { parseRunnerConfig } from './runnerConfig'
import { TryItOutRuntimeError } from './runtime'

const spec = { name: 'aic-pi-a', labels: { 'aic.tryitout': '1' }, env: ['K=v'] }
const defaultCfg = parseRunnerConfig({})

function errno(code: string, message = code): Error {
  return Object.assign(new Error(message), { code })
}
function status(statusCode: number, message = `status ${statusCode}`): Error {
  return Object.assign(new Error(message), { statusCode })
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
})

describe('buildCreateOptions', () => {
  it('applies the D-21 limits in tmpfs mode', () => {
    const o = buildCreateOptions(defaultCfg, spec)
    expect(o.Image).toBe('localhost/pi-runner:latest')
    expect(o.name).toBe('aic-pi-a')
    expect(o.User).toBe('pi')
    expect(o.Cmd).toEqual(['sleep', 'infinity'])
    expect(o.Labels).toEqual(spec.labels)
    expect(o.Env).toEqual(spec.env)
    const hc = o.HostConfig!
    expect(hc.Memory).toBe(1073741824)
    expect(hc.MemorySwap).toBe(1073741824) // IN-04: no swap on top of the memory limit
    expect(hc.NanoCpus).toBe(500000000)
    expect(hc.PidsLimit).toBe(200)
    expect(hc.CapDrop).toEqual(['ALL'])
    expect(hc.SecurityOpt).toContain('no-new-privileges')
    expect(hc.Init).toBe(true)
    expect(hc.NetworkMode).toBe('aic-pi-internal')
    expect(hc.ReadonlyRootfs).toBe(true)
    expect(hc.Tmpfs!['/work']).toContain('size=256m')
    expect(hc.Tmpfs!['/tmp']).toContain('size=64m')
    expect(hc.Tmpfs!['/home/pi/agent']).toContain('size=16m')
    expect(hc.Tmpfs!['/home/pi/agent']).toContain('mode=1777')
    expect(hc.Tmpfs!['/home/pi/agent']).not.toMatch(/uid=|gid=/)
  })

  it('never emits ports, mounts or privilege escalation keys', () => {
    const o = buildCreateOptions(defaultCfg, spec) as Record<string, unknown>
    const hc = o.HostConfig as Record<string, unknown>
    expect(o).not.toHaveProperty('ExposedPorts')
    for (const key of ['PortBindings', 'Binds', 'Mounts', 'Privileged', 'CapAdd', 'Devices']) {
      expect(hc).not.toHaveProperty(key)
    }
  })

  it('fsMode layer keeps only /tmp as tmpfs and a writable rootfs', () => {
    const o = buildCreateOptions(parseRunnerConfig({ PI_RUNNER_FS_MODE: 'layer' }), spec)
    const hc = o.HostConfig!
    expect(hc.ReadonlyRootfs).toBe(false)
    expect(Object.keys(hc.Tmpfs!)).toEqual(['/tmp'])
    expect(hc.CapDrop).toEqual(['ALL'])
    expect(hc.Memory).toBe(1073741824)
  })

  it('honours PI_RUNNER_* overrides', () => {
    const cfg = parseRunnerConfig({ PI_RUNNER_MEMORY_MB: '512', PI_RUNNER_CPUS: '1', PI_RUNNER_PIDS: '50' })
    const hc = buildCreateOptions(cfg, spec).HostConfig!
    expect(hc.Memory).toBe(536870912)
    expect(hc.NanoCpus).toBe(1e9)
    expect(hc.PidsLimit).toBe(50)
  })
})

describe('lazy construction', () => {
  it('does not open the engine client until a method is called', async () => {
    const rt = createDockerodeRuntime(defaultCfg, 'i')
    expect(mocks.constructed).not.toHaveBeenCalled()
    mocks.ping.mockResolvedValue('OK')
    await rt.ping()
    expect(mocks.constructed).toHaveBeenCalledWith({ socketPath: defaultCfg.socketPath })
  })
})

describe('ensureNetwork', () => {
  it('creates an internal network on inspect 404 and ignores a 409 on create', async () => {
    const inspect = vi.fn().mockRejectedValueOnce(status(404)).mockResolvedValue({ Internal: true })
    mocks.getNetwork.mockReturnValue({ inspect })
    mocks.createNetwork.mockRejectedValue(status(409))
    await createDockerodeRuntime(defaultCfg, 'i').ensureNetwork()
    expect(mocks.createNetwork).toHaveBeenCalledWith({
      Name: 'aic-pi-internal',
      Internal: true,
      Labels: { 'aic.tryitout': '1' },
    })
  })

  it('creates the network when missing', async () => {
    mocks.getNetwork.mockReturnValue({ inspect: vi.fn().mockRejectedValue(status(404)) })
    mocks.createNetwork.mockResolvedValue({})
    await expect(createDockerodeRuntime(defaultCfg, 'i').ensureNetwork()).resolves.toBeUndefined()
  })

  it('rejects a non-internal network without PI_RUNNER_ALLOW_OPEN_EGRESS', async () => {
    mocks.getNetwork.mockReturnValue({ inspect: vi.fn().mockResolvedValue({ Internal: false }) })
    const p = createDockerodeRuntime(defaultCfg, 'i').ensureNetwork()
    await expect(p).rejects.toMatchObject({ code: 'container_start_failed' })
    await expect(p).rejects.toThrow(/PI_RUNNER_ALLOW_OPEN_EGRESS/)
  })

  it('accepts a non-internal network when open egress is allowed (dev)', async () => {
    mocks.getNetwork.mockReturnValue({ inspect: vi.fn().mockResolvedValue({ Internal: false }) })
    const cfg = parseRunnerConfig({ PI_RUNNER_ALLOW_OPEN_EGRESS: 'true' })
    await expect(createDockerodeRuntime(cfg, 'i').ensureNetwork()).resolves.toBeUndefined()
  })

  it('treats builtin networks as non-internal', async () => {
    const cfg = parseRunnerConfig({ PI_RUNNER_NETWORK: 'podman' })
    await expect(createDockerodeRuntime(cfg, 'i').ensureNetwork()).rejects.toMatchObject({
      code: 'container_start_failed',
    })
    expect(mocks.getNetwork).not.toHaveBeenCalled()
  })
})

describe('engine error mapping', () => {
  it.each(['ENOENT', 'ECONNREFUSED', 'EACCES', 'EPERM'])('maps %s to engine_unavailable', async (code) => {
    expect(isEngineConnectionError(errno(code))).toBe(true)
    mocks.ping.mockRejectedValue(errno(code))
    const p = createDockerodeRuntime(defaultCfg, 'i').ping()
    await expect(p).rejects.toMatchObject({ name: 'TryItOutRuntimeError', code: 'engine_unavailable' })
    await expect(p).rejects.toThrow(defaultCfg.socketPath)
  })

  it('maps connection errors from createAndStart to engine_unavailable', async () => {
    mocks.createContainer.mockRejectedValue(errno('ENOENT'))
    await expect(createDockerodeRuntime(defaultCfg, 'i').createAndStart(spec)).rejects.toMatchObject({
      code: 'engine_unavailable',
    })
  })

  it('maps a missing image to container_start_failed naming the image and podman build', async () => {
    mocks.createContainer.mockRejectedValue(status(404, 'no such image'))
    const p = createDockerodeRuntime(defaultCfg, 'i').createAndStart(spec)
    await expect(p).rejects.toMatchObject({ code: 'container_start_failed' })
    await expect(p).rejects.toThrow(/localhost\/pi-runner:latest.*podman build|podman build.*/s)
    await expect(p).rejects.toThrow(/podman build/)
    await expect(p).rejects.toThrow(/pi-runner:latest/)
  })

  it('maps other create errors to container_start_failed with the real message', async () => {
    mocks.createContainer.mockRejectedValue(new Error('boom: oci runtime failed'))
    await expect(createDockerodeRuntime(defaultCfg, 'i').createAndStart(spec)).rejects.toThrow(
      /boom: oci runtime failed/,
    )
  })

  it('force-removes the created container when start fails', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    mocks.createContainer.mockResolvedValue({
      id: 'c1',
      start: vi.fn().mockRejectedValue(new Error('cannot start')),
      remove,
    })
    await expect(createDockerodeRuntime(defaultCfg, 'i').createAndStart(spec)).rejects.toMatchObject({
      code: 'container_start_failed',
    })
    expect(remove).toHaveBeenCalledWith({ force: true })
  })

  it('does not treat unrelated errors as engine connection errors', () => {
    expect(isEngineConnectionError(new Error('x'))).toBe(false)
    expect(isEngineConnectionError(null)).toBe(false)
  })
})

async function archiveOf(
  entries: Array<{ name: string; type?: 'file' | 'symlink' | 'directory'; body?: string; linkname?: string }>,
) {
  const pack = tar.pack()
  for (const e of entries) {
    if (e.type === 'symlink') pack.entry({ name: e.name, type: 'symlink', linkname: e.linkname ?? '/etc/passwd' })
    else if (e.type === 'directory') pack.entry({ name: e.name, type: 'directory' })
    else pack.entry({ name: e.name }, e.body ?? '')
  }
  pack.finalize()
  return pack
}

function runtimeWithArchive(entries: Parameters<typeof archiveOf>[0]) {
  mocks.getContainer.mockReturnValue({ getArchive: async () => archiveOf(entries) })
  return createDockerodeRuntime(defaultCfg, 'i')
}

describe('getFiles hostile archives (output_invalid)', () => {
  const limits = { maxBytes: 1000, maxFiles: 10 }

  it.each(['../x', '/etc/passwd', 'a/../../b'])('rejects entry name %s with output_invalid', async (name) => {
    const rt = runtimeWithArchive([{ name, body: 'x' }])
    await expect(rt.getFiles('c', '/work/j/output', limits)).rejects.toMatchObject({
      name: 'TryItOutRuntimeError',
      code: 'output_invalid',
    })
  })

  it('strips the archived dir basename and skips symlinks and directories', async () => {
    const rt = runtimeWithArchive([
      { name: 'output/', type: 'directory' },
      { name: 'output/result.txt', body: 'ok' },
      { name: 'output/link', type: 'symlink' },
      { name: 'output/sub/a.md', body: 'a' },
    ])
    const out = await rt.getFiles('c', '/work/j/output', limits)
    expect(Object.keys(out).sort()).toEqual(['result.txt', 'sub/a.md'])
  })

  it('rejects when file count exceeds maxFiles', async () => {
    const rt = runtimeWithArchive([
      { name: 'output/1', body: '1' },
      { name: 'output/2', body: '2' },
      { name: 'output/3', body: '3' },
    ])
    const p = rt.getFiles('c', '/work/j/output', { maxBytes: 1000, maxFiles: 2 })
    await expect(p).rejects.toMatchObject({ code: 'output_invalid' })
    await expect(p).rejects.toThrow(/2 files/)
  })

  it('rejects when total bytes exceed maxBytes', async () => {
    const rt = runtimeWithArchive([{ name: 'output/big', body: 'x'.repeat(50) }])
    const p = rt.getFiles('c', '/work/j/output', { maxBytes: 10, maxFiles: 10 })
    await expect(p).rejects.toMatchObject({ code: 'output_invalid' })
    await expect(p).rejects.toThrow(/10 bytes/)
  })

  it('rejects an oversized entry from its header before buffering the body (WR-09)', async () => {
    const pack = tar.pack()
    // header only, body never written; the dangling writer errors when the pack is destroyed
    pack.entry({ name: 'output/huge', size: 1_000_000_000 }).on('error', () => {})
    const destroy = vi.spyOn(pack, 'destroy')
    mocks.getContainer.mockReturnValue({ getArchive: async () => pack })
    const rt = createDockerodeRuntime(defaultCfg, 'i')
    await expect(rt.getFiles('c', '/work/j/output', limits)).rejects.toMatchObject({
      code: 'output_invalid',
    })
    expect(destroy).toHaveBeenCalled()
  })

  it('destroys the engine archive stream on an early exit (WR-09)', async () => {
    const pack = await archiveOf([
      { name: 'output/1', body: '1' },
      { name: 'output/2', body: '2' },
      { name: 'output/3', body: '3' },
    ])
    const destroy = vi.spyOn(pack, 'destroy')
    mocks.getContainer.mockReturnValue({ getArchive: async () => pack })
    const rt = createDockerodeRuntime(defaultCfg, 'i')
    await expect(rt.getFiles('c', '/work/j/output', { maxBytes: 1000, maxFiles: 1 })).rejects.toMatchObject({
      code: 'output_invalid',
    })
    expect(destroy).toHaveBeenCalled()
  })

  it('skips hardlink, device and fifo entries', async () => {
    const pack = tar.pack()
    pack.entry({ name: 'output/hard', type: 'link', linkname: 'output/ok' })
    pack.entry({ name: 'output/dev', type: 'character-device' })
    pack.entry({ name: 'output/fifo', type: 'fifo' })
    pack.entry({ name: 'output/ok' }, 'ok')
    pack.finalize()
    mocks.getContainer.mockReturnValue({ getArchive: async () => pack })
    const rt = createDockerodeRuntime(defaultCfg, 'i')
    const out = await rt.getFiles('c', '/work/j/output', limits)
    expect(Object.keys(out)).toEqual(['ok'])
  })

  it('rejects an archive with an excessive number of non-file entries', async () => {
    const entries = Array.from({ length: 400 }, (_, i) => ({ name: `output/d${i}/`, type: 'directory' as const }))
    const rt = runtimeWithArchive(entries)
    await expect(rt.getFiles('c', '/work/j/output', { maxBytes: 1000, maxFiles: 2 })).rejects.toMatchObject({
      code: 'output_invalid',
    })
  })

  it('keeps an entry named __proto__ as an own entry (IN-02)', async () => {
    const rt = runtimeWithArchive([
      { name: 'output/__proto__', body: 'p' },
      { name: 'output/a', body: 'a' },
    ])
    const out = await rt.getFiles('c', '/work/j/output', limits)
    expect(Object.keys(out).sort()).toEqual(['__proto__', 'a'])
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true)
    expect(out['__proto__']).toBeInstanceOf(Uint8Array)
  })

  it('putFiles with an unsafe path rejects without an unhandled rejection (IN-01)', async () => {
    const seen: unknown[] = []
    const onUnhandled = (e: unknown) => seen.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      mocks.getContainer.mockReturnValue({ putArchive: vi.fn() })
      const rt = createDockerodeRuntime(defaultCfg, 'i')
      await expect(rt.putFiles('c', '/work', [{ path: '../evil', content: 'x' }])).rejects.toMatchObject({
        code: 'exec_failed',
      })
      await new Promise((r) => setTimeout(r, 20))
      expect(seen).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('exposes TryItOutRuntimeError for callers', () => {
    expect(new TryItOutRuntimeError('busy', 'm').code).toBe('busy')
  })
})
