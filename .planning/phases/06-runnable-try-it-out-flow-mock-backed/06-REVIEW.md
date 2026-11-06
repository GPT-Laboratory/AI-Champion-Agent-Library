---
phase: 06-runnable-try-it-out-flow-mock-backed
reviewed: 2026-08-19T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/lib/tryItOut.ts
  - src/lib/tryItOut.test.ts
  - src/lib/components/TryItOutPanel.svelte
  - src/lib/components/TryItOutPanel.test.ts
  - src/routes/agents/[slug]/+page.svelte
  - src/routes/agents/try-it-out.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-08-19T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the mock-backed "Try it out" flow: the client API module (`tryItOut.ts`), the
Svelte panel that drives it, their tests, and the detail-page wiring. The mock
implementation itself is careful and well-isolated (regex matches the contract exactly,
timers are tracked and cleared, object URLs are revoked, filenames are sanitized, no
`{@html}` anywhere). No critical/security-blocking defects were found in the mock's own
logic.

Two real gaps exist in `TryItOutPanel.svelte`'s `run()` function that the current test
suite does not exercise: (1) a narrow but real race where destroying the component
during the ~400ms `submitJob` delay leaves the subsequent `subscribeProgress` call
un-cancelled, contradicting the panel's own stated "never leave a mock timer running
after unmount" invariant; and (2) no error handling around `await submitJob(...)`, which
today is masked by the mock never rejecting but will strand the UI in a disabled
"Running…" state forever the moment the real backend (which the header comment says will
be swapped in without touching this component) returns a rejected promise. There is also
an unvalidated `href` scheme on the new `tryItOutUrl` external link. None of these are
exercised by the otherwise-thorough test suite, which is why they weren't caught.

## Warnings

### WR-01: Component destroy during the submit delay does not cancel the pending subscription

**File:** `src/lib/components/TryItOutPanel.svelte:22-54`
**Issue:** `run()` awaits `submitJob(...)` (mock delay ~400ms) before calling
`subscribeProgress(...)` and assigning the result to `unsubscribe`. The destroy cleanup
effect (lines 51-54) only calls `unsubscribe?.()` — if the component is unmounted while
`submitJob` is still pending, `unsubscribe` is still `null` at that moment, so the
cleanup is a no-op. When `submitJob` resolves after unmount, `subscribeProgress` still
runs, scheduling real `setTimeout`s that fire for up to 4s after the component is gone,
calling back into `onUpdate` to mutate `status`/`events`/`error`/`jobId` state on a
destroyed instance. This directly contradicts the invariant documented at lines 50-54
("never leave a mock timer running after unmount (D-12, threat T2)"), and is not covered
by `TryItOutPanel.test.ts` T2.17 (which unmounts at the 1000ms mark, i.e. after the
400ms submit delay has already resolved and `unsubscribe` is already assigned).
**Fix:**
```ts
let destroyed = false

async function run() {
  unsubscribe?.()
  unsubscribe = null
  events = []
  error = null
  jobId = null
  status = 'queued'

  const result = await submitJob(agentId, task, file)
  if (destroyed) return // component was unmounted mid-submit — don't start a subscription

  jobId = result.jobId
  unsubscribe = subscribeProgress(result.jobId, (u) => {
    status = u.status
    events = u.events
    error = u.error
    if (u.status === 'succeeded' || u.status === 'failed') {
      unsubscribe?.()
      unsubscribe = null
    }
  })
}

$effect(() => () => {
  destroyed = true
  unsubscribe?.()
  unsubscribe = null
})
```

### WR-02: No error handling around `submitJob()` — a rejection strands the UI permanently

**File:** `src/lib/components/TryItOutPanel.svelte:22-42`
**Issue:** `run()` does `const result = await submitJob(agentId, task, file)` with no
try/catch. `status` is set to `'queued'` synchronously before the await, which disables
the Run button (`disabled={inFlight || ...}`) and shows "Running…". If `submitJob`
throws or rejects — which the mock never does today, but which the file's own header
comment says a real backend swap will not require touching this component to handle —
the promise rejection is unhandled (surfaces as a console error / unhandled rejection),
`status` is never reset, and the Run button stays disabled forever with no way for the
user to retry short of a full page reload.
**Fix:**
```ts
async function run() {
  unsubscribe?.()
  unsubscribe = null
  events = []
  error = null
  jobId = null
  status = 'queued'

  try {
    const result = await submitJob(agentId, task, file)
    jobId = result.jobId
    unsubscribe = subscribeProgress(result.jobId, (u) => { /* ... */ })
  } catch (err) {
    status = 'failed'
    error = err instanceof Error ? err.message : 'Failed to submit job'
  }
}
```

### WR-03: `tryItOutUrl` is used as a raw `href` with no scheme validation

**File:** `src/routes/agents/[slug]/+page.svelte:63-72`
**Issue:** The external "Try it out" link renders `href={agent.tryItOutUrl}` directly
whenever `tryItOutMode === 'external' && agent.tryItOutUrl` is truthy, with no check
that the value is an `http(s)` URL. `rel="noopener noreferrer"` protects against
reverse-tabnabbing but does nothing to stop a `javascript:`-scheme value from executing
when the link is clicked. Since `tryItOutUrl` is agent metadata sourced from an ingest
pipeline (per `specId`/`lastIngestedAt` fields on the same object), a malformed or
malicious spec entry could smuggle a `javascript:` URI into a rendered link on a
production page.
**Fix:**
```ts
function isSafeExternalUrl(u: string | null | undefined): u is string {
  if (!u) return false
  try {
    return ['http:', 'https:'].includes(new URL(u).protocol)
  } catch {
    return false
  }
}
```
```svelte
{#if agent.tryItOutMode === 'external' && isSafeExternalUrl(agent.tryItOutUrl)}
  <a href={agent.tryItOutUrl} target="_blank" rel="noopener noreferrer">Try it out &rarr;</a>
{/if}
```

## Info

### IN-01: Task text sent to `submitJob` is not trimmed

**File:** `src/lib/components/TryItOutPanel.svelte:30,80`
**Issue:** The Run button's enabled state is computed from `task.trim() === ''` (line
80), but the raw, untrimmed `task` value is what's actually passed to `submitJob(agentId,
task, file)` (line 30). A task consisting of meaningful text with leading/trailing
whitespace (or a task that is just internal whitespace padding around real content) is
sent verbatim, which is a minor inconsistency between the validation check and the
submitted value.
**Fix:** Submit the trimmed value: `await submitJob(agentId, task.trim(), file)`.

### IN-02: Progress feed has no `aria-live` region

**File:** `src/lib/components/TryItOutPanel.svelte:88-98`
**Issue:** The "Progress" feed updates dynamically as job events stream in, but the
container has no `aria-live` attribute, so screen-reader users get no announcement of
new lines or the terminal success/failure state.
**Fix:** Add `aria-live="polite"` (or `aria-live="polite" aria-atomic="false"`) to the
feed `<div>` at line 89-92.

### IN-03: `downloadArtifact()` click handler has no rejection handling

**File:** `src/lib/components/TryItOutPanel.svelte:104`
**Issue:** `onclick={() => downloadArtifact(jobId!)}` calls an async function without
awaiting or catching it. `downloadArtifact` currently only rejects for an unknown
`jobId`, which cannot occur here since the button only renders once a real `jobId` has
succeeded, but it's a latent unhandled-rejection footgun if `downloadArtifact`'s
contract ever changes (e.g. a real backend returning a 404/expired artifact).
**Fix:**
```ts
async function download() {
  try {
    await downloadArtifact(jobId!)
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to download artifact'
  }
}
```
and bind `onclick={download}`.

---

_Reviewed: 2026-08-19T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
