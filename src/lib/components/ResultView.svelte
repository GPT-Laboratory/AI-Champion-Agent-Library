<script lang="ts">
  // Shows an agent's result (or a sample input) with its tables as tables, status words as coloured chips, and a
  // toggle back to the raw text. Built from plain strings with Svelte elements only (src/lib/resultMarkdown.ts):
  // nothing is ever inserted as HTML. Optionally offers the tables as an Excel workbook (src/lib/xlsx.ts).
  import { parseDocument, parseInline, cellTone, toneColumns, type Block, type Inline, type ParseMode, type Tone } from '$lib/resultMarkdown'
  import { tablesToSheets, xlsxBytes, XLSX_MIME } from '$lib/xlsx'
  import { saveBytes } from '$lib/tryItOutResult'

  interface Props {
    text: string
    /** 'result' for what an agent writes, 'input' for a sample upload (`#` notes, CSV sections). */
    mode?: ParseMode
    /** Accessible name of the view, e.g. "Result file result.md". */
    label: string
    /** File name for "Download tables as Excel"; no button when null or when there is no table. */
    excelName?: string | null
    /** Start with the raw text (e.g. JSON); the toggle still offers the table view. */
    startRaw?: boolean
  }
  let { text, mode = 'result', label, excelName = null, startRaw = false }: Props = $props()

  let showRaw = $state<boolean | null>(null)
  let raw = $derived(showRaw ?? startRaw)
  let blocks: Block[] = $derived(parseDocument(text, mode))
  let tableCount = $derived(blocks.filter((b) => b.kind === 'table').length)

  const TONE: Record<Tone, string> = {
    good: 'bg-green-100 text-green-900',
    warn: 'bg-yellow-100 text-yellow-900',
    bad: 'bg-red-100 text-red-900',
    muted: 'bg-gray-100 text-gray-700',
  }
  const headingTag = (level: number) => (level <= 2 ? 'h3' : level === 3 ? 'h4' : 'h5')

  function downloadExcel() {
    if (excelName) saveBytes(excelName, xlsxBytes(tablesToSheets(blocks)), XLSX_MIME)
  }
</script>

{#snippet inline(runs: Inline[])}
  {#each runs as r}
    {#if r.t === 'code'}<code class="rounded bg-gray-100 px-1 font-mono text-[0.95em]">{r.v}</code>{:else if r.t === 'strong'}<strong>{r.v}</strong>{:else}{r.v}{/if}
  {/each}
{/snippet}

<div class="mt-2" role="group" aria-label={label}>
  <div class="mb-2 flex flex-wrap items-center gap-3">
    <button
      type="button"
      aria-pressed={raw}
      onclick={() => (showRaw = !raw)}
      class="rounded text-xs font-medium text-indigo-600 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-600"
    >
      {raw ? 'Show as tables' : 'Show raw text'}
    </button>
    {#if excelName && tableCount > 0}
      <button
        type="button"
        onclick={downloadExcel}
        class="rounded text-xs font-medium text-indigo-600 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-600"
      >
        Download {tableCount === 1 ? 'table' : 'tables'} as Excel (.xlsx)
      </button>
    {/if}
  </div>

  {#if raw}
    <pre
      tabindex="0"
      aria-label={`${label}, raw text`}
      class="max-h-96 overflow-auto rounded border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">{text}</pre>
  {:else}
    <div class="space-y-3 text-sm text-gray-900">
      {#each blocks as b, bi (bi)}
        {#if b.kind === 'heading'}
          <svelte:element this={headingTag(b.level)} class="pt-1 text-sm font-semibold text-gray-900">{@render inline(b.text)}</svelte:element>
        {:else if b.kind === 'note'}
          <p class="text-xs italic text-gray-600">{b.text}</p>
        {:else if b.kind === 'fields'}
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {#each b.rows as [k, v]}
              <dt class="font-mono text-gray-600">{k}</dt>
              <dd class="font-mono text-gray-900">{v}</dd>
            {/each}
          </dl>
        {:else if b.kind === 'table'}
          {@const toned = mode === 'result' ? toneColumns(b.rows, b.header.length) : b.header.map(() => false)}
          <div
            class="max-h-96 overflow-auto rounded border border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            role="region"
            tabindex="0"
            aria-label={`${b.title ?? 'Table'}, ${b.rows.length} ${b.rows.length === 1 ? 'row' : 'rows'}`}
          >
            <table class="min-w-full border-collapse text-xs">
              <thead class="sticky top-0 bg-gray-100">
                <tr>
                  {#each b.header as h}
                    <th scope="col" class="whitespace-nowrap border-b border-gray-200 px-2 py-1 text-left font-semibold text-gray-700">{@render inline([{ t: 'text', v: h.replace(/`/g, '') }])}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each b.rows as row}
                  <tr class="odd:bg-white even:bg-gray-50">
                    {#each row as cell, ci}
                      {@const tone = toned[ci] ? cellTone(cell) : null}
                      <td class="border-b border-gray-100 px-2 py-1 align-top">
                        {#if tone}<span class={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 font-medium ${TONE[tone]}`}>{cell}</span>{:else}{@render inline(parseInline(cell))}{/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else if b.kind === 'list'}
          {#if b.ordered}
            <ol class="ml-5 list-decimal space-y-0.5">{#each b.items as it}<li>{@render inline(it)}</li>{/each}</ol>
          {:else}
            <ul class="ml-5 list-disc space-y-0.5">{#each b.items as it}<li>{@render inline(it)}</li>{/each}</ul>
          {/if}
        {:else if b.kind === 'code'}
          <pre
            tabindex="0"
            class="max-h-64 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">{b.text}</pre>
        {:else if b.kind === 'lines'}
          <p class="leading-relaxed">
            {#each b.lines as l, li}{#if li > 0}<br />{/if}{@render inline(l)}{/each}
          </p>
        {/if}
      {/each}
    </div>
  {/if}
</div>
