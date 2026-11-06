<script lang="ts">
  interface Member {
    ref?: string
    name: string
    role: string
    description: string | null
    slug: string | null
  }

  let {
    members = [],
    topology = null,
    framework = null,
  }: { members?: Member[]; topology?: string | null; framework?: string | null } = $props()

  const TOPOLOGY: Record<string, string> = {
    swarm: 'Swarm',
    'manager-workers': 'Manager and workers',
    pipeline: 'Pipeline',
    graph: 'Graph',
    'group-chat': 'Group chat',
  }
  const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  const safe = (s: string | null | undefined): s is string => typeof s === 'string' && SAFE_SLUG.test(s)

  let topologyLabel = $derived(topology ? (TOPOLOGY[topology] ?? topology) : null)
</script>

<section class="mt-8" aria-labelledby="system-members-heading">
  <h2 id="system-members-heading" class="mb-3 text-lg font-semibold text-gray-900">Members</h2>
  {#if framework}
    <p class="mb-1 text-sm text-gray-600">Framework: {framework}</p>
  {/if}
  {#if topologyLabel}
    <p class="mb-3 text-sm text-gray-600">Topology: {topologyLabel}</p>
  {/if}
  {#if members.length === 0}
    <p class="text-sm text-gray-600">No members listed.</p>
  {:else}
    <ul class="space-y-3">
      {#each members as m, i (i)}
        <li class="rounded-lg border border-gray-200 p-3">
          <p class="text-sm text-gray-900">
            {#if safe(m.slug)}
              <a
                href="/agents/{m.slug}"
                aria-label="View details: {m.name}"
                class="font-semibold text-indigo-700 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-600"
                >{m.name}</a
              >
            {:else}
              <strong>{m.name}</strong>
            {/if}
            <span class="text-gray-600">({m.role})</span>
          </p>
          {#if m.description}
            <p class="mt-1 break-words text-sm text-gray-600">{m.description}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
