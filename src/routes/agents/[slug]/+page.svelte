<script lang="ts">
  import KindBadge from '$lib/components/KindBadge.svelte'
  import SystemMembers from '$lib/components/SystemMembers.svelte'
  import RelatedAgents from '$lib/components/RelatedAgents.svelte'
  import TechAccordion from '$lib/components/TechAccordion.svelte'
  import CustomizationPanel from '$lib/components/CustomizationPanel.svelte'
  import CustomizeMenu from '$lib/components/CustomizeMenu.svelte'
  import SpecViewer from '$lib/components/SpecViewer.svelte'
  import TryItOutPanel from '$lib/components/TryItOutPanel.svelte'
  import { TAILORABLE_FIELDS } from '$lib/config/tailorable-fields.js'
  import { safeHttpUrl } from '$lib/safeUrl.js'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
  let agent = $derived(data.agent)
  // Only http(s) links reach an href (CR-03): a stored `javascript:` URL renders no link.
  let githubHref = $derived(safeHttpUrl(agent.githubUrl))
  // Phase 13 (flag AGENT_KINDS): data.kindInfo exists only when the flag is on.
  let kindInfo = $derived(data.kindInfo && data.kindInfo.kind !== 'agent' ? data.kindInfo : null)
  let isSystem = $derived(kindInfo !== null)
  // Systems carry the 'n/a' LLM placeholder: hide the LLM line instead of showing it.
  let techAgent = $derived(
    isSystem && agent.llmName === 'n/a' ? { ...agent, fixedFields: [...agent.fixedFields, 'llm.name'] } : agent
  )
  // Same placeholder rule for the Customization panel: systems have no LLM or system prompt to tailor.
  const NA_KEYS = ['llm.name', 'llm.temperature', 'systemPrompt']
  let panelFields = $derived(
    isSystem && agent.llmName === 'n/a'
      ? (agent.customizableFields ?? TAILORABLE_FIELDS.map((f) => f.key)).filter((k) => !NA_KEYS.includes(k))
      : agent.customizableFields
  )
  let panelFixed = $derived(
    isSystem && agent.llmName === 'n/a' ? agent.fixedFields.filter((k) => !NA_KEYS.includes(k)) : agent.fixedFields
  )
  let tryItOutOpen = $state(Boolean(data.openTryOut))
</script>

<svelte:head>
  <title>{agent.title} — AIC Agent Library</title>
</svelte:head>

<div class="mb-4">
  <a href="/catalog" class="rounded text-sm text-gray-500 hover:text-gray-700">
    <span aria-hidden="true">&larr;</span> Back to catalog
  </a>
</div>

<div class="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
  <!-- Left column: Executive summary + TechAccordion -->
  <div>
    <!-- Executive summary — visible by default (DETL-01) -->
    <section>
      <div class="flex items-start justify-between gap-3 mb-3">
        <h1 class="text-3xl font-semibold text-gray-900">{agent.title}</h1>
        {#if agent.maturityStatus === 'production'}
          <span class="shrink-0 text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full mt-1">Production</span>
        {:else if agent.maturityStatus === 'beta'}
          <span class="shrink-0 text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full mt-1">Beta</span>
        {:else}
          <span class="shrink-0 text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full mt-1">Experimental</span>
        {/if}
      </div>

      {#if kindInfo}
        <p class="mb-3"><KindBadge kind={kindInfo.kind} framework={kindInfo.framework} /></p>
      {/if}

      {#if agent.category}
        <p class="text-xs text-indigo-600 font-medium mb-3">{agent.category}</p>
      {/if}

      <p class="text-gray-600 mb-4">{agent.summary}</p>

      {#if agent.tags.length > 0}
        <div class="flex flex-wrap gap-1 mb-4">
          {#each agent.tags as tag}
            <span class="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{tag}</span>
          {/each}
        </div>
      {/if}

      <div class="flex flex-wrap items-center gap-4">
        {#if githubHref}
          <a
            href={githubHref}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:underline"
          >
            {agent.linkLabel ?? 'View on GitHub'}<span aria-hidden="true"> &rarr;</span><span class="sr-only"> (opens in new tab)</span>
          </a>
        {/if}

        {#if agent.tryItOutMode === 'external' && agent.tryItOutUrl}
          <a
            href={agent.tryItOutUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:underline"
          >
            Try it out<span aria-hidden="true"> &rarr;</span><span class="sr-only"> (opens in new tab)</span>
          </a>
        {/if}

        <CustomizeMenu generatorEnabled={data.mcpGeneratorEnabled === true} testerEnabled={data.mcpTesterEnabled === true} />
      </div>

      {#if agent.tryItOutMode === 'runnable'}
        <div id="try-out" class="mt-6">
          <button
            type="button"
            onclick={() => (tryItOutOpen = !tryItOutOpen)}
            aria-expanded={tryItOutOpen}
            aria-controls="try-it-out-panel"
            class="inline-flex items-center gap-2 rounded text-sm font-medium text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            Try it out
            <span
              class="inline-block transition-transform"
              class:rotate-180={tryItOutOpen}
              aria-hidden="true">&darr;</span
            >
          </button>

          {#if tryItOutOpen}
            <div id="try-it-out-panel" class="mt-4">
              <TryItOutPanel agentId={agent.slug} />
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <!-- Collapsible technical spec — collapsed by default (DETL-02) -->
    {#if kindInfo}
      <SystemMembers members={kindInfo.members} topology={kindInfo.topology} framework={kindInfo.framework} />
    {/if}

    <TechAccordion agent={techAgent} />

    {#if data.specViewer}
      <SpecViewer text={data.specViewer.text} truncated={data.specViewer.truncated} />
    {/if}

    <RelatedAgents agents={data.related} />
  </div>

  <!-- Right column: Customization panel (DETL-03) -->
  <div class="lg:sticky lg:top-8 self-start">
    {#if panelFields?.length !== 0 || panelFixed.length > 0}
      <CustomizationPanel
        fields={panelFields}
        fixed={panelFixed}
        fixedNote={agent.fixedNote}
        values={{
          'llm.name': agent.llmName,
          'llm.temperature': agent.llmTemperature === null ? 'Default' : String(agent.llmTemperature),
          systemPrompt: agent.systemPrompt,
          tools: agent.toolNames.join(', '),
        }}
      />
    {/if}
  </div>
</div>
