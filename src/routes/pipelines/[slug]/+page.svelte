<script lang="ts">
  import PipelineRunner from '$lib/components/PipelineRunner.svelte'
  let { data } = $props()
</script>

<svelte:head>
  <title>{data.pipeline.title} — AIC Agent Library</title>
</svelte:head>

<div class="mb-4">
  <a href="/catalog" class="rounded text-sm text-gray-500 hover:text-gray-700">
    <span aria-hidden="true">&larr;</span> Back to catalog
  </a>
</div>
<h1 class="text-3xl font-semibold text-gray-900">{data.pipeline.title}</h1>
<p class="mt-2 mb-8 max-w-3xl text-gray-600">{data.pipeline.summary}</p>

{#key data.pipeline.slug}
  <PipelineRunner pipeline={data.pipeline} />
{/key}
