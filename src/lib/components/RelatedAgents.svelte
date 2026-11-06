<script lang="ts">
  interface RelatedAgent {
    slug: string
    title: string
    summary: string
    category: string | null
  }

  let { agents = [] }: { agents?: RelatedAgent[] } = $props()
</script>

{#if agents.length > 0}
  <section class="mt-8" aria-labelledby="related-agents-heading">
    <h2 id="related-agents-heading" class="mb-3 text-lg font-semibold text-gray-900">Related agents</h2>
    <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {#each agents as a (a.slug)}
        <li>
          <a
            href="/agents/{a.slug}"
            class="block h-full rounded-lg border border-gray-200 p-3 hover:border-indigo-300 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            <span class="block text-sm font-medium text-indigo-700">{a.title}</span>
            {#if a.category}
              <span class="block text-xs text-gray-500">{a.category}</span>
            {/if}
            <span class="mt-1 line-clamp-2 block text-sm text-gray-600">{a.summary}</span>
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}
