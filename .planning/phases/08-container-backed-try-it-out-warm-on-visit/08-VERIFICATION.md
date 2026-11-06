---
phase: 08-container-backed-try-it-out-warm-on-visit
verified: 2026-10-12T00:00:00Z
status: passed
score: 8/8 plans' must-haves verified
gaps: []
---

# Phase 8 Verification

**Goal:** Opening an agent detail page warms a Pi container with that agent's skill; Try It Out runs in it behind the existing job API; Phase 7 direct-LLM runner stays as fallback.

**Status: passed.**

## Evidence
- `npx vitest run src/lib/server src/routes`: 31 files, 273 tests passed.
- Full suite per orchestrator: 408 pass, 3 pre-existing failures in scripts/set-try-it-out-mode.test.ts (pre-date phase); tsc shows only 22 pre-existing errors in untouched test files.
- Artifact spot checks: all tryitout modules exist (artifact, config, leaseManager, llmProxy, piEvents, piFixtures, piRunner, runtime, runtimeDockerode, runtimeFake, service, session, redact, clientLimit, runnerConfig) with tests; `dockerode` imported only in runtimeDockerode.ts (D-03/R-single-import); LLM proxy route present; Containerfile.pi-runner pins pi-coding-agent@1.0.4; scripts/smoke-pi-runner.ts exists.
- Wiring: agents/[slug]/+page.server.ts calls `warmForSession` fire-and-forget with `.catch`; hooks.server.ts exports `init`; tryItOutRunner.ts calls `runJobInContainer`.
- Live verification (08-08-SUMMARY, user approved, rootless Podman 4.9.3): smoke PASS, warm-on-visit, real job with Pi tool events, zip with result.txt, container reuse, fallback with engine down, idle TTL, crash/SIGTERM cleanup, compose socket + internal network, internet blocked, no OpenAI key in container env.

## Decisions D-01..D-22
All claimed across the 8 plans and covered by tests plus the live run. Review fixes WR-01/02/03/04/06/07 applied.

## Known issues (non-blocking, deferred from 08-REVIEW)
WR-05, WR-08, WR-09, IN-01..IN-05: none found to violate a locked decision; not gaps.

## Human verification
None outstanding (live check already approved by the user).
