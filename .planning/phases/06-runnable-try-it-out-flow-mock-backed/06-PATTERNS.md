# Phase 6: Runnable Try It Out Flow (mock-backed) - Pattern Map

**Mapped:** 2026-08-19
**Files analyzed:** 3 (1 new module, 1 new component, 1 modified route + its test)
**Analogs found:** 2 / 3 (component has a strong analog; the mock client module has no analog in this codebase)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/lib/tryItOut.ts` | service (mock client) | event-driven / async request-response | *(none in repo)* | no-analog — see "No Analog Found" |
| `src/lib/components/TryItOutPanel.svelte` | component | request-response + streaming UI | `src/lib/components/FilterBar.svelte` (props/state shape) + `src/lib/components/CustomizationPanel.svelte` (container styling) | role-match (styling), no runes-with-effect precedent |
| `src/routes/agents/[slug]/+page.svelte` | route/page (modification) | request-response | itself (Phase 5 version, lines 62-92) | exact — this file already contains the block to replace |
| `src/routes/agents/try-it-out.test.ts` | test | request-response (jsdom render) | itself (Phase 5 version) — extend, don't replace | exact |
| new test for `TryItOutPanel.svelte` / `tryItOut.ts` (implied, not named in CONTEXT) | test | event-driven (timers) | `src/lib/components/CustomizationPanel.test.ts` (component render style) | partial — no fake-timer test precedent exists |

## Pattern Assignments

### `src/lib/tryItOut.ts` (service, event-driven/async)

**No analog exists in this codebase.** There is no `src/lib/*.ts` service module, no existing mock-timer/event-emitter pattern, and no client-side "job" abstraction anywhere in `src/lib` or `src/routes`. The only "service-like" code is `src/lib/spec/oracle-agentspec.ts` (a pure parser, not a stateful async/event service) and `src/lib/server/db.ts` (server-only DB client, wrong side of the client/server boundary and not usable as a pattern for a browser-side mock).

**Do not adapt server or parser code for this file.** Instead build directly from `docs/job-api-contract.md` (already read in full above) — it is the authoritative and only source of truth for:
- Exact exported function signatures (`submitJob`, `subscribeProgress`, `downloadArtifact`)
- Exact types (`JobStatus`, `JobEvent`, `JobUpdate`, `SubmitResult`) — copy verbatim, do not restyle field names
- Mock timing (400ms submit delay, `running` immediately, terminal at ~4s)
- Exact fail-path regex: `/(^|\W)fail(\W|$)/i` tested against `task`
- Exact mock event summary strings: `read data/sample.csv`, `read data/sample.csv (12 lines)`, `count rows in data/sample.csv`, `write output/result.txt`
- `ts` timestamp format: `"10:46:48"`-style (use e.g. `new Date().toLocaleTimeString('en-GB')` or equivalent — pick whichever produces `HH:MM:SS`)

**Style conventions to still borrow from the codebase** (even with no direct analog):
- `src/lib/spec/types.ts` (lines 1-9) shows this repo's convention for typing/comment style on exported interfaces — inline `//` comments next to fields explaining provenance. Mirror this lightly for the copied contract types (e.g. note `// "10:46:48"` next to `ts`, exactly as the contract doc already documents it).
- `src/lib/spec/index.ts` — check for the repo's barrel/export convention before deciding whether `tryItOut.ts` needs re-exporting anywhere (likely not; CONTEXT.md D-02 says only `TryItOutPanel.svelte` imports from it directly, no barrel needed).
- No `try/catch` wrapping convention exists yet for client-side async in this repo (no fetch/service layer exists to date) — since this phase mocks everything with `setTimeout`, no real error paths beyond the deliberate `failed` status exist; keep error surface limited to the `JobUpdate.error` field per contract, not thrown exceptions, so the panel doesn't need `try/catch` around `subscribeProgress`.

### `src/lib/components/TryItOutPanel.svelte` (component, request-response + streaming)

**Analog for props/composition style:** `src/lib/components/FilterBar.svelte` (full file, lines 1-17 shown above)

**Props destructuring pattern to copy** (`FilterBar.svelte` lines 2-14):
```svelte
<script lang="ts">
  interface Props {
    categories: string[]
    llms: string[]
    // ...
    onCategoryChange: (value: string) => void
  }
  let { categories, llms, onCategoryChange }: Props = $props()

  let hasActiveFilters = $derived(selectedCategory !== '' || selectedLlm !== '')
</script>
```
Apply this shape to `TryItOutPanel.svelte`'s own props (per CONTEXT.md D-13, needs an `agentId` prop with an optional default so it works standalone too):
```svelte
interface Props {
  agentId?: string
}
let { agentId = 'demo-agent' }: Props = $props()
```

**No existing `$state`/`$effect` example exists anywhere in the codebase** — all current components (`FilterBar.svelte`, `CustomizationPanel.svelte`, `AgentCard.svelte`, `TechAccordion.svelte`) only use `$props()` and `$derived()`, no local mutable state and no side-effecting runes. `TryItOutPanel.svelte` will be the first component in this repo to use `$state` (for job status/events/error) and `$effect` (for auto-scroll and unsubscribe-on-destroy per D-12). There is no in-repo precedent to copy for these — implement directly from Svelte 5 conventions per RESEARCH.md/D-11, e.g.:
```svelte
let status = $state<JobStatus | 'idle'>('idle')
let events = $state<JobEvent[]>([])
let error = $state<string | null>(null)
let unsubscribe: (() => void) | null = null

$effect(() => {
  return () => unsubscribe?.()
})
```

**Container/card styling to copy verbatim conventions from:** `CustomizationPanel.svelte` (full file, lines 1-19 shown above) — the `<aside class="rounded-xl border border-gray-200 bg-white p-6">` wrapper, `<h2 class="font-semibold text-gray-900 mb-2">` heading style, and `<p class="text-sm text-gray-600 mb-4">` helper-text style are the established "panel card" look. Reuse this shell for the Try It Out panel's outer container, substituting UI-SPEC.md's copy ("Task", "Progress", etc.) and color rules (indigo accent for Run/Download, red for failed block, per 06-UI-SPEC.md Color section).

**Badge/pill styling for reuse where UI-SPEC calls for label-weight text:** `CustomizationPanel.svelte` line 11 badge pattern (`text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded`) — not directly needed per UI-SPEC (no badges in this phase) but same "text-xs font-semibold uppercase tracking-wide" weight is used for the "Progress" section label per UI-SPEC.md line 93.

**Select/onchange handler pattern for the file input:** `FilterBar.svelte` lines 22-32 show the repo's convention for binding a native form control via an inline arrow function reading `e.currentTarget.value` rather than `bind:value`. Follow the same inline-handler style for the task `<textarea>` (`oninput={(e) => task = e.currentTarget.value}`) and file `<input type="file">` (`onchange={(e) => file = e.currentTarget.files?.[0] ?? null}`), consistent with this codebase's preference for explicit handlers over `bind:`.

### `src/routes/agents/[slug]/+page.svelte` (route modification)

**Analog:** itself, current Phase-5 state (full file read above, 92 lines)

**Exact block to replace** (lines 71-79):
```svelte
{:else if agent.tryItOutMode === 'runnable'}
  <button
    type="button"
    disabled
    title="Try it out is not yet available for this agent"
    class="inline-flex items-center gap-2 text-sm font-medium text-gray-400 bg-gray-100 px-3 py-1.5 rounded cursor-not-allowed"
  >
    Try it out
  </button>
{/if}
```
Replace with (per D-14):
```svelte
{:else if agent.tryItOutMode === 'runnable'}
  <TryItOutPanel agentId={agent.slug} />
{/if}
```
Note: the current `runnable` branch lives inline inside the `flex flex-wrap items-center gap-4` row alongside the GitHub link and `external` link (lines 50-81). Since `TryItOutPanel` is a full card/panel (not an inline link/button), the executor should judge whether it needs to move outside that inline flex row into its own block-level section below (UI-SPEC.md doesn't mandate the DOM position, only that `external`/`none` behavior at lines 62-70 and the no-render behavior stay unchanged). Do not touch lines 1-70 or 82-92 (`TechAccordion`, `CustomizationPanel`, imports of those two).

**Import to add** (mirrors existing import style at lines 1-3):
```svelte
import TryItOutPanel from '$lib/components/TryItOutPanel.svelte'
```

### `src/routes/agents/try-it-out.test.ts` (test, extend)

**Analog:** itself, current Phase-5 version (full file read above, 95 lines)

**Pattern to copy for new assertions:** the existing `renderPage(overrides)` helper (lines 28-30) and `baseAgent` fixture (lines 6-26) — extend the `runnable` mode test (lines 56-68) to assert the panel now renders (e.g. a "Run" button and "Task" label) instead of a disabled button, following the same `container.querySelectorAll` + `.filter(...)` idiom used throughout this file (lines 39-41, 50-54, 78-81). Keep `external`/`none`/malformed tests (lines 33-48, 70-94) untouched per D-14/D-15.

**Testing library convention** (line 1-3, repeated in `CustomizationPanel.test.ts` lines 1-4):
```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/svelte'
```
Use this exact header for any new `TryItOutPanel.svelte` test file and for a new `tryItOut.ts` unit test file (the latter does not need `@vitest-environment jsdom` since it's pure logic/timers, not DOM — mirror plain-node vitest style instead, e.g. `src/lib/spec/types.test.ts` if it uses no jsdom pragma; verify before writing).

## Shared Patterns

### Panel/card container shell
**Source:** `src/lib/components/CustomizationPanel.svelte` lines 5-6
**Apply to:** `TryItOutPanel.svelte` outer wrapper
```svelte
<aside class="rounded-xl border border-gray-200 bg-white p-6">
  <h2 class="font-semibold text-gray-900 mb-2">...</h2>
```

### Inline event-handler style over `bind:`
**Source:** `src/lib/components/FilterBar.svelte` lines 22-32, 66-68
**Apply to:** `TryItOutPanel.svelte` textarea, file input, Run/Download buttons
```svelte
onchange={(e) => onCategoryChange(e.currentTarget.value)}
onclick={onClear}
```

### Props-via-interface + `$props()` destructuring
**Source:** `src/lib/components/FilterBar.svelte` lines 2-14
**Apply to:** `TryItOutPanel.svelte`'s `agentId` prop

### Accent/semantic color tokens (indigo primary, red destructive)
**Source:** `06-UI-SPEC.md` Color section (already the authoritative source; `AgentCard.svelte`/`CustomizationPanel.svelte` establish the indigo-600 precedent used site-wide, e.g. `CustomizationPanel.svelte` line 11's `text-indigo-700`/`bg-indigo-50`)
**Apply to:** Run/Download buttons (indigo), failed-state block (red `bg-red-50`/`border-red-200`/`text-red-700`)

### jsdom + testing-library test header
**Source:** `src/routes/agents/try-it-out.test.ts` lines 1-3; `src/lib/components/CustomizationPanel.test.ts` lines 1-4
**Apply to:** any new `TryItOutPanel.svelte` render test

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/lib/tryItOut.ts` | service | event-driven/async | No client-side service, mock-timer, or event-emitter module exists anywhere in the repo. `src/lib/server/db.ts` is server-only and a different concern; `src/lib/spec/oracle-agentspec.ts` is a synchronous parser, not a stateful async mock. Build directly from `docs/job-api-contract.md` (types, signatures, and mock behavior are fully specified there — no interpretation needed). |
| `TryItOutPanel.svelte`'s `$state`/`$effect` runes usage | component (stateful) | streaming | No component in the repo currently uses `$state` or `$effect` — all existing components are stateless (`$props()`/`$derived()` only). No in-repo precedent for auto-scroll-on-update or unsubscribe-on-destroy effects; implement from Svelte 5 rune semantics directly, informed by RESEARCH.md if it contains code examples. |
| Fake-timer test for `subscribeProgress` | test | event-driven | No existing test in this repo exercises `setTimeout`/`setInterval`-driven async state (`vi.useFakeTimers()` pattern absent). All current tests are synchronous render assertions. Executor should introduce this pattern fresh, following vitest's standard `vi.useFakeTimers()`/`vi.advanceTimersByTime()` API. |

## Metadata

**Analog search scope:** `src/lib/**`, `src/routes/**` (full repo component/service/test surface)
**Files scanned:** `CustomizationPanel.svelte`, `CustomizationPanel.test.ts`, `FilterBar.svelte`, `AgentCard.svelte` (listed, not fully read — same style family as FilterBar/CustomizationPanel), `TechAccordion.svelte` (listed only), `src/routes/agents/[slug]/+page.svelte`, `src/routes/agents/try-it-out.test.ts`, `src/lib/spec/types.ts`, `src/lib/server/db.ts` (listed only), `src/lib/spec/oracle-agentspec.ts` (listed only)
**Pattern extraction date:** 2026-08-19
