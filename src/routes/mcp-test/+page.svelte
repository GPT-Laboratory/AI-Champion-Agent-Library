<script lang="ts">
  import McpTestPanel from '$lib/components/McpTestPanel.svelte'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
</script>

<svelte:head>
  <title>MCP test platform — AIC Agent Library</title>
</svelte:head>

<h1 class="mb-2 text-3xl font-semibold text-gray-900">MCP test platform</h1>
<p class="mb-4 max-w-3xl text-sm text-gray-700">
  Score an MCP server with the benchmark cases. Results for fake subjects score the scorer fixtures, not a real
  generator. Nothing is stored in your browser.
</p>

<McpTestPanel subjects={data.subjects} cases={data.cases} />
