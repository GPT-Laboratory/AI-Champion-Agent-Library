<script lang="ts">
  import { onDestroy } from 'svelte'
  import { MAX_RERUNS, ROUTE_PATH } from '$lib/mcptest/api-contract.js'
  import type { RunStatusResponse, StartRunResponse } from '$lib/mcptest/api-contract.js'
  import type { Report } from '$lib/mcptest/core/report.js'
  import {
    flagsBlockersFirst,
    groupByTier,
    stateClass,
    stateLabel,
    type CaseInfo,
    type SubjectInfo
  } from '$lib/mcptest/uiModel.js'

  let {
    subjects,
    cases,
    fetchFn,
    pollMs = 800
  }: { subjects: SubjectInfo[]; cases: CaseInfo[]; fetchFn?: typeof fetch; pollMs?: number } = $props()

  const uid = $props.id()
  const headingId = `mcp-test-title-${uid}`
  const subjectId = `mcp-test-subject-${uid}`
  const rerunsId = `mcp-test-reruns-${uid}`
  const resultsHeadingId = `mcp-test-results-${uid}`

  type Phase = 'idle' | 'running' | 'done' | 'error'
  let phase: Phase = $state('idle')
  let subject = $state('')
  let reruns = $state(1)
  let status = $state('')
  let message = $state('')
  let runId = $state('')
  let report: Report | null = $state(null)
  let resultsEl: HTMLHeadingElement | undefined = $state()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const groups = $derived(groupByTier(cases))
  const selected = $derived(subjects.find((s) => s.id === subject))
  const fakeSelected = $derived(selected?.kind === 'fake')
  const pending = $derived(phase === 'running')
  const allFlags = $derived(report ? flagsBlockersFirst(report.cases.flatMap((c) => c.flags.map((f) => ({ ...f, caseId: c.caseId })))) : [])

  $effect.pre(() => {
    if (subject === '') subject = subjects.find((s) => s.runnable)?.id ?? ''
  })

  onDestroy(() => {
    stopped = true
    if (timer) clearTimeout(timer)
  })

  const f = () => fetchFn ?? fetch

  async function errorText(res: Response): Promise<string> {
    if (res.status === 404) return 'The MCP test platform is not available.'
    try {
      const body = await res.json()
      if (body && typeof body.message === 'string') return body.message
    } catch {
      /* fall through */
    }
    return 'The run could not be started. Check the settings and try again.'
  }

  function fail(text: string) {
    phase = 'error'
    status = ''
    message = text
  }

  async function start(e: Event) {
    e.preventDefault()
    if (pending || !selected?.runnable) return
    message = ''
    report = null
    status = 'Starting...'
    phase = 'running'
    stopped = false
    const n = Math.min(MAX_RERUNS, Math.max(1, Math.round(Number(reruns) || 1)))
    try {
      const res = await f()(ROUTE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject, reruns: n })
      })
      if (res.status !== 202) return fail(await errorText(res))
      const body = (await res.json()) as StartRunResponse
      runId = body.id
      void poll()
    } catch {
      fail('Could not reach the test platform. Try again.')
    }
  }

  async function poll() {
    if (stopped) return
    try {
      const res = await f()(`${ROUTE_PATH}/${runId}`)
      if (stopped) return
      if (!res.ok) return fail(await errorText(res))
      const s = (await res.json()) as RunStatusResponse
      if (s.status === 'failed') return fail(s.error ? `The run failed: ${s.error}` : 'The run failed.')
      if (s.status === 'done') return await finish()
      const { done, total, current } = s.progress
      status = `Running: ${done} of ${total} cells${current ? `, current ${current}` : ''}`
      timer = setTimeout(() => void poll(), pollMs)
    } catch {
      if (!stopped) fail('Lost contact with the test platform. Try again.')
    }
  }

  async function finish() {
    const res = await f()(`${ROUTE_PATH}/${runId}/report`)
    if (stopped) return
    if (!res.ok) return fail('The run finished but the report could not be loaded.')
    report = (await res.json()) as Report
    phase = 'done'
    status = 'Run complete'
    setTimeout(() => resultsEl?.focus(), 0)
  }
</script>

<!-- Non-modal region. Nothing is stored: no local or session storage, no cookies; state lives in this component. -->
<section aria-labelledby={headingId} class="max-w-4xl rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
  <h2 id={headingId} class="text-lg font-semibold text-gray-900">Run the benchmark</h2>

  <div class="mt-3">
    <h3 class="text-sm font-semibold text-gray-900">Cases</h3>
    {#each groups as g (g.tier)}
      {#if g.cases.length > 0}
        <h4 class="mt-2 text-sm font-medium text-gray-800">Tier {g.tier}</h4>
        <ul class="mt-1 flex flex-col gap-1">
          {#each g.cases as c (c.id)}
            <li class="flex flex-wrap items-center gap-2 text-sm text-gray-900">
              <span class="font-mono">{c.id}</span>
              <span class="text-gray-700">{c.title}</span>
              <span class="rounded border border-gray-500 bg-gray-100 px-2 py-0.5 text-xs text-gray-800">Source: {c.badge}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
  </div>

  <form onsubmit={start} class="mt-4 flex flex-col gap-3">
    <div class="flex flex-col gap-1">
      <label for={subjectId} class="text-sm font-medium text-gray-900">Subject</label>
      <select
        id={subjectId}
        bind:value={subject}
        class="min-h-[44px] rounded border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      >
        {#each subjects as s (s.id)}
          <option value={s.id} disabled={!s.runnable}>{s.label}{s.runnable ? '' : ' (not available here)'}</option>
        {/each}
      </select>
      <ul class="text-xs text-gray-700">
        {#each subjects.filter((s) => !s.runnable && s.note) as s (s.id)}
          <li>{s.label}: {s.note}</li>
        {/each}
      </ul>
    </div>

    {#if fakeSelected}
      <p class="rounded border border-gray-300 bg-gray-50 p-2 text-sm text-gray-800">
        Results for a fake subject score the scorer fixtures, not a real generator.
      </p>
    {/if}

    <div class="flex flex-col gap-1">
      <label for={rerunsId} class="text-sm font-medium text-gray-900">Reruns (1 to {MAX_RERUNS})</label>
      <input
        id={rerunsId}
        type="number"
        min="1"
        max={MAX_RERUNS}
        step="1"
        bind:value={reruns}
        class="min-h-[44px] w-24 rounded border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      />
    </div>

    <div>
      <button
        type="submit"
        disabled={pending || !selected?.runnable}
        aria-busy={pending}
        class="min-h-[44px] rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        Run
      </button>
    </div>
  </form>

  <p role="status" aria-live="polite" class="mt-2 text-sm text-gray-800">{status}</p>
  <div role="alert" class="mt-2 text-sm text-red-800">{message}</div>

  {#if phase === 'done' && report}
    <div class="mt-4">
      <h3 id={resultsHeadingId} tabindex="-1" bind:this={resultsEl} class="text-base font-semibold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
        Results
      </h3>
      <p class="mt-1 text-sm text-gray-900">
        Verdict: <strong>{report.summary.verdict}</strong>. Gate: {report.summary.gate}. Score:
        {report.summary.score.value ?? 'not scored'} ({report.summary.score.casesRun} of {report.summary.score.casesApplicable} cases run).
      </p>

      <h4 class="mt-3 text-sm font-semibold text-gray-900">Flags</h4>
      {#if allFlags.length === 0}
        <p class="text-sm text-gray-800">No flags raised.</p>
      {:else}
        <ul class="mt-1 flex flex-col gap-1 text-sm text-gray-900">
          {#each allFlags as fl, i (i)}
            <li>
              <span class="font-mono">{fl.id}</span>
              <span class="rounded border px-2 py-0.5 text-xs {fl.severity === 'blocker' ? 'border-red-700 bg-red-100 text-red-900' : 'border-yellow-700 bg-yellow-100 text-yellow-900'}">{fl.severity === 'blocker' ? 'Blocker' : 'Warning'}</span>
              <span class="text-gray-700">({fl.caseId})</span>
              {fl.detail}
            </li>
          {/each}
        </ul>
      {/if}

      <div class="mt-3 overflow-x-auto">
        <table class="w-full border-collapse text-left text-sm">
          <caption class="pb-1 text-left text-sm font-medium text-gray-900">Results per case</caption>
          <thead>
            <tr class="border-b border-gray-300">
              <th scope="col" class="px-2 py-1">Case</th>
              <th scope="col" class="px-2 py-1">Tier</th>
              <th scope="col" class="px-2 py-1">State</th>
              <th scope="col" class="px-2 py-1">Checks passed</th>
            </tr>
          </thead>
          <tbody>
            {#each report.cases as c (c.caseId)}
              <tr class="border-b border-gray-200">
                <th scope="row" class="px-2 py-1 font-mono font-normal">{c.caseId}</th>
                <td class="px-2 py-1">{c.tier}</td>
                <td class="px-2 py-1"><span class="rounded border px-2 py-0.5 text-xs {stateClass(c.state)}">{stateLabel(c.state)}</span></td>
                <td class="px-2 py-1">{c.checks.filter((k) => k.status === 'PASS').length} of {c.checks.filter((k) => k.status !== 'NA').length}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <p class="mt-3">
        <a
          href={`${ROUTE_PATH}/${runId}/report`}
          download="mcptest-report.json"
          class="inline-flex min-h-[44px] items-center rounded border border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
        >Download report.json</a>
      </p>
    </div>
  {/if}
</section>
