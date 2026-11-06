---
phase: 08-container-backed-try-it-out-warm-on-visit
plan: 05
subsystem: try-it-out-containers
tags: [lease-manager, containers, session, warm-staging, llm-proxy-tokens]
requires: [08-01, 08-02, 08-03]
provides:
  - createLeaseManager (per-session lease state machine, cap, eviction, reaper, orphan sweep)
  - createTryItOutService / getTryItOutService / startTryItOutService / warmForSession
  - sessionKey + TRYOUT_SESSION_COOKIE
affects: [08-06, 08-07]
tech-stack:
  added: []
  patterns: [synchronous CAS state transitions, globalThis HMR-safe singleton]
key-files:
  created:
    - src/lib/server/tryitout/leaseManager.ts
    - src/lib/server/tryitout/leaseManager.test.ts
    - src/lib/server/tryitout/service.ts
    - src/lib/server/tryitout/service.test.ts
    - src/lib/server/tryitout/session.ts
    - src/lib/server/tryitout/session.test.ts
  modified: []
key-decisions:
  - "Lease put in the map before its first await; all state checks and sets are synchronous so claim and eviction cannot both win"
  - "Container env holds only AIC_LLM_TOKEN; labels never carry the session key"
  - "Staging verified with exec test -f models.json; failure names PI_RUNNER_FS_MODE=layer"
requirements-completed: [D-02, D-06, D-07, D-08, D-09, D-10, D-17, D-18]
duration: ~20 min
completed: 2026-10-08
---

# Phase 8 Plan 05: Lease manager, service and session identity Summary

Per-session warm container leases with cap/eviction/busy/TTL/orphan handling, Pi config and skill staging with a per-lease proxy token, and a shared session identity, all verified on the fake runtime.

## Accomplishments
- leaseManager.ts: warming -> idle -> claimed -> running -> idle, evicting/expired; reload reuse, different-agent replacement, oldest-idle eviction honoring min idle age, busy, reaper (unref-ed 30 s interval), orphan sweep, shutdown.
- service.ts: renderModelsJson/buildWarmFiles (AgentIdSchema-validated slug), warm staging via loadPiSkill, globalThis singleton, startTryItOutService (ping, network, sweep, reaper, process.once signal cleanup), non-rejecting warmForSession.
- session.ts: `user:<email>` or `anon:<id>` from httpOnly aic_tryout_sid cookie (22-char base64url, validated, 24 h).
- Tests: 17 lease-manager, 9 service, 5 session; full tryitout directory 153 tests pass.

## Task Commits
1. Task 1 (tracer): 562971e
2. Task 2: 2139402
3. Task 3: ba43966

## Deviations from Plan

### Auto-fixed Issues
**1. [Rule 1 - Bug] TS narrowing error after await in claim**
- Found during: Task 2 tsc check
- Fix: read `lease.state` into a widened local after `awaitReady`
- Commit: 2139402

Service start-up tests were written alongside the Task 1 service tests and therefore landed in the Task 1 commit (562971e); session.ts was already exercised by that point. No behavioral deviation.

## Self-Check: PASSED
Files exist, commits 562971e/2139402/ba43966 present, `npx vitest run src/lib/server/tryitout` passes, tsc clean on touched files, acceptance greps pass (no OPENAI_API_KEY, openai-completions, globalThis, unref, aic_tryout_sid, process.once).
