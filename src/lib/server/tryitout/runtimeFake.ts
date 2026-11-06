// src/lib/server/tryitout/runtimeFake.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// Scriptable in-memory ContainerRuntime for tests (D-15): no engine, no
// sockets. Mirrors the dockerode implementation's getFiles name rules and caps.

import { randomUUID } from 'node:crypto'
import {
  TryItOutRuntimeError,
  isSafeRelativePath,
  type ContainerRuntime,
  type ContainerSpec,
  type ExecOptions,
  type ExecResult,
  type GetFilesLimits,
  type ManagedContainer,
  type StagedFile,
} from './runtime'

export type FakeFiles = Map<string, Uint8Array | 'dir'>

export type FakeExecScript = (ctx: {
  containerId: string
  cmd: string[]
  workingDir: string
  files: FakeFiles
  stdout(s: string): void
  stderr(s: string): void
}) => Promise<number | null> | number | null

interface FakeContainer {
  labels: Record<string, string>
  env: string[]
  files: FakeFiles
  removed: boolean
}

export interface FakeRuntime extends ContainerRuntime {
  calls: string[]
  failNext(method: keyof ContainerRuntime, err: Error): void
  /**
   * Make every subsequent call of `method` block until the returned `release()` is called (or
   * forever). Releasing lets the pending calls continue as if the engine had answered late.
   */
  hang(method: keyof ContainerRuntime): () => void
  scriptExec(fn: FakeExecScript): void
  envOf(id: string): string[]
  filesOf(id: string): FakeFiles
  containers(): string[]
}

function joinPosix(dir: string, rel: string): string {
  const d = dir.endsWith('/') ? dir.slice(0, -1) : dir
  return `${d}/${rel}`
}

export function createFakeRuntime(opts: { latencyMs?: number } = {}): FakeRuntime {
  const store = new Map<string, FakeContainer>()
  const failures = new Map<string, Error[]>()
  const hangs = new Map<string, Promise<void>>()
  let script: FakeExecScript = () => 0
  const calls: string[] = []
  const enc = new TextEncoder()

  async function enter(method: keyof ContainerRuntime): Promise<void> {
    calls.push(method)
    const hung = hangs.get(method)
    if (hung) await hung
    if (opts.latencyMs && opts.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, opts.latencyMs))
    }
    const queue = failures.get(method)
    if (queue && queue.length > 0) {
      throw queue.shift()!
    }
  }

  function get(id: string): FakeContainer {
    const c = store.get(id)
    if (!c || c.removed) {
      throw new TryItOutRuntimeError('exec_failed', `no such container: ${id}`)
    }
    return c
  }

  const runtime: FakeRuntime = {
    calls,
    failNext(method, err) {
      const q = failures.get(method) ?? []
      q.push(err)
      failures.set(method, q)
    },
    hang(method) {
      let release!: () => void
      hangs.set(
        method,
        new Promise<void>((resolve) => {
          release = () => {
            if (hangs.get(method) === p) hangs.delete(method)
            resolve()
          }
        }),
      )
      const p = hangs.get(method)
      return release
    },
    scriptExec(fn) {
      script = fn
    },
    envOf(id) {
      return get(id).env
    },
    filesOf(id) {
      return get(id).files
    },
    containers() {
      return [...store.entries()].filter(([, c]) => !c.removed).map(([id]) => id)
    },

    async ping() {
      await enter('ping')
    },
    async ensureNetwork() {
      await enter('ensureNetwork')
    },
    async createAndStart(spec: ContainerSpec) {
      await enter('createAndStart')
      const id = `fake-${randomUUID()}`
      store.set(id, { labels: { ...spec.labels }, env: [...spec.env], files: new Map(), removed: false })
      return id
    },
    async putFiles(containerId, destDir, files: StagedFile[]) {
      await enter('putFiles')
      const c = get(containerId)
      for (const f of files) {
        if (!isSafeRelativePath(f.path)) {
          throw new TryItOutRuntimeError('exec_failed', `unsafe staged path: ${f.path}`)
        }
        const abs = joinPosix(destDir, f.path)
        if (f.type === 'dir') {
          c.files.set(abs, 'dir')
        } else {
          const content = f.content ?? ''
          c.files.set(abs, typeof content === 'string' ? enc.encode(content) : new Uint8Array(content))
        }
      }
    },
    async exec(containerId, o: ExecOptions): Promise<ExecResult> {
      await enter('exec')
      const c = get(containerId)
      const exitCode = await script({
        containerId,
        cmd: o.cmd,
        workingDir: o.workingDir,
        files: c.files,
        stdout: (s) => o.onStdout(Buffer.from(s)),
        stderr: (s) => o.onStderr(Buffer.from(s)),
      })
      return { exitCode }
    },
    async getFiles(containerId, dir, limits: GetFilesLimits) {
      await enter('getFiles')
      const c = get(containerId)
      const prefix = dir.endsWith('/') ? dir : `${dir}/`
      const out: Record<string, Uint8Array> = {}
      let total = 0
      let count = 0
      for (const [abs, value] of c.files) {
        if (!abs.startsWith(prefix) || value === 'dir') continue
        const name = abs.slice(prefix.length)
        if (!isSafeRelativePath(name)) {
          throw new TryItOutRuntimeError('output_invalid', `unsafe output path: ${name}`)
        }
        count += 1
        if (count > limits.maxFiles) {
          throw new TryItOutRuntimeError('output_invalid', `output exceeds ${limits.maxFiles} files`)
        }
        total += value.byteLength
        if (total > limits.maxBytes) {
          throw new TryItOutRuntimeError('output_invalid', `output exceeds ${limits.maxBytes} bytes`)
        }
        out[name] = value
      }
      return out
    },
    async remove(containerId) {
      await enter('remove')
      const c = store.get(containerId)
      if (c) c.removed = true
    },
    async listManaged(): Promise<ManagedContainer[]> {
      await enter('listManaged')
      return [...store.entries()]
        .filter(([, c]) => !c.removed)
        .map(([id, c]) => ({ id, labels: { ...c.labels } }))
    },
  }
  return runtime
}
