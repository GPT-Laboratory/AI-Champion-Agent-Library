<script lang="ts">
  import { untrack } from 'svelte'
  import { submitJob, subscribeProgress, downloadArtifact } from '$lib/tryItOut'
  import type { JobEvent, JobStatus } from '$lib/tryItOut'
  import { readJobIdFromUrl, writeJobIdToUrl, clearJobIdFromUrl } from '$lib/tryItOutSession'
  import type { TryItOutExample } from '$lib/tryItOutExample'
  import { fetchJobCheck, fetchResultFiles, saveBytes, type ResultBundle } from '$lib/tryItOutResult'
  import type { JobCheck } from '$lib/tryItOutCheck'
  import { XLSX_MIME } from '$lib/xlsx'
  import ResultView from './ResultView.svelte'
  import { HANDOFFS, openAgentPage, storeHandoff, takeHandoff } from '$lib/handoff'

  interface Props {
    agentId?: string
    /** The agent's example (data/tryitout-prompts/<slug>/example.yaml), if it ships one. */
    example?: TryItOutExample | null
  }
  let { agentId = 'demo-agent', example = null }: Props = $props()

  // With an example, the task starts prefilled and the example file starts attached; the visitor can edit,
  // remove or replace both. Read once at mount (untrack): the example is fixed for the page.
  function exampleFile(): File | null {
    const f = untrack(() => example?.file)
    return f ? new File([f.text], f.name, { type: 'text/plain' }) : null
  }
  let task = $state(untrack(() => example?.task ?? ''))
  // A multi-line example task (e.g. one rule per line) starts with room for its lines.
  const taskRows = untrack(() => Math.min(10, Math.max(3, (example?.task ?? '').split('\n').length + 1)))
  let file = $state<File | null>(exampleFile())
  let usingExampleFile = $state(untrack(() => example?.file != null))
  let fileInputEl: HTMLInputElement | null = $state(null)

  // Hand-over (src/lib/handoff.ts): this agent's result can go on to another agent; or this panel received one.
  const handoff = untrack(() => HANDOFFS.get(agentId) ?? null)
  let received = $state<{ note: string; fileName: string; text: string } | null>(null)
  let handoffError = $state<string | null>(null)
  // The upload the last run used (the file, or the task text without one), for handing its result on.
  let lastRunUpload = $state<string | null>(null)

  function handOver(upload: string, result: string) {
    const built = handoff?.build(upload, result)
    if (!handoff || !built) return
    const ok = storeHandoff({ from: agentId, to: handoff.to, ...built, at: Date.now() })
    if (!ok) {
      handoffError = 'This browser keeps no session storage, so the hand-over is not possible here.'
      return
    }
    openAgentPage(handoff.to)
  }

  // Once, in the browser: take a hand-over meant for this agent and attach it as the file.
  $effect(() => {
    const h = untrack(() => takeHandoff(agentId))
    if (!h) return
    received = { note: h.note, fileName: h.fileName, text: h.text }
    file = new File([h.text], h.fileName, { type: 'text/plain' })
    usingExampleFile = false
  })

  function useExampleFile() {
    received = null
    file = exampleFile()
    usingExampleFile = file !== null
    if (fileInputEl) fileInputEl.value = '' // the native input must not keep showing another file
  }

  function removeExampleFile() {
    received = null
    file = null
    usingExampleFile = false
  }
  let status = $state<JobStatus | 'idle'>('idle')
  let events = $state<JobEvent[]>([])
  let error = $state<string | null>(null)
  let jobId = $state<string | null>(null)

  // The result shown on the page (text files of the artifact, docs/tryitout-example.md); the download stays.
  let resultFiles = $state<ResultBundle | 'loading' | 'unavailable' | null>(null)
  let resultFor: string | null = null
  // The tool check of the run, from the server (never from a file of the artifact); null when none.
  let jobCheck = $state<JobCheck | null>(null)

  const CHECK_LABEL: Record<JobCheck['status'], string> = {
    match: 'Checked by tool: matches',
    differences: 'Checked by tool: differences found',
    'not-checked': 'Not checked by tool',
  }
  const CHECK_STYLE: Record<JobCheck['status'], string> = {
    match: 'border-green-200 bg-green-50 text-green-900',
    differences: 'border-yellow-200 bg-yellow-50 text-yellow-900',
    'not-checked': 'border-gray-200 bg-gray-50 text-gray-800',
  }
  const CHECK_ICON: Record<JobCheck['status'], string> = { match: '✓', differences: '!', 'not-checked': '–' }

  /** Excel name for a text file's tables, or null when the artifact already has its own spreadsheet. */
  function excelNameFor(name: string, bundle: ResultBundle): string | null {
    if (bundle.sheets.length > 0 || !/\.(md|txt)$/i.test(name)) return null
    return `${agentId}-${name.replace(/\.[a-z]+$/i, '')}.xlsx`
  }

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
    resultFiles = null
    resultFor = null
    jobCheck = null
    status = 'queued'
    clearJobIdFromUrl() // a stale id must never be live while a new job is in flight

    lastRunUpload = file ? await file.text() : task
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

  // Once per succeeded job (fresh or restored): load its text files for the inline result.
  $effect(() => {
    if (status !== 'succeeded' || !jobId || resultFor === jobId) return
    const id = jobId
    resultFor = id
    resultFiles = 'loading'
    void fetchResultFiles(id).then((files) => {
      if (resultFor === id) resultFiles = files && files.texts.length + files.sheets.length > 0 ? files : 'unavailable'
    })
    void fetchJobCheck(id).then((c) => {
      if (resultFor === id) jobCheck = c
    })
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

  <label for="tryitout-task" class="block text-xs font-semibold text-gray-700 mb-1">{example?.labels?.task ?? 'Task'}</label>
  <textarea
    id="tryitout-task"
    rows={taskRows}
    aria-describedby={example?.labels?.hint ? 'tryitout-hint' : undefined}
    placeholder={example?.labels?.placeholder ?? 'Describe the task you want this agent to do…'}
    class="w-full rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-600"
    value={task}
    oninput={(e) => (task = e.currentTarget.value)}
  ></textarea>

  {#if example?.labels?.hint}
    <p id="tryitout-hint" class="mt-1 text-xs text-gray-600">{example.labels.hint}</p>
  {/if}

  <label for="tryitout-file" class="mt-4 block text-xs font-semibold text-gray-700 mb-1">{example?.labels?.file ?? 'Attach a file (optional)'}</label>
  <input
    id="tryitout-file"
    type="file"
    bind:this={fileInputEl}
    class="block w-full rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-600 focus-visible:ring-2 focus-visible:ring-indigo-600"
    onchange={(e) => {
      file = e.currentTarget.files?.[0] ?? null
      usingExampleFile = false
      received = null
    }}
  />

  {#if received && file}
    <div class="mt-2 rounded border border-indigo-200 bg-indigo-50 p-3 text-sm text-gray-900" role="status">
      <p>{received.note}</p>
      <p class="mt-1">
        Attached: <span class="font-mono">{received.fileName}</span>
        {#if example?.file}
          <button type="button" onclick={useExampleFile} class="ml-2 rounded text-indigo-600 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-600">Use the example file instead</button>
        {/if}
      </p>
      <details class="mt-2">
        <summary class="cursor-pointer text-sm font-medium text-indigo-600">View the handed-over input</summary>
        <ResultView text={received.text} mode="input" label="Handed-over input" />
      </details>
    </div>
  {/if}

  {#if example?.file}
    {#if !(received && file)}
    <p class="mt-2 text-sm text-gray-700">
      {#if usingExampleFile}
        Attached: <span class="font-mono">{example.file.name}</span> (example input)
        <button type="button" onclick={removeExampleFile} class="ml-2 rounded text-indigo-600 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-600">Remove</button>
      {:else}
        <button type="button" onclick={useExampleFile} class="rounded text-indigo-600 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-600">Use example file</button>
      {/if}
    </p>
    {/if}
    <details class="mt-3">
      <summary class="cursor-pointer text-sm font-medium text-indigo-600">View example input ({example.file.name})</summary>
      <ResultView text={example.file.text} mode="input" label="Example input" />
    </details>
  {/if}

  <button
    type="button"
    disabled={inFlight || task.trim() === ''}
    onclick={run}
    class="mt-4 inline-flex items-center gap-2 min-h-[44px] rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
  >
    {inFlight ? 'Running…' : 'Run'}
  </button>

  {#if example?.result}
    <details class="mt-4">
      <summary class="cursor-pointer text-sm font-medium text-indigo-600">Show example result (no model call)</summary>
      <p class="mt-2 text-xs text-gray-600">{example.result.label}</p>
      <ResultView text={example.result.text} label="Example result" excelName={`${agentId}-example-result.xlsx`} />
      {#if handoff && example.file && handoff.build(example.file.text, example.result.text)}
        <button
          type="button"
          onclick={() => handOver(example!.file!.text, example!.result!.text)}
          class="mt-3 inline-flex items-center gap-2 min-h-[44px] rounded border border-indigo-600 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          {handoff.label} <span aria-hidden="true">→</span>
        </button>
      {/if}
    </details>
  {/if}

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

    {#if resultFiles && typeof resultFiles === 'object'}
      {#each resultFiles.sheets as sh (sh.name)}
        <button
          type="button"
          onclick={() => saveBytes(sh.name, sh.bytes, XLSX_MIME)}
          class="ml-2 mt-4 inline-flex items-center gap-2 min-h-[44px] rounded border border-indigo-600 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          Download {sh.name}
        </button>
      {/each}
    {/if}

    {#if jobCheck}
      <div class={`mt-4 rounded border p-3 text-sm ${CHECK_STYLE[jobCheck.status]}`}>
        <p class="font-semibold"><span aria-hidden="true">{CHECK_ICON[jobCheck.status]}</span> {CHECK_LABEL[jobCheck.status]}</p>
        <p class="mt-1">{jobCheck.summary}</p>
        <p class="mt-1 text-xs">A deterministic helper recomputed the result from the input; no model call.{jobCheck.file ? ` Details in ${jobCheck.file}.` : ''}</p>
      </div>
    {/if}

    {#if resultFiles === 'loading'}
      <p class="mt-4 text-sm text-gray-600">Loading the result…</p>
    {:else if resultFiles === 'unavailable'}
      <p class="mt-4 text-sm text-gray-600">The result cannot be shown here; use Download results.</p>
    {:else if resultFiles && resultFiles.texts.length > 0}
      {@const bundle = resultFiles}
      <p class="mt-6 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Result</p>
      {#each bundle.texts as f, i (f.name)}
        <details class="mt-2" open={i === 0}>
          <summary class="cursor-pointer text-sm font-medium text-indigo-600">{f.name}</summary>
          <ResultView
            text={f.text}
            mode={/\.csv$/i.test(f.name) ? 'input' : 'result'}
            startRaw={/\.json$/i.test(f.name)}
            label={`Result file ${f.name}`}
            excelName={excelNameFor(f.name, bundle)}
          />
        </details>
      {/each}
      {@const mainResult = bundle.texts.find((t) => /^result\.(md|txt)$/i.test(t.name))}
      {#if handoff && lastRunUpload !== null && mainResult && handoff.build(lastRunUpload, mainResult.text)}
        <button
          type="button"
          onclick={() => handOver(lastRunUpload!, mainResult.text)}
          class="mt-4 inline-flex items-center gap-2 min-h-[44px] rounded border border-indigo-600 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          {handoff.label} <span aria-hidden="true">→</span>
        </button>
      {/if}
    {/if}
  {/if}

  {#if handoffError}
    <p class="mt-2 text-sm text-red-700" role="alert">{handoffError}</p>
  {/if}

  {#if status === 'failed'}
    <div class="mt-4 rounded border border-red-200 bg-red-50 p-4" role="alert">
      <p class="text-xs font-semibold text-red-700">Job failed</p>
      <p class="mt-1 text-sm text-red-700">{error}</p>
      <p class="mt-1 text-sm text-red-700">Adjust your task and try again.</p>
    </div>
  {/if}
</aside>
