<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'

  interface Props {
    currentPage: number
    totalPages: number
  }
  let { currentPage, totalPages }: Props = $props()

  let prevEl: HTMLButtonElement | undefined = $state()
  let nextEl: HTMLButtonElement | undefined = $state()

  async function navigate(p: number) {
    const params = new URLSearchParams($page.url.searchParams)
    params.set('page', String(p))
    // keepFocus: SvelteKit would otherwise reset focus to the document, losing the user's place.
    await goto(`?${params.toString()}`, { keepFocus: true })
    // The pressed button is disabled at either end of the range, which drops focus; hand it over.
    if (p <= 1) nextEl?.focus()
    else if (p >= totalPages) prevEl?.focus()
  }
</script>

{#if totalPages > 1}
  <nav class="flex items-center gap-2 justify-center mt-8" aria-label="Pagination">
    <button
      type="button"
      bind:this={prevEl}
      aria-label="Previous page"
      onclick={() => navigate(currentPage - 1)}
      disabled={currentPage <= 1}
      class="px-3 py-2 rounded border border-gray-500 text-sm min-h-[44px] disabled:opacity-40 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-indigo-600"
    >
      Previous
    </button>
    <span class="text-sm text-gray-600" aria-current="page" aria-live="polite">Page {currentPage} of {totalPages}</span>
    <button
      type="button"
      bind:this={nextEl}
      aria-label="Next page"
      onclick={() => navigate(currentPage + 1)}
      disabled={currentPage >= totalPages}
      class="px-3 py-2 rounded border border-gray-500 text-sm min-h-[44px] disabled:opacity-40 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-indigo-600"
    >
      Next
    </button>
  </nav>
{/if}
