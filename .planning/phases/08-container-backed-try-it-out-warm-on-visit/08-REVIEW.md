---
phase: 08-container-backed-try-it-out-warm-on-visit
reviewed: 2026-10-12T00:00:00Z
depth: standard
files_reviewed: 53
files_reviewed_list:
  - Containerfile
  - Containerfile.pi-runner
  - .containerignore
  - data/tryitout-prompts/demo-rfi-triage/SKILL.md
  - .env.example
  - package.json
  - podman-compose.yml
  - README.md
  - scripts/smoke-pi-runner.ts
  - src/hooks.server.test.ts
  - src/hooks.server.ts
  - src/lib/server/tryitout/artifact.test.ts
  - src/lib/server/tryitout/artifact.ts
  - src/lib/server/tryitout/config.ts
  - src/lib/server/tryItOutJobs.test.ts
  - src/lib/server/tryItOutJobs.ts
  - src/lib/server/tryitout/leaseManager.test.ts
  - src/lib/server/tryitout/leaseManager.ts
  - src/lib/server/tryitout/llmProxy.test.ts
  - src/lib/server/tryitout/llmProxy.ts
  - src/lib/server/tryitout/piEvents.test.ts
  - src/lib/server/tryitout/piEvents.ts
  - src/lib/server/tryitout/piFixtures.ts
  - src/lib/server/tryitout/piInstruction.test.ts
  - src/lib/server/tryitout/piRunner.test.ts
  - src/lib/server/tryitout/piRunner.ts
  - src/lib/server/tryItOutPrompts.test.ts
  - src/lib/server/tryItOutPrompts.ts
  - src/lib/server/tryitout/runnerConfig.test.ts
  - src/lib/server/tryitout/runnerConfig.ts
  - src/lib/server/tryItOutRunner.test.ts
  - src/lib/server/tryItOutRunner.ts
  - src/lib/server/tryitout/runtimeContract.test.ts
  - src/lib/server/tryitout/runtimeDockerode.test.ts
  - src/lib/server/tryitout/runtimeDockerode.ts
  - src/lib/server/tryitout/runtimeError.test.ts
  - src/lib/server/tryitout/runtimeFake.ts
  - src/lib/server/tryitout/runtime.ts
  - src/lib/server/tryitout/service.test.ts
  - src/lib/server/tryitout/service.ts
  - src/lib/server/tryitout/session.test.ts
  - src/lib/server/tryitout/session.ts
  - src/lib/tryItOut.test.ts
  - src/lib/tryItOut.ts
  - src/routes/agents/detail.test.ts
  - src/routes/agents/[slug]/+page.server.ts
  - src/routes/agents/warm.test.ts
  - src/routes/api/llm/v1/chat/completions/proxy.test.ts
  - src/routes/api/llm/v1/chat/completions/+server.ts
  - src/routes/api/tryitout/jobs/[id]/artifact/+server.ts
  - src/routes/api/tryitout/jobs/jobs.test.ts
  - src/routes/api/tryitout/jobs/+server.ts
  - vite.config.ts
findings:
  critical: 0
  warning: 9
  info: 5
  total: 14
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-10-12
**Depth:** standard
**Files Reviewed:** 53

## Summary

Source files were read in full (runtime, lease manager, proxy, runner, session, config, routes, hooks, compose, Containerfiles). Test files were read only where they bear on a finding. No secrets were read (.env untouched).

The security-sensitive core is largely sound:

- Proxy tokens are 256-bit random values, stored by SHA-256 digest and looked up in a Map, so there is no usable timing oracle.
- The upstream body is built from an allow-list, the model is forced server-side, and the real key is never logged or echoed by the proxy itself.
- Job ids are UUID-validated before any `join()`, slugs go through `AgentIdSchema`, and the task and upload reach the container only as tar entries, never in argv.
- Tar entries from `getArchive` are filtered to regular files with `isSafeRelativePath`, so symlinks and `..` are dropped.
- Create options drop all caps, set no-new-privileges, a read-only rootfs and resource limits, and publish no ports.
- The eviction CAS is synchronous, so a claim and an eviction cannot interleave.

There are no BLOCKERs. The defects are in the failure paths: stuck leases, missing timeouts, a bypassable egress guard, unrecorded failures, and error-string leakage. Several are reachable in normal operation, for example a hung engine or a bad env value.

## Warnings

### WR-01: A warm-up that stalls leaves the lease in `warming` forever and holds a cap slot

**File:** `src/lib/server/tryitout/leaseManager.ts:180-193, 208, 228`; `src/lib/server/tryitout/service.ts:83-108`

**Issue:** `awaitReady` races `lease.ready` against a timer but does nothing to the lease when the timer wins. `startLease` has no timeout of its own: `createAndStart`, `putFiles` and the `test -f` exec in `stage` are unbounded awaits. If any of them hangs (engine stall, wedged Podman API), the lease stays `warming` in the `leases` map. Consequences:

1. `pickEvictionCandidate` only considers `idle`, and `reap` only reaps `idle`, so the slot is never reclaimed. Enough of these and the global cap is permanently consumed, so every later request gets `busy`.
2. Every later `claim` for that session finds the same `warming` lease via `acquire`, waits `warmWaitMs` (90 s by default) again and fails with `container_start_failed`. Each job then runs on the direct-LLM fallback, because that error code triggers D-14.

The existing test "claim while warming times out after warmWaitMs" (`leaseManager.test.ts:167`) uses a never-resolving stage and only asserts the rejection, so it pins the leak without noticing it.

**Fix:** On timeout, evict the lease and fail it so the slot and token are released:

```ts
async function awaitReady(lease: Lease) {
  ...
  try { await Promise.race([lease.ready, timeout]) }
  catch (e) { if (lease.state === 'warming') void evictSync(lease, 'expired'); throw e }
  finally { clearTimeout(timer) }
}
```

Also give `reap` a branch that expires `warming` leases older than `warmWaitMs * 2`. Put per-call timeouts around `stage` and `createAndStart`.

### WR-02: Housekeeping execs have no timeout, so a hung engine wedges a lease in `running`

**File:** `src/lib/server/tryitout/piRunner.ts:195-216`; `src/lib/server/tryitout/runtimeDockerode.ts:199-231`

**Issue:** The job exec is protected by the timeout race, but the `rm -rf jobDir` cleanup in `finally` is awaited with no bound. `runtimeDockerode.exec` waits on `stream.on('end'|'close')` with no deadline. If the engine stalls at that point (the job result is already recorded), `svc.leases.release(lease)` is never reached. The lease stays `running` forever, the reaper skips it, and every later job from that session fails with `session_busy` ("a job is already running in your session"). The slot is also lost to the cap. Only an app restart clears it.

**Fix:** Wrap the cleanup exec in a `Promise.race` with a short timer, 5-10 s. On timeout or failure, `discard` the lease instead of releasing it, because the work dir state is unknown:

```ts
const cleaned = await Promise.race([cleanup().then(() => true), delay(10_000).then(() => false)]).catch(() => false)
if (cleaned) svc.leases.release(lease); else await svc.leases.discard(lease).catch(() => {})
```

### WR-03: The "refuse open egress" guard is only enforced at startup, and a failed startup skips it, the reaper and the orphan sweep

**File:** `src/lib/server/tryitout/service.ts:158-170`; `src/lib/server/tryitout/runtimeDockerode.ts:169-183`

**Issue:** `ensureNetwork()` is the only place that checks `Internal === true` (D-19/D-20). It runs once inside the startup IIFE, after `ping()`. If `ping()` throws (socket not ready yet, which is common when the app and Podman start together), the `catch` only logs a warning. `ensureNetwork`, `sweepOrphans` and `startReaper` are then never run. Meanwhile `ensureWarm` and `claim` still call `createAndStart`, which uses `cfg.network` with no check. Result:

- If `PI_RUNNER_NETWORK` is `podman`, `host`, or any existing non-internal network, Pi containers run with open egress, despite the explicit refusal logic and the `PI_RUNNER_ALLOW_OPEN_EGRESS=false` pin in compose.
- With no reaper, idle containers are never TTL-expired, and orphans from a previous instance are never swept. Nothing retries.

**Fix:** Make the network check part of `createAndStart`, or memoise a "network verified" promise that `startLease` awaits. Retry the startup sequence with backoff instead of one-shot, and start the reaper unconditionally. The timer is cheap and `reap` only touches known leases.

### WR-04: `runJob` can reject or leave the job `running` forever on a bad config

**File:** `src/lib/server/tryItOutRunner.ts:49-71`; `src/lib/server/tryitout/piRunner.ts:73`; `src/lib/server/tryitout/config.ts:11`

**Issue:** `parseRunnerConfig` throws plain `Error`s on invalid values, for example `PI_RUNNER_FS_MODE=foo` or `PI_RUNNER_MAX_CONTAINERS=abc`. The throw comes from `getTryItOutService()` inside `runJobInContainer`, before any claim. In `runJob`'s `catch`, the first statement is `getTryItOutService().config.fallbackEnabled`, which throws the same error again. `runJob` therefore rejects, and the route swallows it with `runJob(job.jobId).catch(() => {})`. The job has already been set to `running` and is never moved to `failed`. The client polls a `running` job forever with no error string, which violates D-16 and the doc comment "Never rejects". `warmForSession` already guards this call, but `runJob` does not.

**Fix:**

```ts
let fallbackEnabled = false
try { fallbackEnabled = getTryItOutService().config.fallbackEnabled } catch { /* config invalid */ }
```

Better, wrap the whole `catch` body so it always ends in `setStatus(jobId, 'failed', ...)`.

### WR-05: Per-job budget is advisory: no default completion cap, usage lost on aborted streams, concurrent requests overshoot

**File:** `src/lib/server/tryitout/llmProxy.ts:129-151, 193-223, 253-264`

**Issue:** Three gaps in the D-17/D-22 budget enforcement.

1. `MAX_COMPLETION_TOKENS` is applied only when the caller already sent a numeric `max_tokens` or `max_completion_tokens`. If neither is sent (a client that omits both), the request goes upstream with no completion cap, and a single response can be tens of thousands of tokens. A non-number value is not clamped either.
2. Usage is added only after a response finishes (`meterStream`, or `payload.usage`). When the container aborts a stream, `fetch` is aborted through `request.signal`, `meterStream` throws, and the `catch` swallows it, so those tokens are never counted. A client that aborts after reading the content pays nothing against `maxTotalTokens`. Only the 40-request cap remains.
3. The budget check happens before the upstream call, using usage that only includes completed requests. N parallel requests all pass the check.

**Fix:** Always set the cap, for example `out.max_completion_tokens = Math.min(typeof v === 'number' ? v : Infinity, MAX_COMPLETION_TOKENS)` when neither key is a number. Charge an estimate on abort or error (for example the cap, or the request size). Track in-flight requests and reject when `requests - finished >= 1` per lease, or reserve the cap against the budget before dispatch.

### WR-06: Upstream error bodies and infrastructure details are surfaced verbatim to anonymous visitors

**File:** `src/lib/server/tryitout/llmProxy.ts:277-285`; `src/lib/server/tryitout/piEvents.ts:25-26, 175-178, 181-183`; `src/lib/server/tryitout/runtimeDockerode.ts:121-123, 163-165, 179`; `src/lib/server/tryitout/piRunner.ts:194`; `src/lib/server/tryItOutRunner.ts:68`

**Issue:** Two leak paths, both ending in `job.error` or the progress feed, which any holder of the job id can read.

1. When OpenAI returns a non-2xx (for example 401 "Incorrect API key provided: sk-proj-****abcd"), the proxy forwards `errText` as-is. Pi records it in `errorMessage` or `finalError`, and `tracker.verdict` returns it as `error`. The masked key prefix and suffix are echoed to the visitor. The same string appears in the `auto_retry_start` info event.
2. Engine errors carry the host socket path, the image name and a build hint (`podman build -t pi-runner -f Containerfile.pi-runner .`), and the network refusal text. With `PI_FALLBACK_ENABLED=false`, or for any non-fallback code, `err.message` is stored directly. `stderrTail` (500 chars of container stderr) is also passed through.

D-17 says the key never enters the container and is never echoed.

**Fix:** In the proxy, replace upstream error bodies with a sanitized `{error:{message:'upstream error <status>'}}`, optionally passing only `error.type` and `error.code`. In `piRunner` and `runJob`, map `TryItOutRuntimeError` to fixed user-facing strings (`container runner unavailable`, `server busy`) and log the detailed message server-side only.

### WR-07: Cookieless or anonymous visitors can exhaust the container cap (auth disabled)

**File:** `src/lib/server/tryitout/session.ts:29-37`; `src/routes/agents/[slug]/+page.server.ts:21-23`; `src/lib/server/tryitout/leaseManager.ts:151-178`

**Issue:** With `AUTH_ENABLED=false`, the key is an httpOnly random cookie. A client that does not store cookies (a crawler, `curl`, a script) gets a new `anon:<sid>` on every request, and each GET of a runnable agent page starts a new 1 GB / 0.5 CPU container. Five requests fill the cap. After that, real visitors get `busy`, because eviction requires 60 s idle and the attacker keeps arriving. Containers survive 5 minutes each. The `sessionKey` fallback branch (`!cookies`) also mints a fresh ephemeral key per call. D-06's "one container per session" gives no protection when a session costs nothing to create. The same applies to `POST /api/tryitout/jobs`, which accepts any anonymous session.

**Fix:** Warm only when the request already carries a valid session cookie (set it on first visit and warm on the next load or via the client), or require an explicit client call to a warm endpoint. Add a per-IP rate limit on cold lease creation. Document that public deployments must keep `AUTH_ENABLED=true`.

### WR-08: `sweepOrphans` kills containers of any other live app instance on the same engine

**File:** `src/lib/server/tryitout/leaseManager.ts:279-283`; `src/lib/server/tryitout/service.ts:125`

**Issue:** `instanceId` is random per process, and orphans are defined as "managed containers whose instance label differs". D-03 has developers run `npm run dev` against the same rootless Podman socket that the compose-deployed app uses. Starting either one force-removes the other's running containers, mid-job, and the other app's leases keep pointing at dead container ids (the next exec fails, `broken` is set, and the job fails). The same happens with two dev servers, or a rolling restart where the new instance starts before the old one stops.

**Fix:** Namespace by a stable deployment id (for example label `aic.owner=<APP_INSTANCE_NAME or hostname>`) and only sweep containers carrying the same owner. Alternatively, sweep only containers older than the process start time and without a live heartbeat.

### WR-09: Output archive handling buffers whole entries before the size check and leaks the stream on early exit

**File:** `src/lib/server/tryitout/runtimeDockerode.ts:233-269`

**Issue:** `collect(entry)` reads an entire tar entry into memory before `total > limits.maxBytes` is tested. A single 256 MB file (the tmpfs limit; no limit in `layer` mode) is fully buffered in the app process, and the limit only fires afterwards. `header.size` is available up front and should be checked. When `getFiles` throws (`output_invalid`, or an unsafe name), the `for await` over `extract` exits, but `archive` (the HTTP response from the engine) is never destroyed. `archive.pipe(extract)` does not destroy the source, so the socket and response stay open. `piRunner` also does not mark `output_invalid` as `broken`, so the lease goes back to `idle` with a dangling connection.

**Fix:** Check `header.size` against the remaining `maxBytes` before `collect`. Wrap in `try/finally { archive.destroy(); extract.destroy() }`.

## Info

### IN-01: `buildTar` produces an unhandled rejection on an unsafe path

**File:** `src/lib/server/tryitout/runtimeDockerode.ts:91-98`

**Issue:** `done = collect(pack)` is started first. On an unsafe path the code calls `pack.destroy(new Error(...))` and then throws. Nothing awaits or catches `done`, so destroying the pack rejects it as an unhandled rejection, which terminates the process by default on Node 15+. Today every staged path is built from a UUID or a validated slug, so it is latent. It becomes a remote crash the moment someone passes a user-derived name (for example a per-upload filename).

**Fix:** Validate all paths before creating the pack, or `done.catch(() => {})` before throwing.

### IN-02: `getFiles` stores entries in a plain object keyed by tar names

**File:** `src/lib/server/tryitout/runtimeDockerode.ts:236, 266`

**Issue:** `out` is `{}`. A file named `output/__proto__` yields `out['__proto__'] = Uint8Array`, which sets the prototype instead of an own property. The file is silently dropped from `Object.keys` (and from the zip), and the object's prototype becomes a typed array. It only affects the returned map, but the file silently disappears.

**Fix:** Use `Object.create(null)` or a `Map`.

### IN-03: Internal network exposes the whole app, not only the proxy (D-19)

**File:** `podman-compose.yml:36-39`

**Issue:** D-19 says the proxy is the only reachable endpoint. The app container is attached to `aic-pi-internal` with the alias `aic-agent-library` on port 3000, so a Pi container can reach every route. This is the documented "second network" option, so it is deliberate, but it means a prompt-injected Pi can call `POST /api/tryitout/jobs` (when auth is off), `/login` (email send) and `/health`. The proxy is only distinguishable by the token.

**Fix:** Record this as an accepted risk, or place a small nginx relay on `/api/llm/` only (the D-19 relay option).

### IN-04: Container create options leave minor hardening gaps

**File:** `src/lib/server/tryitout/runtimeDockerode.ts:57-67`

**Issue:**

- `Memory` is set without `MemorySwap`, so the container may use up to twice the intended memory in swap on hosts with swap enabled.
- `fsMode: 'layer'` has no disk quota, so a job can fill the host's storage.
- `Privileged` is not explicitly `false`.

**Fix:** Set `MemorySwap: Memory`, and `Privileged: false` for defence in depth. Document that `layer` mode drops the disk limit.

### IN-05: Unbounded JSONL line buffer and unbounded job events

**File:** `src/lib/server/tryitout/piEvents.ts:46-57`

**Issue:** `createJsonlParser.push` appends to `buf` and only flushes on `\n`. A Pi process that emits a very large line (or no LF) grows app-process memory until the job timeout. Pi is trusted software, so this is low risk. Combined with the never-evicted job store, it is a minor hygiene item.

**Fix:** Cap `buf` (for example 1 MB) and drop or reset on overflow.

---

_Reviewed: 2026-10-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
