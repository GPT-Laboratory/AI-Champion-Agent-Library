<script lang="ts">
  import type { ActionData, PageData } from './$types'

  let { data, form }: { data: PageData; form: ActionData } = $props()
  let verification = $derived(form?.step === 'verify')
</script>

<svelte:head>
  <title>Sign in · AIC Agent Library</title>
</svelte:head>

<div class="mx-auto max-w-md py-8 md:py-16">
  <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:p-8">
    <p class="mb-2 text-sm font-medium uppercase tracking-wide text-blue-700">AI Champion consortium</p>
    <h1 class="text-2xl font-semibold text-gray-900">Sign in to Agent Library</h1>
    <p class="mt-3 text-sm leading-6 text-gray-600">
      Access is currently limited to approved consortium email addresses. No password is needed.
    </p>

    {#if form?.error}
      <div id="login-error" class="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
        {form.error}
      </div>
    {/if}

    {#if verification}
      <form method="POST" action="?/verify" class="mt-6 space-y-5">
        <input type="hidden" name="email" value={form.email} />
        <input type="hidden" name="challengeId" value={form.challengeId} />
        <input type="hidden" name="next" value={form.next ?? data.next} />

        {#if form.message}
          <p class="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {form.message}
          </p>
        {/if}

        <div>
          <label for="code" class="block text-sm font-medium text-gray-800">One-time code</label>
          <input
            id="code"
            name="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            required
            aria-describedby={form?.error ? 'login-error' : undefined}
            class="mt-2 block w-full rounded-md border border-gray-500 px-3 py-2 text-lg tracking-[0.3em] shadow-sm focus-visible:border-blue-700 focus-visible:ring-2 focus-visible:ring-blue-700"
          />
          <p class="mt-2 text-xs text-gray-500">Sent to {form.email}. The code expires in 10 minutes.</p>
        </div>

        <button type="submit" class="w-full rounded-md bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800">
          Verify and sign in
        </button>
      </form>

      <form method="POST" action="?/requestCode" class="mt-4 text-center">
        <input type="hidden" name="email" value={form.email} />
        <input type="hidden" name="next" value={form.next ?? data.next} />
        <button type="submit" class="text-sm font-medium text-blue-700 hover:underline">Send a new code</button>
      </form>
    {:else}
      <form method="POST" action="?/requestCode" class="mt-6 space-y-5">
        <input type="hidden" name="next" value={form?.next ?? data.next} />
        <div>
          <label for="email" class="block text-sm font-medium text-gray-800">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autocomplete="email"
            value={form?.email ?? ''}
            required
            aria-describedby={form?.error ? 'login-error' : undefined}
            class="mt-2 block w-full rounded-md border border-gray-500 px-3 py-2 shadow-sm focus-visible:border-blue-700 focus-visible:ring-2 focus-visible:ring-blue-700"
          />
        </div>
        <button type="submit" class="w-full rounded-md bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800">
          Email me a login code
        </button>
      </form>
    {/if}
  </div>
</div>
