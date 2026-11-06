// stdio transport: spawn a subject with a scrubbed environment and expose it as a Channel.
// Spawning requires an explicit allowLocalExec flag (the runtime decides who may execute anything).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isReservedEnvName } from '../envNames'
import { lineChannel, type Channel } from '../jsonrpc'

export const STDERR_CAP_BYTES = 64 * 1024

export class StdioSpawnError extends Error {
  constructor(
    public code: 'exec-not-allowed' | 'spawn-failed',
    message: string
  ) {
    super(message)
    this.name = 'StdioSpawnError'
  }
}

export interface StdioOptions {
  command: string
  args?: string[]
  cwd?: string
  /** Extra child env vars. process.env is never inherited. */
  env?: Record<string, string>
  allowLocalExec?: boolean
  maxLineBytes?: number
  /** Wait after closing stdin before SIGTERM, and again before SIGKILL. Default 500. */
  graceMs?: number
}

/** Throws StdioSpawnError (code exec-not-allowed) without spawning when allowLocalExec is not true. */
export function spawnStdioChannel(opts: StdioOptions): Channel {
  if (opts.allowLocalExec !== true) {
    throw new StdioSpawnError('exec-not-allowed', 'local execution of a subject requires allowLocalExec: true')
  }
  // WR-10: caller variables may not replace PATH, HOME, LANG or change the loader or interpreter.
  for (const k of Object.keys(opts.env ?? {})) {
    if (isReservedEnvName(k)) throw new StdioSpawnError('spawn-failed', `reserved environment variable name: ${k.slice(0, 40)}`)
  }
  const home = mkdtempSync(join(tmpdir(), 'aic-mcp-home-'))
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', LANG: process.env.LANG ?? 'C', HOME: home }
  for (const [k, v] of Object.entries(opts.env ?? {})) env[k] = v
  const cleanup = () => {
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  // WR-05: the subject gets its own process group so that daemons it forks die with it (POSIX only).
  const grouped = process.platform !== 'win32'
  let child
  try {
    child = spawn(opts.command, opts.args ?? [], { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: grouped })
  } catch (e) {
    cleanup()
    throw new StdioSpawnError('spawn-failed', e instanceof Error ? e.message : String(e))
  }

  const grace = opts.graceMs ?? 500
  let exited = false
  const exitWaiters: (() => void)[] = []
  let stderr = ''

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (s: string) => {
    if (stderr.length < STDERR_CAP_BYTES) stderr += s.slice(0, STDERR_CAP_BYTES - stderr.length)
  })
  child.stdin.on('error', () => {})

  const ch = lineChannel(child.stdout, child.stdin, { maxLineBytes: opts.maxLineBytes, closeOnEnd: false })
  child.on('error', () => {
    exited = true
    for (const w of exitWaiters.splice(0)) w()
    ch.emitClose({ code: null })
  })
  child.on('close', (code, signal) => {
    exited = true
    for (const w of exitWaiters.splice(0)) w()
    ch.emitClose({ code, signal })
  })

  /** Signals the whole process group (falls back to the child alone). */
  const killTree = (sig: NodeJS.Signals) => {
    try {
      if (grouped && child.pid) process.kill(-child.pid, sig)
      else child.kill(sig)
    } catch {
      try {
        child.kill(sig)
      } catch {
        /* already gone */
      }
    }
  }

  const waitExit = (ms: number) =>
    new Promise<void>((resolve) => {
      if (exited) return resolve()
      const t = setTimeout(resolve, ms)
      exitWaiters.push(() => {
        clearTimeout(t)
        resolve()
      })
    })

  return {
    send: ch.send,
    onMessage: ch.onMessage,
    onNoise: ch.onNoise,
    onClose: ch.onClose,
    onOversize: ch.onOversize,
    stderrText: () => stderr,
    async close() {
      try {
        child.stdin.end()
      } catch {
        /* ignore */
      }
      await waitExit(grace)
      if (!exited) {
        killTree('SIGTERM')
        await waitExit(grace)
      }
      if (!exited) {
        killTree('SIGKILL')
        await waitExit(grace * 4)
      }
      // Anything the subject forked into its group must not outlive the case, even after a clean exit.
      killTree('SIGKILL')
      cleanup()
    }
  }
}
