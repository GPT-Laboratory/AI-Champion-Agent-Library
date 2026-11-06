// Contract suite: the in-memory fake and the dockerode runtime (against a mocked
// engine) must satisfy the same ContainerRuntime lifecycle.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const engine = vi.hoisted(() => ({
  containers: new Map<string, { labels: Record<string, string>; files: Map<string, Buffer | 'dir'> }>(),
  execScript: { stdout: '', stderr: '', exitCode: 0 as number | null },
  reset() {
    this.containers.clear()
    this.execScript = { stdout: '', stderr: '', exitCode: 0 }
  },
}))

vi.mock('dockerode', async () => {
  const tar = (await import('tar-stream')).default
  const { PassThrough } = await import('node:stream')

  async function readAll(stream: AsyncIterable<unknown>): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array))
    return Buffer.concat(chunks)
  }

  class FakeDocker {
    modem = {
      demuxStream(stream: NodeJS.ReadableStream & NodeJS.WritableStream, out: NodeJS.WritableStream, err: NodeJS.WritableStream) {
        stream.resume()
        setImmediate(() => {
          if (engine.execScript.stdout) out.write(Buffer.from(engine.execScript.stdout))
          if (engine.execScript.stderr) err.write(Buffer.from(engine.execScript.stderr))
          stream.end()
        })
      },
    }
    constructor(public opts: unknown) {}
    async ping() {
      return 'OK'
    }
    async createContainer(o: { Labels: Record<string, string> }) {
      const id = `eng-${engine.containers.size + 1}-${Math.random().toString(16).slice(2)}`
      engine.containers.set(id, { labels: o.Labels, files: new Map() })
      return { id, start: async () => {} }
    }
    async listContainers() {
      return [...engine.containers.entries()].map(([Id, c]) => ({ Id, Labels: c.labels }))
    }
    getContainer(id: string) {
      return {
        putArchive: async (buf: Buffer, o: { path: string }) => {
          const c = engine.containers.get(id)!
          const extract = tar.extract()
          const done = (async () => {
            for await (const entry of extract) {
              const abs = `${o.path}/${entry.header.name.replace(/\/$/, '')}`
              if (entry.header.type === 'directory') {
                c.files.set(abs, 'dir')
                entry.resume()
              } else {
                c.files.set(abs, await readAll(entry))
              }
            }
          })()
          extract.end(buf)
          await done
        },
        getArchive: async (o: { path: string }) => {
          const c = engine.containers.get(id)!
          const base = o.path.split('/').pop()!
          const pack = tar.pack()
          for (const [abs, v] of c.files) {
            if (!abs.startsWith(o.path + '/') || v === 'dir') continue
            pack.entry({ name: `${base}/${abs.slice(o.path.length + 1)}` }, v)
          }
          pack.finalize()
          return pack
        },
        exec: async () => ({
          start: async () => new PassThrough(),
          inspect: async () => ({ Running: false, ExitCode: engine.execScript.exitCode }),
        }),
        remove: async () => {
          engine.containers.delete(id)
        },
      }
    }
    getNetwork() {
      return { inspect: async () => ({ Internal: true }) }
    }
    async createNetwork() {}
  }
  return { default: FakeDocker }
})

import { createFakeRuntime } from './runtimeFake'
import { createDockerodeRuntime } from './runtimeDockerode'
import { parseRunnerConfig } from './runnerConfig'
import type { ContainerRuntime } from './runtime'

interface Harness {
  runtime: ContainerRuntime
  script(stdout: string, stderr: string, exitCode: number | null): void
}

function fakeHarness(): Harness {
  const runtime = createFakeRuntime()
  return {
    runtime,
    script(stdout, stderr, exitCode) {
      runtime.scriptExec(({ stdout: so, stderr: se }) => {
        if (stdout) so(stdout)
        if (stderr) se(stderr)
        return exitCode
      })
    },
  }
}

function dockerodeHarness(): Harness {
  return {
    runtime: createDockerodeRuntime(parseRunnerConfig({}), 'inst-1'),
    script(stdout, stderr, exitCode) {
      engine.execScript = { stdout, stderr, exitCode }
    },
  }
}

describe.each([
  ['fake', fakeHarness],
  ['dockerode (mocked engine)', dockerodeHarness],
] as const)('ContainerRuntime contract: %s', (_name, make) => {
  let h: Harness
  beforeEach(() => {
    engine.reset()
    h = make()
  })

  const spec = { name: 'aic-pi-x', labels: { 'aic.tryitout': '1', 'aic.agent': 'demo' }, env: ['A=1'] }

  it('createAndStart returns an id that listManaged reports with labels', async () => {
    const id = await h.runtime.createAndStart(spec)
    expect(id).toBeTruthy()
    const list = await h.runtime.listManaged()
    const found = list.find((c) => c.id === id)
    expect(found?.labels).toMatchObject(spec.labels)
  })

  it('putFiles then getFiles round-trips relative names', async () => {
    const id = await h.runtime.createAndStart(spec)
    await h.runtime.putFiles(id, '/work', [
      { path: 'j/input/task.txt', content: 'hi' },
      { path: 'j/output', type: 'dir' },
    ])
    const files = await h.runtime.getFiles(id, '/work/j/input', { maxBytes: 1e6, maxFiles: 10 })
    expect(Object.keys(files)).toEqual(['task.txt'])
    expect(new TextDecoder().decode(files['task.txt'])).toBe('hi')
  })

  it('exec separates stdout/stderr and returns the exit code', async () => {
    const id = await h.runtime.createAndStart(spec)
    h.script('out-data', 'err-data', 3)
    let so = ''
    let se = ''
    const res = await h.runtime.exec(id, {
      cmd: ['echo'],
      workingDir: '/work',
      onStdout: (c) => (so += c.toString()),
      onStderr: (c) => (se += c.toString()),
    })
    expect(res.exitCode).toBe(3)
    expect(so).toBe('out-data')
    expect(se).toBe('err-data')
  })

  it('remove drops the container and is idempotent for unknown ids', async () => {
    const id = await h.runtime.createAndStart(spec)
    await h.runtime.remove(id)
    expect((await h.runtime.listManaged()).some((c) => c.id === id)).toBe(false)
    await expect(h.runtime.remove('does-not-exist')).resolves.toBeUndefined()
  })
})

describe('fake runtime controls', () => {
  it('failNext rejects the next call once, latencyMs delays, calls records order', async () => {
    const { TryItOutRuntimeError } = await import('./runtime')
    const rt = createFakeRuntime({ latencyMs: 20 })
    rt.failNext('createAndStart', new TryItOutRuntimeError('engine_unavailable', 'x'))
    const t0 = Date.now()
    await expect(rt.createAndStart({ name: 'n', labels: {}, env: [] })).rejects.toMatchObject({
      code: 'engine_unavailable',
    })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15)
    await expect(rt.createAndStart({ name: 'n', labels: {}, env: [] })).resolves.toBeTruthy()
    await rt.ping()
    expect(rt.calls).toEqual(['createAndStart', 'createAndStart', 'ping'])
  })
})
