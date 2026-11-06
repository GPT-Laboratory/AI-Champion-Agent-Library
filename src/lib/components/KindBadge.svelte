<script lang="ts">
  let { kind, framework = null }: { kind: string; framework?: string | null } = $props()

  const LABELS: Record<string, string> = {
    system: 'System',
    skill: 'Skill',
    'mcp-server': 'MCP server',
    workflow: 'Workflow',
    'external-agent': 'External agent',
  }

  let label = $derived(
    kind === 'agent' ? '' : (LABELS[kind] ?? (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : ''))
  )
  let text = $derived(label && framework ? `${label} · ${framework}` : label)
</script>

{#if text}
  <span class="inline-block rounded-full border border-gray-500 bg-white px-2 py-0.5 text-xs font-medium text-gray-700">{text}</span>
{/if}
