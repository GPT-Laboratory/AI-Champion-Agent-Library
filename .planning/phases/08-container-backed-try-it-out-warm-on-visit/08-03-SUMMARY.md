---
phase: 08-container-backed-try-it-out-warm-on-visit
plan: 03
subsystem: api
tags: [llm-proxy, sse, auth, budget, vitest]

requires:
  - phase: 08-container-backed-try-it-out-warm-on-visit
    provides: container runtime layer (plan 01)
provides:
  - Per-lease bearer-token LLM proxy (llmProxy.ts) with per-job token/request budget
  - POST /api/llm/v1/chat/completions route injecting the real key server-side and streaming SSE through
  - /api/llm/ prefix exempt from the user-auth hook
affects: [08-05, 08-06]

tech-stack:
  added: []
  patterns:
    - "Key passed as parameter, read at request time in the route only"
    - "tee() the upstream SSE body: one branch to client, one to a usage meter"

key-files:
  created:
    - src/lib/server/tryitout/llmProxy.ts
    - src/lib/server/tryitout/llmProxy.test.ts
    - src/routes/api/llm/v1/chat/completions/+server.ts
    - src/routes/api/llm/v1/chat/completions/proxy.test.ts
    - src/hooks.server.test.ts
  modified:
    - src/hooks.server.ts

key-decisions:
  - "Budget enforcement was implemented together with the tracer in llmProxy.ts; Task 2 added the test coverage"
  - "Active job usage object is also registered in the finished map at beginJob so getJobUsage(jobId) works throughout"

requirements-completed: [D-17, D-19, D-22]

duration: 6 min
completed: 2026-10-08
---

# Phase 8 Plan 03: LLM proxy Summary

Token-authenticated Chat Completions proxy that injects the real OpenAI key server-side, forces model gpt-4.1-mini, whitelists the request body, enforces per-job budgets, and streams SSE back byte-identical.

## Tasks

1. Tracer: proxy + route + streaming test - 9fddb6e
2. Budget, revocation, body cap, whitelist tests - 5831a70
3. hooks.server.ts public prefix `/api/llm/` + tests - 2da16dd

## Deviations from Plan

Minor: budget logic landed in the Task 1 commit (written in one pass); Task 2 commit contains its tests only. No functional deviation.

## Verification

llmProxy.test.ts, proxy.test.ts, hooks.server.test.ts: 20 tests pass. Acceptance greps pass (timingSafeEqual present, no Math.random, no OPENAI_API_KEY in llmProxy.ts, no sensitive console logging).

## Next

Ready for 08-04 / later plans (05 wires tokens to leases; 06 calls beginJob/endJob).

## Self-Check: PASSED
