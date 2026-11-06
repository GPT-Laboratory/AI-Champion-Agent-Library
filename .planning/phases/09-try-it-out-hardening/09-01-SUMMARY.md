---
phase: 09-try-it-out-hardening
plan: 01
subsystem: try-it-out security
tags: [security, llm-proxy, budget, tar, lease-manager, jsonl]
requires: [08-container-backed-try-it-out-warm-on-visit]
provides: [09-SECURITY-REVIEW.md, hardened proxy budget, owner-scoped sweep, hardened getFiles/buildTar/JSONL parser]
affects: [src/lib/server/tryitout/*]
tech-stack:
  added: []
  patterns: [reserve-then-reconcile budget, null-prototype map for untrusted keys, owner label for shared engines]
key-files:
  created: [.planning/phases/09-try-it-out-hardening/09-SECURITY-REVIEW.md]
  modified:
    - src/lib/server/tryitout/llmProxy.ts
    - src/lib/server/tryitout/leaseManager.ts
    - src/lib/server/tryitout/service.ts
    - src/lib/server/tryitout/runtime.ts
    - src/lib/server/tryitout/runtimeDockerode.ts
    - src/lib/server/tryitout/piEvents.ts
    - .planning/AUTONOMOUS-DECISIONS.md
    - .planning/AUTONOMOUS-SUMMARY.md
decisions: [D-016, D-017, D-018]
metrics:
  completed: 2026-10-12
  tasks: 3
requirements-completed: [P9-SC1]
---

# Phase 9 Plan 01: Security review and fixes Summary

Adversarial review of the Phase 8 Try It Out code, with 13 of 15 findings fixed test-first and 2 accepted with rationale; all deferred Phase 8 findings (WR-05, WR-08, WR-09, IN-01, IN-02, IN-04, IN-05) are closed.

## Commits

- 558ba50 docs: 09-SECURITY-REVIEW.md (Task 1)
- 7721f66 fix: job budget with default completion cap and reserve-then-reconcile (WR-05)
- 4936dd9 fix: orphan sweep scoped by `aic.owner` (WR-08)
- 6a44aa7 fix: JSONL line cap (IN-05)
- 8883b8f fix: getFiles/buildTar/create options hardening (WR-09, IN-01, IN-02, IN-04), dispositions, D-018

## Deviations from Plan

**1. [Rule 1 - Bug] Destroying streams raised an uncaught PREMATURE_CLOSE**
- **Found during:** Task 3 (WR-09 fix)
- **Issue:** `extract.destroy()` / `archive.destroy()` in the early-exit path emitted an error event with no listener, which would be an uncaught exception in production.
- **Fix:** noop error listeners attached before destroying. Covered by the existing early-exit tests (vitest fails on unhandled errors).
- **Commit:** 8883b8f

**2. [Rule 2 - Scope] Extra findings beyond the deferred list**
SEC-04 (stream_options passthrough), SEC-09 (non-file entry cap) and SEC-12 (`.` path segments) were found by the audit and fixed.

Plan files list deviation: the plan named `artifact.ts`; no change was needed there (zip names were already validated), the `.` segment fix lives in `runtime.ts:isSafeRelativePath` and is tested from `artifact.test.ts`.

## Notes

- Valid inputs unchanged: existing tests stayed green; only additions are default `max_tokens`, `MemorySwap`, owner label, `.` segment refusal.
- No new dependencies, no container or network use; `npm run check` exits 0 (581 passed, 1 skipped).
- Operator follow-up: set `APP_INSTANCE_NAME` for compose deployments (D-017); IN-03 (whole app reachable from the Pi network) remains an accepted risk.

## Self-Check: PASSED
