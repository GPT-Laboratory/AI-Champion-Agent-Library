<script lang="ts">
  import KindBadge from '$lib/components/KindBadge.svelte'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
  let enough = $derived(data.agents.length >= 2)
  let anyDiff = $derived(data.rows.some((r) => r.differs))
</script>

<svelte:head>
  <title>Compare agents — AIC Agent Library</title>
</svelte:head>

<h1 class="text-3xl font-semibold text-gray-900 mb-2">Compare agents</h1>
<p class="text-sm text-gray-700 mb-6">
  <a href="/catalog" class="font-medium text-indigo-700 underline">Back to the catalog</a>
  to choose up to {data.max} agents.
</p>

{#if data.truncated}
  <p class="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
    Only the first {data.max} agents are compared.
  </p>
{/if}
{#if data.invalidCount > 0}
  <p class="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
    {data.invalidCount} requested {data.invalidCount === 1 ? 'name was' : 'names were'} not valid agent identifiers and {data.invalidCount === 1 ? 'was' : 'were'} ignored.
  </p>
{/if}
{#if data.unknown.length > 0}
  <p class="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
    {data.unknown.length === 1 ? 'One agent was' : `${data.unknown.length} agents were`} not found and
    {data.unknown.length === 1 ? 'is' : 'are'} left out of the comparison. It may have been removed.
  </p>
{/if}

{#if !enough}
  <div class="py-10 text-center">
    <h2 class="text-lg font-semibold text-gray-900 mb-2">Pick at least two agents to compare</h2>
    <p class="text-sm text-gray-600">
      Tick "Compare" on two or three agents in the <a href="/catalog" class="text-indigo-700 underline">catalog</a>, then choose "Compare selected".
    </p>
  </div>
{:else}
  <div
    class="overflow-x-auto rounded border border-gray-200"
    role="region"
    aria-label="Agent comparison table, scrolls horizontally on narrow screens"
    tabindex="0"
  >
    <table class="w-full min-w-[40rem] border-collapse text-left text-sm">
      <caption class="px-3 py-2 text-left text-sm text-gray-700">
        Side-by-side comparison of {data.agents.length} agents.
        {#if anyDiff}Rows marked "Differs" have values that are not the same across all agents.{:else}All values are identical.{/if}
      </caption>
      <thead>
        <tr class="bg-gray-50">
          <th scope="col" class="w-40 border-b border-gray-300 px-3 py-2 font-semibold text-gray-900">Attribute</th>
          {#each data.agents as a (a.slug)}
            <th scope="col" class="border-b border-gray-300 px-3 py-2 align-top font-semibold text-gray-900">
              <a href="/agents/{a.slug}" class="text-indigo-700 underline">{a.title}</a>
              {#if data.kindsOn && a.kind && a.kind !== 'agent'}
                <span class="mt-1 block"><KindBadge kind={a.kind} framework={a.framework} /></span>
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each data.rows as row (row.key)}
          <tr class={row.differs ? 'bg-amber-50' : ''}>
            <th scope="row" class="border-b border-gray-200 px-3 py-2 align-top font-medium text-gray-900">
              {row.label}
              {#if row.differs}
                <span class="mt-1 block w-fit rounded border border-amber-700 bg-white px-1.5 text-xs font-medium text-amber-900">Differs</span>
              {/if}
            </th>
            {#each row.cells as cell, i (i)}
              <td class="border-b border-gray-200 px-3 py-2 align-top text-gray-800 break-words">
                {#if cell.href}
                  <a href={cell.href} target="_blank" rel="noopener noreferrer" class="text-indigo-700 underline">{cell.text}<span class="sr-only"> (opens in new tab)</span></a>
                {:else}
                  {cell.text}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
