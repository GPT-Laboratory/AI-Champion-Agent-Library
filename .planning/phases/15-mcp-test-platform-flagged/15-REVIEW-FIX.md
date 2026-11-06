---
phase: 15-mcp-test-platform-flagged
fixed_at: 2026-10-13T04:50:00Z
review_path: .planning/phases/15-mcp-test-platform-flagged/15-REVIEW.md
iteration: 1
findings_in_scope: 16
fixed: 15
skipped: 1
status: partial
---

# Phase 15: Code Review Fix Report

**Fixed at:** 2026-10-13
**Source review:** `.planning/phases/15-mcp-test-platform-flagged/15-REVIEW.md`
**Iteration:** 1
**Branch:** `worktree-agent-ae662628d15d19969` (reset to `autonomous/overnight-improvements` first; nothing pushed, no other branch touched)

**Summary:**
- Findings in scope: 16 (CR-01..04, WR-01..12)
- Fixed: 15 (4 Critical, 11 Warning)
- Skipped: 1 (WR-12 code part; the documentation part is done)
- Info: IN-03, IN-04, IN-05 done (trivial); IN-01, IN-02, IN-06 deliberately left (reasons below)
- One extra defect found while verifying, fixed: the `/mcp-test` page answered 500 on every request (D-252)

**Verification ran in the isolated worktree** (the main checkout was never used): `npm ci`, `db:push`, `ingest`, `tryout:configure`, then per-fix targeted vitest runs and finally `npm run check`, which exited 0 (`svelte-kit sync`, `tsc --noEmit`, 186 test files passed, 1 skipped, 1816 tests). WR-02 was also checked against a real `vite dev` server (flag off: 404 for GET, POST, PUT and DELETE on all three API routes, POST on the page; flag on: page 200, `GET /api/mcp-test/runs` 405 with `Allow: POST`, a `fake:good` run of two cases ends PASS). No container was built or run; no Python was run by the fixes or tests (one `python3 --version` was run by mistake at the start of the session, nothing else).

Logic fixes carry the status "fixed: requires human verification" because the tests prove structure and the cases named, not that the scoring rules match the study author's intent: CR-02, WR-07, WR-03.

## Fixed Issues

### CR-01: Container driver tree omitted golden.jsonl and csv fixtures (silent empty goldens, false PASS)

**Files modified:** `src/lib/server/mcptest/containerRun.ts`, `src/lib/mcptest/driver.ts`, `src/lib/mcptest/core/cases.ts`, `src/lib/mcptest/core/suite.ts`, `src/lib/mcptest/core/runner.ts`
**Commits:** 81183e6 (staging, driver), 260aa62 (loader and runner guards)
**Applied fix:** `readDriverTree` stages `.jsonl` and `.csv` and every file under the suite directory whatever its extension, and throws if a suite case has no `golden.jsonl`; `runInContainer` applies the same check to an injected tree. `loadSuite` requires a non-empty `golden.jsonl` (via `loadCaseDir(dir, { requireGolden: true })`; the generic loader stays lenient by default) so the in-container suite fails to load rather than scoring nothing; the runner returns ERROR "case declares no golden checks" for a case with no golden. Tests: `containerRun.fixes.test.ts` (every suite file is staged; the suite loaded from the staged tree equals the host suite), `core/failClosed.test.ts`.

### CR-02: Zero scored checks gave a vacuous PASS; verdict PASS with a null score (fixed: requires human verification)

**Files modified:** `src/lib/mcptest/core/scoring.ts`, `src/lib/mcptest/core/scoring.test.ts`
**Commit:** 260aa62
**Applied fix:** a ran case with no scored check is never PASS (state ERROR; FAIL if D1 failed), regardless of thresholds. `rollUp` returns PASS only with gate `pass` and a non-null score, else INCOMPLETE. Tests: `core/failClosed.test.ts` (reproduces the review scenario through `runSuite`).
**Existing tests edited (minimal, justified):** two spots in `core/scoring.test.ts` built a Tier 1 case with `d1: { pass: true }` and no checks and expected PASS (`maps D1 false and D1 true`, and the `t1()` helper used by five `rollUp` tests). Those pinned the exact bug (a case that measured nothing passing), so each fixture now carries one passing D1 check. No assertion was changed.

### CR-03: Phase 8 runtime hard-coded `User: 'pi'` and a `/home/pi/agent` tmpfs; the runner image has user `node`

**Files modified:** `src/lib/server/tryitout/runnerConfig.ts`, `src/lib/server/tryitout/runtimeDockerode.ts`, `src/lib/server/mcptest/containerRun.ts`, `Containerfile.mcp-test-runner` (comment)
**Commit:** 81183e6
**Applied fix:** optional `runUser` (default `pi`) and `mountAgentDir` (default true) on `RunnerConfig`; `mcpTestRunnerConfig` sets `node` and false. Pi behaviour is unchanged. Test: the user named by `buildCreateOptions(mcpTestRunnerConfig())` equals the Containerfile's last `USER`; the Pi defaults keep `pi` and the agent tmpfs. Whether a real engine accepts the options is pending human (HUMAN-UAT items 3 and 4 updated). D-241.

### CR-04: `DRIVER_CMD` ran bare `tsx`, not on PATH

**Files modified:** `src/lib/server/mcptest/containerRun.ts`, `Containerfile.mcp-test-runner`
**Commit:** 81183e6
**Applied fix:** `DRIVER_CMD` is `/node_modules/.bin/tsx /work/src/lib/mcptest/driver.ts`; the Containerfile also sets `ENV PATH=/node_modules/.bin:/opt/venv/bin:$PATH`. Test asserts the absolute path, the `--prefix /` install and the PATH line. D-242. Pending human: build and run.

### WR-01: HTTP transport followed redirects (SSRF)

**Files modified:** `src/lib/mcptest/core/transports/streamableHttp.ts`
**Commit:** e11bef6
**Applied fix:** `redirect: 'error'` on POST, health GET and DELETE. Tests: a 302 to a second local server is never followed (the second server sees zero hits); every fetch carries the option (`streamableHttp.limits.test.ts`).

### WR-02: Flag-off requests with an unhandled method returned 405

**Files modified:** the three `+server.ts` files under `src/routes/api/mcp-test/runs`, new `src/lib/server/mcptest/methodFallback.ts`, `src/routes/mcp-test/+page.server.ts`
**Commit:** 9eb5785 (the page 500 follow-up is 9d620c6)
**Applied fix:** `export const fallback` in each route (404 flag off, 405 plus `Allow` flag on), placed after the primary handler because an existing test reads the first `export const`; a default page action gives the same answer for POST to `/mcp-test`. Test: `src/routes/api/mcp-test/fallback.test.ts`; verified against a real dev server.

### WR-03: TTL eviction removed active runs; no overall deadline in host mode (fixed: requires human verification)

**Files modified:** `src/lib/server/mcptest/jobs.ts`, `src/lib/server/mcptest/service.ts`, `src/lib/server/mcptest/jobs.test.ts`
**Commit:** 3de5866
**Applied fix:** the TTL sweep skips queued and running runs. `executeRun` runs under an `AbortController`: the signal reaches `runSuite` at the budget (report INCOMPLETE, run `done`); after a 10 s hard grace the run is set `failed` and late writes from the abandoned work are dropped. Tests: `service.deadline.test.ts`. D-246.
**Existing test edited (minimal, justified):** `jobs.test.ts > evicts after the TTL on get and create` evicted runs that were still `queued`; that is the bug. The test now sets the runs to `done`/`failed` before ageing them. Its intent (finished runs are evicted by TTL) is kept.

### WR-04: Container leaked when the timeout fired during `createAndStart`, and was never swept

**Files modified:** `src/lib/server/mcptest/containerRun.ts`
**Commit:** 81183e6
**Applied fix:** labels now include `aic.tryitout=1` and `aic.owner` so the existing orphan sweep finds them; the create promise is tracked and its container removed once it settles when the run ended first. Tests: label check; a hung `createAndStart` released after the timeout leaves no container.

### WR-05: Report could be forged by the subject; raw container text was served

**Files modified:** `src/lib/server/mcptest/containerRun.ts`, `src/lib/mcptest/core/transports/stdio.ts`
**Commits:** 81183e6 (host stores `JSON.stringify(checked.data)`), 12fa95a (process group)
**Applied fix:** schema-validated data is stored and served; the stdio subject is spawned `detached` and the process group is killed on close, including after a clean exit. Tests: unknown keys do not reach `reportJson`; a daemon forked by a subject is dead after `close()` (fails without the fix). **Residual risk, accepted and logged in D-243:** a subject that escapes its group with `setsid` and shares the driver's uid can still overwrite `report.json` with a schema-valid forgery; closing that needs a separate uid or an out-of-band channel.

### WR-06: Streamable HTTP client buffered unbounded data

**Files modified:** `src/lib/mcptest/core/transports/streamableHttp.ts`
**Commit:** e11bef6
**Applied fix:** JSON bodies are read through the stream with a byte counter and cancelled at the cap; SSE counts data bytes per event and total bytes per response (8 times the cap) and cancels the reader past either. Tests: the server observes the connection drop for endless data lines, many small valid events, and an endless JSON body.

### WR-07: Verdict could be PASS when the Tier 1 gate never ran (fixed: requires human verification)

**Files modified:** `src/lib/mcptest/core/scoring.ts`
**Commit:** 260aa62
**Applied fix:** the PASS branch needs `gate === 'pass'`; a FAIL in Tier 2/3 still reports FAIL when the gate did not run. Tests in `core/failClosed.test.ts`. Consequence recorded in D-240: a generator subject, whose Tier 1 case is pending human in unattended runs, cannot reach PASS.

### WR-08: `MCPTEST_JOB_TIMEOUT_MS` ignored; container exec not cancelled

**Files modified:** `src/lib/server/mcptest/service.ts`, `src/lib/server/mcptest/containerRun.ts`, `src/lib/server/tryitout/runtime.ts`, `src/lib/server/tryitout/runtimeDockerode.ts`
**Commits:** 3de5866, 81183e6
**Applied fix:** `jobTimeoutMs(env)` (runner-config bounds, default 300000 ms, replacing the fixed 120000) is passed to `runInContainer` and used as the in-process budget; `ExecOptions.signal` is optional and the dockerode runtime stops waiting on the exec stream when it aborts (the run's `finally` aborts it). Tests: the timeout reaches `runInContainer`; the exec signal is aborted on timeout.

### WR-09: CLI entry guard fragile, exit 0 without doing anything

**Files modified:** `scripts/mcp-test.ts`
**Commit:** 6d1bb64
**Applied fix:** exported `isMainModule` compares real paths (`fileURLToPath`, `resolve`, `realpathSync`). Tests (`scripts/mcp-test.entry.test.ts`): the CLI runs through a symlink in a directory whose name has a space and a percent sign, and a usage error exits 2.

### WR-10: Driver request schema permitted interpreter flags and dangerous env names

**Files modified:** `src/lib/mcptest/driverRequest.ts`, new `src/lib/mcptest/core/envNames.ts`, `src/lib/mcptest/core/transports/stdio.ts`, `scripts/mcp-test.ts`, `src/lib/mcptest/driverRequest.test.ts`
**Commit:** 5a0c836
**Applied fix:** arguments may not start with `-`; the first must end in `.py`, `.js`, `.mjs` or `.cjs`; env names may not be reserved (`PATH`, `HOME`, `LANG`, `LD_*`, `NODE_*`, `PYTHON*` and others, D-247); the CLI `--env-*` flags and `spawnStdioChannel` use the same list (the latter throws instead of letting a caller override the scrubbed PATH, HOME, LANG). Tests: `driverRequest.hardening.test.ts`.
**Existing test edited (minimal, justified):** `driverRequest.test.ts` used `Array(8).fill('a')` to pin the 8-argument cap; a bare `a` is no longer a valid first argument, so it is now `['server.py', ...Array(7).fill('a')]`. The cap assertion is unchanged.

### WR-11: Subject-controlled report fields unredacted and unbounded

**Files modified:** `src/lib/mcptest/core/report.ts`, `src/lib/mcptest/core/redact.ts`, `src/lib/mcptest/core/runner.ts`
**Commit:** 8ff7d89
**Applied fix:** tool names, server name and version and protocol version go through a new `redactName` (canary and Bearer masked, control characters dropped, 80 characters; deliberately not the 32-character key-shape mask) and are bounded in the schema (200 names x 80); the runner's over-cap fallback has a second shrink step and asserts the size afterwards. Tests: `core/report.subjectFields.test.ts` including a 14000-check report that ends under the cap.

## Skipped Issues

### WR-12: Rate limit and single-flight key depend on client-controlled or proxy-collapsed identity

**File:** `src/routes/api/mcp-test/runs/+server.ts:54-63`
**Reason:** code part skipped by design. The review's own fix is "document ADDRESS_HEADER and XFF_DEPTH" (done in `docs/mcp-test-platform.md`, together with the single-slot denial-of-service note and the bearer-id note). Keying the limiter on the authenticated user, adding a post-run cool-down and comparing `sessionKey` on reads each change who may use the tester and depend on the open auth question (D-179, HUMAN-UAT item 8). Logged in D-250.
**Original issue:** with a proxy the per-client limit is shared by all visitors, the per-session cap is evaded by dropping the cookie, and anyone can hold the one global slot.

## Info findings

- IN-03 fixed (commit e8e60cf): legacy CSV cells neutralise a leading `=`, `+`, `-`, `@`, tab or CR; test `core/report.csvInjection.test.ts`.
- IN-04 and IN-05 fixed as documentation (commit e8e60cf): the run id is documented as a bearer capability; the docs no longer promise a case picker the panel lacks.
- IN-01, IN-02 left: both change scores or follow a ported "must not change" rule; Ville's call (D-251).
- IN-06 left: capping the mock `entries` changes `count()` and `log()` semantics that tests rely on; both structures end with their cell (D-251).
- IN-05 counting body stream left: the adapter's `BODY_SIZE_LIMIT` bounds it.

## Additional defect found and fixed

**`/mcp-test` returned 500 on every request** (commit 9d620c6, D-252). `+page.server.ts` exported two helper functions that SvelteKit rejects as invalid exports, so with the flag on or off the page never rendered and the documented flag-off 404 never held for the page. Unit tests that import `load` could not see it; it showed up when WR-02 was checked against a real dev server. Helpers moved to `src/lib/mcptest/pageData.ts`; `src/routes/mcp-test/page.exports.test.ts` pins the export list.

## Still pending human

Updated in `15-HUMAN-UAT.md` (items 3 and 4): build the image and check `id -un`, `/node_modules/.bin/tsx --version`, `command -v tsx`; confirm the engine accepts the create options (user `node`, `ReadonlyRootfs`, `/work` and `/tmp` tmpfs); confirm no `aic.mcptest` container survives a normal run, a timeout or a cancel and that the Try It Out sweep leaves a run in flight alone; confirm a container report has real checks for every requested case.

## Decisions logged

D-240 to D-252 in `.planning/AUTONOMOUS-DECISIONS.md` (alternatives, why, revert for each).

---

_Fixed: 2026-10-13_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
