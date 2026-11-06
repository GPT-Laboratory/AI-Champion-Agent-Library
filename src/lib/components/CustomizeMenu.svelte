<script lang="ts">
  import { tick } from 'svelte'
  import GenerateMcpPanel from './GenerateMcpPanel.svelte'

  // Phase 14: generatorEnabled (fed from the detail load, default off) adds a fourth, enabled item.
  // Phase 15: testerEnabled (fed from the detail load, default off) appends a link to /mcp-test.
  let { generatorEnabled = false, testerEnabled = false }: { generatorEnabled?: boolean; testerEnabled?: boolean } = $props()

  type Item = { id: string; label: string; description: string; action?: 'generate'; href?: string }
  const placeholders: Item[] = [
    { id: 'configure-fields', label: 'Configure fields', description: 'Choose which agent fields to tailor' },
    { id: 'connect-data', label: 'Connect your data', description: 'Connect your own data sources' },
    { id: 'change-model', label: 'Change model', description: 'Pick a different language model' },
  ]
  const generateItem: Item = {
    id: 'generate-mcp',
    label: 'Generate MCP',
    description: 'Generate an MCP server from a schema or spec',
    action: 'generate',
  }
  const testerItem: Item = {
    id: 'mcp-test',
    label: 'Test MCP servers',
    description: 'Score an MCP server with the benchmark cases',
    href: '/mcp-test',
  }
  const items: Item[] = $derived(
    generatorEnabled || testerEnabled
      ? [...placeholders, ...(generatorEnabled ? [generateItem] : []), ...(testerEnabled ? [testerItem] : [])]
      : placeholders
  )

  let panelOpen = $state(false)

  function activate(item: Item) {
    if (item.action === 'generate') {
      closeMenu(false)
      panelOpen = true
      return
    }
    note = `Coming soon: ${item.label} is not available yet.`
  }

  function closePanel() {
    panelOpen = false
    trigger?.focus()
  }

  const uid = $props.id()
  const menuId = `customize-menu-${uid}`

  let open = $state(false)
  let note = $state('')
  let wrapper: HTMLDivElement | undefined = $state()
  let trigger: HTMLButtonElement | undefined = $state()
  let itemEls: (HTMLElement | undefined)[] = $state([])

  function focusItem(i: number) {
    const n = items.length
    itemEls[((i % n) + n) % n]?.focus()
  }

  async function openMenu() {
    open = true
    note = ''
    await tick()
    focusItem(0)
  }

  function closeMenu(returnFocus: boolean) {
    open = false
    note = ''
    if (returnFocus) trigger?.focus()
  }

  function toggle() {
    if (open) closeMenu(false)
    else void openMenu()
  }

  function onMenuKeydown(e: KeyboardEvent) {
    const current = itemEls.findIndex((el) => el === document.activeElement)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusItem(current + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusItem(current <= 0 ? items.length - 1 : current - 1)
        break
      case 'Home':
        e.preventDefault()
        focusItem(0)
        break
      case 'End':
        e.preventDefault()
        focusItem(items.length - 1)
        break
      case 'Escape':
        e.preventDefault()
        closeMenu(true)
        break
      case 'Tab':
        closeMenu(false)
        break
    }
  }

  function onWindowClick(e: MouseEvent) {
    if (open && wrapper && !wrapper.contains(e.target as Node)) closeMenu(false)
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="relative inline-block" bind:this={wrapper}>
  <button
    type="button"
    bind:this={trigger}
    onclick={toggle}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={menuId}
    class="inline-flex min-h-[44px] items-center gap-2 rounded border border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
  >
    Customize
    <span aria-hidden="true">&darr;</span>
  </button>

  {#if open}
    <div class="absolute z-10 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
    <div
      id={menuId}
      role="menu"
      tabindex="-1"
      aria-label="Customization options"
      onkeydown={onMenuKeydown}
    >
      {#each items as item, i (item.id)}
        {#if item.href}
          <a
            role="menuitem"
            href={item.href}
            bind:this={itemEls[i]}
            class="flex w-full flex-col items-start gap-1 rounded px-3 py-2 text-left text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            <span class="text-sm font-medium">{item.label}</span>
            <span class="text-xs text-gray-600">{item.description}</span>
          </a>
        {:else if item.action === 'generate'}
          <button
            type="button"
            role="menuitem"
            bind:this={itemEls[i]}
            onclick={() => activate(item)}
            class="flex w-full flex-col items-start gap-1 rounded px-3 py-2 text-left text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            <span class="text-sm font-medium">{item.label}</span>
            <span class="text-xs text-gray-600">{item.description}</span>
          </button>
        {:else}
        <button
          type="button"
          role="menuitem"
          aria-disabled="true"
          bind:this={itemEls[i]}
          onclick={() => activate(item)}
          class="flex w-full cursor-not-allowed flex-col items-start gap-1 rounded px-3 py-2 text-left text-gray-500 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          <span class="flex w-full items-center justify-between gap-2">
            <span class="text-sm font-medium">{item.label}</span>
            <span class="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </span>
          <span class="text-xs text-gray-500">{item.description}</span>
        </button>
        {/if}
      {/each}
    </div>
    <!-- Outside role="menu": a menu may only contain menu items (axe aria-required-children). -->
    <p role="status" class="px-3 pt-1 text-xs text-gray-600">{note}</p>
    </div>
  {/if}
</div>

{#if generatorEnabled && panelOpen}
  <GenerateMcpPanel onclose={closePanel} />
{/if}
