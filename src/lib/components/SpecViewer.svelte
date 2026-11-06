<script lang="ts">
  import { tokenizeSpec } from '$lib/specViewer.js'

  // UI-04 (flag UI_SPEC_VIEWER). Text is rendered as escaped spans only, never as HTML.
  let { text, truncated = false }: { text: string; truncated?: boolean } = $props()
  let open = $state(false)
  let lines = $derived(open ? tokenizeSpec(text) : [])
</script>

<section class="mt-6 rounded-lg border border-slate-200" data-testid="spec-viewer">
  <h2 class="text-base font-semibold">
    <button
      type="button"
      onclick={() => (open = !open)}
      aria-expanded={open}
      aria-controls="spec-viewer-region"
      class="flex w-full items-center justify-between rounded-lg px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
    >
      Raw spec
      <span aria-hidden="true">{open ? '↑' : '↓'}</span>
    </button>
  </h2>
  <div id="spec-viewer-region" role="region" aria-label="Raw AgentSpec (YAML)" hidden={!open} class="border-t border-slate-200 px-4 py-3">
    {#if open}
      <p class="mb-2 text-xs text-slate-700">
        Reconstructed from the stored record. Secret-looking values are redacted{truncated ? ' and the text is truncated' : ''}.
      </p>
      <pre
        tabindex="0"
        aria-label="AgentSpec YAML"
        class="max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs leading-relaxed text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      ><code>{#each lines as toks, i (i)}{#each toks as t, j (j)}{#if t.kind === 'key'}<span class="text-indigo-800">{t.text}</span>{:else if t.kind === 'string'}<span class="text-emerald-900">{t.text}</span>{:else if t.kind === 'number' || t.kind === 'bool' || t.kind === 'null'}<span class="text-amber-900">{t.text}</span>{:else if t.kind === 'comment'}<span class="text-slate-700 italic">{t.text}</span>{:else}{t.text}{/if}{/each}{'\n'}{/each}</code></pre>
    {/if}
  </div>
</section>
