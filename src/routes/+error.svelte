<script>
  import { page } from '$app/stores'

  // E6 (D-400): friendly, stack-free error page. It renders inside the root layout, so the
  // skip link, landmark and nav are already there. Only the status and the (already sanitised)
  // message are shown; 5xx messages are replaced by fixed copy so internals never reach the page.
  let status = $derived($page.status ?? 500)
  let title = $derived(status === 404 ? 'Page not found' : status >= 500 ? 'Something went wrong' : 'Request problem')
  let message = $derived(
    status >= 500 ? 'An unexpected error occurred. Please try again in a moment.' : ($page.error?.message ?? 'The request could not be completed.')
  )
  // D-462: the short reference from handleError (shown for 5xx only, and only if it has the expected shape).
  let ref = $derived(status >= 500 && /^[0-9a-f]{8}$/.test($page.error?.ref ?? '') ? $page.error?.ref : null)
</script>

<svelte:head>
  <title>{status} {title} | AIC Agent Library</title>
</svelte:head>

<div class="text-center py-16">
  <p class="text-sm font-medium text-gray-700">Error {status}</p>
  <h1 class="mt-1 text-2xl font-semibold text-gray-900">{title}</h1>
  <p class="mt-3 text-sm text-gray-700 break-words">{message}</p>
  {#if ref}
    <p class="mt-2 text-sm text-gray-700">Reference: <code class="font-mono">{ref}</code></p>
  {/if}
  <p class="mt-6">
    <a
      href="/catalog"
      class="inline-flex items-center min-h-[44px] rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
    >
      Back to the catalog
    </a>
  </p>
</div>
