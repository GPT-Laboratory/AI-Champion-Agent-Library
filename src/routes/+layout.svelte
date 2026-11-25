<script>
  import '../app.css'
  import ThemeToggle from '$lib/components/ThemeToggle.svelte'
  let { children, data } = $props()
  // The release tag (vite.config.ts / deploy.sh); empty in tests and builds without tags.
  const appVersion = import.meta.env.VITE_APP_VERSION
</script>

<div class="min-h-screen bg-white">
  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
  >
    Skip to main content
  </a>
  <header class="bg-gray-100 border-b border-gray-200">
    <nav aria-label="Primary" class="max-w-6xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
      <div class="flex items-baseline gap-2">
        <a href="/catalog" class="text-lg font-semibold text-gray-900">AIC Agent Library</a>
        {#if appVersion}
          <span class="text-xs text-gray-600" data-testid="app-version">{appVersion}</span>
        {/if}
      </div>
      <div class="flex items-center gap-4">
        <a href="/pipelines" class="text-sm font-medium text-gray-900 underline">Pipelines</a>
        {#if data.compareEnabled}
          <a href="/compare" class="text-sm font-medium text-gray-900 underline">Compare agents</a>
        {/if}
        {#if data.themeEnabled}
          <ThemeToggle theme={data.theme} />
        {/if}
        {#if data.user}
          <span class="hidden text-sm text-gray-600 sm:inline">{data.user.email}</span>
          <form method="POST" action="/logout">
            <button type="submit" class="text-sm font-medium text-blue-700 hover:underline">Sign out</button>
          </form>
        {/if}
      </div>
    </nav>
  </header>
  <main id="main-content" tabindex="-1" class="max-w-6xl mx-auto px-4 md:px-6 py-8 focus:outline-none">
    {@render children()}
  </main>
</div>
