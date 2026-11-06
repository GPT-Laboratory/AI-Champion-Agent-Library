---
phase: 08-container-backed-try-it-out-warm-on-visit
fixed_at: 2026-10-12T15:05:00Z
review_path: .planning/phases/08-container-backed-try-it-out-warm-on-visit/08-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 8: Code Review Fix Report

**Fixed at:** 2026-10-12
**Source review:** `.planning/phases/08-container-backed-try-it-out-warm-on-visit/08-REVIEW.md`
**Iteration:** 1

**Scope:** WR-06, WR-07, WR-04, WR-02, WR-01, WR-03 (as selected by the caller). WR-05, WR-08, WR-09 and IN-01..IN-05 were deferred and left untouched.

**Summary:**
- Findings in scope: 6
- Fixed: 6
- Skipped: 0

**Verification environment:** fixes were made in an isolated git worktree (fast-forwarded onto `agent-integration` afterwards). The worktree has no `node_modules` of its own and cannot run the Svelte component test `src/routes/agents/try-it-out.test.ts`, so the final full run was done in the main checkout after the fast-forward: `npx vitest run src/lib/server src/routes` gives 31 files, 273 tests, all passing. `npx tsc --noEmit` reports the same 22 pre-existing errors (catalog.test.ts 17, try-it-out.test.ts 2, tryItOut.test.ts 2, detail.test.ts 1) and none in touched source files.

## Fixed Issues

### WR-06: Upstream error bodies and infrastructure details surfaced to visitors

**Files modified:** `src/lib/server/tryitout/redact.ts` (new), `src/lib/server/tryitout/redact.test.ts` (new), `src/lib/server/tryitout/llmProxy.ts`, `src/lib/server/tryitout/piEvents.ts`, `src/lib/server/tryitout/piRunner.ts`, `src/lib/server/tryItOutRunner.ts`, plus tests in `llmProxy.test.ts`, `piEvents.test.ts`, `piRunner.test.ts`, `tryItOutRunner.test.ts`
**Commit:** 2038fe3
**Applied fix:** The proxy now answers a non-2xx upstream with `model request failed (<status>)` and logs the upstream body server-side with `sk-` keys and bearer tokens redacted. `piEvents` drops the upstream text from the `auto_retry_start` feed line, no longer returns container stderr in the verdict (`pi exited with code N`), and redacts model/retry errors. `piRunner` and `runJob` map `TryItOutRuntimeError` to fixed strings (`container engine unavailable`, `container engine error`, `container output was invalid`; `busy`, `session_busy` and output-limit messages are kept), redact and bound plain error text, and log the full redacted detail (including the stderr tail) server-side. The direct-LLM fallback path is covered too.
**Note:** the runtime error messages themselves (socket path, image name, build hint) are unchanged; they are simply no longer shown to visitors.

### WR-07: Cookie-less visitors can exhaust the container cap

**Files modified:** `src/lib/server/tryitout/clientLimit.ts` (new), `src/lib/server/tryitout/clientLimit.test.ts` (new), `src/lib/server/tryitout/runnerConfig.ts`, `src/lib/server/tryitout/service.ts`, `src/routes/agents/[slug]/+page.server.ts`, `src/routes/api/tryitout/jobs/+server.ts`, `.env.example`, tests in `runnerConfig.test.ts`, `service.test.ts`, `warm.test.ts`, `jobs.test.ts`
**Commit:** c0f6a39
**Applied fix:** New anonymous sessions are capped per client address with a sliding window (`PI_RUNNER_ANON_SESSIONS_PER_CLIENT`, default 5 per 10 minutes, 0 = unlimited). The page warm-up skips the warm when over the cap; `POST /api/tryitout/jobs` answers 429. Signed-in users and sessions that already hold a lease are never limited, so behaviour with auth on is unchanged. The cookie is still minted on the response as before.
**Caveat:** behind a reverse proxy that does not forward the client address (no `ADDRESS_HEADER`/`XFF_DEPTH` configured for adapter-node), all anonymous visitors share one bucket; raise or zero the env var in that case.

### WR-04: `runJob` can reject and strand the job in `running`

**Files modified:** `src/lib/server/tryItOutRunner.ts`, `src/lib/server/tryItOutRunner.test.ts`
**Commit:** b4bd383
**Applied fix:** `fallbackEnabled` is read inside its own try/catch (invalid config means no fallback). The whole failure handler is wrapped, and a `failJob` helper guards logging, the event push and `setStatus('failed', ...)` individually, so the job always reaches a terminal status. Test: `PI_RUNNER_FS_MODE=foo` now yields a `failed` job with an error instead of a rejection.

### WR-02: Cleanup exec has no timeout

**Files modified:** `src/lib/server/tryitout/piRunner.ts`, `src/lib/server/tryitout/piRunner.test.ts`
**Commit:** dbe9c94
**Applied fix:** The post-job `rm -rf` exec races a `CLEANUP_TIMEOUT_MS` (10 s) timer. On timeout or exec failure the lease is discarded instead of released; the recorded job result is unaffected. Tests cover a hung cleanup (fake timers) and a throwing cleanup.

### WR-01: Stalled warm-up leaves the lease in `warming`

**Files modified:** `src/lib/server/tryitout/leaseManager.ts`, `src/lib/server/tryitout/leaseManager.test.ts`
**Commit:** 0b327f6
**Applied fix:** `reap` now expires `warming` leases older than 2x `warmWaitMs`, freeing the cap slot and revoking the token (a late-returning create call removes its own container because the lease is no longer `warming`). Test verifies the slot is `busy` before the reap and free after, and the token is revoked.
**Not done:** the review also suggested per-call timeouts around `stage`/`createAndStart` and evicting on `awaitReady` timeout; the caller's scope named the reaper approach only, so those were left out.

### WR-03: Network guard and reaper depend on startup ping succeeding

**Files modified:** `src/lib/server/tryitout/leaseManager.ts`, `src/lib/server/tryitout/service.ts`, `src/lib/server/tryitout/service.test.ts`
**Commit:** 8a93d31
**Applied fix:** The lease manager takes an optional `beforeCreate` hook awaited before every `createAndStart`; the service supplies a memoised `verifyNetwork()` (cached on success, retried after a failure), so a non-internal network is refused regardless of startup. `startTryItOutService` starts the reaper unconditionally and retries ping, network check and orphan sweep with backoff (0, 2, 6, 20 s). Tests: reaper starts when ping fails; creation is refused with no container created when the guard fails; guard runs once on success and is re-checked after failure. One existing startup test was adjusted to wait for the sweep rather than the reaper.

## Skipped Issues

None. WR-05, WR-08, WR-09 and IN-01..IN-05 were out of scope by instruction (deferred).

## Test results

- `npx vitest run src/lib/server src/routes` (main checkout, after fast-forward): 31 files passed, 273 tests passed, 0 failed.
- Baseline items not hit in this run: the 3 `scripts/set-try-it-out-mode.test.ts` failures (outside the requested path) and the occasional `jobs.test.ts` timing flake.
- `npx tsc --noEmit`: 22 errors, identical to the pre-existing baseline, none in touched source files.

---

_Fixed: 2026-10-12_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
