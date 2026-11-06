---
phase: 09-try-it-out-hardening
plan: 02
subsystem: tryitout
tags: [chaos-tests, lease, reaper, hung-engine, fake-runtime]
requires: [09-01]
provides: [chaos.lease.test.ts, chaos.engine.test.ts, chaos.reaper.test.ts, FakeRuntime.hang()]
affects: [leaseManager.ts, piRunner.ts, runtimeFake.ts]
key-files:
  created:
    - src/lib/server/tryitout/chaos.lease.test.ts
    - src/lib/server/tryitout/chaos.engine.test.ts
    - src/lib/server/tryitout/chaos.reaper.test.ts
  modified:
    - src/lib/server/tryitout/leaseManager.ts
    - src/lib/server/tryitout/piRunner.ts
    - src/lib/server/tryitout/runtimeFake.ts
metrics:
  completed: 2026-10-12
  tasks: 3
---

# Phase 9 Plan 02: Lease, engine and reaper chaos tests Summary

Deterministic chaos tests (fake runtime, fake timers/injected clock, no containers or network) for lease races, a hung or failing engine and reaper timing, plus three small fixes for wedges they exposed.

## What was built
- `chaos.lease.test.ts`: N>cap concurrent claims/warm-ups, duplicate session claim, release/discard/reap races on one lease, 200 seeded (mulberry32) random interleavings checking cap, token validity, single removal and single revoke, token reuse across leases of one session.
- `chaos.engine.test.ts`: createAndStart and stage hangs (bounded caller outcome, reaper frees slot, late result self-cleans), job putFiles/getFiles/exec/cleanup hangs, remove hang and reject, shutdown with hung remove, engine unreachable at startup (WR-03), redaction of engine text.
- `chaos.reaper.test.ts`: idle TTL exact boundary, claimed/running never reaped, stalled warming boundary at 2x warmWaitMs, backwards clock, reap racing discard, timer lifecycle, owner-scoped orphan sweep (WR-08).
- `runtimeFake.ts`: optional `hang(method)` returning a `release()`; default behaviour unchanged.

## Defects found
1. A second discard/evict/reap of an already-evicting lease issued a second engine `remove` for the same container.
2. A hung engine `remove` made `discard`, eviction and the `finally` block of `runJobInContainer` wait forever.
3. A hung `putFiles` (job staging) or `getFiles` (output fetch) left the job `running` and the lease claimed forever (the app-side job timer only covers `exec`).
4. Accepted, not changed: while an evicted lease's container is still being removed, the engine can briefly hold more than the cap (cap counts leases, not dying containers). Counting dying containers against the cap would make new claims busy while a removal is pending (a product trade-off). The tests assert surplus containers belong only to terminal leases and the count converges to the live leases.

## Behavioural changes
- `leaseManager.removeContainer` memoises one removal promise per lease; later discards await it. Revert commit 039b509.
- Engine `remove` is capped at `REMOVE_TIMEOUT_MS` = 15 s (dep `removeTimeoutMs` overrides in tests); on timeout a warning is logged, the lease stays terminal and the orphan sweep retries. Revert commit c7269d9.
- `putFiles` (job staging) and `getFiles` are capped at `ENGINE_CALL_TIMEOUT_MS` = 60 s; on timeout the job fails with the generic "container engine error" and the lease is discarded. Revert commit c7269d9.
- Warm-up hangs (createAndStart/stage) keep relying on the existing documented bound (caller at warmWaitMs, reaper at 2x warmWaitMs); no per-call timeout added.

## Commits
039b509 fix remove once; 5f157a8 lease tests; c7269d9 fix timeouts; 05a34b0 engine tests; reaper tests (see `git log`).

## Deviations from Plan
None beyond the above fixes. `npm run check` exit 0; package.json untouched.

## Self-Check: PASSED
