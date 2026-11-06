---
phase: "08"
slug: "container-backed-try-it-out-warm-on-visit"
status: planned
nyquist_compliant: true
wave_0_complete: false
created: "2026-10-08"
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.0 |
| **Config file** | `vitest.config.ts` (node env; components use jsdom; includes `src/**/*.test.ts`, `scripts/**/*.test.ts`) |
| **Quick run command** | `npx vitest run <touched test file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

Known baseline: 3 tests in `scripts/set-try-it-out-mode.test.ts` already fail before this phase (pre-existing). The suite is otherwise green.

---

## Sampling Rate

- **After every task commit:** Run the touched test file(s) with `npx vitest run <file>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite green (apart from the 3 known pre-existing failures), plus one recorded live smoke run
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled by the planner (2026-10-08). Plan-task IDs refer to `08-NN-PLAN.md` Task N.

| Task | Wave | Decision | Behavior | Test Type | Automated Command | File Exists | Status |
|------|------|----------|----------|-----------|-------------------|-------------|--------|
| 08-01 T1 (tracer) | 1 | D-01/D-04/D-15 | Runtime contract: fake and dockerode (mocked engine) pass one lifecycle suite | unit | `npx vitest run src/lib/server/tryitout/runtimeContract.test.ts` | created in task | pending |
| 08-01 T2 | 1 | D-03/D-19/D-21 | Create options (CapDrop ALL, limits, tmpfs, no ports), fs-mode switch, internal-network guard, engine error mapping, getFiles traversal/caps, config parser | unit | `npx vitest run src/lib/server/tryitout/runtimeDockerode.test.ts src/lib/server/tryitout/runnerConfig.test.ts src/lib/server/tryitout/runtimeContract.test.ts` | created in task | pending |
| 08-02 T1 (tracer) | 1 | D-11/D-12 | Pi success fixture -> JobEvents + succeeded verdict | unit | `npx vitest run src/lib/server/tryitout/piEvents.test.ts` | created in task | pending |
| 08-02 T2 | 1 | D-16 | Failure verdicts (model error exit 0, retry failure, timeout, exit codes), parser framing edge cases | unit | `npx vitest run src/lib/server/tryitout/piEvents.test.ts` | created in T1 | pending |
| 08-02 T3 | 1 | D-02/R-05 | SKILL.md frontmatter valid; fallback loader strips it; loadPiSkill | unit | `npx vitest run src/lib/server/tryItOutPrompts.test.ts src/lib/server/tryItOutRunner.test.ts` | update existing | pending |
| 08-03 T1 (tracer) | 1 | D-17 | Token-authed request streams through proxy, real key injected server-side, model forced | route | `npx vitest run src/routes/api/llm/v1/chat/completions/proxy.test.ts` | created in task | pending |
| 08-03 T2 | 1 | D-17/D-22 | 401/429/413/400, revocation, per-job budget, whitelist | unit | `npx vitest run src/lib/server/tryitout/llmProxy.test.ts src/routes/api/llm/v1/chat/completions/proxy.test.ts` | created in task | pending |
| 08-03 T3 | 1 | D-17/D-19 | `/api/llm/` bypasses user auth; other `/api/*` still 401 | unit | `npx vitest run src/hooks.server.test.ts` | created in task (no prior hooks test) | pending |
| 08-04 T1 (tracer) | 2 | D-13/D-14 | Succeeded job downloads `aic-job-<id>.zip` with result.txt (fallback producer), client filename .zip | route/unit | `npx vitest run src/routes/api/tryitout/jobs/jobs.test.ts src/lib/server/tryItOutRunner.test.ts src/lib/tryItOut.test.ts` | update existing | pending |
| 08-04 T2 | 2 | D-12/D-13 | Typed pushEvent, sessionKey, zip name checks and caps, symlink skip | unit | `npx vitest run src/lib/server/tryItOutJobs.test.ts src/lib/server/tryitout/artifact.test.ts src/routes/api/tryitout/jobs/jobs.test.ts` | created in task | pending |
| 08-05 T1 (tracer) | 2 | D-02/D-17/D-18 | Warm stages models.json/base prompt/SKILL.md with per-lease token; claim/release; reload reuse | unit (fake runtime) | `npx vitest run src/lib/server/tryitout/service.test.ts` | created in task | pending |
| 08-05 T2 | 2 | D-06/D-08/D-09/D-10/D-07 | Cap, min idle age, busy, session_busy, CAS race, replace, TTL reaper, orphan sweep | unit (fake runtime, fake timers) | `npx vitest run src/lib/server/tryitout/leaseManager.test.ts src/lib/server/tryitout/service.test.ts` | created in task | pending |
| 08-05 T3 | 2 | D-06 | sessionKey (user email or anon cookie), service start-up idempotent and safe | unit | `npx vitest run src/lib/server/tryitout/session.test.ts src/lib/server/tryitout/service.test.ts src/lib/server/tryitout/leaseManager.test.ts` | created in task | pending |
| 08-06 T1 (tracer) | 3 | D-11/D-12/D-13/D-15 | POST job runs in fake container: tool events, files-not-argv, zip of Pi output, cleanup | route (fake runtime) | `npx vitest run src/routes/api/tryitout/jobs/jobs.test.ts` | update existing | pending |
| 08-06 T2 | 3 | D-14 | Fallback only on engine_unavailable/container_start_failed; busy never falls back; env switch; invariant it.each | unit | `npx vitest run src/lib/server/tryItOutRunner.test.ts` | update existing | pending |
| 08-06 T3 | 3 | D-16/D-22/D-07 | Timeout, budget, model error, exit codes, empty output, reuse, discard | unit (fake runtime) | `npx vitest run src/lib/server/tryitout/piRunner.test.ts src/lib/server/tryItOutRunner.test.ts src/routes/api/tryitout/jobs/jobs.test.ts` | created in task | pending |
| 08-07 T1 (tracer) | 3 | D-05/D-06/D-10 | Runnable page load warms without awaiting; cookie set; non-runnable never warms | unit | `npx vitest run src/routes/agents/warm.test.ts src/routes/agents/detail.test.ts` | created in task | pending |
| 08-07 T2 | 3 | D-05 | init hook starts the service; import does not | unit | `npx vitest run src/hooks.server.test.ts src/routes/agents/warm.test.ts` | update existing | pending |
| 08-08 T1 (tracer) | 4 | D-02/D-20 | Image pinned/offline env; smoke script compiles and fails cleanly without an engine | script | `npx tsc --noEmit && npx tsx scripts/smoke-pi-runner.ts --help` (+ nonexistent-socket exit 1) | created in task | pending |
| 08-08 T2 | 4 | D-01/D-19 | Compose/env/docs; full suite; build; client bundle has no OPENAI_API_KEY or dockerode | gate | `npx vitest run --exclude scripts/set-try-it-out-mode.test.ts` (hard gate) && baseline file run with `--reporter=json` asserted to have exactly 3 failed tests && `npx tsc --noEmit && npm run build && ! grep -rq "OPENAI_API_KEY" build/client/ && ! grep -rq "dockerode" build/client/` (full command in 08-08-PLAN.md Task 2) | n/a | pending |
| 08-08 T3 | 4 | D-01/D-03/D-19/D-20/D-21 (live) | Socket, internal DNS, egress blocked, Pi offline, fs mode, limits, timeout kill, warm on visit, zip, fallback, TTL cleanup, orphan cleanup | live smoke (manual checkpoint) | `npx tsx scripts/smoke-pi-runner.ts` on a Podman host | created in 08-08 T1 | pending |

*Status: pending · green · red · flaky*

Notes:
- `npm test` baseline: 3 pre-existing failures in `scripts/set-try-it-out-mode.test.ts`; full-suite commands accept exactly those. The 08-08 gate enforces this mechanically: it runs the suite with that file excluded as a hard gate, then runs that file alone and fails unless the JSON reporter shows exactly 3 failed tests.
- The warm-trigger test lives at `src/routes/agents/warm.test.ts` (not inside `[slug]/`) to avoid bracket globbing in vitest filters.
- Wave 0 items are created inside the first tasks of wave-1 plans (fake runtime in 08-01 T1, Pi fixtures in 08-02 T1); every task has an automated command, so no MISSING sentinels are needed.

---

## Wave 0 Requirements

- [ ] Live spike script (needs Podman): confirm `putArchive` into tmpfs and a read-only rootfs, exec demux and exit code, `--internal` DNS, compat socket access from the app container; its result selects the file-staging variant
- [ ] `src/lib/server/tryitout/runtimeFake.ts` — shared fake runtime (scriptable exec stdout JSONL, injected failures, latency, archive store)
- [ ] Recorded Pi JSONL fixtures (success with read/write tools, model-error with exit 0, retry failure), hand-written from Pi `docs/json.md`
- [ ] Test files listed in the map above
- [ ] `npm install dockerode tar-stream fflate` and `@types/dockerode` (vitest is already present)

---

## Manual-Only Verifications

| Behavior | Decision | Why Manual | Test Instructions |
|----------|----------|------------|-------------------|
| Warm container starts on page open and the first job completes in Pi | D-05, D-11 | Needs Podman, the built image and a real OpenAI key | Run `scripts/smoke-pi-runner.ts`, then open `/agents/demo-rfi-triage`, run the sample RFI and download the zip |
| Container cannot reach anything except the LLM proxy | D-19 | Needs a real internal network | From a warm container, confirm an external host fails and the proxy alias answers |
| App-in-container start with the socket mounted | D-01 | Needs the compose stack | `podman-compose up`, open the page, confirm a Pi container appears and is cleaned up after the idle TTL |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
