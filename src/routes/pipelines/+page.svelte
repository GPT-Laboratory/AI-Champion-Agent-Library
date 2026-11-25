<script lang="ts">
  let { data } = $props()
</script>

<svelte:head>
  <title>Pipelines — AIC Agent Library</title>
</svelte:head>

<h1 class="text-3xl font-semibold text-gray-900">Pipelines</h1>
<p class="mt-2 mb-6 max-w-3xl text-gray-600">
  Agents that run one after the other on one page, with a tool between each pair and your approval at each hand-over.
</p>

{#if data.pipelines.length === 0}
  <p class="text-gray-600">No pipelines yet.</p>
{:else}
  <ul class="space-y-4">
    {#each data.pipelines as p (p.slug)}
      <li class="rounded-xl border border-gray-200 bg-white p-5">
        <h2 class="text-lg font-semibold text-gray-900">
          <a href={`/pipelines/${p.slug}`} class="text-indigo-600 hover:underline">{p.title}</a>
        </h2>
        <p class="mt-1 text-sm text-gray-600">{p.summary}</p>
        <ol class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700" aria-label={`Steps of ${p.title}`}>
          {#each p.steps as s, i (s.slug)}
            <li>
              {#if i > 0}<span aria-hidden="true" class="mr-2 text-gray-500">→</span>{/if}{i + 1}.
              <a href={`/agents/${s.slug}`} class="text-indigo-600 hover:underline">{s.title}</a>
            </li>
          {/each}
        </ol>
      </li>
    {/each}
  </ul>
{/if}
