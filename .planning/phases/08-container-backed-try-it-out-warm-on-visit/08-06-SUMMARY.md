---
phase: 08-container-backed-try-it-out-warm-on-visit
plan: 06
subsystem: try-it-out-runner
tags: [pi, containers, dispatcher, fallback, job-api]
requires: [08-02, 08-03, 08-04, 08-05]
provides:
  - runJobInContainer, buildPiArgs, PI_INSTRUCTION (piRunner.ts)
  - runJob dispatcher + runDirectLlmJob (Phase 7 body demoted to fallback)
  - session-aware POST /api/tryitout/jobs
affects: [08-07]
tech-stack:
  added: []
  patterns: [files-only task delivery, constant argv, race of exec against app-side timeout]
key-files:
  created:
    - src/lib/server/tryitout/piRunner.ts
    - src/lib/server/tryitout/piRunner.test.ts
  modified:
    - src/lib/server/tryItOutRunner.ts
    - src/lib/server/tryItOutRunner.test.ts
    - src/routes/api/tryitout/jobs/+server.ts
    - src/routes/api/tryitout/jobs/jobs.test.ts
key-decisions:
  - "Fallback to runDirectLlmJob only on engine_unavailable/container_start_failed with fallbackEnabled; busy, session_busy and every post-claim failure never fall back"
  - "App-side timer (jobTimeoutMs + 5 s) is raced against exec so a hung stream cannot wedge the job; it discards the container"
  - "Budget failure message takes precedence over the Pi verdict when proxy usage reports budgetExceeded"
requirements-completed: [D-06, D-07, D-11, D-12, D-13, D-14, D-15, D-16, D-20, D-22]
duration: ~25 min
completed: 2026-10-08
---

# Phase 8 Plan 06: Run jobs in the Pi container Summary

Jobs now execute `timeout --signal=KILL <s> pi --mode json --offline ...` inside the session's warm container behind the unchanged job API, with Pi events mapped to the feed, output zipped, and the Phase 7 direct model call kept only as a narrowly scoped fallback.

## Accomplishments
- piRunner.ts: constant argv from config and validated slug; task/upload written only as `/work/<jobId>/input/*` files; JSONL events to feed; output via getFiles with result.txt fallback from the last assistant text; per-job proxy budget (beginJob/endJob); rm -rf of job dir and lease release on clean jobs, discard on timeout or exec error.
- Dispatcher in tryItOutRunner.ts with D-14 rules, console.warn plus visible feed line on fallback, never rejects.
- POST route passes `sessionKey({ locals, cookies, url })` into createJob.
- Tests: container path end to end (jobs.test.ts), dispatcher with it.each invariant over all six RuntimeErrorCodes, 12 piRunner failure/cleanup/reuse tests. 54 tests in the three files pass; full suite has only the 3 known pre-existing set-try-it-out-mode failures.

## Task Commits
1. Task 1 (tracer): 8697220
2. Task 2: ff3978c
3. Task 3: 1ab44f4

## Deviations from Plan

### Auto-fixed Issues
**1. [Rule 1 - Bug] Timeout test config**
- Found during: Task 3
- Issue: planned 50 ms timeout is below the config minimum (1000 ms) and the env var is PI_RUNNER_JOB_TIMEOUT_MS
- Fix: tests use 1000 ms; the hung-stream case uses fake timers
- Commit: 1ab44f4

Production code for the timeout/budget/cleanup paths was written in the Task 1 commit (piRunner.ts was authored whole), so Task 3 added only tests. No behavioral deviation.

## Self-Check: PASSED
Files exist, commits 8697220/ff3978c/1ab44f4 present, the three target test files pass, tsc clean on touched files, acceptance greps pass (runDirectLlmJob/runJob 1 each, sessionKey( 1, clearTimeout 1, agent_end 0, no busy fallback).
