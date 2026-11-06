<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation'
  import AgentCard from '$lib/components/AgentCard.svelte'
  import FilterBar from '$lib/components/FilterBar.svelte'
  import SearchBar from '$lib/components/SearchBar.svelte'
  import { buildCatalogParams, truncateQuery } from '$lib/catalogUrl'
  import Pagination from '$lib/components/Pagination.svelte'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  // Filter state is derived from the server-provided URL params, so it re-seeds whenever
  // `data` changes (back/forward, nav links). Assigning (optimistic update on change)
  // overrides the value until the next navigation delivers new data.
  let selectedCategory = $derived(data.filters.category ?? '')
  let selectedLlm = $derived(data.filters.llm ?? '')
  let selectedMaturity = $derived(data.filters.maturity ?? '')
  let selectedKind = $derived(('kind' in data.filters ? data.filters.kind : null) ?? '')
  let query = $derived(data.filters.q ?? '')

  // The search input owns its text while typing, so it is only re-created (not re-synced)
  // when navigation came from outside the page (nav link, back/forward).
  let searchKey = $state(0)
  afterNavigate(({ type }) => {
    if (type === 'link' || type === 'popstate') searchKey++
  })

  // DISC-02 (AGENT_COMPARE): selection lives in ?compare=a,b,c; without JS the form below submits to /compare.
  const MAX_COMPARE = 3
  let compareOn = $derived('compareEnabled' in data && data.compareEnabled === true)
  let selected = $derived<string[]>('compare' in data && Array.isArray(data.compare) ? data.compare : [])
  let announcement = $derived(`${selected.length} of ${MAX_COMPARE} agents selected for comparison`)

  function toggleCompare(slug: string, checked: boolean) {
    const next = checked ? [...selected.filter((s) => s !== slug), slug].slice(0, MAX_COMPARE) : selected.filter((s) => s !== slug)
    selected = next
    const params = new URLSearchParams(window.location.search)
    if (next.length) params.set('compare', next.join(','))
    else params.delete('compare')
    goto(`?${params.toString()}`, { replaceState: true, keepFocus: true, noScroll: true })
  }
  function compareProps(slug: string) {
    const checked = selected.includes(slug)
    return {
      checked,
      disabled: !checked && selected.length >= MAX_COMPARE,
      onchange: (c: boolean) => toggleCompare(slug, c)
    }
  }

  const degradedMessage = 'Search is temporarily limited. Showing basic text matches only.'

  let noResultsQuery = $derived(truncateQuery(data.filters.q ?? ''))

  function updateCategory(value: string) {
    selectedCategory = value
    syncUrl()
  }

  function updateLlm(value: string) {
    selectedLlm = value
    syncUrl()
  }

  function updateMaturity(value: string) {
    selectedMaturity = value
    syncUrl()
  }

  function updateKind(value: string) {
    selectedKind = value
    syncUrl()
  }

  function clearFilters() {
    selectedKind = ''
    selectedCategory = ''
    selectedLlm = ''
    selectedMaturity = ''
    syncUrl()
  }

  function updateQuery(value: string) {
    query = value
    syncUrl()
  }

  function syncUrl() {
    const params = buildCatalogParams({
      category: selectedCategory,
      llm: selectedLlm,
      maturity: selectedMaturity,
      q: query,
      kind: selectedKind
    })
    if (compareOn && selected.length) params.set('compare', selected.join(','))
    goto(`?${params.toString()}`, { replaceState: true, keepFocus: true, noScroll: true })
  }
</script>

<svelte:head>
  <title>Agent Catalog — AIC Agent Library</title>
</svelte:head>

<h1 class="text-3xl font-semibold text-gray-900 mb-6">Agent Catalog</h1>

{#key searchKey}
  <SearchBar
    value={data.filters.q ?? ''}
    onsearch={updateQuery}
    count={data.total}
    message={data.searchDegraded ? degradedMessage : ''}
  />
{/key}

<FilterBar
  categories={data.categories}
  llms={data.llms}
  maturityStatuses={data.maturityStatuses}
  {selectedCategory}
  {selectedLlm}
  {selectedMaturity}
  onCategoryChange={updateCategory}
  onLlmChange={updateLlm}
  onMaturityChange={updateMaturity}
  onClear={clearFilters}
  {...'kinds' in data ? { kinds: data.kinds, selectedKind, onKindChange: updateKind } : {}}
/>

{#if data.searchDegraded}
  <!-- Announced through SearchBar's persistent live region (message prop), not role=status here. -->
  <p class="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
    {degradedMessage}
  </p>
{/if}

{#if data.agents.length === 0}
  <div class="text-center py-16">
    {#if noResultsQuery}
      <h2 class="text-lg font-semibold text-gray-900 mb-2 break-words">No agents match "{noResultsQuery}"</h2>
      <p class="text-sm text-gray-600">Try different words or remove a filter.</p>
    {:else}
      <h2 class="text-lg font-semibold text-gray-900 mb-2">No agents match your filters</h2>
      <p class="text-sm text-gray-600">Try removing a filter or browsing all categories.</p>
    {/if}
  </div>
{:else}
  {#if compareOn}
    <form method="GET" action="/compare" aria-label="Compare selected agents">
      <div class="mb-4 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          class="rounded-lg bg-indigo-600 px-4 py-2 min-h-[44px] text-sm font-medium text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
        >
          Compare selected
        </button>
        <p class="text-sm text-gray-700">Select two or three agents, up to {MAX_COMPARE}.</p>
        <p role="status" aria-live="polite" class="sr-only">{announcement}</p>
      </div>
      {#each selected.filter((s) => !data.agents.some((a) => a.slug === s)) as slug (slug)}
        <input type="hidden" name="agents" value={slug} />
      {/each}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {#each data.agents as agent (agent.slug)}
          <AgentCard {agent} compare={compareProps(agent.slug)} />
        {/each}
      </div>
    </form>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each data.agents as agent (agent.slug)}
        <AgentCard {agent} />
      {/each}
    </div>
  {/if}

  <Pagination currentPage={data.page} totalPages={data.totalPages} />
{/if}
