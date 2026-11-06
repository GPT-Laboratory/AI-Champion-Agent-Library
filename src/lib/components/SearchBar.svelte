<script lang="ts">
  interface Props {
    value?: string
    onsearch: (q: string) => void
    count?: number | null
    /** Extra text for the persistent live region (for example the degraded-search notice). */
    message?: string
    delay?: number
  }
  let { value = '', onsearch, count = null, message = '', delay = 200 }: Props = $props()

  // Initialised once on purpose: the input owns its text while typing.
  // svelte-ignore state_referenced_locally
  let text = $state(value)
  let timer: ReturnType<typeof setTimeout> | undefined
  let inputEl: HTMLInputElement | undefined = $state()

  function schedule(next: string) {
    text = next
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      onsearch(next.trim())
    }, delay)
  }

  function clear() {
    clearTimeout(timer)
    timer = undefined
    text = ''
    onsearch('')
    // The Clear button unmounts with the text, so hand focus back to the input.
    inputEl?.focus()
  }

  $effect(() => {
    return () => clearTimeout(timer)
  })

  let announcement = $derived(
    [
      count === null || count === undefined ? '' : `${count} ${count === 1 ? 'agent' : 'agents'} found`,
      message
    ]
      .filter(Boolean)
      .join('. ')
  )
</script>

<div role="search" class="mb-4">
  <label for="agent-search" class="sr-only">Search agents</label>
  <div class="flex items-center gap-2">
    <input
      id="agent-search"
      bind:this={inputEl}
      type="search"
      value={text}
      oninput={(e) => schedule((e.currentTarget as HTMLInputElement).value)}
      placeholder="Search agents"
      autocomplete="off"
      maxlength="200"
      class="min-h-[44px] w-full rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:ring-2 focus-visible:ring-indigo-600"
    />
    {#if text}
      <button
        type="button"
        onclick={clear}
        class="px-3 py-2 rounded border border-gray-500 text-sm min-h-[44px] hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-indigo-600"
      >
        Clear search
      </button>
    {/if}
  </div>
  <p class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
</div>
