// src/lib/tryItOut.ts
// Client API for the runnable "Try it out" flow.
// Signatures and types are FROZEN by docs/job-api-contract.md — do not change them.
// Real backend: this client reaches the demo backend over `fetch` only, at
// the three routes under src/routes/api/tryitout/jobs/**. No mock remains.

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface JobEvent {
  ts: string // "10:46:48"
  type: 'tool_start' | 'tool_end' | 'info'
  tool?: string // "read" | "write" | "grep"
  summary: string // the line the feed renders
}

export interface JobUpdate {
  status: JobStatus
  events: JobEvent[]
  error: string | null
}

export interface SubmitResult {
  jobId: string
  status: JobStatus
}

export async function submitJob(
  agentId: string,
  task: string,
  file?: File | null
): Promise<SubmitResult> {
  const form = new FormData()
  form.set('agentId', agentId)
  form.set('task', task)
  if (file) form.set('file', file)

  const res = await fetch('/api/tryitout/jobs', { method: 'POST', body: form })
  if (!res.ok) {
    throw new Error(`submitJob failed: ${res.status}`)
  }
  return res.json()
}

const POLL_MS = 1000

export function subscribeProgress(
  jobId: string,
  onUpdate: (u: JobUpdate) => void
): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null

  async function poll(): Promise<void> {
    if (cancelled) return

    const res = await fetch(`/api/tryitout/jobs/${jobId}`)
    if (cancelled) return

    if (res.status === 404) {
      onUpdate({ status: 'failed', events: [], error: `unknown job: ${jobId}` })
      return
    }
    if (!res.ok) {
      onUpdate({ status: 'failed', events: [], error: `poll failed: ${res.status}` })
      return
    }

    const update: JobUpdate = await res.json()
    if (cancelled) return
    onUpdate(update)

    if (update.status === 'succeeded' || update.status === 'failed') {
      return // terminal — stop polling
    }

    timer = setTimeout(() => {
      timer = null
      void poll()
    }, POLL_MS)
  }

  void poll()

  return () => {
    cancelled = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}

export async function downloadArtifact(jobId: string): Promise<void> {
  const res = await fetch(`/api/tryitout/jobs/${jobId}/artifact`)
  if (!res.ok) {
    throw new Error(`downloadArtifact failed: ${res.status}`)
  }
  const blob = await res.blob()
  triggerBlobDownload(blob, `aic-job-${safeFileToken(jobId)}.zip`)
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url) // threat T3 — no object-URL leak
}

function safeFileToken(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_')
}
