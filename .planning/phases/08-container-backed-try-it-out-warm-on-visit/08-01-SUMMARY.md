---
phase: 08-container-backed-try-it-out-warm-on-visit
plan: 01
subsystem: infra
tags: [dockerode, podman, container-runtime, tar-stream, zod, vitest]

requires:
  - phase: 07-try-it-out-backend
    provides: tryItOut job store and OpenAI runner that later plans dispatch around
provides:
  - ContainerRuntime interface and TryItOutRuntimeError (runtime.ts)
  - dockerode runtime over the Podman socket with D-21 limits and D-19 network guard
  - in-memory scriptable fake runtime for tests (D-15)
  - env-driven RunnerConfig parser plus getRunnerConfig wrapper
affects: [08-02, 08-05, 08-06, 08-08]

tech-stack:
  added: [dockerode, tar-stream, fflate, "@types/dockerode", "@types/tar-stream"]
  patterns:
    - "Engine library isolated to one implementation file behind an interface"
    - "Pure env parser plus thin $env wrapper (auth-config style)"
    - "Archive API (putArchive/getArchive) for file transfer, never host-path mounts"

key-files:
  created:
    - src/lib/server/tryitout/runtime.ts
    - src/lib/server/tryitout/runnerConfig.ts
    - src/lib/server/tryitout/config.ts
    - src/lib/server/tryitout/runtimeFake.ts
    - src/lib/server/tryitout/runtimeDockerode.ts
    - src/lib/server/tryitout/runtimeContract.test.ts
    - src/lib/server/tryitout/runtimeDockerode.test.ts
    - src/lib/server/tryitout/runnerConfig.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "exec flushes: after the multiplexed stream ends, both demuxed PassThroughs are ended and awaited so no stdout/stderr chunk is lost before the exit code is read"
  - "Built-in networks (podman, bridge, host) are treated as non-internal so the egress guard always applies to them"
  - "Lost network-create race (409) re-inspects the network rather than assuming it is internal"

patterns-established:
  - "Shared isSafeRelativePath in runtime.ts used by both runtimes' getFiles"
  - "Contract suite via describe.each over fake and mocked-engine dockerode"

requirements-completed: [D-01, D-03, D-04, D-15, D-19, D-21]

duration: 10 min
completed: 2026-10-08
---

# Phase 8 Plan 01: Container Runtime Layer Summary

**ContainerRuntime interface with a dockerode/Podman-socket implementation (D-21 limits, internal-network guard, hostile-tar-safe getFiles) and an in-memory fake that pass one shared contract suite.**

## Accomplishments
- One `ContainerRuntime` contract; fake and dockerode (mocked engine) both pass the same lifecycle suite.
- `buildCreateOptions` emits the D-21 limits, with a `layer` fs-mode fallback; no ports, mounts or privilege keys.
- Engine connection errno set maps to `engine_unavailable`; other create/start failures to `container_start_failed`; failed start force-removes the container.
- `ensureNetwork` refuses a non-internal network unless `PI_RUNNER_ALLOW_OPEN_EGRESS=true`.
- `getFiles` rejects `..`/absolute names, skips symlinks and directories, enforces maxBytes/maxFiles.
- Config parser with all 24 documented `PI_*` knobs and defaults.

## Task Commits
1. Task 1 (tracer): runtime contract, fake and dockerode runtimes - `54dc7ce`
2. Task 2: D-21 options, guard, error mapping, config - `910dea0`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Type errors and over-matching comments in Task 1 commit**
- **Found during:** Task 2 (acceptance re-run)
- **Issue:** Task 1 commit had tsc stream-typing errors, and doc comments contained the words `Binds`/`$env` that the acceptance greps match.
- **Fix:** Typed `collect` over `AsyncIterable<unknown>`, reworded comments.
- **Files modified:** runtimeDockerode.ts, runnerConfig.ts, runtimeContract.test.ts
- **Commit:** 910dea0

**2. [Rule 1 - Bug] exec could drop trailing output**
- **Found during:** Task 1
- **Issue:** Resolving on stream end can precede delivery of demuxed chunks.
- **Fix:** End and await both PassThroughs before inspecting the exit code.
- **Commit:** 54dc7ce

**Total deviations:** 2 auto-fixed. **Impact:** none on scope. Task 1 included a tmpfs-mode `buildCreateOptions` (needed by createAndStart); Task 2 added layer mode and tests.

## Issues Encountered
None. Live-engine behaviour (putArchive into tmpfs, rootless limits) is unverifiable here (no Podman); deferred to plan 08 smoke script.

## Verification
- `npx vitest run` on the three test files: 41 passed.
- `npx tsc --noEmit`: no errors under src/lib/server/tryitout/.
- Acceptance greps: dockerode imported only in runtimeDockerode.ts (plus tests); no Binds/PortBindings/stdin/$env/$lib in the restricted files.

## Self-Check: PASSED
