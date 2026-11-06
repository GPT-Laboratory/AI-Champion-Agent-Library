---
phase: 11-related-agents-disc-01
plan: 02
subsystem: ui
tags: [related-agents, a11y, detail-page, DISC-01]
requires: [11-01]
provides: [RelatedAgents component, detail load `related`]
key-files:
  created:
    - src/lib/components/RelatedAgents.svelte
    - src/lib/components/RelatedAgents.a11y.test.ts
    - .planning/phases/11-related-agents-disc-01/11-HUMAN-UAT.md
  modified:
    - src/routes/agents/[slug]/+page.server.ts
    - src/routes/agents/[slug]/+page.svelte
    - src/routes/agents/detail.test.ts
    - src/lib/components/a11y.pages.test.ts
decisions: [D-028]
requirements: [DISC-01]
completed: 2026-10-12
---

# Phase 11 Plan 02: Related agents UI Summary

Detail pages show up to 4 related agents (h2, list of card links, axe clean), hidden when none and never breaking the page if related computation fails.

## Accomplishments
- `RelatedAgents.svelte` with component axe tests (1 and 4 agents, unique names, empty renders nothing).
- `load` returns `related` in ranked order via one `inArray` query, self excluded, errors swallowed.
- a11y.pages.test.ts already rendered the detail page, so it now includes related data plus a dedicated axe case with landmarks and heading order.
- Browser check left as pending human (11-HUMAN-UAT.md).

## Deviations from Plan
**[Rule 1 - Bug] Stale detail content when navigating between agents.** `let { agent } = data` captured only the initial data, which related links would expose (SvelteKit reuses the page component). Changed to `$derived(data.agent)`. Logged in D-028. `tryItOutOpen` state still persists across such navigations.

## Self-Check: PASSED
