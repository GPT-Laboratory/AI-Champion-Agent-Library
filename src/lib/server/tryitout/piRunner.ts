// src/lib/server/tryitout/piRunner.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// Runs one Try It Out job inside the session's warm Pi container (D-06/D-07,
// D-11..D-16, D-20, D-22). The task text and uploaded file reach the container
// ONLY as files (putFiles); argv is a constant built from config and the
// validated slug (T8-06-1).

import { readFile } from 'node:fs/promises'
import { AgentIdSchema } from '../tryItOutPrompts'
import { MODEL } from '../tryItOutModel'
import { getJob, inputFilePath, isValidJobId, pushEvent, setStatus } from '../tryItOutJobs'
import { AGENT_DIR, WORK_ROOT_IN_CONTAINER, TryItOutRuntimeError, type ExecResult } from './runtime'
import type { RunnerConfig } from './runnerConfig'
import { getTryItOutService } from './service'
import { beginJob, endJob, getJobUsage } from './llmProxy'
import { createCompletionTracker, createJsonlParser, createPiEventMapper } from './piEvents'
import { writeArtifactZip } from './artifact'
import { logDetail, publicErrorMessage } from './redact'
import { localMcpAgent, type LocalMcpAgent } from '../localMcp/agents'

/** Names only the input files that were actually staged, so Pi never tries to read a missing upload. */
export function piInstruction(hasUpload: boolean): string {
  const inputs = hasUpload ? 'task.txt and upload.txt' : 'task.txt only; no file was uploaded'
  return `Follow the skill. Inputs are in ./input (${inputs}). Write all deliverables as files in ./output.`
}

// App-side backstop beyond the in-container `timeout` (covers a hung exec stream).
export const TIMEOUT_GRACE_MS = 5000
// Bound on the post-job `rm -rf` exec (WR-02): a hung engine must not leave the lease running.
export const CLEANUP_TIMEOUT_MS = 10_000

// Bound on the staging (putFiles) and output (getFiles) engine calls (09-02): a hung engine must
// not leave the job `running` and the lease claimed forever.
export const ENGINE_CALL_TIMEOUT_MS = 60_000

function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  work.catch(() => {}) // a late rejection after the timeout must not be unhandled
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TryItOutRuntimeError('exec_failed', 'engine call timed out')), ms)
  })
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export function buildPiArgs(
  cfg: RunnerConfig,
  slug: string,
  hasUpload = true,
  extension: LocalMcpAgent | null = localMcpAgent(slug),
): string[] {
  return [
    'timeout',
    '--signal=KILL',
    String(Math.ceil(cfg.jobTimeoutMs / 1000)),
    'pi',
    '--mode',
    'json',
    '--no-session',
    '--offline',
    '--no-extensions',
    '--no-mcp',
    '--no-prompt-templates',
    '--no-themes',
    '--no-context-files',
    '--no-approve',
    '-ns',
    ...(extension ? ['-e', extension.extensionPath] : []),
    '--skill',
    `${AGENT_DIR}/skills/${slug}`,
    '--provider',
    'aic',
    '--model',
    MODEL,
    '--tools',
    [...cfg.tools, ...(extension ? extension.tools : [])].join(','),
    '--append-system-prompt',
    `${AGENT_DIR}/base-prompt.md`,
    '--',
    `/skill:${slug} ${piInstruction(hasUpload)}`,
  ]
}

/** Most mapped Pi events kept on one job; the rest are dropped after one "truncated" marker (09-03). */
export const MAX_JOB_EVENTS = 2000

const STDERR_TAIL_BYTES = 4096

/**
 * Throws TryItOutRuntimeError only for claim-phase failures. After a successful
 * claim it records its own terminal status and never rethrows.
 */
export async function runJobInContainer(jobId: string): Promise<void> {
  const job = getJob(jobId)
  if (!job) return
  if (!isValidJobId(jobId)) throw new Error('invalid job id')
  const slug = AgentIdSchema.parse(job.agentId)

  const svc = getTryItOutService()
  const cfg = svc.config
  const runtime = svc.runtime

  pushEvent(jobId, 'claiming container…')
  const { lease, warm } = await svc.leases.claim(job.sessionKey ?? `job:${jobId}`, slug)
  pushEvent(jobId, warm ? 'using warm container' : 'started a fresh container')

  let timedOut = false
  let broken = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let proxyJobBegun = false
  const jobDir = `${WORK_ROOT_IN_CONTAINER}/${jobId}`

  try {
    const containerId = lease.containerId
    if (!containerId) throw new Error('container is not available')
    svc.leases.markRunning(lease)
    beginJob(lease.id, jobId, { maxTotalTokens: cfg.jobTokenBudget, maxRequests: cfg.jobRequestBudget })
    proxyJobBegun = true

    // Task and upload are written as FILES only (T8-06-1).
    const staged: Parameters<typeof runtime.putFiles>[2] = [
      { path: jobId, type: 'dir' },
      { path: `${jobId}/input`, type: 'dir' },
      { path: `${jobId}/output`, type: 'dir' },
      { path: `${jobId}/input/task.txt`, content: job.task },
    ]
    if (job.fileName !== null) {
      staged.push({ path: `${jobId}/input/upload.txt`, content: new Uint8Array(await readFile(inputFilePath(jobId))) })
    }
    await bounded(runtime.putFiles(containerId, WORK_ROOT_IN_CONTAINER, staged), ENGINE_CALL_TIMEOUT_MS)

    pushEvent(jobId, 'starting pi…')
    const tracker = createCompletionTracker()
    const mapper = createPiEventMapper()
    let mappedEvents = 0
    const parser = createJsonlParser((record) => {
      tracker.observe(record)
      const mapped = mapper.map(record)
      if (!mapped) return
      mappedEvents++
      if (mappedEvents <= MAX_JOB_EVENTS) pushEvent(jobId, mapped.summary, mapped.type, mapped.tool)
      else if (mappedEvents === MAX_JOB_EVENTS + 1) pushEvent(jobId, 'further progress events omitted')
    })
    let stderrTail = ''

    const started = Date.now()
    let onTimeout: (r: ExecResult) => void = () => {}
    const timeoutSignal = new Promise<ExecResult>((resolve) => {
      onTimeout = resolve
    })
    timer = setTimeout(() => {
      timedOut = true
      void svc.leases.discard(lease)
      onTimeout({ exitCode: null })
    }, cfg.jobTimeoutMs + TIMEOUT_GRACE_MS)

    let result: ExecResult
    try {
      result = await Promise.race([
        runtime.exec(containerId, {
          cmd: buildPiArgs(cfg, slug, job.fileName !== null),
          workingDir: jobDir,
          onStdout: (chunk) => parser.push(chunk),
          onStderr: (chunk) => {
            stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES)
          },
        }),
        timeoutSignal,
      ])
    } catch (err) {
      broken = true
      throw err
    }
    parser.end()
    if (!timedOut && result.exitCode === 137 && Date.now() - started >= cfg.jobTimeoutMs) {
      timedOut = true
    }

    const verdict = tracker.verdict({
      exitCode: result.exitCode,
      timedOut,
      timeoutMs: cfg.jobTimeoutMs,
      stderrTail,
    })
    const usage = endJob(lease.id) ?? getJobUsage(jobId)
    proxyJobBegun = false

    if (usage?.budgetExceeded) {
      pushEvent(jobId, 'agent failed')
      setStatus(
        jobId,
        'failed',
        `job token budget exceeded (${usage.totalTokens} tokens, ${usage.requests} requests)`,
      )
      return
    }
    if (!verdict.ok) {
      if (stderrTail.trim()) logDetail(`pi job ${jobId} stderr:`, stderrTail.trim().slice(-500))
      pushEvent(jobId, 'agent failed')
      setStatus(jobId, 'failed', verdict.error)
      return
    }

    let files = await bounded(
      runtime.getFiles(containerId, `${jobDir}/output`, {
        maxBytes: cfg.maxOutputBytes,
        maxFiles: cfg.maxOutputFiles,
      }),
      ENGINE_CALL_TIMEOUT_MS,
    )
    if (Object.keys(files).length === 0) {
      const text = tracker.lastAssistantText()
      if (text) files = { 'result.txt': new TextEncoder().encode(text) }
    }
    if (Object.keys(files).length === 0) {
      pushEvent(jobId, 'agent failed')
      setStatus(jobId, 'failed', 'agent finished without producing output')
      return
    }
    await writeArtifactZip(jobId, files)
    pushEvent(jobId, 'agent settled (clean exit)')
    setStatus(jobId, 'succeeded')
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && (err as { code?: string }).code === 'output_invalid')) {
      broken = true
    }
    // WR-06: engine/socket/image detail stays server-side; the visitor gets a generic message.
    logDetail(`pi job ${jobId} failed:`, err)
    pushEvent(jobId, 'agent failed')
    setStatus(jobId, 'failed', publicErrorMessage(err))
  } finally {
    if (timer) clearTimeout(timer)
    if (proxyJobBegun) endJob(lease.id)
    if (timedOut || broken) {
      await svc.leases.discard(lease).catch(() => {})
    } else {
      // Best-effort cleanup of this job's directory (D-07, T8-06-4). Bounded: if the engine hangs
      // or the exec fails the work dir state is unknown, so the lease is discarded, not released.
      let cleaned = true
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined
      try {
        const cid = lease.containerId
        if (cid) {
          const cleanup = runtime
            .exec(cid, {
              cmd: ['rm', '-rf', jobDir],
              workingDir: '/',
              onStdout: () => {},
              onStderr: () => {},
            })
            .then(() => true)
          const cleanupTimeout = new Promise<boolean>((resolve) => {
            cleanupTimer = setTimeout(() => resolve(false), CLEANUP_TIMEOUT_MS)
          })
          cleanup.catch(() => {}) // a late rejection after the timeout must not be unhandled
          cleaned = await Promise.race([cleanup, cleanupTimeout])
        }
      } catch {
        cleaned = false // cleanup failure must not affect the recorded result
      } finally {
        if (cleanupTimer) clearTimeout(cleanupTimer)
      }
      if (cleaned) svc.leases.release(lease)
      else await svc.leases.discard(lease).catch(() => {})
    }
  }
}
