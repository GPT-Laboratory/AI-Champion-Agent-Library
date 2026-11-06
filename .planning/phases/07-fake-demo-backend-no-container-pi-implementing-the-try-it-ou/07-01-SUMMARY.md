---
phase: 07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou
plan: 01
subsystem: infra
tags: [openai, model-selection, environment-setup, secrets]

# Dependency graph
requires:
  - phase: 06-runnable-try-it-out-flow-mock-backed
    provides: mock-backed submitJob/subscribeProgress/downloadArtifact client and TryItOutPanel.svelte
provides:
  - openai SDK (^7.5.0) as a runtime dependency
  - scripts/probe-openai-model.ts — reproducible live model/temperature probe
  - MODEL-PROBE.md — recorded real probe output (gpt-4.1-mini, temperature accepted)
  - src/lib/server/tryItOutModel.ts exporting MODEL/TEMPERATURE/modelParams()
affects: [07-02, 07-03, 07-04, 07-05]

actuals:
  tokens: 2400
  tasks: 4
  commits: 4

tech-stack:
  added: ["openai ^7.5.0"]
  patterns:
    - "Standalone tsx probe scripts under scripts/ never wired into npm test/build/dev, output captured into a phase-local MODEL-PROBE.md rather than re-run in CI"
    - "modelParams() returns {} instead of {temperature: null} so a rejected parameter is never sent in the request payload"

key-files:
  created:
    - scripts/probe-openai-model.ts
    - .planning/phases/07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou/MODEL-PROBE.md
    - src/lib/server/tryItOutModel.ts
    - src/lib/server/tryItOutModel.test.ts
    - .planning/phases/07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou/deferred-items.md
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "gpt-4.1-mini confirmed present in the live client.models.list() response for the deployed key — resolves RESEARCH.md's contradiction between the official pricing page and third-party 404-claim blog posts, for this key specifically"
  - "temperature=0.2 empirically accepted by a real client.responses.create() round-trip — D-07's fixed-low-temperature requirement is met exactly, the gpt-5.6-* fallback-with-omitted-temperature branch was NOT needed"
  - "Task 4 (D-07 costly-reversibility decision checkpoint) resolved: user selected accept-probe — gpt-4.1-mini / temperature=0.2 locked as-is, no override, no D-07 revisit"

patterns-established:
  - "Server-only constants module (tryItOutModel.ts) follows db.ts's two-line header convention verbatim and never imports OPENAI_API_KEY itself — the SDK client lives in the runner (07-03), not here"

requirements-completed: []

# Coverage metadata: This plan closes SC-04/SC-09 only partially (per its own
# must_haves: "SC-04 (partial)", "SC-09 (partial)") — full closure requires
# plans 07-02/07-03/07-04. requirements-completed intentionally stays empty
# here; the orchestrator's requirements mark-complete step (shared artifact,
# not touched by this parallel worktree executor) runs after all phase plans
# land.

# Metrics
duration: 16min
completed: 2026-08-20
status: complete
---

# Phase 07 Plan 01: Model Probe and Constants Freeze Summary

**openai SDK installed; live client.models.list() confirmed `gpt-4.1-mini` reachable and `temperature: 0.2` accepted by a real round-trip; frozen into src/lib/server/tryItOutModel.ts — user selected `accept-probe` at the D-07 decision checkpoint, closing this plan.**

## Performance

- **Duration:** ~16 min total across sessions (Task 1 and Task 4 were separate human-input sessions; Tasks 2-3 were one continuous run)
- **Started:** 2026-08-19T21:35:00+03:00 (approx, prior continuation)
- **Completed:** 2026-08-20 (this continuation — Task 4 decision-record only, no code change)
- **Tasks:** 4/4 completed (all tasks done, plan closed)
- **Files modified:** 7 (2 modified, 5 created) — unchanged by Task 4, which recorded a decision only

## Accomplishments

- Installed `openai@^7.5.0` as a runtime dependency (D-06) — confirmed in `dependencies`, not `devDependencies`
- Built `scripts/probe-openai-model.ts`: a reproducible, never-wired-into-CI probe that calls the real `client.models.list()` and empirically probes temperature acceptance via a real `client.responses.create()` round-trip (not inferred from the model name)
- Ran the probe against the deployed `OPENAI_API_KEY`: `gpt-4.1-mini` is present in `models.list()` and `temperature: 0.2` was `TEMPERATURE_ACCEPTED` on the first try — no fallback branch needed
- Recorded the real captured output in `MODEL-PROBE.md` (verified zero `sk-` occurrences)
- Froze the result into `src/lib/server/tryItOutModel.ts`, exporting `MODEL = 'gpt-4.1-mini'`, `TEMPERATURE = 0.2`, and `modelParams()`, matching `db.ts`'s server-only header convention and never reading `OPENAI_API_KEY` itself
- Added `src/lib/server/tryItOutModel.test.ts` — all 4 assertions pass
- Task 4 (D-07 costly-reversibility decision checkpoint): user selected `accept-probe` — `gpt-4.1-mini` / `temperature: 0.2` locked as-is; decision recorded in `MODEL-PROBE.md`, no code change needed since `tryItOutModel.ts` already encoded exactly this value

## Task Commits

Each task was committed atomically:

1. **Task 1: Supply the OpenAI API key (human-only)** — `6aebeb1` (docs; halt record from the prior session — key has since been supplied and verified present in this worktree's `.env`)
2. **Task 2: Install the openai SDK and run the live model + temperature probe** — `5ea5bed` (feat)
3. **Task 3: Freeze the choice into src/lib/server/tryItOutModel.ts** — `212bcd2` (feat)
4. **Task 4: Lock the fixed model + temperature (D-07 decision checkpoint)** — `df5cc8d` (docs; decision-record only — `accept-probe` selected, no code change)

## Files Created/Modified

- `package.json` / `package-lock.json` — `openai` added as a runtime dependency
- `scripts/probe-openai-model.ts` — live model-availability + temperature-acceptance probe (never wired into `test`/`build`/`dev`)
- `.planning/phases/07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou/MODEL-PROBE.md` — real captured probe output backing the model/temperature choice
- `src/lib/server/tryItOutModel.ts` — exports `MODEL`, `TEMPERATURE`, `modelParams()` (D-07/D-08)
- `src/lib/server/tryItOutModel.test.ts` — unit tests for the above
- `.planning/phases/07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou/deferred-items.md` — logs two pre-existing, unrelated failures found during verification (see Issues Encountered)

## Decisions Made

- Accepted the probe's primary-recommendation branch: `gpt-4.1-mini` + `temperature: 0.2`, both empirically confirmed against the deployed key — no fallback to the `gpt-5.6-*` family was needed
- Task 4 (D-07 costly-reversibility decision checkpoint): user selected `accept-probe` — confirming `gpt-4.1-mini` / `temperature: 0.2` as the single fixed model/temperature for all runnable demo agents; no `override-model` and no `revisit-d07`

## Deviations from Plan

None (Rules 1-3) — plan executed exactly as written for Tasks 2 and 3. One minor in-task correction: the first draft of `tryItOutModel.ts`'s header comment used the literal strings `OPENAI_API_KEY` and `` `llm_config` `` in prose, which tripped Task 3's own acceptance-criteria grep (`grep -cE "OPENAI_API_KEY|llm_config|llmName|llmTemperature"` must return 0); reworded the comments to describe the same facts without the literal matched strings, re-verified the grep returns 0, no behavior change — folded into the Task 3 commit, not logged as a separate deviation since it was caught and fixed before the task's commit, not after.

## Issues Encountered

- `npx tsc --noEmit` reports pre-existing errors in `src/routes/catalog/+page.server.ts`, `src/routes/catalog/catalog.test.ts`, and `src/routes/agents/try-it-out.test.ts` (missing `$lib/server/db.js` resolution, implicit-any params, `PageData` mismatches). Confirmed pre-existing by `git stash -u` (removing all of this plan's changes) and re-running — identical error set, none referencing `tryItOutModel.ts`. Logged in `deferred-items.md`, out of scope for this plan.
- `npm test` shows 6 pre-existing failures in `scripts/ingest.test.ts` (`Cannot open database because the directory does not exist`). Confirmed pre-existing the same way. All other 104 tests (including the new `tryItOutModel.test.ts`) pass. Logged in `deferred-items.md`, out of scope for this plan.

## User Setup Required

None further — Task 1's `OPENAI_API_KEY` setup is complete and verified present in this worktree's `.env` (gitignored, untracked, resolvable via `node --env-file=.env`).

## Next Phase Readiness

**Plan complete — 4/4 tasks done.** The D-07 decision is locked: `MODEL = 'gpt-4.1-mini'`, `TEMPERATURE = 0.2`, `modelParams()` exported from `src/lib/server/tryItOutModel.ts`, backed by a live probe recorded in `MODEL-PROBE.md`. Plans 07-02/07-03/07-04 can now consume `MODEL`/`TEMPERATURE`/`modelParams()` without further open questions on the model/temperature axis.

## Self-Check: PASSED

- `scripts/probe-openai-model.ts` exists — confirmed via `ls`/git show
- `.planning/phases/07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou/MODEL-PROBE.md` exists — confirmed
- `src/lib/server/tryItOutModel.ts` and `src/lib/server/tryItOutModel.test.ts` exist — confirmed, tests pass (4/4)
- Commit `5ea5bed` found in `git log --oneline`
- Commit `212bcd2` found in `git log --oneline`
- Commit `df5cc8d` found in `git log --oneline`
- `npx vitest run src/lib/server/tryItOutModel.test.ts` re-verified passing (4/4) before finalizing this SUMMARY

---
*Phase: 07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou*
*Completed: 2026-08-20*
