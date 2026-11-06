<script lang="ts">
  interface Props {
    categories: string[]
    llms: string[]
    maturityStatuses: string[]
    selectedCategory: string
    selectedLlm: string
    selectedMaturity: string
    onCategoryChange: (value: string) => void
    onLlmChange: (value: string) => void
    onMaturityChange: (value: string) => void
    onClear: () => void
    kinds?: string[]
    selectedKind?: string
    onKindChange?: (value: string) => void
  }
  let { categories, llms, maturityStatuses, selectedCategory, selectedLlm, selectedMaturity, onCategoryChange, onLlmChange, onMaturityChange, onClear, kinds, selectedKind = '', onKindChange }: Props = $props()

  let categoryEl: HTMLSelectElement | undefined = $state()

  function clear() {
    onClear()
    // The Clear button unmounts once no filter is active, so move focus to the first control.
    categoryEl?.focus()
  }

  let hasActiveFilters = $derived(selectedCategory !== '' || selectedLlm !== '' || selectedMaturity !== '' || selectedKind !== '')
</script>

<div class="flex flex-wrap items-end gap-4 mb-6" role="group" aria-label="Filter agents">
  <div>
    <label for="filter-category" class="block text-xs font-medium text-gray-700 mb-1">Category</label>
    <select
      id="filter-category"
      bind:this={categoryEl}
      class="min-h-[44px] rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-900"
      value={selectedCategory}
      onchange={(e) => onCategoryChange(e.currentTarget.value)}
    >
      <option value="">All categories</option>
      {#each categories as cat}
        <option value={cat}>{cat}</option>
      {/each}
    </select>
  </div>

  <div>
    <label for="filter-llm" class="block text-xs font-medium text-gray-700 mb-1">Model</label>
    <select
      id="filter-llm"
      class="min-h-[44px] rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-900"
      value={selectedLlm}
      onchange={(e) => onLlmChange(e.currentTarget.value)}
    >
      <option value="">All models</option>
      {#each llms as llm}
        <option value={llm}>{llm}</option>
      {/each}
    </select>
  </div>

  <div>
    <label for="filter-maturity" class="block text-xs font-medium text-gray-700 mb-1">Status</label>
    <select
      id="filter-maturity"
      class="min-h-[44px] rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-900"
      value={selectedMaturity}
      onchange={(e) => onMaturityChange(e.currentTarget.value)}
    >
      <option value="">All statuses</option>
      {#each maturityStatuses as status}
        <option value={status}>{status}</option>
      {/each}
    </select>
  </div>

  {#if kinds && kinds.length > 1}
    <div>
      <label for="filter-kind" class="block text-xs font-medium text-gray-700 mb-1">Type</label>
      <select
        id="filter-kind"
        class="min-h-[44px] rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-900"
        value={selectedKind}
        onchange={(e) => onKindChange?.(e.currentTarget.value)}
      >
        <option value="">All types</option>
        {#each kinds as k}
          <option value={k}>{k}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if hasActiveFilters}
    <button
      type="button"
      onclick={clear}
      class="rounded text-sm text-indigo-600 hover:underline min-h-[44px] px-2 focus-visible:ring-2 focus-visible:ring-indigo-600"
    >
      Clear filters
    </button>
  {/if}
</div>
