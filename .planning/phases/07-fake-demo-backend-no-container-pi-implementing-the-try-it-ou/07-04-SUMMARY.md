---
phase: 07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou
plan: 04
subsystem: api
tags: [sveltekit-server, fetch-client, openai, job-api, vitest-fetch-stub]

# Dependency graph
requires:
  - phase: 07-03
    provides: "src/lib/server/tryItOutJobs.ts (createJob/getJob/isValidJobId/path helpers), tryItOutRunner.ts (runJob), tryItOutPrompts.ts (AgentIdSchema) — the entire execution engine"
provides:
  - "src/routes/api/tryitout/jobs/+server.ts — POST job creation: validates agentId/task, enforces the 200KB upload cap before any write, writes uploads to the fixed input path, fires runJob without awaiting it"
  - "src/routes/api/tryitout/jobs/[id]/+server.ts — GET status poll returning the literal { status, events, error } JobUpdate shape"
  - "src/routes/api/tryitout/jobs/[id]/artifact/+server.ts — GET artifact download, succeeded-only, 409/404 branches"
  - "src/lib/tryItOut.ts — real fetch-backed submitJob/subscribeProgress/downloadArtifact; mock deleted wholesale; frozen signatures/types preserved"
  - "src/lib/testing/fakeJobApi.ts — installFakeJobApi(), a shared vi.stubGlobal('fetch', ...) stub emulating the three real routes, used by both client and component tests"
affects: [07-05-fake-demo-backend]

actuals:
  tokens: 9800
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "SvelteKit +server.ts route handlers invoked directly in tests with plain { request } / { params } objects — no HTTP server needed since route modules export ordinary functions"
    - "Partial vi.mock of $lib/server/tryItOutJobs wrapping only createJob in vi.fn(actual.createJob) — a genuine call-through spy that lets tests assert 'no job created' without needing to predict a jobId"
    - "Captured job.status immediately after createJob (before firing the fire-and-forget runJob) instead of re-reading job.status afterward — runJob mutates the store's status to 'running' synchronously on its first line (before its first await), so reading job.status after invoking it would already read back 'running', not the literal 'queued' SC-01 requires"
    - "installFakeJobApi's default script mirrors the REAL runner's exact pushEvent call sequence and frozen stage-line strings (07-03-SUMMARY.md), not Phase 6's mock tool_start/tool_end script — success: 3 stage events + 1 terminal; failure: 2 stage events + 1 terminal, matching src/lib/server/tryItOutRunner.ts exactly"
    - "Fire-and-forget jobs in tests must be drained to a terminal status (waitForStatus helper) before the test ends, or their background runJob execution bleeds into a later test's fake-timer/mock-queue state (discovered via a genuine cross-test flake during Task 1)"

key-files:
  created:
    - src/routes/api/tryitout/jobs/+server.ts
    - src/routes/api/tryitout/jobs/[id]/+server.ts
    - src/routes/api/tryitout/jobs/[id]/artifact/+server.ts
    - src/routes/api/tryitout/jobs/jobs.test.ts
    - src/lib/testing/fakeJobApi.ts
  modified:
    - src/lib/tryItOut.ts
    - src/lib/tryItOut.test.ts
    - src/lib/components/TryItOutPanel.test.ts
    - .planning/phases/07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou/deferred-items.md

key-decisions:
  - "POST handler captures `job.status` (='queued') into a local const immediately after createJob, before firing runJob — reading job.status AFTER the fire-and-forget call would observe 'running' because runJob's setStatus(jobId,'running') executes synchronously before its first await, which happens before the handler's own return statement runs. This is a real timing bug the plan's literal action steps would have introduced verbatim; fixed as part of implementation (Rule 1)."
  - "fakeJobApi's default event script uses the real runner's frozen stage lines ('using task text as input…'/'reading input…', 'calling model…', 'writing output…', 'agent settled (clean exit)', 'agent failed') and event counts (4 on success, 3 on failure), not Phase 6's 5/3-event mock script — this is the correct substitution since the fake stub's job is to emulate the REAL 07-03/07-04 backend, not Phase 6's retired mock."
  - "fakeJobApi decides success/fail per submitted task text using the exact same contract regex Phase 6's mock used (/(^|\\W)fail(\\W|$)/i) — a deliberate test-only heuristic (a real backend would let the model decide) that let almost all of TryItOutPanel.test.ts's existing task-string fixtures ('please fail now', 'summarize the csv') keep working unchanged."

patterns-established:
  - "Every test that fires a job via the real POST handler waits for that job to reach a terminal status before the test ends, even when the assertion under test doesn't need the terminal state — prevents a dangling fire-and-forget runJob promise from consuming a later test's mockCreate.mockResolvedValueOnce() slot."

requirements-completed: []
# This plan closes SC-01/SC-02/SC-04/SC-05/SC-06/SC-07 at the wiring level.
# Per this phase's established convention (07-01-SUMMARY.md, 07-03-SUMMARY.md),
# requirements-completed stays empty here — these SC-IDs are also listed in
# 07-05's frontmatter (which re-touches TryItOutPanel.svelte for session
# persistence and re-verifies SC-05/06/07 hold with that addition), and these
# SC-IDs have no corresponding entries in the top-level REQUIREMENTS.md
# traceability matrix to check off. The orchestrator's shared requirements
# step runs once after all phase plans land.

coverage:
  - id: D1
    description: "POST /api/tryitout/jobs validates agentId/task, enforces the 200KB cap on file+task before any write or job creation, writes uploads to the fixed input path (never a client-filename-derived path), and fires runJob without awaiting it so the response returns { jobId, status: 'queued' } immediately (SC-01, SC-02, T4-2, T4-3)"
    requirement: "SC-01"
    verification:
      - kind: unit
        ref: "src/routes/api/tryitout/jobs/jobs.test.ts (19 tests, incl. oversized-upload, traversal-filename, and empty-file-input tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /api/tryitout/jobs/:id returns the literal { status, events, error } JobUpdate with no agentId/task/fileName leakage; 404 for unknown or malformed ids, never a filesystem error (SC-06, T4-1)"
    requirement: "SC-06"
    verification:
      - kind: unit
        ref: "src/routes/api/tryitout/jobs/jobs.test.ts — 'GET /api/tryitout/jobs/[id]' describe block"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/tryitout/jobs/:id/artifact serves the real generated file with an attachment Content-Disposition only when status is 'succeeded'; 409 otherwise; 404 for unknown id or a succeeded-but-deleted output file (never an unhandled ENOENT) (SC-06, T4-5, T4-6)"
    requirement: "SC-06"
    verification:
      - kind: unit
        ref: "src/routes/api/tryitout/jobs/jobs.test.ts — 'GET /api/tryitout/jobs/[id]/artifact' describe block"
        status: pass
    human_judgment: false
  - id: D4
    description: "src/lib/tryItOut.ts reaches the backend via fetch only; the three exported function signatures and four exported types are byte-identical to docs/job-api-contract.md; the mock is deleted wholesale (SC-07, T4-4, T4-8)"
    requirement: "SC-07"
    verification:
      - kind: unit
        ref: "src/lib/tryItOut.test.ts (27 tests)"
        status: pass
      - kind: other
        ref: "grep -cE '\\$lib/server|OPENAI_API_KEY' src/lib/tryItOut.ts -> 0; grep -c 'MOCK IMPLEMENTATION|mockJobs|pi exited non-zero' src/lib/tryItOut.ts -> 0; sed -n '1,25p' matches the frozen types"
        status: pass
    human_judgment: false
  - id: D5
    description: "TryItOutPanel.svelte and src/routes/agents/[slug]/+page.svelte have zero source changes; the panel's transport-discipline test (no fetch(, no EventSource, no URL literal, no {@html}) still passes unmodified (SC-07)"
    requirement: "SC-07"
    verification:
      - kind: unit
        ref: "src/lib/components/TryItOutPanel.test.ts — 'TryItOutPanel transport discipline' describe block (byte-identical diff)"
        status: pass
      - kind: other
        ref: "git diff --exit-code src/lib/components/TryItOutPanel.svelte src/routes/agents/[slug]/+page.svelte -> no changes"
        status: pass
    human_judgment: false
  - id: D6
    description: "End-to-end: driving the real POST/GET handlers with a mocked OpenAI client reaches 'succeeded' with only info-typed events, and the artifact route serves the real generated text; two concurrent jobs stay independent (SC-04, SC-05)"
    requirement: "SC-04"
    verification:
      - kind: unit
        ref: "src/routes/api/tryitout/jobs/jobs.test.ts — 'two sequential POSTs' test (independent artifacts) and the full success-path artifact test"
        status: pass
    human_judgment: false
  - id: D7
    description: "npm test (173/173, up from 148 pre-plan), npx tsc --noEmit (zero new errors — same 22 pre-existing baseline), and npm run build all succeed; SC-09 verified against the real build output (no OPENAI_API_KEY, no server-only stage string in build/client/)"
    verification:
      - kind: unit
        ref: "full suite: npm test"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit (22 pre-existing, 0 new); npm run build; grep -rl OPENAI_API_KEY|'calling model' build/client/ -> no matches"
        status: pass
    human_judgment: false

duration: 24min
completed: 2026-08-20
status: complete
---

# Phase 07 Plan 04: Route Handlers + Real Fetch Client Summary

**Wired the three SvelteKit `+server.ts` job endpoints over Plan 07-03's engine and swapped `src/lib/tryItOut.ts`'s mock for real `fetch()` calls, backed by a shared `installFakeJobApi()` test stub — the UI (`TryItOutPanel.svelte`) has zero source changes and its transport-discipline test still passes byte-identical.**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-08-20T04:28:00Z (approx. — worktree bootstrap)
- **Completed:** 2026-08-20T04:52:07Z
- **Tasks:** 3/3
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments
- `src/routes/api/tryitout/jobs/+server.ts`: `POST` validates `agentId`/`task`, enforces a 200KB cap (against both the file and the task string) before any job is created or byte is written, writes uploads to a fixed server-chosen path, and fires `runJob` without awaiting it — 19/19 route tests passing, including oversized-upload, path-traversal-via-filename, empty-file-input (Pitfall 3), and two-independent-jobs concurrency tests
- `src/routes/api/tryitout/jobs/[id]/+server.ts` and `.../artifact/+server.ts`: literal `{ status, events, error }` status responses and a succeeded-only artifact download with correct `Content-Disposition`, both 404-safe against malformed/unknown ids and never leaking a filesystem error
- `src/lib/tryItOut.ts`: mock deleted wholesale; `submitJob`/`subscribeProgress`/`downloadArtifact` now POST/GET the real routes over `fetch`; `subscribeProgress` polls every 1000ms with a `cancelled` flag and clears its timer on unsubscribe (`vi.getTimerCount() === 0` verified); frozen types/signatures byte-identical to `docs/job-api-contract.md`
- `src/lib/testing/fakeJobApi.ts`: a shared `installFakeJobApi()` fetch stub used by both `tryItOut.test.ts` (27 tests) and `TryItOutPanel.test.ts` (20 tests) — scripts the real runner's exact frozen stage-line sequence instead of duplicating Phase 6's mock strings in two places
- Full-suite regression: `npm test` 173/173 (up from 148 pre-plan, no test deleted), `npx tsc --noEmit` unchanged at the same 22 pre-existing/unrelated errors, `npm run build` succeeds, and SC-09 is now proven against the actual `build/client/` output (no `OPENAI_API_KEY`, no `calling model…` runner string)

## Task Commits

Each task was committed atomically:

1. **Task 1: The three SvelteKit route handlers** - `917a49c` (feat)
2. **Task 2: Rewire src/lib/tryItOut.ts to real fetch, with a shared fake-API test stub** - `81840a0` (feat)
3. **Task 3: Full-suite regression and build durability check** - `2dc0a5d` (chore)

**Plan metadata:** SUMMARY.md committed alongside this plan's task commits (worktree mode — orchestrator handles STATE.md/ROADMAP.md centrally after merge).

## Files Created/Modified
- `src/routes/api/tryitout/jobs/+server.ts` - `POST` job creation, validation, upload cap, fixed-path write, fire-and-forget `runJob`
- `src/routes/api/tryitout/jobs/[id]/+server.ts` - `GET` status poll, literal `JobUpdate` shape
- `src/routes/api/tryitout/jobs/[id]/artifact/+server.ts` - `GET` artifact download, succeeded-only
- `src/routes/api/tryitout/jobs/jobs.test.ts` - 19 tests covering every behavior in the plan
- `src/lib/tryItOut.ts` - Real fetch-backed client; mock deleted; frozen contract preserved
- `src/lib/tryItOut.test.ts` - Rewritten against `installFakeJobApi()`, 27 tests
- `src/lib/testing/fakeJobApi.ts` - Shared fetch stub emulating the three real routes
- `src/lib/components/TryItOutPanel.test.ts` - Migrated to the fake stub; mock strings replaced with the real frozen stage lines; transport-discipline block byte-identical
- `.planning/phases/.../deferred-items.md` - Logged confirmation that the 22 pre-existing `tsc` errors are unchanged after this plan

## Decisions Made
- Captured `job.status` immediately after `createJob` (before firing `runJob`) rather than re-reading it afterward, to guarantee the POST response literally returns `'queued'` — see Deviations
- `fakeJobApi`'s scripted event timeline mirrors the real `tryItOutRunner.ts`'s exact `pushEvent` call sequence and frozen stage-line strings, not Phase 6's retired mock script
- `fakeJobApi` reuses the exact contract fail-regex (`/(^|\W)fail(\W|$)/i`) to decide success/fail per submitted task text — a deliberate test-only heuristic that preserved almost all of `TryItOutPanel.test.ts`'s existing task-string fixtures unchanged

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] POST handler would have returned `status: 'running'` instead of the SC-01-mandated `'queued'`**
- **Found during:** Task 1, while implementing the POST handler per the plan's literal action steps
- **Issue:** The plan's action step 8 says `return json({ jobId: job.jobId, status: job.status })`, reading `job.status` after firing `runJob(job.jobId).catch(() => {})`. But `runJob` is an async function whose first statement, `setStatus(jobId, 'running')`, executes synchronously (before its first `await`) the instant it is *called* — even though it isn't awaited. So by the time the handler's own `job.status` read happens, the store's status has already flipped to `'running'`, directly contradicting SC-01's literal `{ status: 'queued' }` requirement.
- **Fix:** Captured `job.status` into a local `initialStatus` const immediately after `createJob` (which always returns status `'queued'`), before firing `runJob`, and returned that captured value instead of re-reading the mutable store.
- **Files modified:** `src/routes/api/tryitout/jobs/+server.ts`
- **Verification:** `jobs.test.ts`'s first POST test asserts `body.status === 'queued'` and passes; all 19 route tests green.
- **Committed in:** `917a49c` (Task 1 commit)

**2. [Rule 1 - Bug] Cross-test bleed from un-awaited fire-and-forget jobs in `jobs.test.ts`**
- **Found during:** Task 1, while iterating on the route test suite
- **Issue:** Several tests POST a job and don't await its completion before the test ends (by design — SC-01 requires the response NOT to wait for the model call). But the resulting dangling `runJob` promise keeps executing on Node's microtask queue during LATER tests, and can consume a later test's `mockCreate.mockResolvedValueOnce(...)` slot, producing a genuinely flaky failure (`expected 'mock model output' to be 'artifact content here'`) reproduced once during development.
- **Fix:** Added a `waitForStatus(jobId, ['succeeded', 'failed'])` drain at the end of every test whose job doesn't otherwise reach a terminal state before the test completes, so no background execution survives into the next test.
- **Files modified:** `src/routes/api/tryitout/jobs/jobs.test.ts`
- **Verification:** Ran the suite 3 additional times after the fix with zero flakes.
- **Committed in:** `917a49c` (Task 1 commit)

**3. [Rule 1 - Bug] Panel download tests needed a microtask flush after the real (now-async) `downloadArtifact` fetch**
- **Found during:** Task 2, migrating `TryItOutPanel.test.ts`
- **Issue:** Phase 6's mock `downloadArtifact` had no internal `await`, so its promise settled within whatever microtask flushing `fireEvent.click(...)` already provided. The real implementation does `await fetch(...)` and `await res.blob()`, needing an explicit flush; two download-interaction tests (T2.9, T2.13) failed with `createObjectURL`/`capturedBlob` never populated.
- **Fix:** Added `await vi.advanceTimersByTimeAsync(0)` immediately after each `fireEvent.click(downloadButton)` to flush the fetch promise chain.
- **Files modified:** `src/lib/components/TryItOutPanel.test.ts`
- **Verification:** All 20 panel tests pass, including both download-interaction tests.
- **Committed in:** `81840a0` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 SC-01-correctness bug, 1 test-isolation bug, 1 test-timing fix)
**Impact on plan:** All three were necessary for correctness/test-reliability; none expanded scope beyond what the plan's own acceptance criteria already required (a literal `'queued'` response, a green non-flaky suite, and passing download-interaction tests). No scope creep.

## Substituted Assertions (Phase 6 mock strings — planned substitution, not a deviation)

Per the plan's explicit instruction, every Phase 6 mock-specific string assertion in `tryItOut.test.ts` and `TryItOutPanel.test.ts` was replaced with the real backend's frozen stage lines:
- `'read data/sample.csv'` / `'read data/sample.csv (12 lines)'` / `'count rows in data/sample.csv'` / `'write output/result.txt'` → `'using task text as input…'` / `'calling model…'` / `'writing output…'` (the real runner's exact `pushEvent` calls)
- `'agent failed (exit 1)'` → `'agent failed'`
- `'pi exited non-zero: required input file missing'` → `'model returned no output text'` (a real, plausible `tryItOutRunner.ts` error message)
- `'agent settled (clean exit)'` was NOT changed — it is the frozen literal string reused verbatim by the real runner for feed parity (07-03-SUMMARY.md decision), so the assertion already matches the new implementation
- T2.20's hardcoded event count `5` (Phase 6's 4-stage + 1-terminal mock script) → `4` (the real runner's 3-stage + 1-terminal sequence)
- T2.16's ordering check switched from `'read data/sample.csv'` vs `'write output/result.txt'` substrings to `'using task text as input…'` vs `'writing output…'`

## Issues Encountered
- This worktree's `node_modules/` and `db/` were entirely absent on start (same fresh-worktree bootstrap gap 07-03 flagged). Ran `npm install` (235 packages), `mkdir db && npx drizzle-kit push`, and `npm run ingest` (8/8 succeeded) before writing any code — bootstrap, not a plan deviation.
- `docs/job-api-contract.md` is untracked in the main repo working tree (not committed to git), so it did not exist inside this isolated worktree despite being `@`-referenced by the plan's context. Read it directly from the main repo's absolute path (`/home/ville/dev/aic-tryitout/AI-Champion-Agent-Library/docs/job-api-contract.md`) to obtain the frozen contract text; did not copy it into this worktree since it is not in this plan's `files_modified` list and no acceptance check reads it from disk at test time.

## User Setup Required

None - no external service configuration required. All tests mock `fetch`/`openai`; no real `OPENAI_API_KEY` call is made by any test in this plan.

## Next Phase Readiness
- Plan 07-05 (session persistence via `?job=` URL param) can now build directly on this plan's real `submitJob`/`subscribeProgress`/`downloadArtifact` and the shared `installFakeJobApi()` stub for its own `TryItOutPanel.test.ts` changes.
- The three route handlers, `fakeJobApi.ts`'s exported `InstalledFakeJobApi`/`FakeJobApiOptions` types, and the frozen stage-line strings are all available for 07-05 to reference.
- No blockers for 07-05.

---
*Phase: 07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou*
*Completed: 2026-08-20*

## Self-Check: PASSED

- All 9 claimed files confirmed tracked via `git ls-files --error-unmatch` (three route handlers, `jobs.test.ts`, `tryItOut.ts`, `tryItOut.test.ts`, `fakeJobApi.ts`, `TryItOutPanel.test.ts`, this SUMMARY.md)
- Commits `917a49c`, `81840a0`, `2dc0a5d`, `fd3f8f3` all confirmed in `git log --oneline --all`
- `npm test` re-verified passing (173/173 across 17 test files) after all commits
