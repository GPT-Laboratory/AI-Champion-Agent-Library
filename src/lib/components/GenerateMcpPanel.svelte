<script lang="ts">
  import { onMount } from 'svelte'
  import { listAdapters } from '$lib/mcpgen/registry.js'
  import { MAX_INPUT_BYTES, ROUTE_PATH } from '$lib/mcpgen/api-contract.js'

  let {
    onclose,
    fetchFn,
  }: { onclose?: () => void; fetchFn?: typeof fetch } = $props()

  const uid = $props.id()
  const headingId = `gen-mcp-title-${uid}`
  const noticeId = `gen-mcp-notice-${uid}`
  const adapterId = `gen-mcp-adapter-${uid}`
  const textId = `gen-mcp-text-${uid}`

  const adapters = listAdapters()

  let adapter = $state('')
  let text = $state('')
  let pending = $state(false)
  let status = $state('')
  let problems: string[] = $state([])
  let textEl: HTMLTextAreaElement | undefined = $state()

  onMount(() => textEl?.focus())

  function filename(header: string | null): string {
    const m = header ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header) : null
    const name = m ? m[1].replace(/[^A-Za-z0-9._-]/g, '_') : ''
    return name || 'mcp-server.zip'
  }

  async function submit(e: Event) {
    e.preventDefault()
    if (pending) return
    problems = []
    status = ''
    if (text.trim() === '') {
      problems = ['Paste a schema or spec first']
      return
    }
    if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) {
      problems = [`Input is too large (limit ${Math.round(MAX_INPUT_BYTES / 1024)} KB)`]
      return
    }
    pending = true
    status = 'Generating...'
    try {
      const f = fetchFn ?? fetch
      const res = await f(ROUTE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adapter: adapter || undefined, input: text }),
      })
      if (res.ok && (res.headers.get('content-type') ?? '').includes('application/zip')) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename(res.headers.get('content-disposition'))
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        text = ''
        status = 'Download started'
        return
      }
      status = ''
      if (res.status === 404) {
        problems = ['Generate MCP is not available']
        return
      }
      let gaps: { code?: unknown; message?: unknown }[] = []
      try {
        const body = await res.json()
        if (body && Array.isArray(body.gaps)) gaps = body.gaps
      } catch {
        gaps = []
      }
      problems =
        gaps.length > 0
          ? gaps.map((g) => `${String(g.code ?? 'error')}: ${String(g.message ?? '')}`)
          : ['Generation failed. Check the input and try again.']
    } catch {
      status = ''
      problems = ['Could not reach the generator. Try again.']
    } finally {
      pending = false
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onclose?.()
    }
  }
</script>

<!-- Non-modal region: no focus trap. Nothing is stored; the input is cleared after download. -->
<section
  role="region"
  aria-labelledby={headingId}
  onkeydown={onKeydown}
  class="mt-4 max-w-2xl rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
>
  <h2 id={headingId} class="text-lg font-semibold text-gray-900">Generate MCP server</h2>
  <p id={noticeId} class="mt-1 text-sm text-gray-700">
    Paste a schema or spec only. Do not paste API keys, passwords or data rows; they are rejected.
  </p>

  <form onsubmit={submit} class="mt-3 flex flex-col gap-3">
    <div class="flex flex-col gap-1">
      <label for={adapterId} class="text-sm font-medium text-gray-900">Adapter</label>
      <select
        id={adapterId}
        bind:value={adapter}
        class="min-h-[44px] rounded border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      >
        <option value="">Auto-detect</option>
        {#each adapters as a (a.id)}
          <option value={a.id}>{a.label}</option>
        {/each}
      </select>
    </div>

    <div class="flex flex-col gap-1">
      <label for={textId} class="text-sm font-medium text-gray-900">Schema or spec text</label>
      <textarea
        id={textId}
        bind:value={text}
        bind:this={textEl}
        rows="10"
        spellcheck="false"
        autocomplete="off"
        aria-describedby={noticeId}
        class="rounded border border-gray-300 px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      ></textarea>
    </div>

    <div class="flex gap-2">
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        class="min-h-[44px] rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        Generate
      </button>
      <button
        type="button"
        onclick={() => onclose?.()}
        class="min-h-[44px] rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      >
        Close
      </button>
    </div>
  </form>

  <p role="status" class="mt-2 text-sm text-gray-700">{status}</p>
  <div role="alert" class="mt-2 text-sm text-red-800">
    {#if problems.length > 0}
      <ul class="list-disc pl-5">
        {#each problems as p, i (i)}
          <li>{p}</li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
