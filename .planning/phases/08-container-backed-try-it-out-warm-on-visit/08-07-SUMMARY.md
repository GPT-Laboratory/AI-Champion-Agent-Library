---
phase: 08-container-backed-try-it-out-warm-on-visit
plan: 07
subsystem: tryitout
tags: [sveltekit, warm-on-visit, init-hook, session]
requires: [08-03, 08-05]
provides:
  - warm trigger in agent page load for tryItOutMode 'runnable'
  - init (ServerInit) hook starting the Try It Out service
affects: [src/routes/agents/[slug]/+page.server.ts, src/hooks.server.ts]
key-files:
  created: [src/routes/agents/warm.test.ts]
  modified:
    - src/routes/agents/[slug]/+page.server.ts
    - src/routes/agents/detail.test.ts
    - src/hooks.server.ts
    - src/hooks.server.test.ts
key-decisions:
  - "Warm is fire-and-forget (void warmForSession(...).catch) so engine latency never blocks render"
  - "hooks test uses a plain (non-spy) throwing mock because vitest 4 reported a deliberately thrown vi.fn as a test error"
requirements-completed: [D-05, D-06, D-10]
duration: 6 min
completed: 2026-10-08
---

# Phase 8 Plan 07: Warm on Visit Summary

Opening a runnable agent page warms the visitor's container in the background, keyed by the same session identity the job POST uses, and the service (orphan sweep, reaper) starts via the SvelteKit init hook.

## Accomplishments
- +page.server.ts calls `void warmForSession(sessionKey({ locals, cookies, url }), slug)` only for `tryItOutMode === 'runnable'`; return shape unchanged; mints aic_tryout_sid when auth is off; reload reuses the lease.
- `export const init: ServerInit` calls `startTryItOutService()` inside try/catch (console.warn on failure); importing hooks does not touch the engine.
- Tests: warm.test.ts (never-resolving warm does not block, user vs anon keys, none/external skip, reload same key, rejection tolerated); detail.test.ts mocks the service; hooks.server.test.ts init cases.

## Commits
- 5e13f40 test(08-07): failing tests (RED)
- 94299ff feat(08-07): warm on page open (GREEN)
- 581489e feat(08-07): init hook

## Deviations from Plan

**[Rule 3 - Blocker] Test mock style in hooks.server.test.ts** - a `vi.fn` configured to throw was reported as a failing test by vitest 4 even though init caught it; replaced with a plain function mock. Test-only; no production impact.

**Total deviations:** 1 (test tooling). Impact: none.

## Verification
- warm, detail, hooks tests pass; `npm test`: only the 3 known pre-existing failures in scripts/set-try-it-out-mode.test.ts. No tsc errors in touched files. Acceptance greps: `await warmForSession` 0, `void warmForSession` 1, `tryItOutMode === 'runnable'` 1, `export const init` 1.

## Next
Ready for next plan in phase 08.

## Self-Check: PASSED
