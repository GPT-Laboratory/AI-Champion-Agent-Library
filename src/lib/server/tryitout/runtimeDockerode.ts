// src/lib/server/tryitout/runtimeDockerode.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// dockerode-backed ContainerRuntime over the Podman Docker-compatible socket
// (D-01/D-04). This is the ONLY file in src/ that imports dockerode and
// tar-stream. The Docker client is constructed lazily on first use, never at
// import time, so importing this module never opens the socket.
//
// Files move in and out through the archive API (putArchive/getArchive), never
// host-path mounts (Pitfall 2), and exec never attaches stdin (R-01).

import Docker from 'dockerode'
import tar from 'tar-stream'
import { PassThrough } from 'node:stream'
import { finished } from 'node:stream/promises'
import {
  LABEL_MANAGED,
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
import type { RunnerConfig } from './runnerConfig'

const MB = 1024 * 1024

/**
 * Pure create-options builder (D-21). Never emits host mounts, published
 * ports, privileged mode or added capabilities; caller data is limited to name, labels, env.
 */
export function buildCreateOptions(cfg: RunnerConfig, spec: ContainerSpec): Docker.ContainerCreateOptions {
  const layer = cfg.fsMode === 'layer'
  // 'layer' fallback (Pattern 3): archive writes cannot target tmpfs or a
  // read-only rootfs on every engine, so work and agent dirs live in the
  // writable layer and only /tmp stays tmpfs.
  const Tmpfs: Record<string, string> = layer
    ? { '/tmp': `rw,size=${cfg.tmpTmpfsMb}m,mode=1777` }
    : {
        '/work': `rw,size=${cfg.workTmpfsMb}m,mode=1777`,
        '/tmp': `rw,size=${cfg.tmpTmpfsMb}m,mode=1777`,
      }
  // Podman 4.9 rejects the uid=/gid= tmpfs options (verified by the live smoke run), so
  // the agent dir is sticky world-writable instead; only the pi user exists in the container.
  // Images that have no /home/pi/agent (the MCP test runner) opt out with mountAgentDir: false (CR-03).
  if (!layer && cfg.mountAgentDir !== false) Tmpfs['/home/pi/agent'] = `rw,size=${cfg.agentTmpfsMb}m,mode=1777`
  return {
    Image: cfg.image,
    name: spec.name,
    User: cfg.runUser ?? 'pi',
    Cmd: ['sleep', 'infinity'],
    Labels: spec.labels,
    Env: spec.env,
    HostConfig: {
      Memory: Math.round(cfg.memoryMb * MB),
      // IN-04: same value as Memory, so the container cannot use swap on top of its limit.
      MemorySwap: Math.round(cfg.memoryMb * MB),
      NanoCpus: Math.round(cfg.cpus * 1e9),
      PidsLimit: cfg.pids,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      Init: true,
      NetworkMode: cfg.network,
      ReadonlyRootfs: !layer,
      Tmpfs,
    },
  }
}

const ENGINE_ERRNOS = new Set(['ENOENT', 'ECONNREFUSED', 'EACCES', 'EPERM'])

/** True for socket-level connection failures (engine not running / not reachable). */
export function isEngineConnectionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && ENGINE_ERRNOS.has(code)
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function collect(stream: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
  }
  return Buffer.concat(chunks)
}

async function buildTar(files: StagedFile[]): Promise<Buffer> {
  // IN-01: validate every path before any stream exists, so a bad path cannot leave a rejected
  // collect() promise behind (an unhandled rejection would crash the process).
  for (const f of files) {
    if (!isSafeRelativePath(f.path)) {
      throw new TryItOutRuntimeError('exec_failed', `unsafe staged path: ${f.path}`)
    }
  }
  const pack = tar.pack()
  const done = collect(pack)
  for (const f of files) {
    if (f.type === 'dir') {
      pack.entry({ name: f.path, type: 'directory', mode: f.mode ?? 0o755, uid: 1000, gid: 1000 })
    } else {
      const raw = f.content ?? ''
      const body = Buffer.from(raw)
      pack.entry({ name: f.path, type: 'file', mode: f.mode ?? 0o644, uid: 1000, gid: 1000, size: body.length }, body)
    }
  }
  pack.finalize()
  return done
}

export function createDockerodeRuntime(cfg: RunnerConfig, instanceId: string): ContainerRuntime {
  void instanceId // reserved: labels are supplied by the caller via ContainerSpec
  let docker: Docker | undefined
  const client = (): Docker => {
    if (!docker) docker = new Docker({ socketPath: cfg.socketPath })
    return docker
  }
  const mapEngineError = (err: unknown): Error =>
    isEngineConnectionError(err)
      ? new TryItOutRuntimeError(
          'engine_unavailable',
          `container engine not reachable at ${cfg.socketPath}: ${messageOf(err)}`,
        )
      : err instanceof Error
        ? err
        : new Error(String(err))

  return {
    async ping() {
      try {
        await client().ping()
      } catch (err) {
        throw mapEngineError(err)
      }
    },

    async ensureNetwork() {
      const d = client()
      const builtin = cfg.network === 'podman' || cfg.network === 'bridge' || cfg.network === 'host'
      let internal = false
      if (!builtin) {
        try {
          const info = await d.getNetwork(cfg.network).inspect()
          internal = info?.Internal === true
        } catch (err) {
          if (isEngineConnectionError(err)) throw mapEngineError(err)
          if ((err as { statusCode?: number }).statusCode !== 404) throw err
          try {
            await d.createNetwork({ Name: cfg.network, Internal: true, Labels: { [LABEL_MANAGED]: '1' } })
            internal = true
          } catch (createErr) {
            if (isEngineConnectionError(createErr)) throw mapEngineError(createErr)
            if ((createErr as { statusCode?: number }).statusCode !== 409) throw createErr
            // Lost a creation race: re-inspect the network someone else created.
            const info = await d.getNetwork(cfg.network).inspect()
            internal = info?.Internal === true
          }
        }
      }
      if (!internal && !cfg.allowOpenEgress) {
        throw new TryItOutRuntimeError(
          'container_start_failed',
          `network "${cfg.network}" is not internal; refusing to run Pi with open egress. ` +
            'Use an internal network, or set PI_RUNNER_ALLOW_OPEN_EGRESS=true for local development only.',
        )
      }
    },

    async createAndStart(spec) {
      const d = client()
      let container: Docker.Container
      try {
        container = await d.createContainer(buildCreateOptions(cfg, spec))
      } catch (err) {
        if (isEngineConnectionError(err)) throw mapEngineError(err)
        if ((err as { statusCode?: number }).statusCode === 404) {
          throw new TryItOutRuntimeError(
            'container_start_failed',
            `image ${cfg.image} not found; build it with: podman build -t pi-runner -f Containerfile.pi-runner . (${messageOf(err)})`,
          )
        }
        throw new TryItOutRuntimeError('container_start_failed', messageOf(err))
      }
      try {
        await container.start()
      } catch (err) {
        await container.remove({ force: true }).catch(() => {})
        if (isEngineConnectionError(err)) throw mapEngineError(err)
        throw new TryItOutRuntimeError('container_start_failed', messageOf(err))
      }
      return container.id
    },

    async putFiles(containerId, destDir, files) {
      const body = await buildTar(files)
      await client().getContainer(containerId).putArchive(body, { path: destDir })
    },

    async exec(containerId, opts: ExecOptions): Promise<ExecResult> {
      const d = client()
      const exec = await d.getContainer(containerId).exec({
        Cmd: opts.cmd,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        WorkingDir: opts.workingDir,
      })
      const stream = await exec.start({ Detach: false, Tty: false })
      const out = new PassThrough()
      const err = new PassThrough()
      out.on('data', (c: Buffer) => opts.onStdout(c))
      err.on('data', (c: Buffer) => opts.onStderr(c))
      d.modem.demuxStream(stream, out, err)
      // WR-08: a cancelled run stops waiting on the exec stream (the container is removed by the caller).
      if (opts.signal) {
        const onAbort = () => (stream as unknown as { destroy?: () => void }).destroy?.()
        if (opts.signal.aborted) onAbort()
        else opts.signal.addEventListener('abort', onAbort, { once: true })
      }
      await new Promise<void>((resolve, reject) => {
        stream.on('end', resolve)
        stream.on('close', resolve)
        stream.on('error', reject)
      })
      // Flush: let both demuxed streams drain before reporting completion.
      out.end()
      err.end()
      await Promise.all([finished(out), finished(err)])
      // ExitCode can still be null / Running:true right after the stream ends.
      const deadline = Date.now() + 2000
      let info = await exec.inspect()
      while (info.Running && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
        info = await exec.inspect()
      }
      return { exitCode: info.ExitCode ?? null }
    },

    async getFiles(containerId, dir, limits: GetFilesLimits) {
      const archive = await client().getContainer(containerId).getArchive({ path: dir })
      const extract = tar.extract()
      // IN-02: null-prototype map so an entry named __proto__ is an own key, not dropped.
      const out: Record<string, Uint8Array> = Object.create(null)
      let total = 0
      let count = 0
      let seen = 0
      // SEC-09: dirs, links etc. are skipped but still bounded.
      const maxEntries = limits.maxFiles * 10 + 100
      const piped = archive.pipe(extract)
      try {
        for await (const entry of piped) {
          const header = entry.header
          seen += 1
          if (seen > maxEntries) {
            throw new TryItOutRuntimeError('output_invalid', `output exceeds ${maxEntries} archive entries`)
          }
          if (header.type !== 'file') {
            entry.resume()
            continue
          }
          if (!isSafeRelativePath(header.name)) {
            entry.resume()
            throw new TryItOutRuntimeError('output_invalid', `unsafe output path: ${header.name}`)
          }
          // Strip the archived directory's basename (first segment).
          const slash = header.name.indexOf('/')
          const rel = slash === -1 ? header.name : header.name.slice(slash + 1)
          if (!isSafeRelativePath(rel)) {
            entry.resume()
            continue
          }
          count += 1
          if (count > limits.maxFiles) {
            throw new TryItOutRuntimeError('output_invalid', `output exceeds ${limits.maxFiles} files`)
          }
          // WR-09: trust the header size before buffering anything.
          if (typeof header.size === 'number' && total + header.size > limits.maxBytes) {
            throw new TryItOutRuntimeError('output_invalid', `output exceeds ${limits.maxBytes} bytes`)
          }
          const body = await collect(entry)
          total += body.length
          if (total > limits.maxBytes) {
            throw new TryItOutRuntimeError('output_invalid', `output exceeds ${limits.maxBytes} bytes`)
          }
          out[rel] = new Uint8Array(body)
        }
      } finally {
        // WR-09: never leave the engine response or the parser open on an early exit.
        // Destroying emits PREMATURE_CLOSE; swallow it so it cannot become an uncaught error event.
        const noop = () => {}
        extract.on('error', noop)
        archive.on('error', noop)
        extract.destroy()
        ;(archive as unknown as { destroy?: () => void }).destroy?.()
      }
      return out
    },

    async remove(containerId) {
      try {
        await client().getContainer(containerId).remove({ force: true })
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) return
        throw err
      }
    },

    async listManaged(): Promise<ManagedContainer[]> {
      const list = await client().listContainers({
        all: true,
        filters: { label: [`${LABEL_MANAGED}=1`] },
      })
      return list.map((c) => ({ id: c.Id, labels: c.Labels ?? {} }))
    },
  }
}
