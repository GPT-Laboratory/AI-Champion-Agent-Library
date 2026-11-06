<script lang="ts">
  import KindBadge from '$lib/components/KindBadge.svelte'

  interface Props {
    agent: {
      slug: string
      title: string
      summary: string
      category: string | null
      maturityStatus: string
      tags: string[]
      tryItOutMode: string
      tryItOutUrl: string | null
      kind?: string
      framework?: string | null
    }
    /** DISC-02: only passed when AGENT_COMPARE is on; absent means the card renders exactly as before. */
    compare?: { checked: boolean; disabled: boolean; onchange: (checked: boolean) => void }
  }
  let { agent, compare }: Props = $props()
</script>

<article class="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow motion-reduce:transition-none hover:shadow-md">
  <div class="flex items-start justify-between gap-2 mb-2">
    <h2 class="font-semibold text-gray-900 text-lg leading-snug">{agent.title}</h2>
    {#if agent.maturityStatus === 'production'}
      <span class="shrink-0 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Production</span>
    {:else if agent.maturityStatus === 'beta'}
      <span class="shrink-0 text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">Beta</span>
    {:else}
      <span class="shrink-0 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Experimental</span>
    {/if}
  </div>
  {#if agent.kind && agent.kind !== 'agent'}
    <p class="mb-2"><KindBadge kind={agent.kind} framework={agent.framework ?? null} /></p>
  {/if}
  {#if agent.category}
    <p class="text-xs text-indigo-600 font-medium mb-2">{agent.category}</p>
  {/if}
  <p class="text-sm text-gray-600 line-clamp-3">{agent.summary}</p>
  {#if agent.tags.length > 0}
    <div class="flex flex-wrap gap-1 mt-3">
      {#each agent.tags.slice(0, 3) as tag}
        <span class="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{tag}</span>
      {/each}
    </div>
  {/if}
  <div class="mt-auto flex items-center gap-4 pt-5">
    <a
      href="/agents/{agent.slug}"
      class="inline-flex min-h-[44px] items-center text-sm font-medium text-gray-700 hover:text-indigo-700 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-600"
      aria-label="View details: {agent.title}"
    >
      View details
    </a>
    {#if agent.tryItOutMode === 'runnable'}
      <a
        href="/agents/{agent.slug}?tryout=1#try-out"
        class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
        aria-label="Try out {agent.title}"
      >
        Try out
      </a>
    {:else if agent.tryItOutMode === 'external' && agent.tryItOutUrl}
      <a
        href={agent.tryItOutUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
        aria-label="Try out {agent.title} (opens in new tab)"
      >
        Try out
      </a>
    {/if}
  </div>
  {#if compare}
    <label class="mt-2 inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-700">
      <input
        type="checkbox"
        name="agents"
        value={agent.slug}
        checked={compare.checked}
        disabled={compare.disabled}
        onchange={(e) => compare.onchange(e.currentTarget.checked)}
        class="h-5 w-5 focus-visible:ring-2 focus-visible:ring-indigo-600"
      />
      <span>Compare <span class="sr-only">{agent.title}</span></span>
    </label>
  {/if}
</article>
