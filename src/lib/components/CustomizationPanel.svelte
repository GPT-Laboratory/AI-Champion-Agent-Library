<script lang="ts">
  import { TAILORABLE_FIELDS } from '$lib/config/tailorable-fields.js'

  // fields: keys the agent declares as customizable; null shows all fields.
  // fixed: keys shown with their current value, defined by the agent's creator.
  let {
    fields = null,
    fixed = [],
    values = {},
    fixedNote = null,
  }: {
    fields?: string[] | null
    fixed?: string[]
    values?: Record<string, string>
    fixedNote?: string | null
  } = $props()

  const customizable = $derived(
    fields ? TAILORABLE_FIELDS.filter((f) => fields.includes(f.key)) : TAILORABLE_FIELDS
  )
  const fixedFields = $derived(TAILORABLE_FIELDS.filter((f) => fixed.includes(f.key)))
</script>

<aside class="rounded-xl border border-gray-200 bg-white p-6" aria-labelledby="customization-heading">
  <h2 id="customization-heading" class="font-semibold text-gray-900 mb-2">Customization Options</h2>
  {#if customizable.length > 0}
    <p class="text-sm text-gray-600 mb-4">These fields can be tailored when you customize this agent.</p>
    <ul class="space-y-3">
      {#each customizable as field}
        <li class="flex items-start gap-3">
          <span class="shrink-0 text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded mt-0.5">Customizable</span>
          <div>
            <p class="text-sm font-medium text-gray-900">{field.label}</p>
            <p class="text-xs text-gray-500">{field.description}</p>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
  {#if fixedFields.length > 0}
    <p class="text-sm text-gray-600 mb-4" class:mt-6={customizable.length > 0}>
      These settings are defined by the agent's creator and can't be changed from the library.
    </p>
    <ul class="space-y-3">
      {#each fixedFields as field}
        <li class="flex items-start gap-3">
          <span class="shrink-0 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded mt-0.5">Fixed</span>
          <div>
            <p class="text-sm font-medium text-gray-900">{field.label}</p>
            <p class="text-xs text-gray-500">{values[field.key] ?? '—'}</p>
          </div>
        </li>
      {/each}
    </ul>
    {#if fixedNote}
      <p class="mt-4 text-xs text-gray-500">{fixedNote}</p>
    {/if}
  {/if}
</aside>
