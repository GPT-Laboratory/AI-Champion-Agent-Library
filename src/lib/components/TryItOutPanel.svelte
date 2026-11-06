<script lang="ts">
  import { untrack } from 'svelte'
  import { submitJob, subscribeProgress, downloadArtifact } from '$lib/tryItOut'
  import type { JobEvent, JobStatus } from '$lib/tryItOut'
  import { readJobIdFromUrl, writeJobIdToUrl, clearJobIdFromUrl } from '$lib/tryItOutSession'

  interface Props {
    agentId?: string
  }
  let { agentId = 'demo-agent' }: Props = $props()

  let task = $state('')
  let file = $state<File | null>(null)
  let status = $state<JobStatus | 'idle'>('idle')
  let events = $state<JobEvent[]>([])
  let error = $state<string | null>(null)
  let jobId = $state<string | null>(null)

  let feedEl: HTMLDivElement | null = $state(null)
  let unsubscribe: (() => void) | null = null
  let restoreAttempted = false

  const statusText: Record<string, string> = {
    queued: 'Job queued',
    running: 'Job running',
    succeeded: 'Job succeeded',
    failed: 'Job failed'
  }

  let inFlight = $derived(status === 'queued' || status === 'running')

  // Shared subscription-callback body for both a fresh run() and the ?job=
  // restore-on-mount path (SC-08) — status/events/error/unsubscribe handling
  // must never diverge between the two call sites.
  function attach(id: string, isRestore: boolean) {
    unsubscribe = subscribeProgress(id, (u) => {
      // Stale-id rule (SC-08): a restored ?job= id the server no longer
      // recognizes must degrade to idle, not render as a false failure.
      // Gated on isRestore (a boolean threaded through, not a heuristic on
      // the error text alone) so a fresh run() that genuinely fails still
      // renders the real failure block.
      if (isRestore && u.status === 'failed' && u.error?.startsWith('unknown job:')) {
        unsubscribe?.()
        unsubscribe = null
        status = 'idle'
        events = []
        error = null
        jobId = null
        clearJobIdFromUrl()
        return
      }

      status = u.status
      events = u.events
      error = u.error
      if (u.status === 'succeeded' || u.status === 'failed') {
        unsubscribe?.() // stop timers as soon as the job is terminal (threat T2)
        unsubscribe = null
      }
    })
  }

  async function run() {
    unsubscribe?.()
    unsubscribe = null
    events = []
    error = null
    jobId = null
    status = 'queued'
    clearJobIdFromUrl() // a stale id must never be live while a new job is in flight

    const result = await submitJob(agentId, task, file)
    jobId = result.jobId
    writeJobIdToUrl(result.jobId)

    attach(result.jobId, false)
  }

  // Restore-on-mount (SC-08, D-10): resume a valid ?job= id's subscription
  // without resubmitting. Runs exactly once — `restoreAttempted` short-
  // circuits every later invocation before any reactive read happens, so
  // this effect stops tracking dependencies after its first run and is
  // never re-triggered by the state writes below. `untrack` keeps the
  // one-time `jobId` check from establishing a dependency either.
  $effect(() => {
    if (restoreAttempted) return
    restoreAttempted = true

    const restoredId = readJobIdFromUrl()
    const alreadyActive = untrack(() => jobId !== null)
    if (restoredId && !alreadyActive) {
      jobId = restoredId
      status = 'running' // render the Progress feed immediately, not a flash of idle
      attach(restoredId, true)
    }
  })

  // Auto-scroll: keep the newest line visible (D-10). Reading events.length is what tracks it.
  $effect(() => {
    events.length
    if (feedEl) feedEl.scrollTop = feedEl.scrollHeight
  })

  // Destroy cleanup: never leave a mock timer running after unmount (D-12, threat T2).
  $effect(() => () => {
    unsubscribe?.()
    unsubscribe = null
  })
</script>

<aside class="rounded-xl border border-gray-200 bg-white p-6" aria-labelledby="tryitout-heading">
  <h2 id="tryitout-heading" class="font-semibold text-gray-900 mb-2">Try it out</h2>

  <label for="tryitout-task" class="block text-xs font-semibold text-gray-700 mb-1">Task</label>
  <textarea
    id="tryitout-task"
    rows="3"
    placeholder="Describe the task you want this agent to do…"
    class="w-full rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-600"
    value={task}
    oninput={(e) => (task = e.currentTarget.value)}
  ></textarea>

  <label for="tryitout-file" class="mt-4 block text-xs font-semibold text-gray-700 mb-1">Attach a file (optional)</label>
  <input
    id="tryitout-file"
    type="file"
    class="block w-full rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-600 focus-visible:ring-2 focus-visible:ring-indigo-600"
    onchange={(e) => (file = e.currentTarget.files?.[0] ?? null)}
  />

  <button
    type="button"
    disabled={inFlight || task.trim() === ''}
    onclick={run}
    class="mt-4 inline-flex items-center gap-2 min-h-[44px] rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
  >
    {inFlight ? 'Running…' : 'Run'}
  </button>

  <!-- Persistent live region: always in the DOM so status changes are announced. -->
  <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{statusText[status] ?? ''}</p>

  {#if status !== 'idle'}
    <p id="tryitout-progress-label" class="mt-6 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Progress</p>
    <div
      bind:this={feedEl}
      role="log"
      tabindex="0"
      aria-labelledby="tryitout-progress-label"
      class="max-h-64 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-3 font-mono text-sm text-gray-900"
    >
      {#each events as event}
        <p class="py-1 whitespace-pre-wrap break-words">
          <span class="text-xs font-semibold text-gray-500">{event.ts}</span> {event.summary}
        </p>
      {/each}
    </div>
  {/if}

  {#if status === 'succeeded' && jobId}
    <button
      type="button"
      onclick={() => downloadArtifact(jobId!)}
      class="mt-4 inline-flex items-center gap-2 min-h-[44px] rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600"
    >
      Download results
    </button>
  {/if}

  {#if status === 'failed'}
    <div class="mt-4 rounded border border-red-200 bg-red-50 p-4" role="alert">
      <p class="text-xs font-semibold text-red-700">Job failed</p>
      <p class="mt-1 text-sm text-red-700">{error}</p>
      <p class="mt-1 text-sm text-red-700">Adjust your task and try again.</p>
    </div>
  {/if}
</aside>
