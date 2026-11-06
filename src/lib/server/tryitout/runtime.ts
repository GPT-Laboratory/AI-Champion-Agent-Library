// src/lib/server/tryitout/runtime.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// The container runtime contract (D-04). One interface, two implementations:
// runtimeDockerode.ts (real engine over the Podman socket) and runtimeFake.ts
// (in-memory, tests). Nothing here imports an engine library.

export const AGENT_DIR = '/home/pi/agent'
export const WORK_ROOT_IN_CONTAINER = '/work'

export const LABEL_MANAGED = 'aic.tryitout'
export const LABEL_INSTANCE = 'aic.instance'
/** Stable deployment id (WR-08): the orphan sweep only removes containers of the same owner. */
export const LABEL_OWNER = 'aic.owner'
export const LABEL_AGENT ='aic.agent'
export const LABEL_CREATED = 'aic.created'

export type RuntimeErrorCode =
  | 'engine_unavailable'
  | 'container_start_failed'
  | 'busy'
  | 'session_busy'
  | 'exec_failed'
  | 'output_invalid'

export class TryItOutRuntimeError extends Error {
  constructor(
    public readonly code: RuntimeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'TryItOutRuntimeError'
  }
}

/**
 * Reload-safe check. The lease service lives on globalThis and survives a Vite dev reload, so the
 * error class it throws can come from an older copy of this module; `instanceof` then fails and
 * the D-14 fallback silently stops working. Match on the name and a string code as well.
 */
export function isTryItOutRuntimeError(err: unknown): err is TryItOutRuntimeError {
  return (
    err instanceof TryItOutRuntimeError ||
    (err instanceof Error &&
      err.name === 'TryItOutRuntimeError' &&
      typeof (err as { code?: unknown }).code === 'string')
  )
}

/** Image, limits and network come from the runtime's RunnerConfig, never from the caller. */
export interface ContainerSpec {
  name: string
  labels: Record<string, string>
  env: string[]
}

/** path is RELATIVE to destDir, POSIX separators. */
export interface StagedFile {
  path: string
  type?: 'file' | 'dir'
  content?: string | Uint8Array
  mode?: number
}

export interface ExecOptions {
  cmd: string[]
  workingDir: string
  onStdout: (chunk: Buffer) => void
  onStderr: (chunk: Buffer) => void
  /** Optional cancellation: the dockerode runtime stops waiting on the exec stream when it aborts. */
  signal?: AbortSignal
}

export interface ExecResult {
  exitCode: number | null
}

export interface GetFilesLimits {
  maxBytes: number
  maxFiles: number
}

export interface ManagedContainer {
  id: string
  labels: Record<string, string>
}

export interface ContainerRuntime {
  ping(): Promise<void>
  ensureNetwork(): Promise<void>
  createAndStart(spec: ContainerSpec): Promise<string>
  putFiles(containerId: string, destDir: string, files: StagedFile[]): Promise<void>
  exec(containerId: string, opts: ExecOptions): Promise<ExecResult>
  getFiles(containerId: string, dir: string, limits: GetFilesLimits): Promise<Record<string, Uint8Array>>
  remove(containerId: string): Promise<void>
  listManaged(): Promise<ManagedContainer[]>
}

/**
 * Pure name check shared by both runtimes' getFiles: a tar entry name must be
 * a non-empty relative POSIX path with no '..' or empty-dot segments and no NUL.
 */
export function isSafeRelativePath(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0) return false
  if (name.includes('\0') || name.includes('\\')) return false
  if (name.startsWith('/')) return false
  const parts = name.split('/')
  for (const part of parts) {
    if (part === '..' || part === '.' || part === '') return false
  }
  return true
}
