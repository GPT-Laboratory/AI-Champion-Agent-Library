---
phase: 15-mcp-test-platform-flagged
reviewed: 2026-10-13T00:00:00Z
depth: deep
files_reviewed: 52
files_reviewed_list:
  - src/lib/mcptest/api-contract.ts
  - src/lib/mcptest/driver.ts
  - src/lib/mcptest/driverRequest.ts
  - src/lib/mcptest/generatorChecks.ts
  - src/lib/mcptest/generatorSubject.ts
  - src/lib/mcptest/uiModel.ts
  - src/lib/mcptest/core/aggregate.ts
  - src/lib/mcptest/core/binding.ts
  - src/lib/mcptest/core/cases.ts
  - src/lib/mcptest/core/cellRun.ts
  - src/lib/mcptest/core/client.ts
  - src/lib/mcptest/core/expect.ts
  - src/lib/mcptest/core/isolation.ts
  - src/lib/mcptest/core/jsonrpc.ts
  - src/lib/mcptest/core/leak.ts
  - src/lib/mcptest/core/redact.ts
  - src/lib/mcptest/core/report.ts
  - src/lib/mcptest/core/runner.ts
  - src/lib/mcptest/core/scoring.ts
  - src/lib/mcptest/core/subjects.ts
  - src/lib/mcptest/core/suite.ts
  - src/lib/mcptest/core/tier3Checks.ts
  - src/lib/mcptest/core/tier4Checks.ts
  - src/lib/mcptest/core/transports/stdio.ts
  - src/lib/mcptest/core/transports/streamableHttp.ts
  - src/lib/mcptest/core/validators.ts
  - src/lib/mcptest/core/walk.ts
  - src/lib/mcptest/fake/fakeMain.ts
  - src/lib/mcptest/fake/fakeServer.ts
  - src/lib/mcptest/fake/httpFake.ts
  - src/lib/mcptest/fake/tools.ts
  - src/lib/mcptest/mock/contract.ts
  - src/lib/mcptest/mock/faults.ts
  - src/lib/mcptest/mock/spec.ts
  - src/lib/mcptest/mock/upstream.ts
  - src/lib/server/mcptest/containerRun.ts
  - src/lib/server/mcptest/jobs.ts
  - src/lib/server/mcptest/service.ts
  - src/routes/api/mcp-test/runs/+server.ts
  - src/routes/api/mcp-test/runs/[id]/+server.ts
  - src/routes/api/mcp-test/runs/[id]/report/+server.ts
  - src/routes/mcp-test/+page.server.ts
  - src/routes/mcp-test/+page.svelte
  - src/lib/components/McpTestPanel.svelte
  - scripts/mcp-test.ts
  - Containerfile.mcp-test-runner
  - src/lib/server/tryitout/runtimeDockerode.ts
  - src/lib/server/tryitout/runtime.ts
  - src/lib/server/tryitout/session.ts
  - src/lib/server/tryitout/clientLimit.ts
  - src/lib/server/tryitout/runnerConfig.ts
  - src/lib/flags.ts
findings:
  critical: 4
  warning: 12
  info: 6
  total: 22
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-10-13
**Depth:** deep
**Files Reviewed:** 52 (the last six in the list are Phase 8 / shared files read only to check the container contract)
**Status:** issues_found

## Summary

Reviewed the MCP test platform core (client, transports, validators, scoring, runner, report), the mock upstream, the fake servers, suite loader, in-container driver, the server-side service, job store and container runner, the three API routes, the page, the panel, the CLI and the runner Containerfile. Phase 8 runtime files were read only to check the contract.

Things that hold up: the flag check is the first statement of every handler and of the page load. Run ids are validated before lookup. Bodies are size-capped. The stdio transport scrubs the environment (PATH, LANG, a fresh HOME, plus the mock URL and canary). The mock binds to 127.0.0.1 and checks the Host header. No `{@html}` is used in the panel. I found no practical ReDoS: the only user-influenced regexes are suite-authored patterns (`tool_hint`, `namePattern`, `status_category`) matched against subject text, and they are linear.

The concerns that matter are all on the container path and in scoring. The container path as committed cannot produce a meaningful result, and in one configuration it produces a false PASS. Scoring lets a case pass with zero checks.

Structural findings (fallow): none were supplied for this review.

Verification note: CR-01 and CR-02 were reproduced in-process by running `runSuite` with the fake `good` variant on `T1-STD-CATALOG`, `T2-CATALOG-API` and `T3-RT-DOCS` with `golden: []`. The result was verdict PASS, gate pass, score null and 0 checks on every case.

## Critical Issues

### CR-01: Container driver tree omits `golden.jsonl` and CSV fixtures, so container runs silently score against empty goldens and return PASS

**File:** `src/lib/server/mcptest/containerRun.ts:71` (also `:90`)
**Issue:** `readDriverTree` stages only files whose extension is in `TEXT_EXT = {.ts,.json,.yaml,.yml,.md,.mjs}`. Every case directory carries `golden.jsonl` (12 files) and the dump case carries `.csv` fixtures. None of these are staged. Inside the container, `loadCaseDir` treats a missing `golden.jsonl` as optional (`cases.ts:224-231`, `readOptional` returns `{}` on ENOENT), so it does not fail. Every case loads with `golden = []` and `T2-CATALOG-DUMP` becomes `SKIPPED_FIXTURE`. The runner then connects, lists tools, sets D1 pass and evaluates zero checks. Combined with CR-02, the report says verdict PASS, gate pass, score null, with 0 checks per case. The driver reports `exitCode 0` and a schema-valid report, so the host accepts it. The unit test (`containerRun.test.ts:195-207`) only asserts the suite directory is present, not that `golden.jsonl` is.
**Fix:**
```ts
const TEXT_EXT = new Set(['.ts', '.json', '.jsonl', '.yaml', '.yml', '.md', '.mjs', '.csv'])
```
Also make the driver fail closed. After `loadSuite()`, throw if any selected case has `golden.length === 0` and is not one of the known golden-less cases. Add a test that `readDriverTree()` includes every `suite/*/golden.jsonl` and that the in-container `loadSuite` result equals the host result.

### CR-02: `evaluateCase` passes a case that has zero scored checks (vacuous PASS); verdict can be PASS with a null score

**File:** `src/lib/mcptest/core/scoring.ts:171-185` (also `:247-248`)
**Issue:** When D1 passed and there are no scored checks and no decisive thresholds, `ok = scoredChecks.every(...)` is `true` on an empty array. The only guard (`scoredChecks.length === 0 && dims.D1 === null`) covers D1 null, not D1 true. A case that ran but evaluated nothing, whether from empty golden, all-NA checks, or thresholds that are all unscorable (`met === null`), is reported as PASS. `rollUp` then reports `verdict: 'PASS'` with `score.value: null`. A scorer should fail closed when it measured nothing.
**Fix:**
```ts
else if (scoredChecks.length === 0) ok = false // nothing was measured: never a PASS
// and below, make the empty case an ERROR (scorer problem), not a FAIL:
else if (scoredChecks.length === 0 && decisive.length === 0) state = 'ERROR'
```
Also make `rollUp` refuse `PASS` when `score.value === null` (use INCOMPLETE).

### CR-03: Phase 8 runtime hard-codes `User: 'pi'`, but the runner image only has user `node`, so container creation cannot work

**File:** `src/lib/server/tryitout/runtimeDockerode.ts:53` vs `Containerfile.mcp-test-runner:36-38`
**Issue:** `buildCreateOptions` sets `User: 'pi'` and a `/home/pi/agent` tmpfs for every image. `Containerfile.mcp-test-runner` ends with `USER node` and never creates a `pi` user (the Pi image does `usermod -l pi`). Creating or starting the container will fail with "unable to find user pi". The container-run path in `containerRun.ts` (reusing `createDockerodeRuntime`) therefore cannot start. The `/home/pi/agent` tmpfs mountpoint also does not exist in this image under `ReadonlyRootfs`. This contradicts the Phase 15 claim that the image reuses the Phase 8 contract. The fake runtime hides the problem.
**Fix:** Make the user part of `RunnerConfig` (for example `runUser`, default `pi`, and `node` in `mcpTestRunnerConfig`), and omit the `/home/pi/agent` tmpfs when it is not the Pi image. Or create a `pi` user and `/home/pi/agent` in the Containerfile (`usermod -l pi -d /home/pi -m node && groupmod -n pi node`). Add a contract test that parses `Containerfile.mcp-test-runner` for the user that `buildCreateOptions` names.

### CR-04: `DRIVER_CMD` runs bare `tsx`, which is not on PATH in the runner image

**File:** `src/lib/server/mcptest/containerRun.ts:22` vs `Containerfile.mcp-test-runner:25-34`
**Issue:** The image runs `npm install --prefix / ... tsx@4.21.0`. That places the binary at `/node_modules/.bin/tsx`. The only PATH change is `ENV PATH=/opt/venv/bin:$PATH`, so `/node_modules/.bin` is not on PATH. `exec(['tsx', ...])` fails with "executable file not found". The driver never runs.
**Fix:** Either `ENV PATH=/node_modules/.bin:/opt/venv/bin:$PATH` in the Containerfile, or change `DRIVER_CMD` to `['node', '--import', 'tsx', '/work/src/lib/mcptest/driver.ts']`, and add `ENV NODE_PATH=/node_modules`. Extend `containerfile.test.ts` to assert the executable used by `DRIVER_CMD[0]` is reachable.

## Warnings

### WR-01: HTTP transport follows redirects, bypassing the loopback-only restriction (SSRF)

**File:** `src/lib/mcptest/core/transports/streamableHttp.ts:144, 200, 213`
**Issue:** `parseLoopback` validates only the initial URL. `fetch` defaults to `redirect: 'follow'`, so a loopback server (or any future `Launch.kind: 'http'` subject) can answer 302 to `http://169.254.169.254/...` or an internal host. The client follows it and sends the `MCP-Session-Id` header along. The header comment says "the runner never touches real hosts". No current subject produces `kind: 'http'`, but the guard is the platform's SSRF defence and it is incomplete.
**Fix:** Pass `redirect: 'error'` (or `'manual'` and treat 3xx as `bad_response`) in all three `doFetch` calls.

### WR-02: Flag-off requests with a non-handled method return 405, not 404, so route existence leaks

**File:** `src/routes/api/mcp-test/runs/+server.ts:33`, `src/routes/api/mcp-test/runs/[id]/+server.ts:7`, `src/routes/api/mcp-test/runs/[id]/report/+server.ts:7`
**Issue:** Each file exports one method handler. SvelteKit answers any other method (for example `GET /api/mcp-test/runs`, `POST /api/mcp-test/runs/<id>`) with 405 and an `Allow` header before any handler code runs. With `MCP_TESTER` off the tests only call the exported handlers directly, so "404 on every route" is not true over HTTP.
**Fix:** Export `export const fallback: RequestHandler = () => error(404, 'Not found')` in each file. When the flag is on, return 405 explicitly from the fallback.

### WR-03: TTL eviction removes active runs, freeing the single-flight slot while the work keeps running; host mode has no overall deadline

**File:** `src/lib/server/mcptest/jobs.ts:46-49`, `src/lib/server/mcptest/service.ts:153-167`
**Issue:** `evict()` deletes every record older than `ttlMs` regardless of status. The comment at line 50 says running runs are never evicted, but that holds only for the size-cap loop. In the default in-process mode `executeRun` passes no `signal` or total deadline to `runSuite` (the only bound is the 5 s per-request client timeout). A hung or pathological run holds the slot for up to 30 minutes, then the run is evicted. `activeCount()` drops to 0, a new run starts, and the old work is still consuming CPU on the web process event loop. Repeating this stacks unbounded concurrent in-process runs, which is the invariant the global cap exists to enforce.
**Fix:** Skip active runs in the TTL sweep, or mark them `failed` and abort them. Add an `AbortController` per run, pass `signal` to `runSuite`, and enforce a hard wall-clock cap (for example 5 minutes) in `executeRun`.

### WR-04: Container can leak when the timeout fires during `createAndStart`, and leaked containers are never swept

**File:** `src/lib/server/mcptest/containerRun.ts:197-206, 260-274`; `src/lib/server/tryitout/runtimeDockerode.ts:277-283`
**Issue:** `containerId` is assigned only after `createAndStart` resolves. If `guard` rejects (timeout or abort) while the engine call is in flight, `finally` sees `containerId === null` and skips `remove`. The container is created and started afterwards and nobody removes it. The code comment says the "orphan sweep labels (aic.mcptest) cover leftovers", but the Phase 8 sweep and `listManaged` filter on `aic.tryitout=1`. The mcptest container carries only `aic.mcptest` and `aic.instance`, so no sweep ever finds it. It then lives on a `sleep infinity` process indefinitely.
**Fix:** Add `LABEL_MANAGED: '1'` (and the owner label) to the container labels so the existing reaper covers them. Track the in-flight create promise and remove its result in `finally` (for example `const created = runtime.createAndStart(...)` then `containerId = await created`, and in `finally` await `created.catch(() => null)` to learn the id).

### WR-05: Container report can be forged by the subject, and the raw container text (not the validated data) is served

**File:** `src/lib/server/mcptest/containerRun.ts:229-258`; `src/lib/mcptest/core/transports/stdio.ts:51, 105-109`
**Issue:** The generated server runs as the same uid as the driver, in a container whose `/work/out` is mode 0777 on a writable tmpfs. `spawnStdioChannel` kills only the direct child (no `detached` process group, `kill` targets `child`), so a server that forks a daemon survives the case, can see `/work/in/request.json` and `golden.jsonl`, and can overwrite `/work/out/report.json` after the driver writes it but before `getFiles`. The host then stores and serves `reportJson: text`, the original bytes, not `JSON.stringify(checked.data)`. Zod strips unknown keys in `checked.data` but the raw text keeps them, so up to 1 MB of unvalidated content passes through. This weakens the "report cannot be gamed by the subject" assumption of the whole scorer.
**Fix:** Spawn the subject in its own process group (`detached: true`) and `process.kill(-pid, 'SIGKILL')` on close. Have the driver write the report to a path the subject cannot modify (a root-owned dir, or hand the report back on stdout). On the host, store `JSON.stringify(checked.data)`.

### WR-06: Streamable HTTP client buffers unbounded data before enforcing its size cap

**File:** `src/lib/mcptest/core/transports/streamableHttp.ts:121-130, 164-168`
**Issue:** In `readSse`, `data` lines are appended without a cap. The cap only checks the incomplete-line buffer, so many short `data:` lines with no blank line grow `data` without bound. In the JSON branch `await res.text()` reads the whole body first and checks `text.length > maxBytes` afterwards. A hostile loopback subject can stream gigabytes within the cell timeout, because abort happens only at `close()`.
**Fix:** Track a running byte count across `data` entries and cancel the reader when it exceeds `maxBytes`. For JSON read through the stream with a byte counter and cancel on overflow. Abort the request on client timeout too.

### WR-07: Verdict can be PASS when the Tier 1 gate never ran

**File:** `src/lib/mcptest/core/scoring.ts:217-218, 244-249`
**Issue:** `gate` is `not_run` whenever no Tier 1 case is in `RAN` (for example `GEN_FAILED`, `INSTALL_FAILED`, `UNAVAILABLE`, `PENDING_HUMAN`, `SKIPPED_FIXTURE`). `scoring` only contains Tier 2 and Tier 3 cases, so Tier 1 never counts toward coverage. If every applicable Tier 2/3 case ran and passed, the precedence block returns `PASS` while the report's own gate field says `not_run`.
**Fix:** `else if (gate !== 'pass') verdict = 'INCOMPLETE'` before the PASS branch, or require `gate === 'pass'` in the PASS condition.

### WR-08: `MCPTEST_JOB_TIMEOUT_MS` is parsed but ignored; container exec is not cancelled on timeout

**File:** `src/lib/server/mcptest/containerRun.ts:60, 196`; `src/lib/server/mcptest/service.ts:142`
**Issue:** `mcpTestRunnerConfig` maps `MCPTEST_JOB_TIMEOUT_MS` into the runner config but `runInContainer` uses `opts.timeoutMs ?? 120_000`, and `service.ts` never passes it, so the operator knob does nothing. The fixed 120 s may also be short for 12 cases x 3 reruns at the default 0.5 CPU, where fault cases alone wait several seconds per rerun. The guard only rejects the wrapper promise; the exec keeps running until `remove` kills the container.
**Fix:** Pass `cfg.jobTimeoutMs` into `runInContainer` and document it. Thread an `AbortSignal` into `runtime.exec` where the runtime supports it.

### WR-09: CLI entry guard is fragile and exits 0 without doing anything

**File:** `scripts/mcp-test.ts:258-261`
**Issue:** `import.meta.url === \`file://${process.argv[1]}\`` fails when the path has characters that URLs encode (spaces, `%`, non-ASCII) or when invoked via a symlink or relative path. `isMain` is then false, nothing runs and the process exits 0, which a CI step reads as a PASS verdict. `driver.ts` does it correctly with `fileURLToPath`.
**Fix:**
```ts
import { fileURLToPath } from 'node:url'
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
```

### WR-10: Driver request schema permits interpreter flags and dangerous environment variable names

**File:** `src/lib/mcptest/driverRequest.ts:24-35, 49`
**Issue:** `args` accepts any relative-looking string up to 200 chars, including `-c`, `-m`, `--eval`, `-e`, `-p`, and `command` is `python3` or `node`. So `{command:'python3', args:['-c','import os;...']}` validates. `envNames` accepts any `[A-Z][A-Z0-9_]{1,63}` including `PATH`, `HOME`, `LD_PRELOAD`, `NODE_OPTIONS`, `PYTHONPATH`. `buildEnv` writes the mock URL and canary under those names, and `stdio.ts:40-42` lets caller env override PATH/HOME/LANG. Today the request is built server-side from the trusted generator, and the container is the isolation, so this is defence in depth, but the schema is described as the single trust boundary.
**Fix:** Require `args[0]` to end in `.py` or `.js`, reject args starting with `-`, and deny-list reserved env names (`PATH`, `HOME`, `LANG`, `LD_*`, `NODE_*`, `PYTHON*`). Apply the same checks to the CLI `--env-*` flags.

### WR-11: Subject-controlled fields appear in the report unredacted and unbounded

**File:** `src/lib/mcptest/core/report.ts:94, 279-280` (schema `z.string()` without `.max`); `src/lib/mcptest/core/runner.ts:258-263`
**Issue:** `buildReport` runs `clean()` on check reasons, state reasons, flags and findings, but not on `subject.toolNames`, `serverInfo.name/version` or `protocolVersion`, all of which come from the server under test. A server that echoes its API key (the canary) there leaks it into the report without the redactor seeing it, and a server with a huge name list inflates the report. The runner's over-cap fallback trims cases only, does not touch these fields, and does not re-check size afterwards, so the result can still exceed `MAX_REPORT_BYTES` (the job store then fails the run).
**Fix:** Pass `toolNames` (capped, say 200 names x 80 chars), `serverInfo` and `protocolVersion` through `clean`, give the schema `.max()` bounds, and call `assertReportSize` again after the fallback.

### WR-12: Rate limit and single-flight key both depend on client-controlled or proxy-collapsed identity

**File:** `src/routes/api/mcp-test/runs/+server.ts:54-63`
**Issue:** The per-session cap uses `sessionKey`, which mints a new anonymous key whenever the cookie is absent. The per-client limiter uses `getClientAddress()`, which behind a reverse proxy without a trusted forwarded header is the proxy's address for every visitor. Result: the 10-per-10-minutes budget is shared by all users (one noisy visitor locks everyone out), and the per-session cap is trivially evaded, leaving only the global single-flight cap. There is also an unauthenticated global denial of service: anyone can keep the one slot occupied.
**Fix:** Document that `ADDRESS_HEADER` and `XFF_DEPTH` must be configured when the app is proxied. Consider keying the limiter on the authenticated user when auth is on, and add a short cool-down after a run ends.

## Info

### IN-01: `pagination_ceiling` passes whenever the response carries no leak

**File:** `src/lib/mcptest/core/validators.ts:130-135`
**Issue:** The check never inspects the response beyond leak detection, so a server that ignores the ceiling and returns data, or returns a clean error, passes. This follows the study rule but it is a weak discriminator and it is one of the ten headline checks.
**Fix:** Also require either an explicit error or an empty or capped page. Record the decision in the fidelity table.

### IN-02: Envelope-word leak heuristic is applied to successful payloads

**File:** `src/lib/mcptest/core/leak.ts:19-20`, used from `validators.ts:73` and `expect.ts:249`
**Issue:** Three of `timestamp`, `status`, `error`, `path` anywhere in a response text (case-insensitive substring) raises a `LEAK` blocker, which forces verdict BLOCKED. A legitimate item with `status`, `path` and a description containing "error" would trip it. The rule is ported deliberately ("must not change") but it is applied to non-error results too.
**Fix:** Apply the envelope rule only to error outcomes, or require the words as JSON keys of one object.

### IN-03: `toLegacyCsvRow` is unused and not safe against spreadsheet formula injection

**File:** `src/lib/mcptest/core/report.ts:388-407`
**Issue:** The function has no callers outside tests. If it is ever wired to a download, `subject.id` and tool names (server-controlled) starting with `=`, `+`, `-` or `@` become formulas.
**Fix:** Remove it, or prefix such cells with `'` in `esc`.

### IN-04: Run ids are the only read authorisation; the stored session key is never checked

**File:** `src/lib/server/mcptest/jobs.ts:21-22`, `src/routes/api/mcp-test/runs/[id]/+server.ts`, `.../report/+server.ts`
**Issue:** `sessionKey` is stored per run but status and report reads ignore it. UUID v4 ids are unguessable, so this is acceptable for the stated threat model, but it is a field that looks like authorisation and is not.
**Fix:** Compare `run.sessionKey` to `sessionKey(event)` on reads, or delete the comment's implication and document that the id is a bearer capability.

### IN-05: Docs and panel disagree; body is read fully before the size check

**File:** `docs/mcp-test-platform.md` (UI section) vs `src/lib/components/McpTestPanel.svelte:84-88`; `src/routes/api/mcp-test/runs/+server.ts:36-44`
**Issue:** The docs say the UI lets the user "optionally narrow the cases". The panel posts only `subject` and `reruns`. Separately, the 4096-byte cap on a chunked body (no `content-length`) is enforced only after `request.text()` has read it. The adapter's `BODY_SIZE_LIMIT` bounds this in practice.
**Fix:** Align the docs with the UI (or add the case picker). Read the body through a counting stream.

### IN-06: Small unbounded structures in long-lived objects

**File:** `src/lib/mcptest/core/client.ts:51, 141` (`timedOut` Set); `src/lib/mcptest/mock/upstream.ts:318` (`entries`)
**Issue:** Both grow with the number of timeouts or requests in a cell, and a hostile subject can drive both. They are bounded by cell lifetime, so low impact.
**Fix:** Cap `entries` (for example 5000, dropping the oldest while keeping the counter) and bound `timedOut`.

---

_Reviewed: 2026-10-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
