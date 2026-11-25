<script lang="ts">
  // Runs the pipeline "Plain-language rules -> E-BOM -> M-BOM" (docs/pipelines.md) in the browser: each step is an
  // ordinary Try It Out job (src/lib/tryItOut.ts, unchanged), each hand-over a deterministic tool
  // (src/lib/pipeline/rulesToMbom.ts), and the visitor approves every hand-over. Nothing runs without a click.
  import { untrack } from 'svelte'
  import { submitJob, subscribeProgress, type JobEvent, type JobStatus } from '$lib/tryItOut'
  import { fetchJobCheck, fetchResultFiles, saveBytes, type ResultBundle } from '$lib/tryItOutResult'
  import type { JobCheck } from '$lib/tryItOutCheck'
  import { XLSX_MIME } from '$lib/xlsx'
  import ResultView from './ResultView.svelte'
  import {
    ebomUpload,
    existingRules,
    rulesOfResult,
    sourcingInput,
    type RulesChoice,
    type SourcingHandOver,
  } from '$lib/pipeline/rulesToMbom'

  interface Step {
    slug: string
    title: string
    task: string
    runnable: boolean
  }
  interface Props {
    pipeline: {
      steps: Step[]
      data: { name: string; text: string }
      mapping: string
      catalog: string
    }
  }
  let { pipeline }: Props = $props()
  const p = untrack(() => pipeline)

  type RunStatus = JobStatus | 'waiting' | 'skipped'
  interface Run {
    status: RunStatus
    jobId: string | null
    events: JobEvent[]
    error: string | null
    files: ResultBundle | 'loading' | 'unavailable' | null
    check: JobCheck | null
  }
  const blank = (): Run => ({ status: 'waiting', jobId: null, events: [], error: null, files: null, check: null })

  // Inputs
  let notes = $state(p.steps[0].task)
  let useExample = $state(true)
  let ownFile = $state<{ name: string; text: string } | null>(null)
  let choice = $state<RulesChoice>('add')
  let data = $derived(useExample || !ownFile ? p.data : ownFile)
  let ownRules = $derived(existingRules(data.text))

  // Progress
  type Phase = 'input' | 'running' | 'gate1' | 'gate2' | 'done' | 'stopped'
  let phase = $state<Phase>('input')
  let runs = $state<Run[]>([blank(), blank(), blank()])
  let rulesText = $state('')
  let ebomInput = $state<string | null>(null)
  let handover = $state<SourcingHandOver | null>(null)
  let unsubscribe: (() => void) | null = null

  const allRunnable = p.steps.every((s) => s.runnable)
  const STATUS_TEXT: Record<RunStatus, string> = {
    waiting: 'Not started',
    skipped: 'Skipped: the data’s own rules are used',
    queued: 'Queued',
    running: 'Running',
    succeeded: 'Done',
    failed: 'Failed',
  }
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

  function mainResult(r: Run): string | null {
    if (!r.files || typeof r.files !== 'object') return null
    return r.files.texts.find((t) => /^result\.(md|txt)$/i.test(t.name))?.text ?? null
  }

  /** One step as a Try It Out job: submit, follow it to the end, then load its files and tool check. */
  async function runStep(i: number, task: string, fileName: string, text: string): Promise<boolean> {
    runs[i] = { ...blank(), status: 'queued' }
    let jobId: string
    try {
      jobId = (await submitJob(p.steps[i].slug, task, new File([text], fileName, { type: 'text/plain' }))).jobId
    } catch (err) {
      runs[i] = { ...runs[i], status: 'failed', error: err instanceof Error ? err.message : 'the job could not be started' }
      return false
    }
    runs[i].jobId = jobId
    await new Promise<void>((resolve) => {
      let done = false
      unsubscribe = subscribeProgress(jobId, (u) => {
        if (done) return
        runs[i].status = u.status
        runs[i].events = u.events
        runs[i].error = u.error
        if (u.status === 'succeeded' || u.status === 'failed') {
          done = true
          queueMicrotask(() => {
            unsubscribe?.()
            unsubscribe = null
          })
          resolve()
        }
      })
    })
    if (runs[i].status !== 'succeeded') return false
    runs[i].files = 'loading'
    const [files, check] = await Promise.all([fetchResultFiles(jobId), fetchJobCheck(jobId)])
    runs[i].files = files ?? 'unavailable'
    runs[i].check = check
    return mainResult(runs[i]) !== null
  }

  async function start() {
    phase = 'running'
    if (choice === 'mine' && ownRules.length > 0) {
      runs[0] = { ...blank(), status: 'skipped' }
      await toEbom()
      return
    }
    const ok = await runStep(0, notes, data.name, data.text)
    if (!ok) {
      phase = 'stopped'
      return
    }
    rulesText = rulesOfResult(mainResult(runs[0])!).join('\n')
    phase = 'gate1'
  }

  /** Gate 1 approved: the tool splices the (possibly edited) rules into the E-BOM data; the E-BOM agent runs. */
  async function toEbom() {
    phase = 'running'
    ebomInput = ebomUpload(data.text, rulesText.split('\n'), choice)
    const ok = await runStep(1, p.steps[1].task, 'ebom-upload-with-rules.txt', ebomInput)
    if (!ok) {
      phase = 'stopped'
      return
    }
    handover = sourcingInput(ebomInput, mainResult(runs[1])!, p.mapping, p.catalog)
    phase = 'gate2'
  }

  /** Gate 2 approved: the sourcing agent runs on the E-BOM lines the tool joined and mapped. */
  async function toSourcing() {
    if (!handover?.text) return
    phase = 'running'
    const ok = await runStep(2, p.steps[2].task, 'ebom-lines-and-catalog.txt', handover.text)
    phase = ok ? 'done' : 'stopped'
  }

  function startOver() {
    unsubscribe?.()
    unsubscribe = null
    runs = [blank(), blank(), blank()]
    rulesText = ''
    ebomInput = null
    handover = null
    phase = 'input'
  }

  async function pickFile(e: Event & { currentTarget: HTMLInputElement }) {
    const f = e.currentTarget.files?.[0]
    if (!f) return
    ownFile = { name: f.name, text: await f.text() }
    useExample = false
  }

  $effect(() => () => unsubscribe?.())
</script>

{#snippet stepCard(i: number, label: string)}
  {@const r = runs[i]}
  {@const s = p.steps[i]}
  <section class="rounded-xl border border-gray-200 bg-white p-5" aria-labelledby={`step-${i}-heading`}>
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={`step-${i}-heading`} class="font-semibold text-gray-900">
        {i + 1}. <a href={`/agents/${s.slug}`} class="text-indigo-600 hover:underline">{s.title}</a>
        <span class="ml-1 text-sm font-normal text-gray-600">({label})</span>
      </h2>
      <p class="text-sm text-gray-700" data-testid={`step-${i}-status`}>{STATUS_TEXT[r.status]}</p>
    </div>
    {#if r.events.length > 0}
      <ul class="mt-3 space-y-0.5 font-mono text-xs text-gray-700">
        {#each r.events.slice(-4) as e}
          <li><span class="text-gray-500">{e.ts}</span> {e.summary}</li>
        {/each}
      </ul>
    {/if}
    {#if r.status === 'failed'}
      <p class="mt-3 text-sm text-red-700" role="alert">{r.error ?? 'The step failed.'}</p>
    {/if}
    {#if r.check}
      <div class={`mt-3 rounded border p-3 text-sm ${CHECK_STYLE[r.check.status]}`}>
        <p class="font-semibold">{CHECK_LABEL[r.check.status]}</p>
        <p class="mt-1">{r.check.summary}</p>
      </div>
    {/if}
    {#if r.files === 'loading'}
      <p class="mt-3 text-sm text-gray-600">Loading the result…</p>
    {:else if r.files === 'unavailable'}
      <p class="mt-3 text-sm text-gray-600">The result cannot be shown here.</p>
    {:else if r.files}
      {#each r.files.sheets as sh (sh.name)}
        <button
          type="button"
          onclick={() => saveBytes(sh.name, sh.bytes, XLSX_MIME)}
          class="mt-3 mr-2 inline-flex min-h-[44px] items-center rounded border border-indigo-600 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          Download {sh.name}
        </button>
      {/each}
      {#each r.files.texts as f, fi (f.name)}
        <details class="mt-3" open={fi === 0}>
          <summary class="cursor-pointer text-sm font-medium text-indigo-600">{f.name}</summary>
          <ResultView text={f.text} label={`Step ${i + 1} file ${f.name}`} />
        </details>
      {/each}
    {/if}
  </section>
{/snippet}

<div class="space-y-4">
  {#if !allRunnable}
    <p class="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900" role="alert">
      Not every agent of this pipeline can run here, so the pipeline cannot run.
    </p>
  {/if}

  <!-- Inputs: the data first, then the notes that apply to it. -->
  <section class="rounded-xl border border-gray-200 bg-white p-5" aria-labelledby="pipeline-inputs-heading">
    <h2 id="pipeline-inputs-heading" class="font-semibold text-gray-900">Inputs</h2>
    <fieldset class="mt-3" disabled={phase !== 'input'}>
      <legend class="text-xs font-semibold text-gray-700">E-BOM data (blocks, catalogue and elements)</legend>
      <label class="mt-2 flex items-center gap-2 text-sm text-gray-900">
        <input type="radio" name="pipeline-data" checked={useExample} onchange={() => (useExample = true)} />
        Example data (<span class="font-mono">{p.data.name}</span>)
      </label>
      <label class="mt-1 flex items-center gap-2 text-sm text-gray-900">
        <input type="radio" name="pipeline-data" checked={!useExample} disabled={!ownFile} onchange={() => (useExample = false)} />
        My own file{ownFile ? ` (${ownFile.name})` : ''}
      </label>
      <label for="pipeline-file" class="mt-2 block text-xs text-gray-700">Attach your own E-BOM input file (same format as the example)</label>
      <input
        id="pipeline-file"
        type="file"
        onchange={pickFile}
        class="mt-1 block w-full rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-600 focus-visible:ring-2 focus-visible:ring-indigo-600"
      />
      <details class="mt-2">
        <summary class="cursor-pointer text-sm font-medium text-indigo-600">View the data ({data.name})</summary>
        <ResultView text={data.text} mode="input" label="Pipeline E-BOM data" />
      </details>
    </fieldset>

    <label for="pipeline-notes" class="mt-5 block text-xs font-semibold text-gray-700">Scope notes in your own words, one per line</label>
    <textarea
      id="pipeline-notes"
      rows="7"
      disabled={phase !== 'input'}
      class="mt-1 w-full rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-600"
      value={notes}
      oninput={(e) => (notes = e.currentTarget.value)}
    ></textarea>
    <p class="mt-1 text-xs text-gray-600">
      Notes that exclude elements become scope rules for the E-BOM; you can edit the rules before they are used.
    </p>

    {#if ownRules.length > 0}
      <fieldset class="mt-4" disabled={phase !== 'input'}>
        <legend class="text-xs font-semibold text-gray-700">The data already has {ownRules.length} scope {ownRules.length === 1 ? 'rule' : 'rules'}</legend>
        <label class="mt-2 flex items-center gap-2 text-sm text-gray-900">
          <input type="radio" name="pipeline-rules" checked={choice === 'add'} onchange={() => (choice = 'add')} /> Keep them and add the new ones
        </label>
        <label class="mt-1 flex items-center gap-2 text-sm text-gray-900">
          <input type="radio" name="pipeline-rules" checked={choice === 'replace'} onchange={() => (choice = 'replace')} /> Replace them with the new ones
        </label>
        <label class="mt-1 flex items-center gap-2 text-sm text-gray-900">
          <input type="radio" name="pipeline-rules" checked={choice === 'mine'} onchange={() => (choice = 'mine')} /> Use only them (skip step 1)
        </label>
      </fieldset>
    {/if}

    <div class="mt-5 flex flex-wrap gap-3">
      <button
        type="button"
        onclick={start}
        disabled={phase !== 'input' || !allRunnable || (notes.trim() === '' && !(choice === 'mine' && ownRules.length > 0))}
        class="inline-flex min-h-[44px] items-center rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
      >
        Run the pipeline
      </button>
      {#if phase !== 'input'}
        <button
          type="button"
          onclick={startOver}
          disabled={phase === 'running'}
          class="inline-flex min-h-[44px] items-center rounded border border-gray-500 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-not-allowed disabled:text-gray-400"
        >
          Start over
        </button>
      {/if}
    </div>
  </section>

  <p class="sr-only" role="status" aria-live="polite">
    {phase === 'gate1' ? 'Step 1 done: review the rules.' : phase === 'gate2' ? 'Step 2 done: review the E-BOM lines.' : phase === 'done' ? 'The pipeline is done.' : ''}
  </p>

  {@render stepCard(0, 'model: notes to scope rules')}

  {#if phase === 'gate1'}
    <section class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-800">
      <h2 class="font-semibold text-gray-900">Tool: rules into the E-BOM data</h2>
      <label for="pipeline-rules-edit" class="mt-2 block text-xs font-semibold text-gray-700">
        Scope rules for the E-BOM ({choice === 'replace' ? 'they replace the data’s own rules' : ownRules.length ? 'added to the data’s own rules' : 'added to the data'}); edit if needed, one per line
      </label>
      <textarea
        id="pipeline-rules-edit"
        rows={Math.max(3, rulesText.split('\n').length + 1)}
        class="mt-1 w-full rounded border border-gray-500 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-600"
        value={rulesText}
        oninput={(e) => (rulesText = e.currentTarget.value)}
      ></textarea>
      <p class="mt-1 text-xs text-gray-600">
        {rulesText.trim() === '' ? 'No rules: the E-BOM agent runs on the data as it is.' : 'The tool puts these lines into the ## RULES section of the E-BOM data; a tool step before the next run works out which elements they exclude.'}
      </p>
      <button
        type="button"
        onclick={toEbom}
        class="mt-3 inline-flex min-h-[44px] items-center rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600"
      >
        Approve and continue <span aria-hidden="true" class="ml-1">→</span>
      </button>
    </section>
  {:else if ebomInput !== null}
    <section class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-800">
      <h2 class="font-semibold text-gray-900">Tool: rules into the E-BOM data</h2>
      <details class="mt-2">
        <summary class="cursor-pointer text-sm font-medium text-indigo-600">View the E-BOM input the tool handed over</summary>
        <ResultView text={ebomInput ?? ''} mode="input" label="E-BOM input handed over" />
      </details>
    </section>
  {/if}

  {@render stepCard(1, 'model: E-BOM class step, checked by the ebom-join tool')}

  {#if handover}
    <section class="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-800">
      <h2 class="font-semibold text-gray-900">Tool: E-BOM lines for sourcing</h2>
      {#if handover && handover.problems.length > 0}
        <p class="mt-2 text-sm text-red-700" role="alert">Nothing can be handed over: {handover.problems.join('; ')}</p>
      {:else if handover}
        <p class="mt-2">
          The ebom-join tool joined the E-BOM class rows into {handover.lines.length} {handover.lines.length === 1 ? 'line' : 'lines'} (block and designation, metres rounded up to whole 3 m sticks) and mapped each to a product class, size and material.
        </p>
        <ul class="mt-2 list-disc pl-5 font-mono text-xs">
          {#each handover.lines as l (l.line_id)}
            <li>{l.line_id}: {l.designation} in {l.block}, {l.qty} {l.unit}{l.stickRounded ? ` (measured ${l.measured} m)` : ''} → {l.req_class}, DN {l.req_dn}, {l.req_material}</li>
          {/each}
        </ul>
      {/if}
      {#if handover && handover.unmapped.length > 0}
        <p class="mt-2 text-sm">Not handed over (no product mapping): {handover.unmapped.join(', ')}</p>
      {/if}
      {#if phase === 'gate2' && handover && handover.text}
        <button
          type="button"
          onclick={toSourcing}
          class="mt-3 inline-flex min-h-[44px] items-center rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          Approve and continue <span aria-hidden="true" class="ml-1">→</span>
        </button>
      {/if}
    </section>
  {/if}

  {@render stepCard(2, 'model: E-BOM lines to M-BOM draft')}

  {#if phase === 'done'}
    <p class="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">
      The pipeline is done. Every result above is a draft for expert review.
    </p>
  {/if}
</div>
