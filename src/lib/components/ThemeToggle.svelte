<script lang="ts">
  import { THEMES, themeCookieString, type Theme } from '$lib/theme.js'

  let { theme: initial = 'system' }: { theme?: Theme } = $props()
  // svelte-ignore state_referenced_locally
  let current = $state<Theme>(initial)
  const labels: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' }

  function choose(t: Theme) {
    current = t
    document.documentElement.setAttribute('data-theme', t)
    try {
      document.cookie = themeCookieString(t, location.protocol === 'https:')
    } catch {
      /* cookies blocked: the choice still applies for this page view */
    }
  }
</script>

<div role="group" aria-label="Colour theme" class="inline-flex overflow-hidden rounded border border-gray-500" data-testid="theme-toggle">
  {#each THEMES as t (t)}
    <button
      type="button"
      aria-pressed={current === t}
      onclick={() => choose(t)}
      class="min-h-[44px] min-w-[44px] px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-indigo-600 {current === t
        ? 'bg-indigo-600 text-white'
        : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}"
    >
      {labels[t]}
    </button>
  {/each}
</div>
