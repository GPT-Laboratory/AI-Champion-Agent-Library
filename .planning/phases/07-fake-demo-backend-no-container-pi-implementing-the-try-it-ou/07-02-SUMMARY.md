---
phase: 07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou
plan: 02
subsystem: data
tags: [oracle-agentspec, sqlite, better-sqlite3, drizzle, ingest, try-it-out]

# Dependency graph
requires:
  - phase: 05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape
    provides: "try_it_out_mode/try_it_out_url/try_it_out_task_template flat nullable columns, never sourced from YAML, never clobbered by ingest's onConflictDoUpdate"
provides:
  - "data/agents/demo-rfi-triage.yaml — the one demo-only agent (slug demo-rfi-triage) this phase runs end to end"
  - "data/tryitout-prompts/demo-rfi-triage/skill.md — the shipped skill file plan 07-03's loader will read"
  - "data/tryitout-prompts/demo-rfi-triage/sample-rfi.txt — live-demo input fixture"
  - "scripts/set-try-it-out-mode.ts — setTryItOutMode(dbPath), the one-off idempotent mode-flip UPDATE"
  - ".tryitout-work/ gitignore entry, ahead of plan 07-03 creating that directory"
affects: [07-03-fake-demo-backend, 07-04-fake-demo-backend, 07-05-fake-demo-backend]

actuals:
  tokens: 3400
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Oracle AgentSpec YAML for a demo-only agent: DEMO ONLY disclaimer as the first words of description, metadata.maturity experimental, tools key omitted entirely, no try_it_out key (mode is DB-only per D-05)"
    - "One-off DB mode-flip script mirrors scripts/ingest.ts conventions: process.env.CATALOG_DB_PATH ?? default, import.meta.url main guard, absolute (not delta) UPDATE values for idempotence, throws on zero-row match instead of silently no-op-ing"

key-files:
  created:
    - data/agents/demo-rfi-triage.yaml
    - data/tryitout-prompts/demo-rfi-triage/skill.md
    - data/tryitout-prompts/demo-rfi-triage/sample-rfi.txt
    - scripts/set-try-it-out-mode.ts
    - scripts/set-try-it-out-mode.test.ts
  modified:
    - .gitignore

key-decisions:
  - "llm_config in demo-rfi-triage.yaml carries gpt-4.1-mini for schema-shape consistency only, with a YAML comment stating the Try It Out backend ignores it entirely (D-07 fixed model/temperature lives in tryItOutModel.ts, plan 07-01)"
  - "setTryItOutMode() throws immediately naming any slug matching zero rows, rather than silently no-op-ing, so a missing/forgotten ingest step fails loudly"

patterns-established:
  - "Demo-only catalog agents: description opens with 'DEMO ONLY — not a production AIC/WP5 catalog agent.', metadata.maturity: experimental, tags include demo — grep-verifiable so this can never be mistaken for a real catalog entry"

requirements-completed: [SC-03]

coverage:
  - id: D1
    description: "demo-rfi-triage.yaml ingests into the agents table with a real system_prompt (SC-03 base-prompt prerequisite) and no try_it_out key in the YAML"
    requirement: "SC-03"
    verification:
      - kind: other
        ref: "npm run ingest && node -e checks for slug=demo-rfi-triage row with system_prompt.length>=40 (see task 1 verify block in 07-02-PLAN.md)"
        status: pass
    human_judgment: false
  - id: D2
    description: "skill.md and sample-rfi.txt exist at the exact paths plan 07-03's loader will read, encoding the urgency/discipline/routing/rationale triage task"
    requirement: "SC-03"
    verification:
      - kind: other
        ref: "grep -ic checks for urgency/structural/MEP/architectural/routing/rationale in skill.md; wc -c on sample-rfi.txt (1226 bytes, within 200-4000 range)"
        status: pass
    human_judgment: false
  - id: D3
    description: "setTryItOutMode() flips demo-rfi-triage to runnable and hvac-load-calculator to none, idempotently, with a Phase 5 no-clobber regression test"
    requirement: "SC-03"
    verification:
      - kind: unit
        ref: "scripts/set-try-it-out-mode.test.ts (4 tests: both mode flips, zero-match throw, idempotence, re-ingest no-clobber) — all pass"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-08-19
status: complete
---

# Phase 07 Plan 02: Demo Agent, Skill File, and Mode-Flip Script Summary

**Created the `demo-rfi-triage` Oracle AgentSpec agent + its shipped `skill.md`/sample fixture, and a one-off idempotent DB script that flips it to `runnable` while reverting `hvac-load-calculator` to `none`**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-19T21:14:00Z (approx.)
- **Completed:** 2026-08-19T21:17:34Z
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments
- `data/agents/demo-rfi-triage.yaml` ingests cleanly (`npm run ingest` — no `[SKIP]` line) into a `slug = 'demo-rfi-triage'` row with a real `system_prompt`, an explicit "DEMO ONLY" disclaimer, no `tools` key, and no `try_it_out` key
- `data/tryitout-prompts/demo-rfi-triage/skill.md` and `sample-rfi.txt` exist at the exact paths plan 07-03's prompt loader will read, encoding the D-02 urgency/discipline/routing/rationale triage task with a predictable labelled-line output contract
- `scripts/set-try-it-out-mode.ts` (`setTryItOutMode`) flips `demo-rfi-triage` to `runnable` and `hvac-load-calculator` back to `none` via a bound-parameter prepared UPDATE, verified idempotent and covered by a Phase-5-no-clobber regression test
- `.gitignore` now excludes `.tryitout-work/` ahead of plan 07-03 becoming its first writer

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the demo-only agent YAML, its skill.md, and a sample RFI fixture** - `9675cf5` (feat)
2. **Task 2: One-off try_it_out_mode UPDATE script plus the .tryitout-work gitignore entry** - `2cdccd5` (feat)

**Plan metadata:** SUMMARY.md committed alongside this plan's task commits (worktree mode — orchestrator handles STATE.md/ROADMAP.md centrally after merge).

## Files Created/Modified
- `data/agents/demo-rfi-triage.yaml` - Oracle AgentSpec YAML for the one demo-only agent; DEMO ONLY disclaimer, no tools, no try_it_out key
- `data/tryitout-prompts/demo-rfi-triage/skill.md` - Shipped skill file: classify by urgency (critical/high/normal/low) and discipline (structural/MEP/architectural), then output Urgency/Discipline/Routing/Rationale labelled lines
- `data/tryitout-prompts/demo-rfi-triage/sample-rfi.txt` - 1226-byte realistic demo RFI (ductwork/beam clash) for the live demo
- `scripts/set-try-it-out-mode.ts` - `setTryItOutMode(dbPath)`: absolute-value idempotent UPDATE for the two targeted slugs, throws on zero-row match
- `scripts/set-try-it-out-mode.test.ts` - 4 passing tests: both mode flips, zero-match error, idempotence, re-ingest no-clobber regression
- `.gitignore` - Appended `.tryitout-work/` (1 line added, 0 removed, existing entries untouched)

## Decisions Made
- `llm_config` in the new YAML is present only for `OracleAgentSpecSchema` shape consistency (schema requires the block); a YAML comment states the Try It Out backend ignores it and always uses the fixed model/temperature from `src/lib/server/tryItOutModel.ts` (D-07, plan 07-01)
- `setTryItOutMode()` throws naming the unmatched slug on zero `changes`, rather than silently no-op-ing, so a forgotten `npm run ingest` step fails loudly instead of leaving stale mode values

## Deviations from Plan

None - plan executed exactly as written. Both tasks' automated verify commands and all acceptance criteria passed on the first attempt; no Rule 1-3 auto-fixes were needed.

## Issues Encountered

- First `npm run ingest` run failed with `no such table: agents` because this worktree's `db/` directory (gitignored, per-worktree) had never been initialized. Ran `npm run db:push` (drizzle-kit push) once to create the table, matching the documented `npm run dev`/`npm run build` script chain (`db:push && ingest && ...`) — not a plan deviation, just the expected first-run bootstrap for a fresh worktree DB.
- `npm test` (full suite) showed 6 pre-existing failing test files (`src/lib/tryItOut.test.ts`, `TryItOutPanel.test.ts`, `try-it-out.test.ts`, `FilterBar.test.ts`, `TechAccordion.test.ts`, `CustomizationPanel.test.ts`) due to `node_modules/@testing-library/` being entirely absent in this worktree, despite being a listed devDependency. This is unrelated to any file this plan touches and is out of scope per the executor scope-boundary rule — logged to `deferred-items.md` in this phase directory rather than fixed. This plan's own new test suite (`scripts/set-try-it-out-mode.test.ts`, 4/4) and the other 48 previously-passing tests were unaffected.

## User Setup Required

None - no external service configuration required (this plan touches no `OPENAI_API_KEY`-dependent code; that lives in the parallel plan 07-01).

## Next Phase Readiness
- Plan 07-03's prompt loader can now read `data/tryitout-prompts/demo-rfi-triage/skill.md` and the `agents.system_prompt` DB column for `slug = 'demo-rfi-triage'` — both exist and are verified.
- The dev DB already reflects the target mode state (`demo-rfi-triage -> runnable`, `hvac-load-calculator -> none`) so plan 07-05's human checkpoint should find the right agent gated for the Try It Out panel once 07-03/07-04 land.
- Blocker/concern: the worktree's stale `node_modules/@testing-library/` gap (see Issues Encountered) should be reconciled (e.g. `npm install`) before any plan relying on the Svelte-component test suite is verified end to end — flagged in `deferred-items.md`, not fixed here as it is outside this plan's file scope.

---
*Phase: 07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou*
*Completed: 2026-08-19*

## Self-Check: PASSED

All created files confirmed present (`data/agents/demo-rfi-triage.yaml`, `data/tryitout-prompts/demo-rfi-triage/skill.md`, `data/tryitout-prompts/demo-rfi-triage/sample-rfi.txt`, `scripts/set-try-it-out-mode.ts`, `scripts/set-try-it-out-mode.test.ts`, this SUMMARY.md) and the `.tryitout-work/` `.gitignore` entry confirmed present. Task commits `9675cf5` and `2cdccd5` confirmed in `git log`.
