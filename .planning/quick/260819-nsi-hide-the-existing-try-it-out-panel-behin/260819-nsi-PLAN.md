---
phase: quick-260819-nsi
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/routes/agents/try-it-out.test.ts
  - src/routes/agents/[slug]/+page.svelte
autonomous: true
requirements:
  - QTIO-01  # Panel hidden on initial render
  - QTIO-02  # "Try it out" control with down arrow shown for runnable agents
  - QTIO-03  # Click reveals the existing panel inline, below the control
  - QTIO-04  # TryItOutPanel.svelte and tryItOut.ts unchanged

must_haves:
  truths:
    - "On a runnable agent detail page, the Try It Out form (task textarea, Run button, 'Try it out' h2) is NOT in the DOM on first render"
    - "A single enabled 'Try it out' button with a down arrow (↓) is visible for runnable agents"
    - "Clicking that button reveals the existing TryItOutPanel inline, directly below the button, on the same page"
    - "Clicking again collapses it back to hidden"
    - "external / none / null / malformed try-it-out modes render exactly as before (no toggle button, no panel)"
    - "src/lib/components/TryItOutPanel.svelte and src/lib/tryItOut.ts are byte-identical to HEAD"
  artifacts:
    - path: "src/routes/agents/[slug]/+page.svelte"
      provides: "Disclosure toggle ($state boolean) wrapping the runnable-mode TryItOutPanel render"
      contains: "aria-expanded"
    - path: "src/routes/agents/try-it-out.test.ts"
      provides: "Updated runnable-mode assertions: hidden-by-default, reveal-on-click, collapse-on-second-click"
      contains: "fireEvent.click"
  key_links:
    - from: "src/routes/agents/[slug]/+page.svelte toggle button onclick"
      to: "local $state boolean guarding {#if} around <TryItOutPanel />"
      via: "Svelte 5 runes reactivity"
      pattern: "\\$state\\(false\\)"
---

<objective>
Hide the existing Try It Out panel behind a collapsible "Try it out" disclosure control on the runnable agent detail page. The panel is absent on initial render; clicking the control mounts it inline directly below the control.

Purpose: The runnable panel currently dominates the top of the detail page for runnable agents, pushing the executive summary and technical spec down. A disclosure control keeps the page scannable (DETL-01 intent) while leaving the panel one click away.

Output: Modified `src/routes/agents/[slug]/+page.svelte` (toggle + conditional mount) and updated `src/routes/agents/try-it-out.test.ts` (runnable-mode assertions).

HARD CONSTRAINT: `src/lib/components/TryItOutPanel.svelte` and `src/lib/tryItOut.ts` MUST NOT be modified. All visibility logic lives in `+page.svelte`.
</objective>

<execution_context>
@/home/jhr/Projects/2026_AIC_Agent_Library/.claude/get-shit-done/workflows/execute-plan.md
@/home/jhr/Projects/2026_AIC_Agent_Library/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/routes/agents/[slug]/+page.svelte
@src/routes/agents/try-it-out.test.ts
@src/lib/components/TechAccordion.svelte
@.planning/phases/06-runnable-try-it-out-flow-mock-backed/06-UI-SPEC.md
</context>

<interfaces>
<!-- Extracted from the codebase. Use these directly — no exploration needed. -->

**Current runnable branch in `src/routes/agents/[slug]/+page.svelte` (lines 75-79) — the ONLY block to change:**
```svelte
{#if agent.tryItOutMode === 'runnable'}
  <div class="mt-6">
    <TryItOutPanel agentId={agent.slug} />
  </div>
{/if}
```
It sits at the end of the `<section>` in the left column, after the `flex flex-wrap items-center gap-4` link row (GitHub link + external-mode "Try it out &rarr;" link) and before `<TechAccordion {agent} />`.

**`TryItOutPanel.svelte` markup contract (READ-ONLY — do not modify):**
- Props: `agentId: string`
- `<h2 class="font-semibold text-gray-900 mb-2">Try it out</h2>`
- `<textarea id="tryitout-task">`, `<input id="tryitout-file">`
- Primary button text: `Run` (or `Running…` when in flight)
- **No `onMount` and no `$effect`** — mounting it is completely side-effect free, so a plain `{#if}` conditional mount starts no timers and calls no `tryItOut.ts` function until the user clicks Run.

**Codebase arrow convention (`+page.svelte`):** HTML entities only, no SVG and no icon library — `&larr; Back to catalog`, `View on GitHub &rarr;`, `Try it out &rarr;`. Per 06-UI-SPEC.md: "Icon library: none — codebase uses text/unicode arrows". Therefore the disclosure arrow is `&darr;` (down), rotated 180° via a Tailwind `rotate-180` class when expanded.

**Existing collapsible pattern (`TechAccordion.svelte`):** native `<details>/<summary>`. Do NOT reuse `<details>` here — its native marker cannot be replaced with the codebase's entity-arrow convention without extra CSS, and criterion QTIO-02 requires an explicit down arrow. Use a `<button>` + `$state` boolean instead (matches the project's Svelte 5 runes style, e.g. `let { agent } = data` / `$props()`).

**Accent/focus convention (`+page.svelte` link row + 06-UI-SPEC.md Color section):**
`text-sm font-medium text-indigo-600 hover:underline`, focus ring `focus-visible:ring-2 focus-visible:ring-indigo-600`.

**Test conventions:** `// @vitest-environment jsdom` header, `render` from `@testing-library/svelte`, `fireEvent` from `@testing-library/svelte`, `tick` from `svelte` (see `src/lib/components/TryItOutPanel.test.ts`). `renderPage(overrides)` helper already exists in `try-it-out.test.ts`. Test command: `npm test` (vitest run).
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Rewrite runnable-mode tests for hidden-by-default + reveal-on-click (RED)</name>
  <files>src/routes/agents/try-it-out.test.ts</files>
  <behavior>
Replace the single existing test `'runnable mode renders the TryItOutPanel and no disabled placeholder button'` with the following tests. Keep the file's existing `baseAgent`, `renderPage`, and `tryItOutElements` helpers as-is.

Add to the imports: `fireEvent` from `@testing-library/svelte` and `tick` from `svelte`.

- Test A — `'runnable mode hides the TryItOutPanel on initial render'`: render with `{ tryItOutMode: 'runnable' }`. Assert the panel is absent:
  - `container.querySelectorAll('h2')` filtered by `/try it out/i` → length `0`
  - `container.querySelector('#tryitout-task')` → `toBeNull()`
  - no `<button>` whose trimmed textContent is exactly `'Run'`
- Test B — `'runnable mode renders an enabled "Try it out" toggle with a down arrow'`: render runnable. Assert:
  - exactly ONE `<button>` whose textContent matches `/try it out/i`
  - that button's `textContent` contains `'↓'` (the `&darr;` entity resolves to this character in the DOM)
  - `button.getAttribute('aria-expanded')` → `'false'`
  - `button.disabled` → `false` (guards against reintroducing Phase 5's disabled placeholder)
- Test C — `'clicking the toggle reveals the existing TryItOutPanel inline below the control'`: render runnable, grab the toggle button, `await fireEvent.click(toggle)`, `await tick()`. Assert:
  - `h2` filtered by `/try it out/i` → length `1`
  - `container.querySelector('#tryitout-task')` → not null
  - a `<button>` with trimmed text `'Run'` exists
  - `toggle.getAttribute('aria-expanded')` → `'true'`
  - the panel renders AFTER the toggle in document order: `toggle.compareDocumentPosition(panelHeading) & Node.DOCUMENT_POSITION_FOLLOWING` is truthy
- Test D — `'clicking the toggle a second time collapses the panel again'`: click, tick, click, tick → `container.querySelector('#tryitout-task')` is `null` and `aria-expanded` is `'false'`.

Do NOT touch the four existing tests for external / none / null / malformed modes — they must keep passing unchanged (`tryItOutElements` must still be length 0 for none/null/malformed, which holds because the toggle only renders for `tryItOutMode === 'runnable'`).
  </behavior>
  <action>
Edit `src/routes/agents/try-it-out.test.ts` only. Delete the old runnable test body and write Tests A-D per the `<behavior>` block above. Add a small local helper inside the describe block for reuse, e.g.:

```ts
function tryItOutToggle(container: HTMLElement) {
  return Array.from(container.querySelectorAll('button')).filter((b) =>
    /try it out/i.test(b.textContent ?? '')
  )
}
```

Then run `npm test` and confirm the new runnable tests FAIL (the current `+page.svelte` mounts the panel unconditionally, so Test A fails on the h2/`#tryitout-task` assertions and Test B fails because no toggle button exists). Confirm the other four try-it-out tests and the rest of the suite still pass.

Known pre-existing state: `scripts/ingest.test.ts` was logged in Phase 05 as a deferred regression. If it is still red before your change, note it in the SUMMARY and do NOT attempt to fix it — it is out of scope.

Commit as `test(quick-nsi): add failing tests for collapsible try-it-out disclosure`.
  </action>
  <verify>
    <automated>npm test -- src/routes/agents/try-it-out.test.ts 2>&1 | tail -30  # runnable tests A-D FAIL; external/none/null/malformed PASS</automated>
  </verify>
  <done>New runnable-mode tests A-D exist and fail for the right reason (panel present when it should be absent / no toggle button found). The four other-mode tests still pass. Nothing outside `try-it-out.test.ts` changed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add the disclosure toggle in +page.svelte (GREEN)</name>
  <files>src/routes/agents/[slug]/+page.svelte</files>
  <behavior>
All tests in `src/routes/agents/try-it-out.test.ts` pass, including the four untouched other-mode tests. Full `npm test` shows no new failures versus the pre-change baseline.
  </behavior>
  <action>
In `src/routes/agents/[slug]/+page.svelte`:

1. In the `<script lang="ts">` block, after `let { agent } = data`, add:
```ts
let tryItOutOpen = $state(false)
```

2. Replace the runnable branch (currently lines 75-79) with:
```svelte
{#if agent.tryItOutMode === 'runnable'}
  <div class="mt-6">
    <button
      type="button"
      onclick={() => (tryItOutOpen = !tryItOutOpen)}
      aria-expanded={tryItOutOpen}
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
      <div class="mt-4">
        <TryItOutPanel agentId={agent.slug} />
      </div>
    {/if}
  </div>
{/if}
```

Notes and rationale:
- Use `{#if tryItOutOpen}` (conditional mount), NOT a `hidden` attribute or CSS `display:none`. Criterion QTIO-01 requires the panel to be absent from the DOM on initial render, and Task 1's Test A asserts `#tryitout-task` is null. Conditional mounting is safe because `TryItOutPanel.svelte` has no `onMount`/`$effect`.
- The arrow glyph in markup is always `&darr;` (down) per QTIO-02; the `rotate-180` class flips it visually while expanded. This mirrors the codebase's entity-arrow convention (`&larr;`/`&rarr;`) rather than introducing an SVG or icon library (forbidden by 06-UI-SPEC.md "Icon library: none").
- No `aria-controls` — the controlled element is unmounted while collapsed, so a dangling IDREF is avoided; `aria-expanded` on the button is sufficient for the disclosure pattern.
- `text-indigo-600` reuses the established accent for the one interactive affordance here, matching the sibling "Try it out &rarr;" external link and 06-UI-SPEC.md's accent list.
- Do NOT touch `src/lib/components/TryItOutPanel.svelte` or `src/lib/tryItOut.ts`, and do NOT change the external / none / malformed branches.

3. Run `npm test` — all `try-it-out.test.ts` tests must pass, and `TryItOutPanel.test.ts` (which renders the panel directly) must be unaffected.

4. Prove the hard constraint holds:
```bash
git diff --name-only HEAD -- src/lib/components/TryItOutPanel.svelte src/lib/tryItOut.ts   # must print nothing
```

Commit as `feat(quick-nsi): hide try-it-out panel behind collapsible arrow control`.
  </action>
  <verify>
    <automated>npm test -- src/routes/agents/try-it-out.test.ts src/lib/components/TryItOutPanel.test.ts && test -z "$(git diff --name-only HEAD -- src/lib/components/TryItOutPanel.svelte src/lib/tryItOut.ts)" && echo CONSTRAINT_OK</automated>
  </verify>
  <done>All 8 try-it-out route tests pass, `TryItOutPanel.test.ts` still passes, `CONSTRAINT_OK` prints (panel component and `tryItOut.ts` untouched), and full `npm test` shows no new failures beyond the pre-existing deferred `scripts/ingest.test.ts` state.</done>
</task>

</tasks>

<verification>
1. `npm test` — no new failures versus the pre-change baseline (pre-existing `scripts/ingest.test.ts` deferred regression excluded).
2. `git diff --name-only HEAD` lists exactly two files: `src/routes/agents/[slug]/+page.svelte` and `src/routes/agents/try-it-out.test.ts`.
3. `grep -c "TryItOutPanel" src/routes/agents/\[slug\]/+page.svelte` — still imported and rendered once, now inside the nested `{#if tryItOutOpen}`.
4. `grep -n "darr\|rotate-180\|aria-expanded\|\$state(false)" src/routes/agents/\[slug\]/+page.svelte` — all four present.
5. No SVG, no new dependency, no new component file introduced.
</verification>

<success_criteria>
- QTIO-01: The Try It Out panel is hidden (absent from the DOM) on initial render of a runnable agent detail page.
- QTIO-02: A single enabled "Try it out" button with a down arrow (`&darr;` → ↓) renders for runnable agents, with `aria-expanded="false"` while collapsed.
- QTIO-03: Clicking the control reveals the existing panel inline on the same page, in document order after the control; clicking again collapses it.
- QTIO-04: `src/lib/components/TryItOutPanel.svelte` and `src/lib/tryItOut.ts` are unchanged (verified by `git diff --name-only`).
- external / none / null / malformed mode test coverage is unchanged and still green.
</success_criteria>

<output>
After completion, create `.planning/quick/260819-nsi-hide-the-existing-try-it-out-panel-behin/260819-nsi-SUMMARY.md`
</output>
